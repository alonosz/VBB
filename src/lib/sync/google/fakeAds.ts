import type { AdsCredentials } from "./client";
import { API_VERSION } from "./client";

/**
 * A Google Ads account that answers back.
 *
 * The developer token is applied for and reviewed by a person, so it arrives
 * days after the code that needs it. Building against a fake is not a
 * workaround for that wait: it is the only way to drive the failure paths that
 * matter - a refused token, a rejected row, an account in the wrong currency -
 * which a real account will not produce on demand.
 *
 * It checks the headers rather than ignoring them. A fake that accepts a call
 * missing the developer token would let that bug reach the one environment
 * where it costs a day to diagnose.
 */

export interface FakeAdsOptions {
  developerToken?: string;
  /** Endpoint suffix to canned response, e.g. "customers:listAccessibleCustomers". */
  responses?: Record<string, unknown>;
  /** Endpoint suffix to the failure it should produce instead. */
  failures?: Record<string, { status: number; errorCode: string; message: string }>;
}

export interface RecordedCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export function fakeAds(opts: FakeAdsOptions = {}) {
  const developerToken = opts.developerToken ?? "dev-token-test";
  const calls: RecordedCall[] = [];

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    const path = href.split(`/${API_VERSION}/`)[1] ?? href;
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ])
    );
    calls.push({
      method: init?.method ?? "GET",
      path,
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    const refuse = (status: number, errorCode: string, message: string) =>
      new Response(
        JSON.stringify({
          error: {
            code: status,
            message: "Request had invalid authentication credentials.",
            details: [{ errors: [{ errorCode: { authenticationError: errorCode }, message }], requestId: "req-1" }],
          },
        }),
        { status }
      );

    if (!headers.authorization?.startsWith("Bearer ")) {
      return refuse(401, "NOT_ADS_USER", "The caller sent no access token.");
    }
    if (headers["developer-token"] !== developerToken) {
      return refuse(401, "DEVELOPER_TOKEN_NOT_APPROVED", "The developer token is not approved.");
    }

    const failure = opts.failures?.[path];
    if (failure) {
      return new Response(
        JSON.stringify({
          error: {
            code: failure.status,
            message: "Request contains an invalid argument.",
            details: [
              {
                errors: [{ errorCode: { requestError: failure.errorCode }, message: failure.message }],
                requestId: "req-2",
              },
            ],
          },
        }),
        { status: failure.status }
      );
    }

    const canned = opts.responses?.[path];
    return new Response(JSON.stringify(canned ?? {}), { status: 200 });
  }) as unknown as typeof fetch;

  const credentials: AdsCredentials = {
    accessToken: "access-token-test",
    developerToken,
  };

  return { fetchImpl, calls, credentials, origin: "https://ads.test" };
}
