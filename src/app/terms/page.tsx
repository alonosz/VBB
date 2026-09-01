import { Clause, LegalPage } from "@/components/legal/LegalPage";

export const metadata = {
  title: "Terms of Service · ValueBasedBidding",
  description:
    "The terms for using ValueBasedBidding: what we do, what we promise, and what we deliberately do not promise.",
};

/**
 * Terms that match the product's actual posture.
 *
 * The section that matters most is the one refusing to promise a result. The
 * product will not forecast, and a document that quietly implies a return
 * would contradict every screen in it - as well as being the thing that gets
 * an advertising tool into trouble.
 */
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="1 September 2026"
      lede="Plain terms for a tool that reads your CRM data, works out what your leads are worth, and sends those values to your advertising platform. The important part is section 6: we measure, we never promise a result."
    >
      <Clause title="1. Who these terms are between">
        <p>
          These terms are between BetterSignals (&ldquo;we&rdquo;) and the business
          using the service (&ldquo;you&rdquo;). By using ValueBasedBidding you
          accept them. If you are agreeing on behalf of a company, you confirm you
          are allowed to.
        </p>
      </Clause>

      <Clause title="2. What the service does">
        <p>
          It reads deal outcomes from a file you upload or a CRM you connect, works
          out what each lead segment has historically been worth from your own
          closed deals, and produces a value for each new lead. With your
          permission it sends those values to your advertising platform and reads
          back which campaigns are configured to use them.
        </p>
        <p>
          It does not manage your campaigns. It does not change budgets, bids,
          keywords or targeting, and it never will without you doing it yourself.
        </p>
      </Clause>

      <Clause title="3. Your account and your data">
        <p>
          You keep ownership of your data. You grant us only the permission needed
          to provide the service, and you can withdraw it by disconnecting an
          account or deleting a feed.
        </p>
        <p>
          You are responsible for having the right to use the data you give us, and
          for having told the people in it whatever your own privacy notice
          requires. How we handle it is set out in our{" "}
          <a
            href="/privacy"
            className="font-semibold text-[var(--primary)] underline underline-offset-2"
          >
            Privacy Policy
          </a>
          .
        </p>
        <p>
          Keep your workspace key private. It authorises publishing on your behalf.
          Tell us if it is exposed and we will issue a new one.
        </p>
      </Clause>

      <Clause title="4. Third-party accounts">
        <p>
          When you connect Google Ads or a CRM, that provider&rsquo;s own terms
          continue to apply, and you remain bound by them. We act on your instruction
          within the permissions you granted, and we may lose access if that provider
          changes its rules or revokes it - which has happened, and which is why the
          product deliberately keeps a route that needs no third-party approval.
        </p>
      </Clause>

      <Clause title="5. What you may not do">
        <ul>
          <li>
            Upload data you do not have the right to use, or personal data you have
            no lawful basis for.
          </li>
          <li>
            Use the service to build a competing product, or to resell access
            without a written agreement with us.
          </li>
          <li>
            Attempt to break, overload or gain unauthorised access to the service or
            to another customer&rsquo;s workspace.
          </li>
        </ul>
      </Clause>

      <Clause title="6. What we do not promise">
        <p>
          <strong>
            We do not promise that your advertising results will improve.
          </strong>{" "}
          We compute what your leads have historically been worth and hand those
          figures to a platform whose bidding we do not control. Whether that
          changes what the platform buys, and whether that produces more revenue,
          depends on your market, your budget, your campaign settings and the
          platform&rsquo;s own systems.
        </p>
        <p>
          Nothing in the product is a forecast. Every figure describes what already
          happened in your data. Where the product measures whether a change worked,
          it reports honestly - including when the result cannot be distinguished
          from chance, and including when the answer is no.
        </p>
        <p>
          Figures shown on demonstration or sample data are labelled as such and
          describe nothing about your business.
        </p>
      </Clause>

      <Clause title="7. Availability">
        <p>
          We aim to keep the service running and will give reasonable notice of
          planned downtime, but we do not offer a guaranteed uptime level unless we
          have agreed one with you in writing.
        </p>
      </Clause>

      <Clause title="8. Fees">
        <p>
          Where a paid plan applies, the price, billing period and what is included
          are whatever we agreed with you in writing. Pilots and evaluations are free
          unless stated otherwise. We will not start charging you without telling you
          first.
        </p>
      </Clause>

      <Clause title="9. Liability">
        <p>
          To the extent the law allows, we are not liable for lost profits, lost
          revenue, lost advertising spend, or indirect or consequential losses. Our
          total liability for any claim is limited to the fees you paid us in the
          twelve months before it arose, or one hundred US dollars if you have paid
          us nothing.
        </p>
        <p>
          Nothing here excludes liability that cannot lawfully be excluded, including
          for fraud or for death or personal injury caused by negligence.
        </p>
      </Clause>

      <Clause title="10. Ending it">
        <p>
          You can stop using the service at any time, disconnect your accounts, and
          ask us to delete your data. We can suspend or end access if these terms are
          breached, or if we stop offering the service - in which case we will give
          you reasonable notice and the chance to export what is yours.
        </p>
      </Clause>

      <Clause title="11. Changes to these terms">
        <p>
          We may update these terms. The date at the top will change, and we will
          tell active customers directly about anything material rather than leaving
          it here to be noticed. Continuing to use the service after a change means
          you accept it.
        </p>
      </Clause>

      <Clause title="12. Governing law">
        <p>
          These terms are governed by the laws of Israel, and the courts of Tel Aviv
          have exclusive jurisdiction, unless we have agreed otherwise with you in
          writing.
        </p>
      </Clause>
    </LegalPage>
  );
}
