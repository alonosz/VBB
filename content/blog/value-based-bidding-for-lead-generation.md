title: Value-Based Bidding for Lead Generation - The Complete Guide
description: A lower cost per lead looks good in a report. It means much less if those leads never become customers. How to estimate what a lead is worth, send it to Google Ads, and check whether the bids brought better business.
date: 2026-09-15
author: Alon Oszmann
kind: Guide
coverAlt: A figure on a mountain ridge with streams of light converging on them from a valley of glowing points
---

*A lower cost per lead looks good in a report. It means much less if those leads never become customers.*

If your Google Ads campaigns optimize for form submissions, a dead-end enquiry and your next best customer each count as one conversion. The campaign gets credit for generating both, even if only one produces revenue.

That creates a gap between what marketing reports and what sales needs. You can keep improving cost per lead while spending more of your budget on people who are unlikely to buy.

Value-based bidding gives Google a different objective: the value of the conversions it generates. For lead generation, the challenge is deciding what value to report before a sale happens, and checking whether the resulting bids actually bring better business.

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

## The value arrives later than the lead

A form submission tells you someone is interested. It does not tell you whether they will buy, how much they will spend or whether the sale will be profitable.

Waiting for completed sales gives you a clearer outcome, but delays the feedback. Predicting lead value gives you earlier feedback, with more uncertainty.

Google recommends reporting conversion data promptly and generally prefers delays below seven days. However, seven days is not a universal cutoff: its guidance allows longer average delays and explains that consistently late feedback can lengthen the learning period. [Google's value-based bidding guidance](https://support.google.com/google-ads/answer/15099424?hl=en).

Later sales can still inform future bidding when reported through an eligible conversion setup. Predicted values are useful because they can provide an earlier indication of value, not because later outcomes are worthless.

## Estimate value from your own sales history

A practical starting point is to group leads by attributes available when they first enquire, then calculate:

**Estimated lead value = historical close rate × average revenue from won deals in that group**

If a group closes 20% of the time and generates an average of $5,000 per sale, its estimated revenue per new lead is $1,000. That assumes unsuccessful leads generate no revenue.

For B2B, possible attributes include company size, industry, job role and email domain type. For consumer businesses, they might include the service requested, product package or stated purchase timeframe. Whether any attribute is useful depends on your data.

Outliers deserve attention. One unusually large contract can heavily influence an average. Capping historical deal amounts before averaging is one way to reduce that influence, but the resulting estimate represents capped revenue. It can understate the contribution of genuinely large customers, so the cap should be visible and tested.

Using the median is another way to reduce outlier influence, but close rate multiplied by median deal size is a value proxy, not generally expected revenue.

Start with a few groups supported by enough history to evaluate. More detailed segmentation is useful only if it improves predictions on leads the model has not already seen.

## Fix the data before trusting the score

A neat value table can hide problems in the underlying CRM records. Three checks deserve particular attention:

* **Include unsuccessful leads.** A file containing only sales cannot tell you the probability that an enquiry becomes a customer. Check that it represents the population you intend to score, including leads that never became opportunities.
* **Allow outcomes time to develop.** A lead created yesterday is not a failed sale. Compare cohorts with sufficient follow-up and explain how unresolved leads affect the calculation.
* **Use information available at scoring time.** A lost reason, final contract amount or status added after a sale cannot be used to predict value at form submission. Later milestones need their own timing and reliability checks.

Small groups also need cautious treatment. A close rate based on a handful of outcomes should carry less confidence than one supported by hundreds. Combining sparse groups or pulling their estimates toward a broader baseline can reduce overreaction.

## Make sure the values reach Google

A lead's CRM record needs identifiers that the chosen import method can use to match it to an eligible ad interaction. Depending on the setup, these can include a captured click identifier or customer information used through Enhanced Conversions for Leads. [Google's offline conversion import documentation](https://support.google.com/google-ads/answer/2998031?hl=en).

Check identifier capture through the entire journey: landing page, form, CRM and import. If your existing setup already preserves the necessary identifiers, you may not need another tracking script.

Keep two measurements separate: the share of leads carrying usable identifiers, and the results Google reports after processing the import. Having an email address or click ID is not proof that a conversion has been successfully attributed.

Ongoing delivery matters too. A one-time CRM export can support an initial analysis. New leads and later outcomes require fresh data through a CRM connection or repeated exports. A scheduled feed URL cannot discover CRM changes unless something updates the feed.

## Choose a conversion goal you can support

There is no single best funnel stage for every advertiser. Consider how closely the event reflects business value, how quickly it arrives and how often it occurs.

Completed sales may be a suitable goal when they arrive regularly and promptly. Qualified leads can offer earlier feedback if qualification is recorded consistently and predicts sales. Predicted values at enquiry can be worth testing when useful distinctions are available immediately but final outcomes arrive much later.

Google recommends choosing a single funnel stage for bid optimization. If you report several stages, make sure your campaign goals do not unintentionally count the same economic value repeatedly. [Google's conversion-goal guidance](https://support.google.com/google-ads/answer/15099424?hl=en).

For Search and Shopping, Google's published Target ROAS requirement is at least 15 conversions in the preceding 30 days at the conversion tracking level. Other campaign types have different requirements. These are eligibility criteria, not a guarantee of stable performance or improvement. Count usable conversions for the relevant goal, not every lead in your CRM. [Google's Target ROAS requirements](https://support.google.com/google-ads/answer/6268637?hl=en).

## Update values as you learn more

A reliable milestone can change what you know about a lead. If receiving a quote or completing qualification predicts a higher chance of purchase, that information may justify updating its value.

Google supports conversion value restatements, subject to the requirements of the conversion and import method. Plan those updates deliberately and preserve the identifiers needed to adjust the original event. [Google's conversion-adjustment documentation](https://support.google.com/google-ads/answer/7686447?hl=en).

Continue collecting actual sales outcomes. They let you test whether the original estimates were sensible and whether the model needs recalibration as the business changes.

## Measure business results, not just reported value

An increase in Google Ads conversion value is not sufficient evidence of success when you supplied the values yourself. A campaign can generate more of the leads your model rewards without generating more revenue.

Test two things separately.

First, test the model against historical leads excluded from model fitting, preferably from a later period with mature outcomes. Do higher-value groups actually generate more revenue per lead? Are the predicted differences broadly consistent with the observed differences?

Then test the bidding change. Where feasible, use a campaign experiment and compare actual sales revenue or gross profit relative to spend. Track lead volume and cost alongside those outcomes, and give both groups comparable time to convert.

Keep scoring consistent during the comparison. If you change the model, conversion goal, budget and landing page together, it becomes much harder to identify what caused the result.

A before-and-after comparison can help monitor progress, but changes in seasonality, demand and sales follow-up can also affect the outcome. Treat it as directional evidence unless the evaluation design supports a stronger conclusion.

## Find out whether your leads carry a useful value signal

You do not need to assume that every lead has a dramatically different value. Start by checking whether your sales history shows meaningful, repeatable differences.

[ValueBasedBidding.com](https://valuebasedbidding.com/) helps you examine those differences, estimate lead values and prepare them for Google Ads. Start with the sample dataset to see the process, then use your own CRM history to assess whether the approach fits your business.

The goal is to train Google to hunt for higher-value leads, then check whether those leads turn into better sales outcomes.

*Written by Alon Oszmann, creator of ValueBasedBidding.com. This article describes the approach behind our product. Google links are first-party implementation documentation from the platform vendor; they are not independent evidence that our scoring method improves performance.*
