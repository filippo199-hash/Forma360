/**
 * Public-site content (homepage + company details).
 *
 * Kept as plain data in a `.ts` module (not an `app/` route file) — so it is
 * exempt from the `forma360/no-hardcoded-strings` rule while still keeping every
 * user-facing string in one editable place. The public marketing + legal
 * pages are English-only by design (legal/review content), separate from the
 * in-app i18n catalogue.
 *
 * Brand identity (product name, legal entity, domains) comes from the brand
 * catalogue (ADR 0010) — never hardcode a product name in this file. Where
 * copy differs between brands it branches on brand *capabilities*
 * (`offersFreePlan`, `offersSandbox`, the module catalogue) — never on the
 * brand id.
 */
import { brandHasModule } from '@forma360/shared/brand';
import { activeBrand } from '../lib/brand';
import { marketingModules } from './modules';

/** Company / contact details. Used across legal pages, contact, and footer. */
export const COMPANY = {
  /** Product / trading name. */
  name: activeBrand.name,
  /** Registered legal-entity name (Companies House). */
  legalName: activeBrand.legalName,
  /** Companies House registration number (England & Wales). */
  companyNumber: activeBrand.companyNumber,
  /** Full legal-entity descriptor for the opening line of legal documents. */
  legalEntity: activeBrand.legalEntity,
  /** Registered office address (Companies House / Meta App Settings → Basic). */
  address: activeBrand.address,
  /** Country of establishment / governing law. */
  jurisdiction: activeBrand.jurisdiction,
  /** Public-facing contact addresses. Must forward to a monitored inbox. */
  email: activeBrand.supportEmail,
  privacyEmail: activeBrand.privacyEmail,
  website: activeBrand.website,
  /** Last review date shown on legal documents. */
  lastUpdated: '22 June 2026',
} as const;

/** How many modules the active brand ships — quoted across the site. */
export const MODULE_COUNT = marketingModules().length;

/** Whether the active brand ships the safety-register modules (drives copy). */
const HAS_SAFETY_REGISTERS = brandHasModule(activeBrand.id, 'riskAssessments');

/** <title>/description for the public site (layout metadata). */
export const SITE_META = activeBrand.offersFreePlan
  ? {
      title: `${activeBrand.name} — Free health & safety software`,
      description: `Risk assessments, inspections, permits to work, incidents & RIDDOR, COSHH, fire safety, RAMS and training — ${MODULE_COUNT} connected modules, unlimited users, free. Built for UK practice.`,
    }
  : {
      title: activeBrand.name,
      description: `${activeBrand.name} — operational excellence platform. Inspections, issues, actions, assets and analytics in one place, with an AI assistant on the web and WhatsApp.`,
    };

/** Header navigation labels (shown to signed-out visitors). */
export const NAV = {
  signIn: 'Sign in',
  getStarted: 'Get started',
  tryFree: 'Try it free',
  modules: 'Modules',
  docs: 'Docs',
  pricing: 'Pricing',
} as const;

// ─── Hero ────────────────────────────────────────────────────────────────────

export interface HeroContent {
  /** Small pill above the headline. */
  pill: string;
  /** Headline, split so the closing phrase can carry the brand colour. */
  titleLead: string;
  titleAccent: string;
  subtitle: string;
  primaryCta: string;
  secondaryCta: string;
  /** Leads the hero on brands that ship the try-it-now sandbox (ADR 0017). */
  tryCta: string;
  /** Shown instead of the primary CTA when the visitor is already signed in. */
  appCta: string;
  /** Small reassurance line under the hero CTAs. */
  note: string;
}

export const HERO: HeroContent = activeBrand.offersFreePlan
  ? {
      pill: '100% free · Unlimited users · No card',
      titleLead: 'Everything you need to run health & safety.',
      titleAccent: 'Free.',
      subtitle: `Risk assessments, inspections, permits to work, incidents and RIDDOR, COSHH, fire safety, RAMS, training — ${MODULE_COUNT} connected modules your whole team can use, at no cost. Built for UK practice.`,
      primaryCta: 'Create your free workspace',
      secondaryCta: 'Browse the modules',
      tryCta: 'Try it now — no account',
      appCta: 'Open the app',
      note: 'Passwordless sign-in · Web, mobile & WhatsApp · 10 languages',
    }
  : {
      pill: 'The operational excellence platform',
      titleLead: 'Inspect, resolve, improve —',
      titleAccent: 'and just ask.',
      subtitle: `${activeBrand.name} brings inspections, issues, corrective actions, assets and analytics into one platform. Its AI assistant answers questions about your operations in plain language — in the app or over WhatsApp.`,
      primaryCta: 'Get started',
      secondaryCta: 'Book a demo',
      tryCta: 'Try it now — no account',
      appCta: 'Open the app',
      note: 'Passwordless sign-in · 10 languages · Web & WhatsApp',
    };

// ─── Trust strip ─────────────────────────────────────────────────────────────

