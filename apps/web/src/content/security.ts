/**
 * Security & trust page content (`/security`).
 *
 * Same convention as `content/site.ts`: plain data, English-only, brand
 * identity from the brand catalogue. Every claim here is grounded in
 * shipped behaviour (tenant isolation per ADR 0002, server-side
 * permissions, scrubbed telemetry per ADR 0016, revocable share tokens,
 * the settings audit log). The "not yet" section is deliberate: stating
 * what is missing is part of the trust story, not a weakness of it.
 * Do not add certifications, hosting-region or recovery-time claims here
 * without evidence to stand behind them.
 */
import { activeBrand } from '../lib/brand';

export interface SecuritySection {
  readonly title: string;
  readonly body: string;
}

export const SECURITY = {
  metaTitle: `Security — ${activeBrand.name}`,
  metaDescription: `How ${activeBrand.name} protects your workspace: isolation by design, server-enforced permissions, passwordless sign-in, confidential records, revocable share links and scrubbed telemetry — plus an honest list of what is not in place yet.`,
  eyebrow: 'Trust',
  title: 'Security, in plain language',
  lead: `Health and safety records name real people on their worst days. Here is how ${activeBrand.name} treats them — in the same plain terms the rest of the site uses, including the part most security pages leave out: what we don't have yet.`,
  sections: [
    {
      title: 'One organisation, one boundary',
      body: 'Every record belongs to your organisation and is scoped to it at the data layer. A workspace can never read another workspace — isolation is how the platform is built, not a filter applied on top.',
    },
    {
      title: 'Permissions enforced on the server',
      body: 'Named permission sets govern who can see and do what, and every check runs on the server — hiding a button is never the security model. Deactivating a person takes effect immediately, including sessions already signed in, and the platform refuses any change that would leave a workspace without an administrator.',
    },
    {
      title: 'Sign-in without passwords',
      body: 'Sign-in is a one-time code sent to a verified email address. There is no password to phish, reuse or leak in someone else’s breach — and nothing for your team to write on a post-it.',
    },
    {
      title: 'Confidential records stay confidential',
      body: 'Sensitive incident kinds — sharps, violence & aggression — are confidential by default: counted in every statistic, readable only by the people who should. That confidentiality is enforced everywhere the data could surface, including search, exports and the AI assistant.',
    },
    {
      title: 'Share links you control',
      body: 'Public share links — inspection reports, RAMS packs, briefings — use long, unguessable tokens, are excluded from search-engine indexing, and can be revoked at any moment. Revocation is immediate.',
    },
    {
      title: 'The assistant sees what you see',
      body: 'The AI assistant answers only from your own workspace’s records, filtered by your own permissions. On WhatsApp, every inbound message is signature-verified and the sender is matched to their account before anything is looked up.',
    },
    {
      title: 'Telemetry without your data',
      body: 'Error reporting is scrubbed before it leaves the application: request bodies, cookies, query strings and access tokens are stripped, so diagnosing a fault never means exporting your records.',
    },
    {
      title: 'Encryption, backups and audit',
      body: activeBrand.offersFreePlan
        ? 'All traffic is encrypted in transit, and the application runs on managed cloud infrastructure. Pro workspaces add daily backups. Administrative activity is recorded in an audit log your administrators can review from settings, and every register exports on demand — your records are never held hostage.'
        : 'All traffic is encrypted in transit, and the application runs on managed cloud infrastructure. Administrative activity is recorded in an audit log your administrators can review from settings, and every register exports on demand — your records are never held hostage.',
    },
  ] satisfies readonly SecuritySection[],
  notYet: {
    title: 'What we don’t have yet',
    body: 'We would rather tell you than have you discover it: single sign-on (SSO/SAML) and formal certifications such as ISO 27001 are not yet in place. If your organisation needs a security questionnaire answered before adopting, send it over — we answer them honestly.',
  },
  contact: {
    title: 'Questions, questionnaires, disclosures',
    body: `All of it goes to ${activeBrand.supportEmail}. If you believe you have found a vulnerability, please report it there before disclosing it anywhere else — we take reports seriously and reply like humans.`,
  },
} as const;
