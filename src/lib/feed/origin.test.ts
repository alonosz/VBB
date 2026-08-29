import { describe, expect, it } from "vitest";
import { feedOrigin, isDeploymentOrigin } from "./origin";

const DEPLOYMENT = "https://vbb-7ckmpyb5m-vbb2.vercel.app";

describe("feedOrigin", () => {
  it("prefers an explicit custom domain over everything else", () => {
    expect(
      feedOrigin({
        requestOrigin: DEPLOYMENT,
        publicOrigin: "https://app.valuebasedbidding.com",
        productionUrl: "vbb-vbb2.vercel.app",
      })
    ).toBe("https://app.valuebasedbidding.com");
  });

  it("uses the production domain when the request came from a deployment URL", () => {
    // The bug this exists to prevent: publishing while looking at a build-hash
    // URL handed Google a link pinned to one deployment.
    expect(
      feedOrigin({ requestOrigin: DEPLOYMENT, productionUrl: "vbb-vbb2.vercel.app" })
    ).toBe("https://vbb-vbb2.vercel.app");
  });

  it("adds the protocol Vercel leaves off its env var", () => {
    expect(feedOrigin({ requestOrigin: DEPLOYMENT, productionUrl: "vbb-vbb2.vercel.app" }))
      .toMatch(/^https:\/\//);
  });

  it("falls back to the request origin off Vercel, so local development works", () => {
    expect(feedOrigin({ requestOrigin: "http://localhost:3000" })).toBe("http://localhost:3000");
  });

  it("ignores blank or unparseable configuration rather than emitting a broken URL", () => {
    expect(feedOrigin({ requestOrigin: "https://real.example", publicOrigin: "   " }))
      .toBe("https://real.example");
    expect(feedOrigin({ requestOrigin: "https://real.example", productionUrl: "http://" }))
      .toBe("https://real.example");
  });

  it("strips a trailing slash, so the built URL never doubles it", () => {
    expect(feedOrigin({ requestOrigin: "https://x.example", publicOrigin: "https://y.example/" }))
      .toBe("https://y.example");
  });
});

describe("isDeploymentOrigin", () => {
  it("recognises a per-deployment Vercel URL", () => {
    expect(isDeploymentOrigin(DEPLOYMENT)).toBe(true);
  });

  it("does not flag a production Vercel domain or a custom one", () => {
    expect(isDeploymentOrigin("https://vbb-vbb2.vercel.app")).toBe(false);
    expect(isDeploymentOrigin("https://app.valuebasedbidding.com")).toBe(false);
    expect(isDeploymentOrigin("http://localhost:3000")).toBe(false);
  });
});

describe("normalizing hostile configuration", () => {
  it("refuses a bare scheme rather than inventing a host from it", () => {
    // "http://" once became "https://http" - a URL that parses, looks
    // plausible in a log, and points nowhere.
    for (const junk of ["http://", "https://", "//", "://", "https:"]) {
      expect(feedOrigin({ requestOrigin: "https://real.example", publicOrigin: junk })).toBe(
        "https://real.example"
      );
    }
  });

  it("refuses a host with no dot, which is always a typo", () => {
    expect(feedOrigin({ requestOrigin: "https://real.example", productionUrl: "vbb-vbb2" }))
      .toBe("https://real.example");
  });

  it("still allows localhost, the one legitimate dotless host", () => {
    expect(feedOrigin({ requestOrigin: "http://localhost:3000" })).toBe("http://localhost:3000");
  });

  it("refuses a non-http scheme", () => {
    expect(feedOrigin({ requestOrigin: "https://real.example", publicOrigin: "ftp://x.example" }))
      .toBe("https://real.example");
  });
});