/**
 * Brands shipping the safety registers lead with the UK practice they
 * implement; others fall back to the honest industries strip (no customer
 * logos we don't have).
 */
export const TRUST_STRIP = HAS_SAFETY_REGISTERS
  ? {
      heading: 'Built around the way UK health & safety actually works',
      items: [
        'HSE five-step risk assessments',
        'RIDDOR 2013 screening & deadlines',
        'COSHH assessments & exposure limits',
        'Fire Safety Order 2005 FRAs',
        'Permit-to-work controls',
        'RAMS & method statements',
        'Training & competence records',
      ],
    }
  : {
      heading: 'Built for frontline teams across every industry',
      items: [
        'Manufacturing',
        'Construction',
        'Hospitality',
        'Retail',
        'Healthcare',
        'Logistics & transport',
        'Facilities',
        'Energy & utilities',
      ],
    };

// ─── Modules showcase ────────────────────────────────────────────────────────

export const MODULES_SHOWCASE = {
  eyebrow: 'The platform',
  title: activeBrand.offersFreePlan
    ? `${MODULE_COUNT} connected modules. All of them free.`
    : 'Everything your operation needs, in one place',
  subtitle:
    'Every module shares one database, one permission model and one assistant — so a finding becomes an action, and an action becomes an answer. Open any module to see how it works.',
  viewAll: 'Explore all modules',
  paidBadge: 'Paid add-on',
} as const;

// ─── Golden thread (linked-records spotlight) ────────────────────────────────

export const GOLDEN_THREAD = {
  eyebrow: 'The golden thread',
  title: 'A finding becomes a fix — and stays linked',
  body: 'Point solutions leave the connective tissue to spreadsheets. Here the inspection question, the hazard report and the investigation finding all raise actions that link back to their source — so “what did we do about it?” always has an answer, in both directions.',
  bullets: [
    'Failed inspection responses raise actions carrying the exact question and site',
    'Hazard reports promote to incidents with photos and history intact',
    'Investigation findings become owned, due-dated actions at approval — exactly once',
    'Every record reads its follow-up work back, so audit trails run both ways',
  ],
} as const;

// ─── WhatsApp / assistant spotlight ──────────────────────────────────────────

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export const WHATSAPP_SPOTLIGHT = {
  eyebrow: 'Ask, don’t dig',
  title: 'Your operations, one WhatsApp message away',
  body: `No app to open, no dashboard to learn. Your team messages the ${activeBrand.name} assistant on WhatsApp and gets answers scoped to your organisation — instantly. We match the sender to their account, look up only their data, and reply in the same chat.`,
  bullets: [
    'Answers scoped to the sender’s own organisation and permissions',
    'The same AI assistant as the web app — one bubble, every page',
    'Secure: every inbound message is signature-verified',
  ],
  chat: [
    { role: 'user', text: 'How many inspections are overdue?' },
    {
      role: 'assistant',
      text: 'You have 3 overdue inspections — 2 at Riverside and 1 at Docklands. Want me to list them?',
    },
    { role: 'user', text: 'Show open high-priority actions' },
    {
      role: 'assistant',
      text: 'There are 5 open high-priority actions. The oldest is “Forklift hydraulic leak” (Warehouse B), due 4 days ago.',
    },
  ] as ChatTurn[],
} as const;

// ─── How it works ────────────────────────────────────────────────────────────

export const HOW_IT_WORKS = {
  eyebrow: 'Getting started',
  title: activeBrand.offersSandbox
    ? 'From nothing to running in an afternoon'
    : 'How teams roll it out',
  steps: [
    activeBrand.offersSandbox
      ? {
          title: 'Try a working example',
          body: 'Pick what you need to get done and we build you a real, seeded workspace in seconds — no account, no card. Poke at worked records, not an empty screen.',
        }
      : {
          title: 'Start in minutes',
          body: 'Create your workspace with just an email address — sign-in is passwordless, and every module is switched on from day one.',
        },
    {
      title: 'Make it yours',
      body: 'Add your sites, invite your team with the right permission sets, and shape the registers — categories, templates, permit types, your own risk matrix.',
    },
    {
      title: 'Run the day-to-day',
      body: 'Reports come in by QR code, checks run on schedule, deadlines watch themselves, and everyone clears their own “For me” queue.',
    },
  ],
} as const;

// ─── Pricing (free-plan brands only) ─────────────────────────────────────────

export interface PricingContent {
  eyebrow: string;
  title: string;
  body: string;
  planName: string;
  planPrice: string;
  planUnit: string;
  included: readonly string[];
  addOn: {
    badge: string;
    title: string;
    body: string;
  };
  primaryCta: string;
  secondaryCta: string;
  footnote: string;
}

