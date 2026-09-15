title: Value-Based Bidding for Lead Generation - The Complete Guide
description: A lower cost per lead looks good in a report. It means much less if those leads never become customers. How to estimate what a lead is worth, send it to Google Ads, and check whether the bids brought better business.
date: 2026-09-15
author: Alon Oszmann
kind: Guide
featured: true
coverAlt: A figure on a mountain ridge with streams of light converging on them from a valley of glowing points
---

*A lower cost per lead looks good in a report. It means much less if those leads never become customers.*

If your Google Ads campaigns optimize for form submissions, a dead-end enquiry and your next best customer each count as one conversion. The campaign gets credit for generating both, even if only one produces revenue. [Google's conversion reporting documentation](https://support.google.com/google-ads/answer/6270625?hl=en).

That creates a gap between what marketing reports and what sales needs. You can keep improving cost per lead while spending more of your budget on people who are unlikely to buy.

Value-based bidding gives Google a different objective: the value of the conversions it generates. For lead generation, the challenge is deciding what value to report before a sale happens, and checking whether the resulting bids actually bring better business. [Google's value-based bidding guidance](https://support.google.com/google-ads/answer/15099424?hl=en).

## Cheap leads can be expensive customers

Consider an insurance business receiving enquiries for renters insurance and bundled cover.

*Illustrative figures only. Revenue below means revenue the business retains per sale, not the customer's insurance premium.*

| Lead type         | Close rate | Average revenue per sale | Expected revenue per enquiry |
| ----------------- | ---------: | -----------------------: | ---------------------------: |
| Renters insurance |        35% |                     $150 |                       $52.50 |
| Bundled cover     |        15% |                     $700 |                         $105 |

Renters enquiries convert into customers more often. But each bundle enquiry produces twice as much expected revenue.

That does not mean bundles are always the better acquisition opportunity. Their advertising costs matter too. It means counting every enquiry equally leaves out information needed to make that decision.

The same problem exists in B2B. A small business and an enterprise prospect can submit the same demo form while having very different chances of buying and potential contract values.

Google's value-based strategies, Maximize Conversion Value and Target ROAS, optimize toward the values you report. The quality of those values therefore matters to the objective you are giving the bidder. [Google Ads documentation](https://support.google.com/google-ads/answer/6268637?hl=en).

## This may not be for you

Value-based bidding needs three things:

* Real, repeatable differences in value between leads.
* Enough usable conversions to learn from.
* A business that cares about the difference, not just lead volume.

Missing any one means this is the wrong tool for now, not a smaller win. Google's guidance calls for distinct values, a matching business objective and sufficient conversion volume. [Google's suitability criteria](https://support.google.com/google-ads/answer/15099424?hl=en).

If every lead is genuinely worth the same, a flat value adds no information about lead quality. Mathematically, maximizing the same positive value per lead means maximizing lead count. Conversion-based bidding is the simpler choice. That is an equivalent objective, not a promise of identical bids.

You may find no useful spread because you sell one product at one price, your groups are too small to distinguish, or the only predictive fields appear after the sale. One price alone does not rule out different close rates.

Before building anything, take your most obvious lead groups. Multiply each group's close rate by its average deal size. If the answers sit within a narrow band, stop here.

## The value arrives later than the lead

A form submission tells you someone is interested. It does not tell you whether they will buy, how much they will spend or whether the sale will be profitable.

Waiting for completed sales gives you a clearer outcome, but delays the feedback. Predicting lead value gives you earlier feedback, with more uncertainty.

For the first report of a conversion, Google recommends a delay below seven days from click to upload, and says longer delays can slow learning. That guidance is about reporting a conversion, not restating one already recorded. [Google's value-based bidding guidance](https://support.google.com/google-ads/answer/15099424?hl=en).

Later sales can still inform future bidding when reported through an eligible conversion setup. Predicted values are useful because they can provide an earlier indication of value, not because later outcomes are worthless. [Google's offline conversion guidance](https://support.google.com/google-ads/answer/10029210?hl=en).

## Estimate value from your own sales history

A practical starting point is to group leads by attributes available when they first enquire, then calculate:

**Estimated lead value = historical close rate × average revenue from won deals in that group**

Illustrative calculation: if a group closes 20% of the time and generates an average of $5,000 per sale, its estimated revenue per new lead is $1,000. That assumes unsuccessful leads generate no revenue.

For B2B, possible attributes include company size, industry, job role and email domain type. For consumer businesses, they might include the service requested, product package or stated purchase timeframe. Whether any attribute is useful depends on your data.

Outliers deserve attention. One unusually large contract can heavily influence an average. Capping historical deal amounts before averaging is one way to reduce that influence, but the resulting estimate represents capped revenue. It can understate the contribution of genuinely large customers, so the cap should be visible and tested.

Using the median is another way to reduce outlier influence, but close rate multiplied by median deal size is a value proxy, not generally expected revenue.

Start with a few groups supported by enough history to evaluate. More detailed segmentation is useful only if it improves predictions on leads the model has not already seen.

## Fix the data before trusting the score

A neat value table can hide problems in the underlying CRM records. Three checks deserve particular attention:

* **Include unsuccessful leads.** A file containing only sales cannot tell you the probability that an enquiry becomes a customer. Check that it represents the population you intend to score, including leads that never became opportunities.
* **Allow outcomes time to develop.** A lead created yesterday is not a failed sale. Compare cohorts with sufficient follow-up and explain how unresolved leads affect the calculation.
* **Use information available at scoring time.** A lost reason, final contract amount or status added after a sale cannot be used to predict value at form submission. Later milestones need their own timing and reliability checks.

Small groups also need cautious treatment. Estimates from sparse histories deserve less confidence. Combining sparse groups or pulling their estimates toward a broader baseline can reduce overreaction.

## Make sure the values reach Google

A lead's CRM record needs identifiers that the chosen import method can use to match it to an eligible ad interaction. Depending on the setup, these can include a captured click identifier or customer information used through Enhanced Conversions for Leads. [About offline conversion imports](https://support.google.com/google-ads/answer/2998031?hl=en).

Check identifier capture through the entire journey: landing page, form, CRM and import. If your existing setup already preserves the necessary identifiers, you may not need another tracking script.

Keep two measurements separate: the share of leads carrying usable identifiers, and the results Google reports after processing the import. Having an email address or click ID is not proof that a conversion has been successfully attributed. [Google's import verification guidance](https://support.google.com/google-ads/answer/10029210?hl=en).

Ongoing delivery matters too. A one-time CRM export can support an initial analysis. New leads and later outcomes require fresh data through a CRM connection or repeated exports. A scheduled feed URL cannot discover CRM changes unless something updates the feed.

Google dates the start of its upload migration to June 15, 2026: offline conversion and enhanced-conversion lead uploads move to the Data Manager API, with legacy Google Ads API access restricted to allowlisted developer tokens. If a script or connector delivers your data, confirm its route and check upload results and freshness. A running schedule does not prove the values arrived. [Migration notice in About offline conversion imports](https://support.google.com/google-ads/answer/2998031?hl=en).

## Choose a conversion goal you can support

There is no single best funnel stage for every advertiser. Consider how closely the event reflects business value, how quickly it arrives and how often it occurs.

Completed sales may be a suitable goal when they arrive regularly and promptly. Qualified leads can offer earlier feedback if qualification is recorded consistently and predicts sales. Predicted values at enquiry can be worth testing when useful distinctions are available immediately but final outcomes arrive much later.

Google recommends choosing a single funnel stage for bid optimization. [Google's conversion-goal guidance](https://support.google.com/google-ads/answer/15099424?hl=en).

The trap is giving overlapping stages separate values and making them all primary in the campaign's bidding goals. Illustrative example: a lead worth $100, qualification worth $200 and a sale worth $1,000 total $1,300 when someone completes the funnel. You have supplied $1,300 of bidding value for $1,000 of revenue. Google sums the included conversion values; it does not subtract your earlier estimates. [Google's conversion-value reporting documentation](https://support.google.com/google-ads/answer/6270625?hl=en).

Choose a single action, or a non-overlapping set, to drive bidding. Make the rest secondary before switching strategies. Primary actions drive bidding when their standard goal is selected; secondary actions remain in "All conversions" reporting. Check custom goals too: they use included secondary actions for bidding. Demoting an action is not enough if it remains in a custom goal used by the campaign. [Google's primary and secondary settings](https://support.google.com/google-ads/answer/11461796?hl=en).

For Search and Shopping, Google's published Target ROAS requirement is at least 15 conversions in the preceding 30 days at the conversion tracking level. Other campaign types have different requirements. These are eligibility criteria, not a guarantee of stable performance or improvement. [Google's Target ROAS requirements](https://support.google.com/google-ads/answer/6268637?hl=en).

Later-stage goals supply fewer events. Splitting those events across narrow product or regional campaigns can leave little evidence in each. Check usable volume for your chosen action per campaign, not just account totals. This is a practical check, not an additional eligibility threshold: Google also documents learning across conversion actions. [Google's Target ROAS guidance](https://support.google.com/google-ads/answer/6268637?hl=en).

## Update values promptly, and keep adjustments apart from new conversions

A reliable milestone can change what you know about a lead. If receiving a quote or completing qualification predicts a higher chance of purchase, that information may justify updating its value.

There are two different operations, and they carry different rules:

* **Import a new conversion.** Report an event that has not been recorded before, such as a completed sale.
* **Restate an existing conversion.** Replace the value of the lead conversion you already reported, after learning more about it. A restatement changes its value without adding another conversion. [About conversion adjustments](https://support.google.com/google-ads/answer/7686447?hl=en).

Google accepts a restatement for up to 55 days after the conversion was first recorded. Acceptance is not influence. The one figure Google publishes for how long autobidding reads an adjustment is seven days from the conversion being recorded, and on the same page it appears in the hotel ads passage; Google does not say in plain terms whether it binds Search lead conversions. [About conversion adjustments](https://support.google.com/google-ads/answer/7686447?hl=en).

Treat seven days as the deadline anyway. An adjustment sent inside it is safe under any reading of the rule, and nothing is gained by waiting. A lead-value feed should send an update while the original conversion is under seven days old, and keep a later change for recalibration instead of sending an adjustment that may be ignored. Google also requires new conversions and adjustments to be uploaded in separate files. [How to adjust your conversions](https://support.google.com/google-ads/answer/7686280?hl=en).

Keep collecting later sales outcomes. A sale closing months later cannot change the bid that won the click, but it is exactly what tells you whether the estimates were sensible, and it prices tomorrow's leads. A successful upload proves that Google accepted the file, and nothing more.

## Measure business results, not just reported value

An increase in Google Ads conversion value is not sufficient evidence of success when you supplied the values yourself. A campaign can generate more of the leads your model rewards without generating more revenue.

Test two things separately.

First, test the model against historical leads excluded from model fitting, preferably from a later period with mature outcomes. Do higher-value groups actually generate more revenue per lead? Are the predicted differences broadly consistent with the observed differences?

Then test the bidding change. Where feasible, use a campaign experiment and compare actual sales revenue or gross profit relative to spend. Track lead volume and cost alongside those outcomes, and give both groups comparable time to convert. [Google's value-based bidding experiment guidance](https://support.google.com/google-ads/answer/14147337?hl=en).

Keep scoring consistent during the comparison. If you change the model, conversion goal, budget and landing page together, it becomes much harder to identify what caused the result.

Standard conversion columns report by the time of the ad click. Separate "by conv. time" columns report by when the conversion happened. Recent click dates can therefore look worse simply because their conversions have not arrived. [Understand your conversion tracking data](https://support.google.com/google-ads/answer/6270625?hl=en).

In Goals > Attribution > Path metrics, "Avg. days to conversion" shows the delay. Check whether it is measured from the first or the last ad interaction. [About attribution reports](https://support.google.com/google-ads/answer/1722023?hl=en).

Use mature history for your chosen action to establish the delay, then exclude recent days whose outcomes are still incomplete. Allow for upload delays too. The campaign report's Conversions > Days to conversion segment is another check. Last week's incomplete results cannot establish that a bid change failed. [Google's conversion-delay guidance](https://support.google.com/google-ads/answer/6239119?hl=en).

A before-and-after comparison can help monitor progress, but changes in seasonality, demand and sales follow-up can also affect the outcome. Treat it as directional evidence unless the evaluation design supports a stronger conclusion.

## Find out whether your leads carry a useful value signal

You do not need to assume that every lead has a dramatically different value. Start by checking whether your sales history shows meaningful, repeatable differences.

[ValueBasedBidding.com](https://valuebasedbidding.com/) helps you examine those differences, estimate lead values and prepare them for Google Ads. Start with the sample dataset to see the process, then use your own CRM history to assess whether the approach fits your business.

The goal is to train Google to hunt for higher-value leads, then check whether those leads turn into better sales outcomes.

*Written by Alon Oszmann, creator of ValueBasedBidding.com. This article describes the approach behind our product. Google links are first-party implementation documentation from the platform vendor; they are not independent evidence that our scoring method improves performance.*
