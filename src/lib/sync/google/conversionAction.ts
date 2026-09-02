import type { AdsClient } from "./client";
import { CONVERSION_NAME } from "@/lib/feed/handlers";

/**
 * Creating the conversion action, so the advertiser never has to.
 *
 * This is the single most valuable thing the API route does. The feed route
 * asks an advertiser to build this by hand through a six step wizard, and
 * every step has a wrong answer that fails silently:
 *
 *  - a name that does not match to the character, and every uploaded row is
 *    discarded without an error anyone sees;
 *  - "use one value for each conversion", and the whole model is flattened
 *    back to a single number, which is the exact problem this product exists
 *    to solve;
 *  - a click-through window shorter than the sales cycle, and late conversions
 *    are dropped;
 *  - not included in Conversions, and Smart Bidding ignores it entirely.
 *
 * An advertiser can get all six right, see the import succeed, and still see
 * no change - with nothing on any screen explaining why. Doing it for them
 * removes that entire class of failure.
 */

export const CONVERSION_ACTION_NAME = CONVERSION_NAME;

/**
 * Ninety days, matching what the wiring instructions have always said.
 *
 * Long enough for a lead-gen sales cycle, and Google's own default for click
 * conversions. A shorter window silently drops the slow closes, which are the
 * expensive ones.
 */
export const CLICK_LOOKBACK_DAYS = 90;

export interface ConversionActionRef {
  resourceName: string;
  name: string;
  /** True when it already existed, so a reconnect is not reported as setup. */
  existed: boolean;
  /**
   * Settings on an action we found rather than made, that will stop the values
   * doing their job. Empty when we created it, or when the existing one is
   * right.
   */
  problems: SettingProblem[];
}

export interface SettingProblem {
  /** What is wrong, in the words the Google Ads screen uses. */
  title: string;
  /** Where to change it. */
  fix: string;
}

interface SearchResponse {
  results?: {
    conversionAction?: {
      resourceName?: string;
      name?: string;
      status?: string;
      type?: string;
      countingType?: string;
      primaryForGoal?: boolean;
      valueSettings?: { alwaysUseDefaultValue?: boolean; defaultValue?: number };
    };
  }[];
}

interface MutateResponse {
  results?: { resourceName?: string }[];
}

/** Escapes a value for a GAQL string literal. */
function gaqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/**
 * Is it already there?
 *
 * Reconnecting, refitting, or simply pressing the button twice must not leave
 * an account with "VBB Lead Value" and "VBB Lead Value (1)". Google would
 * accept both, uploads would name one of them, and the advertiser's reports
 * would split across two actions with no explanation.
 */
export async function findConversionAction(
  client: AdsClient,
  customerId: string,
  name: string = CONVERSION_ACTION_NAME
): Promise<ConversionActionRef | null> {
  const res = await client.post<SearchResponse>(`customers/${customerId}/googleAds:search`, {
    query:
      "SELECT conversion_action.resource_name, conversion_action.name, " +
      "conversion_action.status, conversion_action.type, " +
      "conversion_action.counting_type, conversion_action.primary_for_goal, " +
      "conversion_action.value_settings.always_use_default_value " +
      "FROM conversion_action " +
      `WHERE conversion_action.name = ${gaqlString(name)} ` +
      "AND conversion_action.status != 'REMOVED' LIMIT 1",
  });

  const found = res.results?.[0]?.conversionAction;
  if (!found?.resourceName) return null;
  return {
    resourceName: found.resourceName,
    name: found.name ?? name,
    existed: true,
    problems: judgeSettings(found),
  };
}

/**
 * Whether an action we did not create will actually use the values.
 *
 * The screen said "was already set up correctly" about an action nobody had
 * looked at. Three of its settings each break the product silently - the
 * values arrive, are stored, are reported, and change no bid - and every one
 * of them is a checkbox on a screen the advertiser may have visited months
 * ago for a different reason.
 *
 * Reported, never rewritten. An action that exists may have been edited on
 * purpose, and changing somebody's account behind them is a worse failure than
 * the one being fixed. The comment on ensureConversionAction already said
 * that; this makes it true of the settings as well as of the action.
 */
