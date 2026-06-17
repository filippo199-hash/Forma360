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

/** Header navigation labels (shown to signed-out visitors). */
export const NAV = {
  signIn: 'Sign in',
  getStarted: 'Get started',
} as const;

/** Homepage hero copy. */
export const HERO = {
  eyebrow: 'The operational excellence platform',
  title: 'Inspect, resolve, improve — and just ask.',
  subtitle:
    'Forma360 brings inspections, issues, corrective actions, assets and analytics into one platform. Its AI assistant answers questions about your operations in plain language — in the app or over WhatsApp.',
  primaryCta: 'Get started',
  secondaryCta: 'Book a demo',
  /** Shown instead of the primary CTA when the visitor is already signed in. */
  appCta: 'Open the app',
  /** Small reassurance line under the hero CTAs. */
  note: 'Passwordless sign-in · 10 languages · Web & WhatsApp',
} as const;

/** Industries strip (honest framing — no customer logos we don't have). */
export const INDUSTRIES_HEADING = 'Built for frontline teams across every industry';
export const INDUSTRIES: string[] = [
  'Manufacturing',
  'Construction',
  'Hospitality',
  'Retail',
  'Healthcare',
  'Logistics & transport',
  'Facilities',
  'Energy & utilities',
];

/** Platform-at-a-glance stats. Real product facts, not vanity metrics. */
export interface Stat {
  value: string;
  label: string;
}
export const STATS: Stat[] = [
  { value: '10', label: 'Integrated modules, one platform' },
  { value: 'Web + WhatsApp', label: 'Ask your data from anywhere' },
  { value: '10', label: 'Languages, available day one' },
  { value: 'Multi-tenant', label: 'Every workspace isolated by design' },
];

export interface Module {
  /** lucide-react icon name, mapped in the component. */
  icon:
    | 'clipboard-check'
    | 'triangle-alert'
    | 'square-check-big'
    | 'package'
    | 'calendar-clock'
    | 'file-text'
    | 'chart-column'
    | 'bot';
  title: string;
  description: string;
}

export const MODULES_INTRO = {
  eyebrow: 'One connected platform',
  title: 'Everything your operation needs, in one place',
  subtitle:
    'Every module shares one database, one permission model and one assistant — so a finding becomes an action, and an action becomes an answer.',
} as const;

export const MODULES: Module[] = [
  {
    icon: 'clipboard-check',
    title: 'Inspections & templates',
    description:
      'Build templates once, conduct inspections on any device, and turn findings into tracked actions automatically.',
  },
  {
    icon: 'triangle-alert',
    title: 'Issues & observations',
    description:
      'Capture observations and incidents, run investigations, and keep everyone aligned on what needs attention.',
  },
  {
    icon: 'square-check-big',
    title: 'Corrective actions',
    description:
      'Close the loop with assigned, due-dated actions linked back to the inspection or issue that raised them.',
  },
  {
    icon: 'package',
    title: 'Assets & maintenance',
    description:
      'Keep an asset register, schedule preventive maintenance, and link work to the equipment it concerns.',
  },
  {
    icon: 'calendar-clock',
    title: 'Schedules & reminders',
    description:
      'Automate recurring inspections and maintenance, with reminders so nothing slips through the cracks.',
  },
  {
    icon: 'file-text',
    title: 'Documents',
    description:
      'Centralise policies, procedures and evidence, with version control and controlled access.',
  },
  {
    icon: 'chart-column',
    title: 'Analytics & exports',
    description:
      'See operational performance at a glance, and export polished PDF or Word reports in a click.',
  },
  {
    icon: 'bot',
    title: 'AI assistant',
    description:
      'Ask questions in plain language and get instant, data-scoped answers — in the app or over WhatsApp.',
  },
];

/** The differentiator spotlight: the WhatsApp assistant. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}
export const WHATSAPP_SPOTLIGHT = {
  eyebrow: 'What sets us apart',
  title: 'Your operations, one WhatsApp message away',
  body: 'No app to open, no dashboard to learn. Your team messages the Forma360 assistant on WhatsApp and gets answers scoped to your organisation — instantly. We match the sender to their account, look up only their data, and reply in the same chat.',
  bullets: [
    'Answers scoped to the sender’s own organisation',
    'Powered by the same AI assistant as the web app',
    'Secure: every inbound message is signature-verified',
  ],
  chat: [
    { role: 'user', text: 'How many inspections are overdue?' },
    {
      role: 'assistant',
      text: 'You have 3 overdue inspections — 2 at Riverside and 1 at Docklands. Want me to list them?',
    },
    { role: 'user', text: 'Show open high-priority issues' },
    {
      role: 'assistant',
      text: 'There are 5 open high-priority issues. The oldest is “Forklift hydraulic leak” (Warehouse B), opened 4 days ago.',
    },
  ] as ChatTurn[],
} as const;

/** Final call-to-action band. */
export const CTA = {
  title: 'Bring your whole operation into focus',
  subtitle: 'Set up your workspace in minutes and put inspections, issues and actions in one place.',
  primary: 'Get started',
  secondary: 'Talk to us',
} as const;

/** Short explanation of how the WhatsApp assistant works (used on About). */
export const WHATSAPP_BLURB =
  'Members of an organisation can message the Forma360 assistant on WhatsApp. We match the sender’s WhatsApp number to their Forma360 user account, scope the request to that organisation’s data, generate an answer with our AI assistant, and reply — all within the conversation the user started.';