export const PRICING: PricingContent | null = activeBrand.offersFreePlan
  ? {
      eyebrow: 'Pricing',
      title: 'Free means free.',
      body: 'Not a trial, not a starter tier with the useful parts removed. The platform — every module, every user, every record — costs nothing to use.',
      planName: 'Everything',
      planPrice: '£0',
      planUnit: 'per user, per month, forever',
      included: [
        `All ${MODULE_COUNT} modules — registers, permits, incidents, the lot`,
        'Unlimited users and unlimited records',
        'Multi-site structure with permissions',
        'PDF, Word, Excel and CSV exports',
        'QR-code hazard reporting, no login needed',
        'The AI assistant, on web and WhatsApp',
        'Email reminders, chases and deadline watches',
        '10 languages, timezone-aware documents',
      ],
      addOn: {
        badge: 'The one paid add-on',
        title: 'AI custom dashboards',
        body: 'Describe a dashboard and the AI builds it — saved, refinable, scheduled to inboxes. Everything else stays free whether you take it or not.',
      },
      primaryCta: 'Create your free workspace',
      secondaryCta: 'Try it first — no account',
      footnote: 'No card at sign-up. No seat counting. No surprise gate three weeks in.',
    }
  : null;

// ─── Docs teaser ─────────────────────────────────────────────────────────────

export const DOCS_TEASER = {
  eyebrow: 'Documentation',
  title: 'Learn it in an afternoon',
  body: 'A guide library that walks every module, task by task — how to build a template, issue a permit, screen for RIDDOR, brief a RAMS pack. Written for practitioners, not for the demo.',
  cta: 'Browse the guides',
  /** Preferred guide slugs; the section renders the ones the brand ships. */
  featuredSlugs: [
    'try-before-you-sign-up',
    'create-your-workspace',
    'write-a-risk-assessment',
    'build-an-inspection-template',
    'issue-a-permit',
    'screen-for-riddor',
  ],
  readGuide: 'Read the guide',
  minutesLabel: 'min read',
} as const;

// ─── Final call-to-action band ───────────────────────────────────────────────

export const CTA = activeBrand.offersFreePlan
  ? {
      title: 'Put your health & safety in one place. Pay nothing.',
      subtitle:
        'Set up your workspace in minutes — or try a seeded one first without so much as an email address.',
      primary: 'Create your free workspace',
      secondary: 'Try it now — no account',
    }
  : {
      title: 'Bring your whole operation into focus',
      subtitle:
        'Set up your workspace in minutes and put inspections, issues and actions in one place.',
      primary: 'Get started',
      secondary: 'Talk to us',
    };

// ─── Footer ──────────────────────────────────────────────────────────────────

export const FOOTER = {
  tagline: activeBrand.offersFreePlan
    ? 'Free health & safety software for the whole team — built for UK practice.'
    : `${activeBrand.name} — the operational excellence platform.`,
  modulesHeading: 'Modules',
  resourcesHeading: 'Resources',
  companyHeading: 'Company',
  labels: {
    about: 'About',
    privacy: 'Privacy',
    terms: 'Terms',
    dataDeletion: 'Data deletion',
    contact: 'Contact',
    allModules: 'All modules',
    guides: 'Guides & docs',
  },
} as const;

/** Short explanation of how the WhatsApp assistant works (used on About). */
export const WHATSAPP_BLURB = `Members of an organisation can message the ${activeBrand.name} assistant on WhatsApp. We match the sender’s WhatsApp number to their ${activeBrand.name} user account, scope the request to that organisation’s data, generate an answer with our AI assistant, and reply — all within the conversation the user started.`;

// ─── Shared marketing-page chrome (module pages, docs) ───────────────────────

/** Labels shared by the /product and /docs pages. */
export const MARKETING_PAGES = {
  product: {
    metaTitle: `Modules — ${activeBrand.name}`,
    metaDescription: `Every ${activeBrand.name} module, and how it works: ${SITE_META.description}`,
    eyebrow: 'The platform',
    title: activeBrand.offersFreePlan
      ? `${MODULE_COUNT} modules, one platform, £0`
      : 'One platform, every module',
    subtitle:
      'Each module is a working tool, not a checkbox on a comparison chart. Open one to see exactly how it works.',
  },
  module: {
    howItWorks: 'How it works',
    capabilities: 'What it does',
    guidesHeading: 'Guides for this module',
    relatedHeading: 'Works with',
    allModules: 'All modules',
    freeNote: activeBrand.offersFreePlan ? 'Included free — like the rest of the platform.' : null,
    paidBadge: 'Paid add-on',
    minutesLabel: 'min read',
  },
  docs: {
    metaTitle: `Guides & documentation — ${activeBrand.name}`,
    metaDescription: `How to use ${activeBrand.name}, task by task: setup, inspections, permits, incidents, risk assessments and more — a guide library written for practitioners.`,
    eyebrow: 'Documentation',
    title: 'Guides',
    subtitle: `How to do things in ${activeBrand.name} — a library you can consult, task by task. Start at the top if you are new; dive into a module if you are not.`,
    guideCountSuffix: 'guides',
    minutesLabel: 'min read',
    backToLibrary: 'All guides',
    previous: 'Previous',
    next: 'Next',
    moduleLink: 'About this module',
    onThisPage: 'In this guide',
    tipLabel: 'Tip',
    noteLabel: 'Note',
  },
} as const;
