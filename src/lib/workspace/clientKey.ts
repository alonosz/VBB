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
    localStorage.removeItem(WORKSPACE_NAME_STORE);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

/**
 * Their company name, kept beside the key.
 *
 * Not a credential and not used for anything but a greeting: an invite now
 * hands somebody to the front page rather than dead-ending on a confirmation
 * screen, and a front page that cannot say whose workspace is ready has
 * silently swallowed the one thing that link was for.
 */
export const WORKSPACE_NAME_STORE = "vbb.workspaceName.v1";

export function readWorkspaceName(): string | null {
  try {
    return typeof window === "undefined" ? null : localStorage.getItem(WORKSPACE_NAME_STORE);
  } catch {
    return null;
  }
}

export function rememberWorkspaceName(name: string): void {
  try {
    localStorage.setItem(WORKSPACE_NAME_STORE, name.trim());
  } catch {
    // The greeting is a nicety. Losing it costs nothing.
  }
}
