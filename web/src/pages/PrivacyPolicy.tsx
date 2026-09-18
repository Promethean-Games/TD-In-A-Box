import './Legal.css';

export default function PrivacyPolicy() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <p className="legal-kicker">Privacy Policy</p>
        <h1>TD in a Box Privacy Policy</h1>

        <p>
          TD in a Box is a tournament management and live broadcasting product designed to help tournament
          directors create events, manage players, and stream tournament activity. This privacy policy explains
          how we handle data in the current architecture and what users should expect from the service.
        </p>

        <h2>Information We May Collect</h2>
        <p>
          We may collect tournament names, player names, event dates, bracket settings, table counts, payout
          configuration, venue details, and account-related profile information used to operate the product.
          For live broadcast features, we may also process event metadata required to display current matches,
          schedules, and stream information.
        </p>

        <h2>How We Use Data</h2>
        <p>
          Tournament and player data is used to generate brackets, manage entrants, track match results, calculate
          payouts, support broadcast workflows, and provide operational tools for tournament directors. Account data
          may be used to identify the user, manage subscription access, and personalize the experience.
        </p>

        <h2>Local Storage and Browser Data</h2>
        <p>
          In the current browser-first implementation, some tournament data is stored locally in the browser using
          local storage to keep the product fast, simple, and functional without a backend service. This means the
          device running the browser may retain tournament records locally. Users should manage backups as needed,
          especially before deleting or resetting data.
        </p>

        <h2>Third-Party Services</h2>
        <p>
          The product may integrate with external hosting, analytics, payment, or streaming services in the future.
          Where those services are used, they may process information under their own privacy policies. We do not
          use customer tournament data for unrelated advertising or resale.
        </p>

        <h2>Retention</h2>
        <p>
          We retain operational data as long as it is needed to support the active event lifecycle, account access,
          subscription management, or legal obligations. Users may archive or export tournament backups to preserve
          records outside the app.
        </p>

        <h2>Security</h2>
        <p>
          We aim to store event and account data with reasonable safeguards, but no internet-connected service can
          guarantee absolute security. Users should protect their devices, browser sessions, and exported backup files.
        </p>

        <h2>Contact</h2>
        <p>
          For privacy questions, contact the product team through the official support channel associated with the
          TD in a Box deployment or product owner.
        </p>
      </div>
    </div>
  );
}