export function judgeSettings(action: {
  status?: string;
  countingType?: string;
  primaryForGoal?: boolean;
  valueSettings?: { alwaysUseDefaultValue?: boolean };
}): SettingProblem[] {
  const problems: SettingProblem[] = [];

  if (action.valueSettings?.alwaysUseDefaultValue === true) {
    problems.push({
      title: "It is set to give every lead the same value",
      fix: 'Google Ads: Goals → Conversions → VBB Lead Value → Edit settings → Value → "Use different values for each conversion". This is the setting the whole model depends on; with it off, every value we send is discarded and replaced by one number.',
    });
  }

  if (action.primaryForGoal === false) {
    problems.push({
      title: "It is a secondary action, so no campaign bids on it",
      fix: 'Google Ads: Goals → Conversions → VBB Lead Value → Edit settings → set it to a primary action ("Include in Conversions"). A secondary action is recorded and reported and never optimised toward, which looks exactly like everything working.',
    });
  }

  if (action.countingType === "MANY_PER_CLICK") {
    problems.push({
      title: 'It counts "every" conversion rather than one per click',
      fix: "Google Ads: Goals → Conversions → VBB Lead Value → Edit settings → Count → One. Restating a lead's value inside the seven day window would otherwise count that lead again each time.",
    });
  }

  if (action.status && action.status !== "ENABLED") {
    problems.push({
      title: `It is ${action.status.toLowerCase()}, not enabled`,
      fix: "Google Ads: Goals → Conversions → VBB Lead Value → Edit settings → set it to Enabled. Values sent to a paused action are kept and act on nothing.",
    });
  }

  return problems;
}

/**
 * The settings, in one object, because each one is a way to fail quietly.
 *
 * `alwaysUseDefaultValue: false` with no default value set is the whole point:
 * it is what makes Google take the value from each uploaded row rather than
 * flattening every lead to one number.
 *
 * `primaryForGoal: true` is what Google now calls "Include in Conversions".
 * Without it the action is recorded and reported and Smart Bidding does not
 * optimise toward it, which looks exactly like everything working.
 */
export function conversionActionPayload(name: string = CONVERSION_ACTION_NAME) {
  return {
    name,
    // Uploaded against a click Google already recorded, which is what an
    // offline conversion from a CRM is.
    type: "UPLOAD_CLICKS",
    category: "DEFAULT",
    status: "ENABLED",
    valueSettings: {
      alwaysUseDefaultValue: false,
    },
    // One lead is one conversion. MANY_PER_CLICK would count a lead again
    // every time we restate its value inside the seven day window.
    countingType: "ONE_PER_CLICK",
    clickThroughLookbackWindowDays: CLICK_LOOKBACK_DAYS,
    primaryForGoal: true,
  };
}

/**
 * Find it, or make it.
 *
 * Deliberately not "make it, and ignore the duplicate error". An account that
 * already has this action may have had it edited by hand, and overwriting
 * somebody's deliberate change without asking is worse than leaving it. What
 * we return says which happened, so the screen can say "already set up"
 * instead of claiming credit for work it did not do.
 */
export async function ensureConversionAction(
  client: AdsClient,
  customerId: string,
  name: string = CONVERSION_ACTION_NAME
): Promise<ConversionActionRef> {
  const existing = await findConversionAction(client, customerId, name);
  if (existing) return existing;

  const res = await client.post<MutateResponse>(
    `customers/${customerId}/conversionActions:mutate`,
    { operations: [{ create: conversionActionPayload(name) }] }
  );

  const resourceName = res.results?.[0]?.resourceName;
  if (!resourceName) {
    // Google answered without refusing and without creating anything. Saying
    // so beats returning a reference that points at nothing.
    throw new Error("Google Ads did not return the conversion action it created.");
  }
  // Nothing to judge on one we just made: the payload above is the standard.
  return { resourceName, name, existed: false, problems: [] };
}
