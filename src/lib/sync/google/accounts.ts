import { AdsClient, formatCustomerId, normalizeCustomerId } from "./client";

/**
 * Which Google Ads account are we pricing leads for?
 *
 * OAuth answers who the person is, not which of their accounts this is about,
 * and an agency login can see dozens. Asking them to type a ten digit number
 * they have to go and look up is the kind of errand this product exists not to
 * hand out, so we list what they can reach and let them pick from names.
 *
 * Two calls, because Google splits it: one returns bare resource names, the
 * other turns them into something a person recognises.
 */

export interface AdsAccount {
  /** Digits only, as the API wants it. */
  customerId: string;
  /** 593-222-7642, as every Google screen shows it. */
  displayId: string;
  name: string;
  currencyCode: string | null;
  timeZone: string | null;
  /** A manager holds other accounts and has no conversions of its own. */
  isManager: boolean;
  /** Cancelled or suspended accounts cannot receive conversions. */
  status: string | null;
}

interface ListResponse {
  resourceNames?: string[];
}

interface SearchResponse {
  results?: {
    customer?: {
      id?: string;
      descriptiveName?: string;
      currencyCode?: string;
      timeZone?: string;
      manager?: boolean;
      status?: string;
    };
  }[];
}

/**
 * Every account this login can reach, by resource name.
 *
 * The ids come back as `customers/5932227642`. Anything that is not ten digits
 * after the slash is dropped rather than passed on: a malformed id becomes a
 * request against nothing, and Google's answer to that names neither the id
 * nor the problem.
 */
export async function listAccessibleCustomerIds(client: AdsClient): Promise<string[]> {
  const res = await client.get<ListResponse>("customers:listAccessibleCustomers");
  const ids: string[] = [];
  for (const name of res.resourceNames ?? []) {
    const id = normalizeCustomerId(name.split("/").pop() ?? "");
    if (id) ids.push(id);
  }
  return ids;
}

/** The query behind the names. Kept here so the field list is reviewable. */
export const CUSTOMER_QUERY =
  "SELECT customer.id, customer.descriptive_name, customer.currency_code, " +
  "customer.time_zone, customer.manager, customer.status FROM customer LIMIT 1";

/**
 * The details for one account.
 *
 * Returns null rather than throwing when Google refuses a single account. A
 * login that can see fifteen accounts will often have one that is suspended or
 * that this developer token cannot read, and losing the whole list to it would
 * leave the advertiser with nothing to pick from and no idea why.
 */
export async function describeAccount(
  client: AdsClient,
  customerId: string
): Promise<AdsAccount | null> {
  let res: SearchResponse;
  try {
    res = await client.post<SearchResponse>(`customers/${customerId}/googleAds:search`, {
      query: CUSTOMER_QUERY,
    });
  } catch {
    return null;
  }

  const customer = res.results?.[0]?.customer;
  if (!customer) return null;

  const id = normalizeCustomerId(customer.id ?? customerId) ?? customerId;
  return {
    customerId: id,
    displayId: formatCustomerId(id),
    // An account with no descriptive name is normal, and its number is the
    // only honest label for it. Inventing one would be inventing data.
    name: customer.descriptiveName?.trim() || formatCustomerId(id),
    currencyCode: customer.currencyCode ?? null,
    timeZone: customer.timeZone ?? null,
    isManager: customer.manager === true,
    status: customer.status ?? null,
  };
}

export interface AccountList {
  accounts: AdsAccount[];
  /** Reachable but unreadable, so the count on screen adds up. */
  unreadable: number;
}

/**
 * Everything they can pick from, named.
 *
 * Managers are kept in the list rather than filtered out. An advertiser who
 * only has a manager account needs to be told that is what they have, not
 * shown an empty screen: conversions belong on the account that runs the
 * campaigns, and silently hiding the only account they can see would look like
 * a broken connection.
 */
export async function listAccounts(client: AdsClient): Promise<AccountList> {
  const ids = await listAccessibleCustomerIds(client);
  const described = await Promise.all(ids.map((id) => describeAccount(client, id)));

  const accounts = described.filter((a): a is AdsAccount => a !== null);
  return { accounts, unreadable: described.length - accounts.length };
}

/** Accounts that can actually receive conversions today. */
export function usableAccounts(accounts: AdsAccount[]): AdsAccount[] {
  return accounts.filter((a) => !a.isManager && a.status !== "CANCELED" && a.status !== "CLOSED");
}

export type AccountRefusal =
  | { ok: true; account: AdsAccount }
  | { ok: false; reason: string };

/**
 * Whether this account can carry the model we fitted.
 *
 * The currency check is the one that matters and the one nobody thinks of. A
 * model fitted on GBP deals uploaded into a USD account is not an error Google
 * reports: it accepts every row and prices every lead about 25% wrong, forever,
 * with nothing on any screen to say so. A saved model already refuses a file in
 * the wrong currency, and this is the same rule at the other end of the pipe.
 */
export function checkAccount(account: AdsAccount, modelCurrency: string): AccountRefusal {
  if (account.isManager) {
    return {
      ok: false,
      reason:
        `${account.name} is a manager account, which holds other accounts rather than ` +
        "running campaigns. Pick the account your ads actually run in.",
    };
  }
  if (account.status === "CANCELED" || account.status === "CLOSED") {
    return { ok: false, reason: `${account.name} is closed, so it cannot receive conversions.` };
  }
  if (account.currencyCode && account.currencyCode !== modelCurrency) {
    return {
      ok: false,
      reason:
        `Your model prices leads in ${modelCurrency} and ${account.name} reports in ` +
        `${account.currencyCode}. Sending those values would misprice every lead, and ` +
        "Google would accept them without complaint. Refit the model in " +
        `${account.currencyCode}, or pick an account that reports in ${modelCurrency}.`,
    };
  }
  return { ok: true, account };
}
