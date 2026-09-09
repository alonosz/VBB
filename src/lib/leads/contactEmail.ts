/**
 * The address the advertiser gave at the moment of connecting, kept beside
 * the workspace key so it is asked for once: at HubSpot on step two, and not
 * again at Google Ads on step five.
 */
export const CONTACT_EMAIL_STORE = "vbb.contactEmail.v1";

export function readContactEmail(): string | null {
  try {
    return typeof window === "undefined" ? null : localStorage.getItem(CONTACT_EMAIL_STORE);
  } catch {
    return null;
  }
}

export function rememberContactEmail(email: string): void {
  try {
    localStorage.setItem(CONTACT_EMAIL_STORE, email.trim());
  } catch {
    // A private window asks once more next time. Nothing else is lost.
  }
}

export function forgetContactEmail(): void {
  try {
    localStorage.removeItem(CONTACT_EMAIL_STORE);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
