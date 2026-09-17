import { describe, expect, it } from "vitest";
import {
  InMemoryMailer,
  ResendMailer,
  adminUrlFromEnv,
  alertMailerFromEnv,
  notifySignup,
  signupAlertMessage,
} from "./signupAlert";

const alert = {
  name: "Dana Klein",
  email: "dana@example.com",
  workspaceId: "ws-7",
  via: "email" as const,
  at: new Date("2026-09-17T09:05:00Z"),
};

describe("the alert", () => {
  it("says who, how, and where to see everyone", () => {
    const m = signupAlertMessage(alert, "https://valuebasedbidding.com/admin");
    expect(m.subject).toBe("New signup: Dana Klein <dana@example.com>");
    expect(m.text).toContain("via the signup form");
    expect(m.text).toContain("Email:      dana@example.com");
    expect(m.text).toContain("2026-09-17 09:05 UTC");
    expect(m.text).toContain("https://valuebasedbidding.com/admin");
    expect(signupAlertMessage({ ...alert, via: "google" }, "x").text).toContain("Sign up with Google");
  });

  it("is off, silently, until both settings exist", () => {
    expect(alertMailerFromEnv({})).toBeNull();
    expect(alertMailerFromEnv({ RESEND_API_KEY: "re_x" })).toBeNull();
    expect(alertMailerFromEnv({ VBB_ALERT_EMAIL: "me@x.com" })).toBeNull();
    expect(alertMailerFromEnv({ RESEND_API_KEY: "re_x", VBB_ALERT_EMAIL: "me@x.com" })).toBeInstanceOf(ResendMailer);
  });

  it("links the admin page on the configured origin", () => {
    expect(adminUrlFromEnv({})).toBe("https://valuebasedbidding.com/admin");
    expect(adminUrlFromEnv({ VBB_PUBLIC_ORIGIN: "https://staging.example.com/" })).toBe("https://staging.example.com/admin");
  });

  it("posts one message to Resend with the right shape", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const mailer = new ResendMailer("re_key", "me@x.com", "VBB <alerts@x.com>", fetchImpl);
    await mailer.send({ subject: "s", text: "t" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer re_key");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ from: "VBB <alerts@x.com>", to: ["me@x.com"], subject: "s", text: "t" });
  });

  it("treats a refusal from Resend as a failure", async () => {
    const fetchImpl = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
    await expect(new ResendMailer("k", "me@x.com", undefined, fetchImpl).send({ subject: "s", text: "t" })).rejects.toThrow(/403/);
  });

  it("never lets a failed send reach the signup", async () => {
    await expect(notifySignup(new InMemoryMailer(true), alert, "x")).resolves.toBeUndefined();
    await expect(notifySignup(null, alert, "x")).resolves.toBeUndefined();
    const ok = new InMemoryMailer();
    await notifySignup(ok, alert, "x");
    expect(ok.sent).toHaveLength(1);
  });
});
