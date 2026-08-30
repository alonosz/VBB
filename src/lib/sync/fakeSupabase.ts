import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Just enough of the Supabase query builder for the calls CrmConnectionStore
 * makes, with the rows left visible so a test can assert what was actually
 * written. Used only by tests; nothing in the app imports it.
 *
 * Rows are keyed by workspace *and provider*, because that is the table's
 * primary key. A fake keyed on the workspace alone would let a Google Ads
 * connection quietly overwrite a HubSpot one and report every test green,
 * which is the exact bug the composite key exists to prevent.
 *
 * The filter builder is a thenable, as the real one is: `.eq().eq()` chains,
 * and the operation runs when it is awaited rather than on the first filter.
 */
export function fakeSupabase() {
  const rows = new Map<string, Record<string, unknown>>();
  const keyOf = (row: Record<string, unknown>) =>
    `${String(row.workspace_id)}|${String(row.provider)}`;

  const builder = () => {
    const filters: Record<string, unknown> = {};
    let pending: "select" | "update" | "delete" | null = null;
    let updateRow: Record<string, unknown> | null = null;

    const matching = () =>
      [...rows.entries()].filter(([, row]) =>
        Object.entries(filters).every(([column, value]) => row[column] === value)
      );

    function run(): { data: Record<string, unknown>[]; error: null } {
      const hits = matching();
      if (pending === "update") {
        for (const [key, row] of hits) rows.set(key, { ...row, ...updateRow });
      } else if (pending === "delete") {
        for (const [key] of hits) rows.delete(key);
      }
      return { data: hits.map(([, row]) => row), error: null };
    }

    const api: Record<string, unknown> = {
      upsert(row: Record<string, unknown>) {
        rows.set(keyOf(row), { ...(rows.get(keyOf(row)) ?? {}), ...row });
        return Promise.resolve({ error: null });
      },
      select() {
        pending = "select";
        return api;
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
      eq(column: string, value: unknown) {
        filters[column] = value;
        return api;
      },
      maybeSingle() {
        return Promise.resolve({ data: run().data[0] ?? null, error: null });
      },
      // Awaiting the builder is what executes it, exactly as Supabase does.
      then(
        resolve: (value: { data: Record<string, unknown>[]; error: null }) => unknown,
        reject?: (reason: unknown) => unknown
      ) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return api;
  };

  return {
    client: { from: builder } as unknown as SupabaseClient,
    rows,
    /** The stored row for one workspace and provider, as the table keys it. */
    rowFor(workspaceId: string, provider = "hubspot") {
      return rows.get(`${workspaceId}|${provider}`);
    },
  };
}
