import './Legal.css';

export default function TermsOfService() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <p className="legal-kicker">Terms of Service</p>
        <h1>TD in a Box Terms of Service</h1>

        <p>
          These Terms of Service govern use of the TD in a Box platform, including tournament management, player
          tracking, payouts, broadcasting workflows, and related operational features. By using the service, you agree
          to the terms below.
        </p>

        <h2>1. Service Overview</h2>
        <p>
          TD in a Box is designed to help tournament directors manage events, create bracket structures, assign
          players to matches, track scores, record results, and prepare live broadcast experiences. Some features may
          depend on subscription level, device capabilities, or browser support.
        </p>

        <h2>2. User Responsibilities</h2>
        <p>
          Users are responsible for the accuracy of tournament data they enter, including player names, event dates,
          payouts, bracket settings, and table assignments. Tournament directors should verify match results before
          publishing them and should keep backups of important event records.
        </p>

        <h2>3. Local Data and Backups</h2>
        <p>
          The current product architecture may store event data locally in the browser. This is intended to support a
          lightweight and reliable experience for local tournament operations, but users remain responsible for
          maintaining backups and for understanding local device storage behavior.
        </p>

        <h2>4. Tournament Integrity</h2>
        <p>
          TD in a Box is a tool for organizing and running events. It does not replace official tournament rules,
          venue policies, local regulations, or governing body requirements. Tournament operators are responsible for
          ensuring competitors, payouts, and schedule decisions comply with the relevant event rules.
        </p>

        <h2>5. Broadcast and Public Viewing</h2>
        <p>
          Broadcast features are intended to present match and event information to players, viewers, and venue staff.
          Users agree not to misuse public viewing features for unlawful content, false representations, or
          unauthorized distribution of private tournament information.
        </p>
        <p>
          All broadcast content must remain PG and kid-appropriate. Prohibited content includes explicit sexual content,
          graphic violence, hate speech, harassment, threats, illegal activity, and promotion of self-harm or dangerous
          conduct. Accounts may be suspended for violations.
        </p>

        <h2>6. Subscription and Entitlements</h2>
        <p>
          Certain capabilities may be restricted based on subscription tier or plan eligibility. Entitlements are used
          to grant access to advanced tools such as additional tournament configuration, templates, venue workflows,
          or broadcast capabilities.
        </p>

        <h2>7. Acceptable Use</h2>
        <p>
          Users may not use the service for illegal activity, fraud, harassment, deceptive event operations, or
          unauthorized access to other users&apos; data. We reserve the right to suspend or restrict access in cases of
          abusive or unlawful use.
        </p>

        <h2>8. Service Availability</h2>
        <p>
          The platform may be updated, improved, or temporarily unavailable during maintenance, testing, or product
          changes. We do not guarantee uninterrupted access or continuous availability of any particular feature.
        </p>

        <h2>9. Limitation of Liability</h2>
        <p>
          TD in a Box is offered as a management tool with reasonable operational safeguards, but we are not liable
          for losses caused by user input errors, local storage issues, device failures, unsupported browser behavior,
          or external service outages beyond our control.
        </p>

        <h2>10. Changes to Terms</h2>
        <p>
          We may update these terms as the product evolves. Continued use of the service after changes are published
          indicates acceptance of the updated terms.
        </p>
      </div>
    </div>
  );
}
