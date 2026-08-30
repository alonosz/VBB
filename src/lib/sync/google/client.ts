/**
 * Talking to the Google Ads API.
 *
 * The transport only. What to ask for lives in the services beside this file;
 * what is here is the part every call shares: the three headers Google
 * requires, the customer id format it insists on, and turning its error shape
 * into something a person can read.
 *
 * That last part is the reason this route exists at all. Publishing a CSV and
 * letting Google fetch it works, but it is a shout into the dark: a refused
 * fetch and a dead URL look identical, and a rejected row is never reported to
 * anyone. Here every failure comes back with a code and a message, per row, and
 * the advertiser gets told.
 */

/**
 * Which version of the API to call.
 *
 * Google ships a new version roughly quarterly and sunsets old ones on a
 * published schedule, so a version hardcoded today becomes an outage on a date
 * nobody has in a calendar. It is one constant, overridable without a deploy,
 * and the sunset is the thing to watch rather than the release.
 */
export const API_VERSION = process.env.GOOGLE_ADS_API_VERSION?.trim() || "v21";

export const API_ORIGIN = "https://googleads.googleapis.com";

/**
 * Google Ads shows account ids as 123-456-7890 and the API accepts only
 * 1234567890. Pasting the id straight off the screen is the obvious thing to
 * do and fails with a NOT_FOUND that names nothing, so the dashes are stripped
 * here rather than in each caller.
 */
export function normalizeCustomerId(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{10}$/.test(digits) ? digits : null;
}

/** Back to the form a person recognises, for anything shown on screen. */
export function formatCustomerId(customerId: string): string {
  const d = normalizeCustomerId(customerId);
  return d ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : customerId;
}

export interface AdsCredentials {
  /** The advertiser's own OAuth access token, already fresh. */
  accessToken: string;
  /** Ours, the same for every customer. Without it every call is refused. */
  developerToken: string;
  /**
   * Set only when reaching the account through a manager account. Omitted
   * where the advertiser authorised us against their account directly, which
   * is the normal case for a self-serve connection.
   */
  loginCustomerId?: string | null;
}

export function credentialsFromEnv(accessToken: string): AdsCredentials | null {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (!developerToken) return null;
  const login = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim();
  return {
    accessToken,
    developerToken,
    loginCustomerId: login ? normalizeCustomerId(login) : null,
  };
}

/**
 * A failure with the detail Google actually sent.
 *
 * `errorCode` is the machine-readable reason (CUSTOMER_NOT_ENABLED,
 * DEVELOPER_TOKEN_NOT_APPROVED, and so on). Keeping it separate from the
 * message is what lets a caller decide between "tell them to reconnect" and
 * "this one row was bad" without matching on English.
 */
export class AdsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode: string | null = null,
    readonly requestId: string | null = null
  ) {
    super(message);
    this.name = "AdsApiError";
  }

  /** The credentials are the problem, not the request. */
  get needsReconnect(): boolean {
    return this.status === 401 || this.errorCode === "USER_PERMISSION_DENIED";
  }
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: {
      errors?: {
        errorCode?: Record<string, string>;
        message?: string;
      }[];
      requestId?: string;
    }[];
  };
}

/**
 * Google nests the useful part several levels down and repeats a generic
 * message at the top. The specific one is worth digging for: "The developer
 * token is not approved" and "Request contains an invalid argument" are the
 * same HTTP status and lead to opposite actions.
 */
export function readError(status: number, body: unknown): AdsApiError {
  const parsed = (body ?? {}) as GoogleErrorBody;
  const detail = parsed.error?.details?.[0];
  const first = detail?.errors?.[0];
  const code = first?.errorCode ? Object.values(first.errorCode)[0] ?? null : null;
  const message =
    first?.message?.trim() ||
    parsed.error?.message?.trim() ||
    `Google Ads refused the request (HTTP ${status}).`;
  return new AdsApiError(message, status, code, detail?.requestId ?? null);
}

export interface AdsClientOptions {
  credentials: AdsCredentials;
  fetchImpl?: typeof fetch;
  /** Pointed at a fake in tests; the real origin everywhere else. */
  origin?: string;
}

export class AdsClient {
  private readonly fetchImpl: typeof fetch;
  private readonly origin: string;

  constructor(private readonly opts: AdsClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.origin = opts.origin ?? API_ORIGIN;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      authorization: `Bearer ${this.opts.credentials.accessToken}`,
      "developer-token": this.opts.credentials.developerToken,
      "content-type": "application/json",
    };
    // Sent only when there is one. An empty login-customer-id header is not
    // the same as an absent one, and Google rejects the empty version.
    if (this.opts.credentials.loginCustomerId) {
      h["login-customer-id"] = this.opts.credentials.loginCustomerId;
    }
    return h;
  }

  /** `path` is everything after the version, e.g. `customers/123:search`. */
  async post<T>(path: string, payload: unknown): Promise<T> {
    return this.call<T>("POST", path, payload);
  }

  async get<T>(path: string): Promise<T> {
    return this.call<T>("GET", path, undefined);
  }

  private async call<T>(method: string, path: string, payload: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.origin}/${API_VERSION}/${path}`, {
        method,
        headers: this.headers(),
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    } catch {
      // Unreachable is not the same as refused, and the advertiser should not
      // be told to reconnect a connection that is fine.
      throw new AdsApiError("We couldn't reach Google Ads. Try again.", 0, "UNREACHABLE");
    }

    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }

    if (!res.ok) throw readError(res.status, body);
    return (body ?? {}) as T;
  }
}
