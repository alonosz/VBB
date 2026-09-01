import { describe, expect, it } from "vitest";
import { describeDatabaseFailure } from "./failure";

describe("describeDatabaseFailure", () => {
  it("names the missing migration as the cause when a column is not there", () => {
    const said = describeDatabaseFailure(
      new Error(
        "Could not find the 'value_bidding_switched_at' column of 'workspaces' in the schema cache"
      )
    );
    expect(said).toMatch(/migration/i);
    expect(said).toContain("value_bidding_switched_at");
  });

  it("says the same for a missing table", () => {
    expect(
      describeDatabaseFailure(new Error('relation "public.workspaces" does not exist'))
    ).toMatch(/migration/i);
  });

  it("does not blame a migration for an unrelated failure", () => {
    const said = describeDatabaseFailure(new Error("JWT expired"));
    expect(said).not.toMatch(/migration/i);
    expect(said).toContain("JWT expired");
  });

  it("survives something that is not an Error at all", () => {
    expect(describeDatabaseFailure("timeout")).toContain("timeout");
  });

  /*
   * The two shapes Postgres actually uses when a migration has not been run,
   * caught in the wild on this project: a CHECK that does not know a new
   * provider value, and a primary key that still assumes one row per
   * workspace. Both surfaced as "the connection could not be saved" with no
   * clue which of a dozen things was wrong.
   */
  it("names a migration when a constraint rejects a value it has not been taught", () => {
    const said = describeDatabaseFailure(
      new Error(
        'new row for relation "crm_connections" violates check constraint "crm_connections_provider_known"'
      )
    );
    expect(said).toContain("crm_connections_provider_known");
  });

  it("passes a duplicate-key failure through in the operator's own words", () => {
    const said = describeDatabaseFailure(
      new Error(
        'duplicate key value violates unique constraint "crm_connections_one_per_workspace"'
      )
    );
    expect(said).toContain("crm_connections_one_per_workspace");
    expect(said).toMatch(/refused/i);
  });
});
