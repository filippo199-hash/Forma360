/**
 * Public-site content (homepage + company details).
 *
 * Kept as plain data in a `.ts` module (not an `app/` route file) — so it is
 * exempt from the `forma360/no-hardcoded-strings` rule while still keeping every
 * user-facing string in one editable place. The public marketing + legal
 * pages are English-only by design (legal/review content), separate from the
 * in-app i18n catalogue.
 */

/** Company / contact details. Used across legal pages, contact, and footer. */
export const COMPANY = {
  name: 'Forma360',
  /** Postal address on record (Meta App Settings → Basic). */
  address: 'Milton Avenue 23, London, N6 5QF, United Kingdom',
  /** Country of establishment / governing law. */
  jurisdiction: 'England and Wales',
  /** Public-facing contact addresses. Must forward to a monitored inbox. */
  email: 'support@forma360.io',
  privacyEmail: 'privacy@forma360.io',
  website: 'https://forma360.io',
  /** Last review date shown on legal documents. */
  lastUpdated: '17 June 2026',
} as const;

export interface Feature {
  title: string;
  description: string;
}

/** Homepage hero copy. */
export const HERO = {
  eyebrow: 'Operational excellence platform',
  title: 'Run inspections, issues and actions — and ask your AI assistant anything.',
  subtitle:
    'Forma360 is a multi-tenant operational-excellence platform for inspections, issues, corrective actions, assets, documents and analytics. Its built-in AI assistant answers questions about your operations in plain language — on the web and over WhatsApp.',
  primaryCta: 'Get started',
  secondaryCta: 'Contact us',
} as const;

/** Homepage feature grid. */
export const FEATURES: Feature[] = [
  {
    title: 'Inspections & templates',
    description:
      'Build templates once, conduct inspections on any device, and turn findings into tracked actions automatically.',
  },
  {
    title: 'Issues & corrective actions',
    description:
      'Capture observations and incidents, run investigations, and close the loop with assigned, due-dated actions.',
  },
  {
    title: 'Assets & maintenance',
    description:
      'Keep an asset register, schedule maintenance, and link inspections and issues to the equipment they concern.',
  },
  {
    title: 'AI assistant — web & WhatsApp',
    description:
      'Ask “how many inspections are overdue?” or “show open high-priority issues” and get instant, data-scoped answers. Available in the app and on WhatsApp, so your team can check in from anywhere.',
  },
  {
    title: 'Documents & analytics',
    description:
      'Centralise policies and procedures, and track operational performance with dashboards and exports.',
  },
  {
    title: 'Secure multi-tenancy',
    description:
      'Every organisation’s data is isolated by design, with role-based permissions, groups and sites controlling access.',
  },
];

/** Short explanation of how the WhatsApp assistant works (used on About). */
export const WHATSAPP_BLURB =
  'Members of an organisation can message the Forma360 assistant on WhatsApp. We match the sender’s WhatsApp number to their Forma360 user account, scope the request to that organisation’s data, generate an answer with our AI assistant, and reply — all within the conversation the user started.';
