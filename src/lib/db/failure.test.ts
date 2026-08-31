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
});
