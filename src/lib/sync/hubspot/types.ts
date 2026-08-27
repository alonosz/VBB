/**
 * The shapes HubSpot's CRM v3 API returns.
 *
 * Deliberately loose: every property comes back as a string or null regardless
 * of its type in HubSpot, and a portal can rename or remove almost anything.
 * Treating the payload as `Record<string, string | null>` and converting
 * carefully is honest about that; typing it strictly would only move the lie
 * earlier.
 */

export interface HubSpotObject {
  id: string;
  properties: Record<string, string | null>;
  associations?: {
    contacts?: { results: { id: string }[] };
    companies?: { results: { id: string }[] };
  };
}

export interface HubSpotPage {
  results: HubSpotObject[];
  paging?: { next?: { after?: string } };
}

/** What a pull hands the mapper: deals plus the records they point at. */
export interface HubSpotPull {
  deals: HubSpotObject[];
  contactsById: Map<string, HubSpotObject>;
  companiesById: Map<string, HubSpotObject>;
  /** Internal stage id → the label a person would recognise. */
  stageLabels?: Map<string, string>;
}
