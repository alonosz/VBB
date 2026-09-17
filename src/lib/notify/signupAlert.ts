/**
 * A line to the operator's inbox when somebody signs up.
 *
 * The admin page lists everyone; this is for the moment it happens, so a
 * design partner who finally opened the link gets a reply the same hour
 * rather than whenever the list is next checked. Two signup paths exist,
 * the modal and the Google button, and both come through here.
 *
 * Sent through Resend's REST endpoint with plain fetch, no SDK. Configured
 * by RESEND_API_KEY and VBB_ALERT_EMAIL; with either unset nothing is sent
 * and nothing is logged, because an unconfigured alert is a choice, not a
 * fault. A send that fails or hangs never touches the signup: it is waited
 * for briefly, then abandoned with a line in the log.
 *
 * Name and address go in the message and nowhere else new. They are the
 * same two facts the workspace row already carries.
 */

export interface SignupAlert {
  name: string;
  email: string;
  workspaceId: string;
  /** Which door they came through. */
  via: "email" | "google";
  at: Date;
}

export interface Mailer {
  send(message: { subject: string; text: string }): Promise<void>;
}

/** How long a signup will wait on the alert before carrying on without it. */
export const SEND_TIMEOUT_MS = 4_000;

const DEFAULT_FROM = "ValueBasedBidding <onboarding@resend.dev>";
const DEFAULT_ORIGIN = "https://valuebasedbidding.com";

export function signupAlertMessage(alert: SignupAlert, adminUrl: string): { subject: string; text: string } {
  const when = `${alert.at.toISOString().replace("T", " ").slice(0, 16)} UTC`;
  const via = alert.via === "google" ? "Sign up with Google" : "the signup form";
  return {
    subject: `New signup: ${alert.name} <${alert.email}>`,
    text: [
      `${alert.name} just signed up to ValueBasedBidding.com via ${via}.`,
      "",
      `Name:       ${alert.name}`,
      `Email:      ${alert.email}`,
      `Workspace:  ${alert.workspaceId}`,
      `When:       ${when}`,
      "",
      `Everyone so far: ${adminUrl}`,
    ].join("\n"),
  };
}

export class ResendMailer implements Mailer {
  constructor(
    private apiKey: string,
    private to: string,
    private from: string = DEFAULT_FROM,
    private fetchImpl: typeof fetch = fetch
  ) {}

  async send(message: { subject: string; text: string }): Promise<void> {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [this.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Resend answered ${res.status}`);
  }
}

/** For tests: remembers what would have been sent. */
export class InMemoryMailer implements Mailer {
  sent: { subject: string; text: string }[] = [];
  constructor(private fail = false) {}
  async send(message: { subject: string; text: string }): Promise<void> {
    if (this.fail) throw new Error("mail is down");
    this.sent.push(message);
  }
}

export function alertMailerFromEnv(env: Record<string, string | undefined> = process.env): Mailer | null {
  const key = env.RESEND_API_KEY?.trim();
  const to = env.VBB_ALERT_EMAIL?.trim();
  if (!key || !to) return null;
  const from = env.VBB_ALERT_FROM?.trim() || DEFAULT_FROM;
  return new ResendMailer(key, to, from);
}

export function adminUrlFromEnv(env: Record<string, string | undefined> = process.env): string {
  const origin = (env.VBB_PUBLIC_ORIGIN?.trim() || DEFAULT_ORIGIN).replace(/\/+$/, "");
  return `${origin}/admin`;
}

/**
 * Send the alert, and never let it matter to the caller. Resolves once the
 * message is away, or once it has failed and been noted; it never throws.
 */
export async function notifySignup(
  mailer: Mailer | null | undefined,
  alert: SignupAlert,
  adminUrl: string = adminUrlFromEnv()
): Promise<void> {
  if (!mailer) return;
  try {
    await mailer.send(signupAlertMessage(alert, adminUrl));
  } catch (error) {
    console.warn("signup alert was not sent:", error instanceof Error ? error.message : error);
  }
}
