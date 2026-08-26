-- VBB Engine — the saved model, stored server-side.
--
-- Until now the server could not price anything, and that was deliberate: the
-- browser held the CRM data and the server held only what Google gets. A
-- nightly sync breaks that symmetry, because a job that runs while nobody is
-- watching has to price leads with no browser in the loop.
--
-- What it stores is the artifact from src/lib/model/savedModel.ts — the frozen
-- rule stack, exactly as the advertiser approved it. Principle 8: a scheduled
-- run applies the saved model, it never refits one. A job that refit nightly
-- would reprice yesterday's leads every morning and Google would learn from a
-- moving target.
--
-- On the storage guardrail, stated plainly rather than buried: this is the
-- first table that holds figures derived from deal amounts — each level's
-- median won amount, the base value, the outlier cap. They are aggregates over
-- at least MIN_LEVEL_SAMPLE (25) resolved deals, never an individual deal, and
-- the model cannot function without them: they are what makes a multiplier
-- explainable ("Manufacturing, 121 deals, 32.2% close, median 6,800") instead
-- of a bare number. Level labels are category names from the advertiser's own
-- CRM — "Manufacturing", "201–1,000" — and never notes or free text.
--
-- What must never be here is a person: no addresses, no names, no titles as
-- typed. The check below enforces the first of those the same way the feed_rows
-- constraints do, because a promise the database will not refuse is not a
-- promise.

create table if not exists public.feed_models (
  -- One current model per feed. Republishing after a refit replaces it; the
  -- rows already sent keep the model_id that priced them, so lineage survives
  -- in the place it actually matters.
  feed_id uuid primary key references public.feeds (id) on delete cascade,

  model_id text not null,
  format_version integer not null,
  fitted_at timestamptz,
  currency_code text not null,

  -- The whole SavedValueModel. Kept as one document because it is validated as
  -- one on the way back in by loadSavedModel(), which treats it as untrusted
  -- input regardless of where it came from — a row in our own database is not
  -- more trustworthy than a file someone uploaded.
  model jsonb not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint feed_models_currency_is_iso check (currency_code ~ '^[A-Z]{3}$'),
  constraint feed_models_format_version_is_positive check (format_version > 0),

  -- The stored document has to agree with its own columns, or a lookup by
  -- model_id would find a model that prices under a different id.
  constraint feed_models_document_matches_columns check (
    model ->> 'modelId' = model_id
    and (model ->> 'formatVersion')::integer = format_version
    and model ->> 'currencyCode' = currency_code
  ),

  -- A model with no base value prices every lead at zero, which is worse than
  -- refusing to price at all: Google would learn that the advertiser's leads
  -- are worthless.
  constraint feed_models_has_a_base_value check (
    (model ->> 'baseValue')::numeric > 0
  ),

  -- The privacy line, enforced rather than remembered. An address always
  -- contains '@' and a category label never should. Same stance the feed_rows
  -- click_id constraint takes, and the same tradeoff: a legitimate label with
  -- an '@' in it is refused loudly, which is the failure we want.
  constraint feed_models_carries_no_addresses check (model::text !~ '@'),

  -- A saved model is a few kilobytes of multipliers. Anything approaching a
  -- megabyte is not a model, and is the shape a mistake takes.
  constraint feed_models_is_model_sized check (length(model::text) < 262144)
);

comment on table public.feed_models is
  'The frozen rule stack a scheduled run applies. Aggregates over >=25 deals only — never an individual deal, never a person.';

comment on column public.feed_models.model is
  'A SavedValueModel document. Revalidated by loadSavedModel() on read: our own row is untrusted input like any other.';

alter table public.feed_models enable row level security;
