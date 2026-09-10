/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { forgetEverything } from "./signOut";
import { CONTACT_EMAIL_STORE } from "@/lib/leads/contactEmail";
import { WORKSPACE_KEY_STORE, WORKSPACE_NAME_STORE } from "@/lib/workspace/clientKey";

describe("forgetEverything", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("removes the key, the name, the address, the model and the flow", () => {
    localStorage.setItem(WORKSPACE_KEY_STORE, "vbb_ws_abcdefghijklmnopqrstuvwxyz");
    localStorage.setItem(WORKSPACE_NAME_STORE, "Acme");
    localStorage.setItem(CONTACT_EMAIL_STORE, "a@acme.com");
    // The model slot is named after the key's tail; it must go while the key
    // is still there to name it.
    localStorage.setItem("vbb.savedModel.v1.opqrstuvwxyz", "{}");
    localStorage.setItem("vbb.savedModel.v1", "{}");
    sessionStorage.setItem("vbb.diagnostic.v1", "{}");

    forgetEverything();

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("is safe with nothing stored", () => {
    expect(() => forgetEverything()).not.toThrow();
  });
});
