title: Journey-Aware Bidding: What Google's New Lead-Gen Beta Does, and What It Does Not
description: Google's Journey-Aware Bidding learns from the stages between a form fill and a sale. It models how likely a lead is to progress, not what the lead is worth. What changes for lead-gen advertisers, what does not, and what to prepare.
date: 2026-09-18
author: Alon Oszmann
kind: Perspective
coverAlt: Illustration of a customer journey as branching roads from a form fill, with some leads reaching gold coins and others disqualified
---

*Google's new beta models how likely a lead is to progress. It does not decide what the lead is worth. Both still matter, and they are different jobs.*

Most lead-generation campaigns ask Google to optimise for the easiest event to see: the form submission. Google can find more of those. It cannot tell, on its own, which ones will become qualified opportunities, customers or profitable customers.

Advertisers have tried to close that gap by importing offline outcomes, giving funnel stages values, and pointing bidding at qualified leads or revenue. In theory that hands Smart Bidding a better objective. In practice, long sales cycles and sparse lower-funnel data often leave the algorithm with too little arriving too late.

On 18 September, Google's Ads Decoded newsletter announced two things aimed at exactly that problem: a Journey-Aware Bidding beta and a Lead Intent Scoring pilot. [Google Ads on LinkedIn](https://www.linkedin.com/company/google-ads-/). This is what each does, read against Google's own description, and what it means if you are already sending values.

## What Journey-Aware Bidding is

A beta for Search campaigns on Target CPA, for advertisers whose qualified-lead and customer conversions are too sparse to train Smart Bidding in real time. You map your journey, for example form submission, qualified lead, opportunity, customer, and import the later stages through Data Manager. Google then learns from both the biddable goal and the non-biddable ones, and models the probability that an early conversion will progress to a deeper one. [Google Ads Data Manager](https://support.google.com/google-ads-data-manager/answer/13761872?hl=en).

That addresses a real dilemma. Optimise for form fills and you have volume but uneven quality. Optimise for customers and you have the right objective but too few events to learn from. Journey-Aware Bidding lets the bidder keep the high-volume event as its goal while using the rare, later ones as evidence about which early conversions tend to go somewhere.

## What it is not

It is not value-based bidding, and the difference is the whole point.

Journey-Aware Bidding answers a probability question: how likely is this lead to become a customer? Value-based bidding, through Maximize Conversion Value or Target ROAS, answers an economic one: how much is that customer expected to be worth? A lead that is very likely to close on a small contract and one that is less likely to close on a large one can be worth the same per enquiry, or the second can be worth more. A probability model cannot see that, because deal size is not in the journey. It is in your CRM, and only you can decide whether the number that matters is revenue, gross profit, or something else.

So the beta improves one half of the estimate. The other half, what the outcomes are worth, is still the advertiser's to supply, and the method for supplying it honestly has not changed: for each kind of lead you can tell apart at form fill, close rate times average deal size, from your own history. That is worked through, with the checks that go with it, in [the complete guide to value-based bidding for lead generation](/blog/value-based-bidding-for-lead-generation).

## The end of typed-in funnel values

One thing the beta should retire is the habit of giving stages made-up prices to communicate their order: a lead at $100, an opportunity at $400, a customer at actual revenue. Smart Bidding reads those as economics. If an opportunity is not really worth four times a lead, the bidder still optimises as if it were.

It is worse than four times. If both actions are primary, a person who reaches opportunity contributes $500 of reported value and one who does not contributes $100, so the opportunity path is represented as five times more valuable before any revenue arrives. [Google's primary and secondary conversion settings](https://support.google.com/google-ads/answer/11461796?hl=en).

Journey-Aware Bidding points at the cleaner separation. Funnel stages are evidence about progression, and Google can now learn from them as such. Values are evidence about economic outcomes, and they should only ever carry a number you can defend from your data. If the numbers for your lead types come out roughly equal, there is no value signal, and Target CPA with a well-mapped journey may be the better setup.

## Lead Intent Scoring is a signal, not a strategy

The second announcement classifies each inbound lead as High, Medium or Low intent, from behaviour at submission plus your historical CRM patterns. Google describes it as a sales tool at this stage, for routing: fast outreach to High, nurture for the rest. It does not feed bidding.

For anyone in the pilot it does something else useful. Once the tier sits on the lead in your CRM, it is a column like any other, and it can be tested like any other: does "High" actually close more often than "Low" in your history, and by how much? A tier that carries real lift earns a place in your values. One that does not gets refused with a reason, which is worth knowing before a sales team reorganises around it.

## Both run on the same fuel

Read the two announcements together and one thing stands out. Journey-Aware Bidding needs your later stages imported promptly through Data Manager, keyed to the original click. Lead Intent Scoring needs your historical outcomes to learn from. Value-based bidding needs exactly the same pipe, carrying a value. None of the three repairs a CRM whose stages mean different things in different regions, whose click IDs are missing, or whose uploads arrive as a monthly batch.

So the announcements are a reason to build the pipe well, not a reason to wait for Google to make it unnecessary. The five places a CRM misleads a bidder are in [the checklist](/blog/is-your-crm-data-ready-for-value-based-bidding), and they apply to the beta exactly as they apply to values.

Two timing rules still hold whatever you send. An offline conversion has to reach Google inside its import window after the click, currently ninety days for a click-ID import, so a stage that takes longer than that to happen cannot be imported at all, and should be counted as such rather than assumed. [Google's offline conversion import documentation](https://support.google.com/google-ads/answer/2998031?hl=en). And an event that arrives is evidence for future bidding, not a change to the bid that already won the click.

## What to do now

A beta on one bid strategy is not a reason to change accounts this week. It is a reason to check readiness, because the same seven questions decide whether any of this can work:

1. Can every qualified lead and customer be tied back to the original ad click?
2. How long does each stage take to happen, and then to reach Google?
3. Are the stages defined the same way everywhere they are used?
4. Which single conversion action drives bidding today?
5. Are several primary actions counting one journey cumulatively?
6. Do the values reflect expected revenue, or were they typed in?
7. Is there enough monthly volume at the stage you want to bid on?

If those do not have clear answers, the bidding strategy is not yet the problem. The signal is.

## The larger shift

Google is moving from treating every form fill as equal toward modelling the likelihood and intent behind each one, and it is getting better at reading the path from submission to sale. That may remove the need to force every stage into the primary column or to invent prices for progression.

It does not remove the need for the business to say what an outcome is worth, or to check whether the customers that came back were better ones. The bidder is as good as the objective and the evidence it receives. This beta may use the evidence better. It does not make the evidence real. That part is still yours.

[ValueBasedBidding.com](https://valuebasedbidding.com/) reads your own closed deals, tells you whether your lead values vary and by how much, and sends the result to Google Ads. Start with the sample dataset, then your own export.

*Written by Alon Oszmann, creator of ValueBasedBidding.com. This article describes the approach behind our product. Google links are first-party implementation documentation from the platform vendor; they are not independent evidence that our scoring method improves performance.*
