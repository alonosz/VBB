/**
 * The workspace key, as the browser holds it.
 *
 * Written once by the workspace page and read by every screen that needs to
 * prove whose account it is acting for. One place, because the alternative -
 * each screen reaching into local storage with its own spelling of the key
 * name - is how a screen ends up silently unauthenticated, which is exactly
 * what happened to the connect page.
 */

export const WORKSPACE_KEY_STORE = "vbb.workspaceKey.v1";

export function readWorkspaceKey(): string | null {
  try {
    // Throws outright in some privacy modes rather than returning null.
    return typeof window === "undefined" ? null : localStorage.getItem(WORKSPACE_KEY_STORE);
  } catch {
    return null;
  }
}

export function rememberWorkspaceKey(key: string): void {
  try {
    localStorage.setItem(WORKSPACE_KEY_STORE, key.trim());
  } catch {
    // A private window is not a reason to block the flow; the key can be
    // pasted again next time.
  }
}

export function forgetWorkspaceKey(): void {
  try {
    localStorage.removeItem(WORKSPACE_KEY_STORE);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
