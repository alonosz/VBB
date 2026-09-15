title: The Future of Lead-Gen Bidding Is Better Value Signals
description: Why the next improvement may come from what you tell the algorithm, not from a more complicated prediction model. Ranking is not enough, magnitudes matter, and delivery is part of the model's practical value.
date: 2026-09-15
author: Alon Oszmann
kind: Perspective
---

*Why the next improvement may come from what you tell the algorithm, not from a more complicated prediction model.*

A cheaper lead is not necessarily a better purchase.

Yet when a campaign's goal is form submissions, a lower cost per lead can look like progress even when sales sees no improvement.

Value-based bidding offers a different instruction: pursue the leads expected to create more business value. But it also moves an important responsibility onto the advertiser.

You have to decide what "more valuable" means, estimate it credibly and check whether bidding against that estimate produces better customers.

My view is that this responsibility will become a more important part of performance marketing. Not because every advertiser needs a sophisticated machine-learning model, but because an automated bidder cannot optimize directly for a business outcome you never measure or report.

## A better signal does not have to be a more complicated model

For lead generation, value is uncertain at the moment someone enquires. You are estimating a future outcome, not reading a completed transaction.

One starting point is a cohort: leads with similar attributes available at submission. Estimate how often that group buys and how much revenue its buyers generate.

For example, imagine two groups of enquiries:

* **Group A.** 10% buy, with average revenue of $2,000 per buyer.
* **Group B.** 20% buy, with average revenue of $3,000 per buyer.

Their estimated revenue per lead is $200 and $600. These are hypothetical figures, not product results.

The estimate does not claim every lead in Group B will produce $600. Most may produce nothing. It describes an average across comparable leads.

That is a potentially useful signal. Whether it is useful enough for bidding depends on whether the difference persists in new data and whether the advertising system can act on it.

Google permits both economic values and proxy scores in value-based bidding. That establishes that precise individual revenue predictions are not a platform requirement. It does not establish that any particular cohort model will outperform volume-based bidding. [Google's value-based bidding guidance](https://support.google.com/google-ads/answer/15099424?hl=en).

## Ranking matters. The gaps between values matter too.

There is a tempting shortcut: "Google only needs to know which leads are better."

That is incomplete.

Consider three tiers valued at $100, $200 and $300. Now consider the same tiers valued at $100, $200 and $3,000.

The ordering is identical. The implied economics are not. In the second version, the highest tier justifies much more acquisition spend relative to the others.

Target ROAS optimizes conversion value subject to an efficiency target, rather than simply sorting customers into good and bad. [Google's Target ROAS documentation](https://support.google.com/google-ads/answer/6268637?hl=en).

A useful model therefore needs defensible differences in magnitude, not just a plausible ranking. If a tier is assigned three times the value, newer outcomes should broadly support that relationship.

Coarse cohorts can be a sensible baseline. Bespoke machine learning can be worth testing when it captures additional, stable differences. Neither earns a performance claim simply by being simple or sophisticated.

## Delivery is part of the model's practical value

A prediction sitting in a dashboard cannot influence a campaign that never receives it.

But successful delivery is not the finish line either. An accepted upload says something about the integration, not whether the score reflects future sales.

I would judge a value signal on four questions:

1. **Separation.** Do higher-scored groups actually produce better outcomes on data the model has not seen?
2. **Calibration.** Are the value differences reasonably aligned with those outcomes?
3. **Coverage.** Which leads receive usable scores and reach the platform? Are important groups missing?
4. **Timeliness.** Does the signal arrive consistently enough to support the chosen bidding event?

These checks connect model quality to operational reality. A highly accurate score covering a narrow, unrepresentative slice of leads may be less useful than its headline accuracy suggests.

## Early predictions and eventual sales have different jobs

An early value estimate gives you something to act on before a long sales process finishes. Later sales tell you whether that estimate deserved your confidence.

Neither should replace the other.

For a short-cycle consumer business, actual purchases may arrive quickly enough to be a practical bidding event. For a long-cycle B2B business, an earlier event may offer a more usable balance of information and frequency.

There is no universal rule that the earliest event is best, or that 50 conversions a month guarantees an advantage. Google's eligibility requirements vary by campaign type; eligibility is not evidence that your model will improve results. [Google's Target ROAS requirements](https://support.google.com/google-ads/answer/6268637?hl=en).

The decision should follow the data: event consistency, reporting delay, usable volume and the relationship with eventual revenue.

## What I expect to change

These are predictions, not announced platform capabilities or guaranteed outcomes.

**Value definitions will become shared work between marketing and sales.** Choosing revenue, gross profit or a qualified-pipeline proxy is a business decision. It cannot be settled by naming a conversion action "High Value Lead."

**Simple models will earn their place through testing.** The right baseline is the simplest approach that captures a reliable, economically meaningful difference. Complexity should earn its additional cost through better predictions and, ultimately, better acquisition results.

**Businesses will want consistent economics across platforms.** The definition of a valuable customer should not change just because the ad platform does. However, event schemas, matching, eligibility and bidding controls still require platform-specific implementation. One model does not mean one interchangeable integration.

**Evaluation will matter as much as scoring.** A tool that assigns higher numbers can make reported conversion value rise without producing another dollar of sales. Advertisers will need to distinguish a richer signal from a better business result.

## What to test now

Start with a question you can answer: does your sales history support meaningful differences between leads at the point you intend to score them?

Build a simple baseline on an older period. Evaluate it on a newer, sufficiently mature period. Keep a record of the model version and resist adjusting it repeatedly to flatter the test results.

If the signal holds up, validate matching and delivery before changing bidding. Then use a controlled campaign experiment where feasible, with a clear baseline, an agreed outcome and enough time for sales to mature.

Judge the result using actual sales outcomes relative to spend, not just the predicted values you submitted. A before-and-after dashboard is useful monitoring, but changes in demand, budget or sales follow-up can also explain an apparent improvement.

There is no honest guarantee that your first model will win. There is a practical way to find out whether giving Google a better signal is worth more than asking it for another cheap form fill.

That is the direction behind [ValueBasedBidding.com](https://valuebasedbidding.com/): use your sales history to estimate lead value, put that signal into Google Ads and help you assess what happens next.

The ambition is simple: help Google hunt higher-value leads, then check whether the customers justify it.
