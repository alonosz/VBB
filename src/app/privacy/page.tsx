import { Clause, LegalPage } from "@/components/legal/LegalPage";

export const metadata = {
  title: "Privacy Policy · ValueBasedBidding",
  description:
    "What ValueBasedBidding reads, what it stores, and what it never stores. Written to describe how the product actually behaves.",
};

/**
 * Written from the schema rather than from a template.
 *
 * Every claim here is one the code enforces: the CHECK constraints on
 * feed_rows refuse a plaintext email outright, the intake profiler sends no
 * cell values, and the CRM pull passes deals through without writing them.
 * A policy that promised more than the database enforces would be the exact
 * failure this product exists to avoid, and a policy that promised less would
 * throw away the strongest thing we can say to a buyer.
 *
 * A lawyer should still read it. It is accurate, not certified.
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="1 September 2026"
      lede="This describes what the product does, not what a template says. The short version: your CRM data is read in your browser and is not uploaded, and the only customer data we keep on a server is what an advertising platform needs to match a conversion - hashed identifiers, a timestamp and an amount."
    >
      <Clause title="Who we are">
        <p>
          ValueBasedBidding is operated by BetterSignals. For questions or requests
          about your data, write to{" "}
          <a
            href="mailto:alon@bettersignals.co"
            className="font-semibold text-[var(--primary)] underline underline-offset-2"
          >
            alon@bettersignals.co
          </a>
          .
        </p>
        <p>
          Where our customer is a business using the product on its own data, that
          business is the <strong>controller</strong> of the personal data in its
          CRM and we are its <strong>processor</strong>. For our own website and
          marketing contacts, we are the controller.
        </p>
      </Clause>

      <Clause title="What we store on our servers">
        <p>This is the complete list. There is nothing else.</p>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>What</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Hashed email addresses</strong> (SHA-256) and{" "}
                  <strong>ad click IDs</strong>
                </td>
                <td>
                  The only way an advertising platform can match a conversion to
                  the click that produced it. The hash is one-way; we cannot read
                  the address back out of it.
                </td>
              </tr>
              <tr>
                <td>
                  <strong>A conversion timestamp, a value and a currency</strong>
                </td>
                <td>What is sent to the ad platform, and nothing more.</td>
              </tr>
              <tr>
                <td>
                  <strong>A model identifier</strong>, and the rules a saved model
                  contains
                </td>
                <td>
                  So any figure can be traced back to the rule that produced it.
                  The rules are segment-level statistics - a close rate, an average
                  deal size - never an individual record.
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Encrypted access tokens</strong> for a CRM or ad account
                  you connect
                </td>
                <td>
                  Encrypted at rest. Needed to read your deals on a schedule and to
                  send values on your behalf.
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Workspace and run records</strong> - a workspace name, when
                  a sync ran, how many rows it handled, and hashed IP addresses for
                  rate limiting
                </td>
                <td>Operating the service and stopping abuse.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Clause>

      <Clause title="What we never store">
        <p>
          We do not keep CRM records. Specifically, we never write to our servers:
        </p>
        <ul>
          <li>Names, postal addresses or phone numbers</li>
          <li>Email addresses in readable form, anywhere in the conversion feed</li>
          <li>Individual deal amounts, company names or job titles</li>
          <li>Notes, free text or anything a salesperson typed</li>
        </ul>
        <p>
          This is enforced by the database rather than by policy. The conversion
          table carries constraints that reject a row whose email field is not a
          64-character hash, so a plaintext address cannot be written even by
          mistake.
        </p>
        <p>
          <strong>One exception, stated plainly:</strong> if you give us your email
          address on our website - to receive a report or to be contacted - we
          store that address in readable form, because an address we cannot read is
          an address we cannot write to. That is a marketing contact, kept separate
          from any customer&rsquo;s CRM data, and you can ask us to delete it at any
          time.
        </p>
      </Clause>

      <Clause title="Where your CRM data is actually processed">
        <p>
          <strong>A file you upload never leaves your browser.</strong> It is read,
          mapped and analysed on your own machine. The model is fitted there. Only
          the finished conversion rows - hashed identifier, time, value, currency -
          are sent to our server, and only when you choose to publish them.
        </p>
        <p>
          <strong>A connected CRM is read through our server but not written down.</strong>{" "}
          When you connect HubSpot, deals pass through our service to your browser,
          which does the analysis. Those records are held in memory for the length
          of the request and are not saved.
        </p>
      </Clause>

      <Clause title="The one AI call, and what it is not allowed to see">
        <p>
          When you describe your business at the start, we make a single call to
          Anthropic&rsquo;s Claude API. Its only job is to suggest which column in
          your file is which, and to note the claims you made about your buyers so
          the product can test them against your data.
        </p>
        <p>
          <strong>It never receives your rows.</strong> It is sent a description of
          each column: the header name, what kind of value it holds, how often it is
          filled in, how many distinct values there are, and - only for short
          category columns like an industry list - a few example labels. It is never
          sent an email address, a name, a phone number, an address, a click ID, a
          deal amount, or free text.
        </p>
        <p>
          <strong>It never produces a number.</strong> Every value, multiplier and
          rate in the product comes from arithmetic on your own rows. If the AI
          call fails, the product carries on without it.
        </p>
      </Clause>

      <Clause title="Who else touches the data">
        <p>We use these providers, and no others, to run the service:</p>
        <ul>
          <li>
            <strong>Vercel</strong> - hosting.
          </li>
          <li>
            <strong>Supabase</strong> - the database described above.
          </li>
          <li>
            <strong>Anthropic</strong> - the single column-mapping call, on the
            column descriptions above and nothing else.
          </li>
          <li>
            <strong>Google</strong> and <strong>HubSpot</strong> - when you connect
            them, to send values and read deals respectively, under the permissions
            you grant.
          </li>
        </ul>
        <p>We do not sell data, and we do not share it for advertising of our own.</p>
      </Clause>

      <Clause title="What we send to Google, and why it is hashed">
        <p>
          When you publish, we send Google a conversion for each lead: the click ID
          if there is one, the hashed email if there is one, the time, the value and
          the currency. Both identifiers travel together where a lead has both,
          because Google matches on the click ID and falls back to the email.
        </p>
        <p>
          The email is hashed before it leaves your browser, in the format Google
          requires. Google matches the hash against its own hashed records. Neither
          we nor anyone reading our database can reverse it.
        </p>
      </Clause>

      <Clause title="How long we keep it">
        <ul>
          <li>
            <strong>Conversion rows:</strong> kept while your feed is active, so a
            platform can collect them and so a republish does not send the same
            conversion twice. Deleted when you delete the feed, and on request.
          </li>
          <li>
            <strong>Access tokens:</strong> deleted when you disconnect the account.
          </li>
          <li>
            <strong>Run records:</strong> kept for operational history.
          </li>
          <li>
            <strong>Marketing contacts:</strong> until you ask us to remove yours.
          </li>
        </ul>
      </Clause>

      <Clause title="Your rights">
        <p>
          You can ask us for a copy of what we hold about you, ask us to correct it,
          or ask us to delete it. Write to{" "}
          <a
            href="mailto:alon@bettersignals.co"
            className="font-semibold text-[var(--primary)] underline underline-offset-2"
          >
            alon@bettersignals.co
          </a>{" "}
          and we will respond within 30 days.
        </p>
        <p>
          If you are an individual whose details sat in a customer&rsquo;s CRM, that
          customer controls the data and is the right first point of contact. Tell us
          anyway and we will help them act on it.
        </p>
        <p>
          Depending on where you live you may also have the right to complain to a
          data protection authority.
        </p>
      </Clause>

      <Clause title="Security">
        <p>
          Traffic is encrypted in transit. Access tokens are encrypted at rest. Feed
          URLs are authorised by a token we store only as a hash, so a copy of our
          database does not hand anyone a working feed.
        </p>
        <p>
          No system is perfect. If we discover a breach affecting your data we will
          tell you promptly and say what happened.
        </p>
      </Clause>

      <Clause title="Changes">
        <p>
          If we change how the product handles data, this page changes with it and
          the date at the top moves. Material changes will be told to active
          customers directly rather than left here to be noticed.
        </p>
      </Clause>
    </LegalPage>
  );
}
