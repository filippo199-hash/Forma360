/**
 * Guides for the organisational and platform modules: sites, assets,
 * contractors, training, documents, briefings, the AI assistant and
 * dashboards. Part of the guide library — see `./index.ts`.
 */
import type { Guide } from './index';

export const ORGANISATION_GUIDES: readonly Guide[] = [
  // ─── Sites & teams ─────────────────────────────────────────────────────────
  {
    slug: 'structure-sites-and-groups',
    title: 'Structure your sites and groups',
    area: 'sites',
    summary:
      'Model the estate as a hierarchy, set site timezones, and build groups by hand or by rule.',
    minutes: 5,
    sections: [
      {
        heading: 'Build the site tree',
        steps: [
          'Open Settings → Sites and add your sites — as a flat list, or a hierarchy of regions, sites and areas where the estate warrants it.',
          'Set each site’s timezone. Documents — permits, incident reports — stamp times in the site’s own zone, because the clock follows the work.',
          'Move sites within the tree as the business reorganises; records keep their site, the site keeps its history.',
        ],
        tip: 'Model where work happens, not the org chart. If two units share a building and a fire alarm, they are probably one site with two groups.',
      },
      {
        heading: 'Group the people',
        steps: [
          'Open Settings → Groups and create the groups the operation thinks in — night shift, FLT drivers, first aiders.',
          'Add members by hand, or give the group rules — “role is supervisor”, built on your custom user fields — and let membership maintain itself.',
          'Rule-based membership reconciles automatically when people or their details change; new starters land in the right groups on day one.',
        ],
      },
      {
        heading: 'Why this pays off everywhere',
        bullets: [
          'Every register filters by site; site overview pages carry compliance cards that land on pre-filtered registers.',
          'Briefings, acknowledgements and access rules all target groups and sites — structure once, reuse everywhere.',
        ],
      },
    ],
  },
  {
    slug: 'permission-sets-and-access',
    title: 'Permission sets and access rules',
    area: 'sites',
    summary:
      'Who can see and do what — named permission sets from a fine-grained catalogue, plus rules that gate features.',
    minutes: 5,
    sections: [
      {
        heading: 'How permissions work here',
        bullets: [
          'Every capability is a fine-grained key — view inspections, manage permits, record fire checks — bundled into named permission sets.',
          'A person holds one set. Administrator, Manager and Standard exist out of the box; build your own beside them.',
          'The server enforces every check. The interface hides what you cannot do as a courtesy — the refusal happens where it cannot be skipped.',
        ],
      },
      {
        heading: 'Build a custom set',
        steps: [
          'Open Settings → Permissions and create a set — say, “Site supervisor”.',
          'Tick the keys the role needs, module by module: everything in observations and actions, view-only on risk assessments, nothing in settings.',
          'Assign it to people from their user pages. Changing the set later changes it for everyone holding it.',
        ],
        tip: 'Name sets after roles, not people. “Sarah’s permissions” stops making sense the day Sarah changes jobs.',
      },
      {
        heading: 'Access rules and the safety rails',
        bullets: [
          'Access rules gate specific features — an inspection template only for one group, one site, or people matching a user-field condition.',
          'The last-administrator guard refuses any change that would leave the workspace without an administrator.',
          'Deactivation is immediate: a deactivated person’s access ends now, not at their next sign-in.',
        ],
      },
    ],
  },

  // ─── Assets ────────────────────────────────────────────────────────────────
  {
    slug: 'set-up-the-asset-register',
    title: 'Set up the asset register',
    area: 'assets',
    summary:
      'Types, nesting and site assignment — so every check and action can point at the exact machine it concerns.',
    minutes: 4,
    sections: [
      {
        heading: 'Define your types',
        steps: [
          'Open Assets → Categories and define asset types with the fields each kind needs — a vehicle asks for registration and MOT date, an extinguisher for size and service date.',
          'Keep the list short at first; add types when a real record needs a field the current types lack.',
        ],
      },
      {
        heading: 'Load the register',
        steps: [
          'Add assets with their type, site and details.',
          'Nest where it reflects reality — the compressor inside the plant room, the stations along a production line. Parent–child structure makes big registers navigable.',
          'Archive disposals rather than deleting them: the asset leaves the register, its history stays readable.',
        ],
        tip: 'Start with the assets that carry statutory duties — lifting equipment, pressure systems, extinguishers — and grow outward. A register of everything, started everywhere, finishes nowhere.',
      },
      {
        heading: 'Put the register to work',
        bullets: [
          'Inspections, actions and observations reference assets — and the asset’s page reads its linked records back as a history.',
          'The fire logbook links its equipment to asset records, so “which extinguisher failed” has one answer.',
          'Filter by type and site when the auditor asks about, say, lifting equipment at one depot.',
        ],
      },
    ],
  },

  // ─── Contractors ───────────────────────────────────────────────────────────
  {
    slug: 'onboard-a-contractor',
    title: 'Onboard a contractor',
    area: 'contractors',
    summary:
      'Requirements, document collection by link, verification and expiry — approval you can stand behind.',
    minutes: 6,
    sections: [
      {
        heading: 'Create the company and its requirements',
        steps: [
          'Open Contractors and add the company with its contacts.',
          'Apply a requirement template — the checklist of what a contractor of this kind must hold: insurances, certifications, policies. Build the templates once; apply them every time.',
        ],
      },
      {
        heading: 'Collect and verify',
        steps: [
          'Send the contractor an upload link — they submit documents against each requirement without needing an account.',
          'Review each submission and verify or reject it, with the reason. Compliance status rolls up from the requirements.',
          'Expiry dates on insurances and certificates drive the record amber before they drive it red.',
        ],
        note: 'A compliance override exists for the genuine exception — with the reason logged. The record shows the judgement call, not a mystery green light.',
      },
      {
        heading: 'Beyond the paperwork',
        bullets: [
          'Record inductions per person, so “has anyone actually inducted them” is a lookup.',
          'Review their RAMS in the reviews queue — see the RAMS guides — linked to the company record.',
          'Grant portal access scoped to exactly the activities they need; their people can be named as permit acceptors and sign on glass without a seat.',
        ],
      },
    ],
  },
  {
    slug: 'run-the-contractor-gate',
    title: 'Run the contractor gate',
    area: 'contractors',
    summary:
      'A kiosk that checks people in and out — so “who is on site right now” is a lookup, not a headcount.',
    minutes: 4,
    sections: [
      {
        heading: 'Configure the kiosk',
        steps: [
          'Open Contractors → Gate to configure it: choose the capture fields — vehicle, badge number, host, whatever the site needs.',
          'The kiosk runs on its own token-based link, so a tablet at reception can run it without anyone signed in.',
        ],
      },
      {
        heading: 'Day to day',
        steps: [
          'Visitors and contractors check in at the kiosk on arrival, and out when they leave.',
          'The register shows who is inside at this minute — the answer the muster point needs.',
          'The visits calendar shows who is planned for the week beside who is physically present today.',
        ],
        tip: 'Point the gate tablet at the kiosk link, lock the tablet to that page, and treat the physical setup as part of the control — a kiosk nobody can reach records nobody.',
      },
    ],
  },

  // ─── Training ──────────────────────────────────────────────────────────────
  {
    slug: 'set-up-training-requirements',
    title: 'Set up training requirements and the matrix',
    area: 'training',
    summary:
      'The rules of your competence scheme, stated once — then read as a colour-coded matrix.',
    minutes: 5,
    sections: [
      {
        heading: 'Define the requirements',
        steps: [
          'Open Training → Requirements and create each requirement: its category, whether it is mandatory and for whom, how long it stays valid, and how far ahead renewal should be chased.',
          'Set validity honestly — a first-aid ticket that expires in three years should say so here, because everything downstream reads it.',
        ],
      },
      {
        heading: 'Read the matrix',
        steps: [
          'Open Training → Matrix: people down, requirements across, colour-coded — current, expiring, expired, missing.',
          'Filter by site or group to see the crew that is actually on the job.',
        ],
        tip: 'The matrix is the competence answer for an auditor, a client PQQ or a Monday-morning plan — screenshotting it is a legitimate report.',
      },
      {
        heading: 'Connect it to the rest',
        bullets: [
          'Fire safety reads marshal cover from designated requirements — nominate which requirements count under Fire safety → Settings.',
          'Needs-attention counts surface expiring competence in the navigation before it becomes expired competence on a job.',
        ],
      },
    ],
  },
  {
    slug: 'record-training-and-evidence',
    title: 'Record training with its evidence',
    area: 'training',
    summary:
      'Training records for employees, contractors and named individuals — with the certificate attached, not filed elsewhere.',
    minutes: 4,
    sections: [
      {
        heading: 'Record the training',
        steps: [
          'From Training, add a record: the person, the requirement it satisfies, when it was achieved and when it expires.',
          'Record the awarding body and certificate number where the ticket has them, and attach the certificate itself as evidence.',
        ],
      },
      {
        heading: 'People beyond the payroll',
        bullets: [
          'Records can belong to your employees, to contractor personnel, or to a named individual outside the system entirely.',
          'That matters because the competence question — can this person do this work here — does not stop at your payroll.',
        ],
        note: 'Free-text people are honest about what they are: a name and evidence you hold, not an account that manages itself.',
      },
      {
        heading: 'Let expiry do the chasing',
        bullets: [
          'Each requirement’s renewal lead time decides when a record turns amber.',
          'The matrix and the navigation counts surface it — renewals become a planning item, not a surprise.',
        ],
      },
    ],
  },

  // ─── Documents ─────────────────────────────────────────────────────────────
  {
    slug: 'organise-the-document-library',
    title: 'Organise the document library',
    area: 'documents',
    summary:
      'Folders, labels, versions and visibility — plus read-and-sign for the documents that bind people.',
    minutes: 5,
    sections: [
      {
        heading: 'File things properly',
        steps: [
          'Open Documents and build the folder structure you actually retrieve by — policies, procedures, certificates, site files.',
          'Use labels for what cuts across folders — “statutory”, “client-facing” — because one hierarchy never fits every question.',
          'Upload documents; the built-in viewer opens them in the browser, so a site phone reads a procedure without a download-open-delete loop.',
        ],
      },
      {
        heading: 'Versions and visibility',
        steps: [
          'Upload a new version onto an existing document rather than beside it — versions stack, one is marked current, and the superseded copies stay readable.',
          'Set visibility per document. It is enforced by the server: a document someone cannot see is genuinely not there for them, not merely hidden.',
        ],
        tip: 'Never “final_v2_NEW”. One document, many versions, one current — the register handles what filenames never could.',
      },
      {
        heading: 'Read-and-sign',
        steps: [
          'For documents that bind people — a new procedure, a policy change — send a signature request.',
          'Each recipient signs from their own “For me” queue; the document’s record shows who has signed and who is outstanding.',
          'For a broader push with a message around it, attach the document to a briefing instead — see the briefings guide.',
        ],
      },
    ],
  },

  // ─── Briefings ─────────────────────────────────────────────────────────────
  {
    slug: 'publish-a-briefing',
    title: 'Publish a briefing and track engagement',
    area: 'briefings',
    summary:
      'Toolbox talks, alerts and policy changes — targeted, levelled, and tracked to the last signature.',
    minutes: 5,
    sections: [
      {
        heading: 'Write it',
        steps: [
          'Open Briefings and create one: title, message, attachments, and any library documents it carries.',
          'Publish now, or schedule it for shift start; set an expiry if it stops mattering after Friday.',
        ],
      },
      {
        heading: 'Choose the engagement level',
        bullets: [
          'Seen — awareness: the safety alert everyone should read.',
          'Acknowledged — confirmation: the changed procedure people must confirm they understand.',
          'Signed — commitment: the briefing that binds, signed on glass.',
        ],
        tip: 'Match the level to the weight of the message, and spend the “signed” level sparingly — if everything demands a signature, signatures stop meaning anything.',
      },
      {
        heading: 'Target and track',
        steps: [
          'Send it to people, groups or sites — the same targeting the rest of the platform uses.',
          'Allow comments and reactions where discussion helps; questions stay on the record instead of in a group chat.',
          'Watch the engagement view: who has seen, acknowledged or signed — and who is outstanding, chased through their own “For me” queue.',
        ],
      },
    ],
  },

  // ─── AI assistant ──────────────────────────────────────────────────────────
  {
    slug: 'ask-the-assistant',
    title: 'Ask the assistant — in the app or on WhatsApp',
    area: 'ai-assistant',
    summary:
      'Plain-language questions over your own data, answered where you asked them — with your permissions applied.',
    minutes: 4,
    sections: [
      {
        heading: 'In the app',
        steps: [
          'Open the assistant from the bubble in the corner — it travels with you on every page.',
          'Ask in your own words: “how many actions are overdue at Riverside?”, “which permits are open right now?”, “when is the forklift LOLER due?”.',
          'Dictate instead of typing when your hands are full — the microphone button transcribes.',
        ],
      },
      {
        heading: 'What the answers are made of',
        bullets: [
          'Answers come from your workspace’s own records — the same registers the screens show — and link back into them.',
          'Your permissions apply: the assistant sees what you see, no more. Confidential incident kinds stay confidential.',
          'It is an assistant, not an oracle: it retrieves and summarises your data; judgements stay yours.',
        ],
      },
      {
        heading: 'On WhatsApp',
        steps: [
          'Message the assistant’s WhatsApp number — no app to open, no dashboard to learn.',
          'The sender is matched to their user account, the request is scoped to their organisation, and the answer arrives in the same chat.',
          'Every inbound message is signature-verified before it is processed.',
        ],
        tip: 'WhatsApp is the channel for the people who will never open a dashboard — supervisors get their numbers where they already are.',
      },
    ],
  },

  // ─── Dashboards ────────────────────────────────────────────────────────────
  {
    slug: 'build-a-dashboard-with-ai',
    title: 'Build a dashboard by describing it',
    area: 'dashboards',
    summary:
      'Say what you want to see, refine it in conversation, then filter and drill like any saved dashboard.',
    minutes: 5,
    sections: [
      {
        heading: 'Describe it',
        steps: [
          'Open Dashboards and start a new one. Custom dashboards are part of the Pro plan — £99 a month per workspace, with daily backups — while the rest of the platform stays free.',
          'Describe what you want, typed or dictated: “permits by site this quarter, incidents by kind, and the overdue-actions trend”.',
          'The builder proposes the dashboard from a bounded catalogue of data sources — it composes real widgets, it does not improvise queries.',
        ],
      },
      {
        heading: 'Refine in conversation',
        steps: [
          'Use the side chat to adjust: “make that a trend”, “split by site”, “add fire-safety checks”.',
          'Save it. It is an ordinary dashboard now — named, shareable within the workspace at the visibility you choose.',
        ],
      },
      {
        heading: 'Read it with confidence',
        bullets: [
          'The date-range and site filter bar applies across every widget.',
          'Widgets drill through to the registers behind them — the chart is a door, not a picture.',
          'Numbers use each module’s own register logic, so the dashboard and the register can never disagree. A viewer without permission for a source sees a locked tile, not the data.',
        ],
      },
    ],
  },
  {
    slug: 'deliver-dashboards',
    title: 'Deliver dashboards to the people who need them',
    area: 'dashboards',
    summary: 'PDF exports, per-widget Excel, and scheduled email delivery of the Monday numbers.',
    minutes: 4,
    sections: [
      {
        heading: 'Export on demand',
        bullets: [
          'Download the whole dashboard as a print-quality PDF for the pack.',
          'Download any single widget to Excel when someone wants the underlying table.',
        ],
      },
      {
        heading: 'Schedule the delivery',
        steps: [
          'From the dashboard, add a schedule: the recurrence and the recipients.',
          'Recipients receive the dashboard by email with the PDF attached — external addresses are allowed, because the board pack often goes outside the building.',
          'Pause or edit the schedule from the dashboard; archiving a dashboard pauses its schedules with it.',
        ],
        tip: 'One good scheduled dashboard replaces a monthly copy-paste ritual. Build the Monday pack once and let it send itself.',
      },
      {
        heading: 'Make it look like yours',
        bullets: [
          'Tenant theming carries your palette across the app, the dashboards and the PDFs — set it in company settings, or derive it from your website.',
        ],
      },
    ],
  },
];
