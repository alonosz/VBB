import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Just enough of the Supabase query builder for the calls CrmConnectionStore
 * makes, with the rows left visible so a test can assert what was actually
 * written. Used only by tests; nothing in the app imports it.
 */
export function fakeSupabase() {
  const rows = new Map<string, Record<string, unknown>>();

  const builder = () => {
    let filterValue: string | null = null;
    let pending: "select" | "update" | "delete" | null = null;
    let updateRow: Record<string, unknown> | null = null;

    const api: Record<string, unknown> = {
      upsert(row: Record<string, unknown>) {
        rows.set(String(row.feed_id), { ...(rows.get(String(row.feed_id)) ?? {}), ...row });
        return Promise.resolve({ error: null });
      },
      select() {
        pending = "select";
        return Object.assign(Promise.resolve({ data: [...rows.values()], error: null }), api);
      },
      update(row: Record<string, unknown>) {
        pending = "update";
        updateRow = row;
        return api;
      },
      delete() {
        pending = "delete";
        return api;
      },
      eq(_column: string, value: string) {
        filterValue = value;
        if (pending === "update") {
          const existing = rows.get(value);
          if (existing) rows.set(value, { ...existing, ...updateRow });
          return Promise.resolve({ error: null });
        }
        if (pending === "delete") {
          rows.delete(value);
          return Promise.resolve({ error: null });
        }
        return api;
      },
      maybeSingle() {
        return Promise.resolve({ data: rows.get(filterValue ?? "") ?? null, error: null });
      },
    };
    return api;
  };

  return { client: { from: builder } as unknown as SupabaseClient, rows };
}
