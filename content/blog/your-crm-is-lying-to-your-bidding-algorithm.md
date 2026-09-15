title: Your CRM Is Lying to Your Bidding Algorithm
description: Five checks before you turn your sales history into Google Ads conversion values. Stage timestamps, source fields, deal ranges, click ID coverage and late outcomes all mislead in ways that become spending instructions.
date: 2026-09-15
author: Alon Oszmann
kind: Checklist
---

*Five checks before you turn your sales history into Google Ads conversion values.*

A CRM can be good enough to manage your pipeline and still be a poor foundation for bidding.

A stage change might record when someone updated a deal, not when the buyer progressed. A source field might describe the first visit, not the click you are measuring. A huge contract might be real, but tell you very little about what the next lead will be worth.

Once those records become conversion values, these are no longer just reporting problems. They become instructions about where to spend your advertising budget.

Before you teach Google which leads to hunt, check what your CRM is actually telling it.

## 1. Did the lead progress, or did someone update the pipeline?

Imagine a deal that spends nine seconds in Evaluation, two seconds in Contracting and less than a minute in Proposal Sent.

Those timestamps deserve a second look. A rep may have updated several stages after the sale. A workflow or import may have moved the record. The buyer may genuinely have skipped steps.

The duration alone does not tell you which explanation is right.

This matters if you plan to raise a lead's value when it reaches a milestone. A delayed administrative update is not the same signal as a newly qualified buyer.

**Check:** Review a sample of unusually fast transitions against record history, workflow activity and sales notes. Establish what creates each timestamp before using it to trigger value updates. Check create and close dates too; neither is automatically reliable.

Use a stage as a timely bidding signal only when you can explain what happened and when it was recorded.

## 2. Does "lead source" mean what you think it means?

Original source, latest source and a salesperson's source selection answer different questions. Mixing them can make a value model look more precise than it is.

A Google click ID also does not prove Google was the customer's only touchpoint. Someone can arrive through a referral, return through an ad and retain "Referral" in the CRM.

The problem is not that source can never predict value. It is that you can accidentally reward a tracking label instead of a valuable customer characteristic.

**Check:** Document how the source field is populated and whether it changes. Use it to compare channel performance and check whether your historical sample resembles the leads you want to acquire.

For an initial lead-value model, I would start with attributes available when the lead arrives: company size or role for B2B; requested service or stated need for consumer lead generation. Test their relationship with outcomes instead of assuming they matter.

Only use information you are permitted to collect and use for the relevant advertising purpose.

## 3. A huge deal range is not proof of a useful bidding signal

Your largest customer may be worth 100 times your smallest. That makes a compelling chart. It does not establish that you could have distinguished them at form fill.

The useful question is narrower:

**Do identifiable groups of new leads consistently produce different sales outcomes?**

That requires more than sorting won deals by amount. You need the leads that did not buy, too. If your export contains only opportunities that reached sales, it may leave out much of the population you are trying to score.

Open leads also need careful treatment. Counting recent opportunities as losses penalizes groups with longer sales cycles. Looking only at resolved deals can introduce a different bias if faster outcomes dominate the sample.

**Check:** Build on sufficiently mature lead cohorts, document how unresolved leads are handled, and test the resulting values on a later period that was not used to build them.

For a revenue objective, close probability multiplied by mean won revenue estimates expected revenue. A median or capped average can make the score less sensitive to large deals, but changes what it estimates. Label that choice honestly.

If you cap large deals, show the effect. A rare enterprise contract is not necessarily bad data. Capping it may stabilize the score while understating a genuinely valuable segment.

## 4. Missing click IDs and missing value evidence are different problems

Historical leads can help you estimate segment performance even when they lack advertising identifiers. Their outcomes still contain information.

Sending a particular conversion back to Google is a separate question. Google supports click-ID-based imports and enhanced conversions for leads using eligible first-party customer data. Missing GCLIDs therefore do not automatically mean every affected lead is unmatchable. [Google's offline conversion documentation](https://support.google.com/google-ads/answer/2998031?hl=en).

**Check:** Separate three measurements:

* **Identifier coverage.** How many records contain usable matching information?
* **Import acceptance.** How many submitted records pass validation?
* **Attribution.** How many accepted events can Google associate with eligible ad interactions?

These are not interchangeable. A CSV with an email column does not prove a high match rate, and an accepted upload does not prove every lead was attributed.

Fix capture for future leads and investigate changes in coverage, upload errors and attribution separately. Do not assume every decline means the website broke.

## 5. Late outcomes need a plan, not a made-up deadline

Long sales cycles create a tradeoff: early events arrive quickly but reveal less; completed sales reveal more but arrive later.

Google recommends shorter reporting delays, preferably under seven days, but explicitly allows average delays beyond seven days in some circumstances. Seven days is not a universal expiry date for useful feedback. Google also recommends choosing one funnel stage for bid optimization. [Google's value-based bidding guidance](https://support.google.com/google-ads/answer/15099424?hl=en).

**Check:** Choose an event that balances speed, volume and its relationship with sales. That might be a valued form submission or a consistently recorded qualified lead. Report promptly and confirm the applicable import and adjustment requirements.

Do not casually add predicted lead value, qualified-lead value and final revenue together as though they were three independent returns from the same customer.

Keep eventual outcomes for validation. An early score is useful only if later sales support it.

## Give Google a signal you can defend

The goal is not a perfect CRM. It is knowing which records are suitable for which decisions.

You should be able to explain what each value represents, which leads informed it, which records were excluded and whether it holds up on newer data.

That is the problem I built [ValueBasedBidding.com](https://valuebasedbidding.com/) to help with: turning sales history into estimated lead values you can inspect and send to Google Ads.

Start with the sample. Then examine your own history before asking an algorithm to spend against it.
