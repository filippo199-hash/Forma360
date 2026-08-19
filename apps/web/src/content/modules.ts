/**
 * Marketing module catalogue — the content behind the public `/product`
 * pages, the homepage module showcase, the footer columns and the docs
 * library grouping.
 *
 * Same convention as `content/site.ts`: plain data in a `.ts` module
 * (exempt from `forma360/no-hardcoded-strings`), English-only by design,
 * brand identity from the brand catalogue. Brand-only modules carry their
 * `BrandOnlyModule` key and are filtered through `brandHasModule`
 * (ADR 0010 place 3) — never by an inline brand-id conditional.
 *
 * Copy rule: everything stated here is shipped behaviour. When a module PR
 * changes what a module does, update its entry in the same spirit as the
 * dashboard executor rule — the marketing page and the product must not
 * disagree.
 */
import { brandHasModule, type BrandOnlyModule } from '@forma360/shared/brand';
import { activeBrand } from '../lib/brand';

// ─── Categories ──────────────────────────────────────────────────────────────

export type ModuleCategoryKey = 'work' | 'records' | 'organisation' | 'platform';

export interface ModuleCategory {
  readonly key: ModuleCategoryKey;
  readonly label: string;
  readonly blurb: string;
}

export const MODULE_CATEGORIES: readonly ModuleCategory[] = [
  {
    key: 'work',
    label: 'Run the day-to-day',
    blurb: 'Capture, authorise and fix — the modules your team touches every shift.',
  },
  {
    key: 'records',
    label: 'Registers & assessments',
    blurb: 'The documents that live for years, kept current and audit-ready.',
  },
  {
    key: 'organisation',
    label: 'People, places & kit',
    blurb: 'The structure everything else scopes to — sites, teams, contractors, equipment.',
  },
  {
    key: 'platform',
    label: 'Intelligence',
    blurb: 'Ask questions in plain language and see the whole picture.',
  },
];

// ─── Module content model ────────────────────────────────────────────────────

/** Icon key, mapped to a lucide component in `components/marketing/module-icon.tsx`. */
export type MarketingIcon =
  | 'clipboard-check'
  | 'triangle-alert'
  | 'siren'
  | 'file-signature'
  | 'list-checks'
  | 'shield-alert'
  | 'flask-conical'
  | 'flame'
  | 'scroll-text'
  | 'building'
  | 'wrench'
  | 'hard-hat'
  | 'graduation-cap'
  | 'folder-open'
  | 'megaphone'
  | 'bot'
  | 'layout-dashboard';

export interface ModuleStep {
  readonly title: string;
  readonly body: string;
}

export interface ModuleCapability {
  readonly title: string;
  readonly body: string;
}

export interface ModuleHighlight {
  readonly title: string;
  readonly body: string;
  readonly points: readonly string[];
}

export const MARKETING_MODULE_SLUGS = [
  'inspections',
  'observations',
  'incidents',
  'permits',
  'actions',
  'risk-assessments',
  'coshh',
  'fire-safety',
  'rams',
  'sites',
  'assets',
  'contractors',
  'training',
  'documents',
  'briefings',
  'ai-assistant',
  'dashboards',
] as const;

export type MarketingModuleSlug = (typeof MARKETING_MODULE_SLUGS)[number];

export interface MarketingModule {
  readonly slug: MarketingModuleSlug;
  readonly name: string;
  readonly category: ModuleCategoryKey;
  readonly icon: MarketingIcon;
  /** Present only on modules some brands do not ship (ADR 0010 place 3). */
  readonly brandModule?: BrandOnlyModule;
  /** ADR 0018 — the one paid add-on. Stated honestly wherever it appears. */
  readonly paidAddOn?: true;
  /** One-line card blurb (homepage showcase, product index, related strips). */
  readonly tagline: string;
  readonly hero: {
    readonly title: string;
    readonly lead: string;
  };
  /** "How it works" — the numbered walk through the module's real flow. */
  readonly workflow: readonly ModuleStep[];
  /** Capability grid — six shipped behaviours, told plainly. */
  readonly capabilities: readonly ModuleCapability[];
  /** One distinctive behaviour, told in depth. */
  readonly highlight: ModuleHighlight;
  readonly related: readonly MarketingModuleSlug[];
}

type ModuleDef = Omit<MarketingModule, 'slug'>;

// ─── The catalogue ───────────────────────────────────────────────────────────

const MODULE_DEFS: Record<MarketingModuleSlug, ModuleDef> = {
  inspections: {
    name: 'Inspections & audits',
    category: 'work',
    icon: 'clipboard-check',
    tagline:
      'Build a checklist once, run it on any device, and turn every failed answer into a tracked action.',
    hero: {
      title: 'Inspections that finish the job',
      lead: 'Templates, conduct, signatures, approval and the report — one flow from "walk the floor" to "here is the evidence", with every finding turned into an action someone owns.',
    },
    workflow: [
      {
        title: 'Build the template',
        body: 'Sections, question types, response sets and conditional logic, so the form only asks what applies. Publish when it is ready — every published version is frozen, so you always know exactly which questions an old report answered.',
      },
      {
        title: 'Run it on site',
        body: 'Conduct on a phone, tablet or laptop. Progress saves as you go, so a part-finished inspection survives interruptions and shift changes. Each inspection stamps its own document number automatically.',
      },
      {
        title: 'Flag it, sign it, approve it',
        body: 'Flag failing responses and raise corrective actions from the exact question they came from. Collect signatures against named signer slots, then route the completed inspection to an approver if your process needs one.',
      },
      {
        title: 'Share the result',
        body: 'Export a polished PDF or Word report, download the register as CSV, or send a revocable public link that opens without an account.',
      },
    ],
    capabilities: [
      {
        title: 'Template builder',
        body: 'Question sections, shared response sets, scoring and signature slots — with logic that shows and hides questions based on earlier answers.',
      },
      {
        title: 'Version control',
        body: 'Publishing freezes the version. Inspections pin the version they started on, so editing a template never rewrites history.',
      },
      {
        title: 'Approvals',
        body: 'Send completed inspections for approval; every approve and reject decision is logged against the record.',
      },
      {
        title: 'Recurring schedules',
        body: 'Set the rhythm and the assignees; upcoming occurrences materialise on their queues with reminder emails before the due date.',
      },
      {
        title: 'Findings become actions',
        body: 'Raise an action from any response. Recurring inspections de-duplicate, so the same broken door does not become five actions.',
      },
      {
        title: 'Reports & sharing',
        body: 'PDF and Word exports, CSV registers, and revocable share links for people outside the platform.',
      },
    ],
    highlight: {
      title: 'Scheduling that runs itself',
      body: 'Decide once that the fire-point check happens every Monday, and stop carrying it in your head.',
      points: [
        'Occurrences appear on each assignee’s queue and the schedules calendar ahead of time',
        'Reminder emails chase before the due date — once, not endlessly',
        'Archiving a template pauses its schedules in the same breath, so nothing fires for a retired checklist',
      ],
    },
    related: ['actions', 'observations', 'assets'],
  },

  observations: {
    name: 'Hazards & observations',
    category: 'work',
    icon: 'triangle-alert',
    tagline:
      'Anyone can report what they see — from a QR code, no login — and it lands somewhere it gets dealt with.',
    hero: {
      title: 'Reporting people actually use',
      lead: 'The gap between "someone noticed" and "someone was told" is where accidents live. Give every worker, contractor and visitor a way to report a hazard in under a minute — then track what happened next.',
    },
    workflow: [
      {
        title: 'Open the channel',
        body: 'Print QR codes and put them where work happens. Scanning opens a public report form — no app, no account, no login. People inside the platform report with photos, location and the category’s own questions.',
      },
      {
        title: 'Sort what comes in',
        body: 'Reports land in one register, tagged by category and site. Categories are yours to define — with custom fields, their own notification rules, and critical alerts for the reports that cannot wait. Good practice is a category too, so the register is not only ever bad news.',
      },
      {
        title: 'Do something about it',
        body: 'Assign the report an owner, priority and due date, raise corrective actions, or start an inspection from a linked template. Comments keep the discussion on the record instead of in a group chat.',
      },
      {
        title: 'Escalate when it is more',
        body: 'A report that turns out to be serious promotes to a full incident in one move — photos carried across, both records linked, nothing retyped.',
      },
    ],
    capabilities: [
      {
        title: 'QR-code reporting',
        body: 'Per-category QR codes open a public form. Reporters need nothing installed — and can stay anonymous.',
      },
      {
        title: 'Categories with their own forms',
        body: 'Each category can carry custom fields and questions, so a near-miss report asks different things than a damage report.',
      },
      {
        title: 'Critical alerts',
        body: 'Categories can name the people to notify on every report — and the people to alert immediately when a report is marked critical.',
      },
      {
        title: 'Photos and location',
        body: 'Attach photos from a phone camera while the thing is still in front of you; reports can carry GPS position and address.',
      },
      {
        title: 'Promotion to incident',
        body: 'One move turns an observation into an incident, linked both ways, with the evidence carried by reference.',
      },
      {
        title: 'Actions and inspections from a report',
        body: 'Raise assigned, due-dated actions straight from a report — or launch an inspection from a template linked to the category.',
      },
    ],
    highlight: {
      title: 'From a wet floor to a closed action',
      body: 'The whole point of a reporting channel is what happens after the report.',
      points: [
        'Scan, describe, photograph, submit — under a minute, no account',
        'The report is in the register the moment it is sent, with the right people notified',
        'Actions raised from it link back, so "what did we do about it?" always has an answer',
      ],
    },
    related: ['incidents', 'actions', 'inspections'],
  },

  incidents: {
    name: 'Incidents & RIDDOR',
    category: 'work',
    icon: 'siren',
    brandModule: 'incidents',
    tagline:
      'Record what happened, screen it against RIDDOR with deadlines that watch themselves, and investigate properly.',
    hero: {
      title: 'When something happens, the record matters',
      lead: 'A mobile-first report form for the first ten minutes, a guided RIDDOR screen with the statutory clocks watched for you, and a versioned investigation that ends in signed-off findings and real corrective actions.',
    },
    workflow: [
      {
        title: 'Report it fast',
        body: 'A form built for the moment itself: what happened, who was involved, how bad it looks. Drafts survive a dropped signal, and photos and evidence attach from the scene.',
      },
      {
        title: 'Triage it',
        body: 'Confirm the details for the incident kind — injury, near miss, dangerous occurrence, ill health and more — set the severity, and record injured persons, their injuries and lost time. Sensitive kinds stay confidential: counted in the numbers, readable only by those who should.',
      },
      {
        title: 'Screen for RIDDOR',
        body: 'A guided screen walks the reportability question — including the categories that must be reported without delay, deaths and specified injuries among them — and a negative determination is still a record. For the written-report routes, the 10- or 15-day clock is tracked: warnings before the deadline, escalation past it, and submission freezes the determination.',
      },
      {
        title: 'Investigate and sign off',
        body: 'Versioned investigations with findings, causes and evidence. Sign-off is separated by duty — the approver cannot be the person who led or submitted — and approved revisions freeze. Reopening writes revision n+1; it never edits what was approved.',
      },
      {
        title: 'Close the loop',
        body: 'Findings generate actions exactly once, each with an owner and due date set at approval. An effectiveness review lands about 90 days later — and "not effective" reopens the incident rather than filing it.',
      },
    ],
    capabilities: [
      {
        title: 'Eight incident kinds',
        body: 'Injury, near miss, dangerous occurrence, ill health, property damage and more — each with the details form it actually needs.',
      },
      {
        title: 'Lost-time tracking',
        body: 'Per-person injury records and absences, with the over-7-day calculator that automatically re-screens RIDDOR when an absence crosses the line.',
      },
      {
        title: 'RIDDOR deadline watch',
        body: 'Warnings as the deadline approaches and escalation once it passes — checked every 15 minutes, not once a night.',
      },
      {
        title: 'Confidential kinds',
        body: 'Sharps and violence & aggression default to confidential: present in every count, readable by no one who should not — enforced on search, exports and the AI assistant too.',
      },
      {
        title: 'Separated-duty investigations',
        body: 'The approver cannot be the investigator. Where no independent approver exists, a sole-manager override is possible — with a logged justification.',
      },
      {
        title: 'Alerts and chases',
        body: 'Site-scoped managers are alerted when an incident is reported; owners get one daily email covering everything they owe — and silence when there is nothing.',
      },
    ],
    highlight: {
      title: 'The RIDDOR engine',
      body: 'Reportability is a legal determination with a statutory clock. Here it is not a diary entry — it is watched.',
      points: [
        '10- and 15-day deadlines computed from the incident facts',
        'An absence crossing seven days triggers an automatic re-screen',
        'Closure is blocked until the determination is discharged',
      ],
    },
    related: ['observations', 'actions', 'risk-assessments'],
  },

  permits: {
    name: 'Permits to work',
    category: 'work',
    icon: 'file-signature',
    brandModule: 'permits',
    tagline:
      'Authorise high-risk work with the checks that must happen first — and a live board of what is open right now.',
    hero: {
      title: 'High-risk work, under control',
      lead: 'Hot work, confined spaces, working at height, electrical and more — nine permit types out of the box, each carrying the preconditions, gas tests, isolations and signatures that have to exist before anyone starts.',
    },
    workflow: [
      {
        title: 'Raise the permit',
        body: 'Pick the type and the form asks for what that type demands: preconditions, an isolation certificate, a rescue plan, a linked risk assessment or RAMS pack, gas readings where the work needs them.',
      },
      {
        title: 'Issue it properly',
        body: 'The issue gate refuses a permit that is not ready — readings out of range or stale, isolations missing, clashes with other permits in the same place unacknowledged. An authoriser counter-signs the issue.',
      },
      {
        title: 'Accept and work',
        body: 'The person doing the work accepts within the validity window — and a named contractor without a seat can accept and sign on glass, counter-signed by the issuer. Confined-space work logs every entry and exit.',
      },
      {
        title: 'Extend, hand over, close',
        body: 'Extensions re-check the clashes. Handover can never target the authoriser. Closure is blocked while anyone is still logged inside. Expiry is watched: a warning an hour out, escalation once it lapses.',
      },
    ],
    capabilities: [
      {
        title: 'Nine types, yours to edit',
        body: 'Hot work, confined space, height, electrical, excavation and more — plus your own types, each with its own required checks and gas limits.',
      },
      {
        title: 'Gas tests with limits',
        body: 'Per-type limits with freshness rules. Every reading keeps its own verdict, and the bounds refuse impossible numbers — never bad news.',
      },
      {
        title: 'Clash acknowledgement',
        body: 'Overlapping permits at the same place need explicit acknowledgement — at issue, and again at every extension.',
      },
      {
        title: 'External acceptors',
        body: 'Contractors without an account can be named as acceptor and sign on glass — because naming an internal colleague instead is legally wrong.',
      },
      {
        title: 'The live board',
        body: 'Every open permit on one board: status, site and clock. The 8am question — what is running right now? — answered at a glance.',
      },
      {
        title: 'The permit document',
        body: 'A signed, timestamped PDF in the site’s own timezone, ready for the job file and the auditor.',
      },
    ],
    highlight: {
      title: 'The issue gate',
      body: 'A permit is a promise that the checks happened. The gate makes that promise structural rather than cultural:',
      points: [
        'Preconditions, isolations and rescue plans verified per type before issue',
        'Gas readings must be in range and fresh — verdicts are snapshotted onto the permit',
        'A linked risk assessment or an issued RAMS pack is required where the type says so',
      ],
    },
    related: ['rams', 'risk-assessments', 'contractors'],
  },

  actions: {
    name: 'Actions',
    category: 'work',
    icon: 'list-checks',
    tagline:
      'One board for everything that must get done — wherever it was raised, whoever owes it.',
    hero: {
      title: 'The follow-through module',
      lead: 'Inspections, incidents, observations and fire checks all raise work. Actions is where that work lives: owned, due-dated, prioritised and visible until it is genuinely done.',
    },
    workflow: [
      {
        title: 'Raise from anywhere',
        body: 'Actions come from a failed inspection response, an approved incident finding, a hazard report, a failed fire check — or stand alone. Each one keeps the link to whatever raised it.',
      },
      {
        title: 'Assign and prioritise',
        body: 'An owner, a due date, a priority and a type — corrective, preventive, improvement and maintenance out of the box, extendable with your own catalogue and categories.',
      },
      {
        title: 'Work the queue',
        body: 'The register carries the filters people actually use — mine, overdue, by site, by source — and every person sees the actions they owe in their own "For me" queue, next to the signatures and acknowledgements waiting on them.',
      },
      {
        title: 'Close with evidence',
        body: 'Attach photos and files to show what was done. The record links back to its source, so the audit trail reads in both directions.',
      },
    ],
    capabilities: [
      {
        title: 'Every source, one hub',
        body: 'Actions carry their origin — the inspection question, the incident finding, the observation — so context is never lost.',
      },
      {
        title: 'Personal queues',
        body: '"For me" merges the actions you owe with the acknowledgements, signatures and drafts waiting on you. One list, no hunting.',
      },
      {
        title: 'Types and categories',
        body: 'Four sensible defaults, plus your own action types and categories for how your organisation splits the work.',
      },
      {
        title: 'Evidence attachments',
        body: 'Photos and files on the action record — including phone photos, converted automatically when needed.',
      },
      {
        title: 'Overdue visibility',
        body: 'Needs-attention counts sit in the navigation itself, so the red is one click away rather than buried in a report.',
      },
      {
        title: 'Exports',
        body: 'The register exports to CSV when someone upstairs asks for the numbers.',
      },
    ],
    highlight: {
      title: 'The golden thread',
      body: 'Every module feeds this one, which is what makes the platform more than a stack of registers.',
      points: [
        'A finding becomes an action exactly once — recurring checks never duplicate it',
        'The action links back to the finding, and the finding to its record',
        '"What did we do about it?" is a click, not an archaeology project',
      ],
    },
    related: ['inspections', 'incidents', 'observations'],
  },

  'risk-assessments': {
    name: 'Risk assessments',
    category: 'records',
    icon: 'shield-alert',
    brandModule: 'riskAssessments',
    tagline:
      'The HSE five-step method as a working editor — signed, versioned, acknowledged by the people it protects.',
    hero: {
      title: 'Risk assessments people can actually follow',
      lead: 'Hazards, who might be harmed, the controls in place and what more is needed — scored on a matrix your organisation owns, signed off by the assessor, and pushed to the people it covers with acknowledgement tracked.',
    },
    workflow: [
      {
        title: 'Draft from a real starting point',
        body: 'Start blank or from the hazard library, with harmed-group presets that include care settings. Each hazard names who could be harmed and how — the way an inspector expects to read it.',
      },
      {
        title: 'Score it honestly',
        body: 'Likelihood times severity on your own matrix. Banding is shared across the organisation, severity floors stop a fatal hazard being scored trivial, and residual risk has to be coherent with the further controls you added.',
      },
      {
        title: 'Publish and sign',
        body: 'Publishing freezes an immutable version carrying the assessor’s sign-off. Later edits build the next version — the copy people acknowledged never changes underneath them.',
      },
      {
        title: 'Get it acknowledged',
        body: 'Send the assessment to the people it covers. Acknowledgements are version-aware, and a daily reminder chases whoever has not signed — then goes quiet.',
      },
      {
        title: 'Review on schedule',
        body: 'Review dates drive the register’s attention strip, and an incident involving the risk can pull the review forward to today.',
      },
    ],
    capabilities: [
      {
        title: 'Five-step editor',
        body: 'The HSE method, step by step — not a blank text box with a heading.',
      },
      {
        title: 'Hazard library',
        body: 'Preset hazards with harmed groups and control suggestions carry the authoring load, so assessments start from substance.',
      },
      {
        title: 'Your own risk matrix',
        body: 'A per-organisation matrix editor with shared banding and severity floors, so two assessors cannot score the same risk into different colours.',
      },
      {
        title: 'Immutable signed versions',
        body: 'Publishing writes a frozen version with first-class assessor sign-off. Edit-in-place never destroys what was attested.',
      },
      {
        title: 'Acknowledgement tracking',
        body: 'Version-aware acknowledgements with a daily chase for the outstanding — and the register knows who signed which version, and when.',
      },
      {
        title: 'PDF and print',
        body: 'A clean PDF for sharing, and a one-page print layout for the site office wall.',
      },
    ],
    highlight: {
      title: 'Versioning that stands up to scrutiny',
      body: 'The question after an incident is never "what does the assessment say now" — it is "what did it say then, and who had read it".',
      points: [
        'Published versions are frozen — an edit creates the next one',
        'Sign-off lives on the version itself: assessor, date, content',
        'Acknowledgements record the exact version each person read',
      ],
    },
    related: ['rams', 'coshh', 'incidents'],
  },

  coshh: {
    name: 'COSHH',
    category: 'records',
    icon: 'flask-conical',
    brandModule: 'coshh',
    tagline:
      'A substance inventory that builds itself from the safety data sheet, assessments with signed versions, and cards at the point of work.',
    hero: {
      title: 'Hazardous substances, minus the ring binder',
      lead: 'Upload the safety data sheet and let the AI read it — hazard statements, PPE, storage, first aid. Then assess the task, watch the exposure limits, and put a one-page card where the substance is actually used.',
    },
    workflow: [
      {
        title: 'Build the inventory',
        body: 'Add a substance by uploading its SDS: the AI import drafts the record — signal word, hazard statements, PPE, storage and first-aid measures — and you review and confirm. Stock locations tie each substance to the sites that hold it.',
      },
      {
        title: 'Assess the task',
        body: 'A COSHH assessment covers the task, the exposure routes and the controls. Publishing freezes a signed version, so the copy that was attested survives every later edit.',
      },
      {
        title: 'Control exposure',
        body: 'Record workplace exposure limits and monitoring results — over-limit readings are flagged, not buried. LEV plant has its own register with test dates.',
      },
      {
        title: 'Put it where the work is',
        body: 'Point-of-work cards give the person using the substance the page that matters: hazards, PPE, spill response and first aid — current version, one page.',
      },
    ],
    capabilities: [
      {
        title: 'AI SDS import',
        body: 'The data sheet does the typing: upload the PDF and review a drafted, structured record instead of retyping sixteen sections.',
      },
      {
        title: 'Signed assessment versions',
        body: 'Publishing writes a frozen, signed copy — editing an active assessment never destroys what was attested.',
      },
      {
        title: 'Exposure limits',
        body: 'WELs on the record, monitoring readings against them, and flags when a result crosses the limit.',
      },
      {
        title: 'Point-of-work cards',
        body: 'The one-page summary for the shop floor — hazards, PPE, first aid — always the current version.',
      },
      {
        title: 'LEV register',
        body: 'Local exhaust ventilation plant with its statutory test dates, beside the substances it protects against.',
      },
      {
        title: 'Stocked-site scoping',
        body: 'An assessment belongs to every site its substance is stocked at, so site views show what is really on their shelves.',
      },
    ],
    highlight: {
      title: 'The SDS does the typing',
      body: 'The slowest part of COSHH is transcription. Hand it to the machine and keep the judgement.',
      points: [
        'Upload the PDF; the record drafts itself for your review',
        'Hazard statements and PPE land as structured data, not a scan in a folder',
        'Review dates keep the inventory current, with the register flagging what is due',
      ],
    },
    related: ['risk-assessments', 'rams', 'documents'],
  },

  'fire-safety': {
    name: 'Fire safety',
    category: 'records',
    icon: 'flame',
    brandModule: 'fireSafety',
    tagline:
      'Buildings, fire risk assessments with frozen versions, and a logbook on British Standard rhythms — where a failure stays red until cleared.',
    hero: {
      title: 'The fire file, always inspection-ready',
      lead: 'Every building carries its risk assessment, logbook, doors, drills, PEEPs and marshals in one record — with British Standard check intervals built in, and the Fire Safety (England) Regulations thresholds applied automatically where they bite.',
    },
    workflow: [
      {
        title: 'Register the building',
        body: 'Height, storeys and use classify the building against the 11-metre, 18-metre and seven-storey thresholds of the Fire Safety (England) Regulations, so you know which duties apply without a spreadsheet of rules. Estates in Scotland, Wales and Northern Ireland keep the same registers, logbook rhythms and FRAs under their own regimes.',
      },
      {
        title: 'Assess the risk',
        body: 'The FRA editor covers persons at risk, ignition–fuel–oxygen, evaluation and findings. Publishing gates on the content being complete and freezes a version; an intolerable rating must carry an actionable finding — and alerts the people who manage fire safety.',
      },
      {
        title: 'Keep the logbook',
        body: 'Alarm tests, emergency lighting, extinguishers and the rest on their British Standard rhythms. A failed check holds a red failed state until a pass clears it, and raises a follow-up action by default.',
      },
      {
        title: 'Run the people side',
        body: 'Drills with outcomes, PEEPs for the people who need them, and marshal cover per building with targets — competence can come from the training module or be recorded directly.',
      },
    ],
    capabilities: [
      {
        title: 'FRA editor with versions',
        body: 'A structured fire risk assessment with publish gates, frozen versions, and sign-off that goes stale when the record changes — re-attestation is asked for, not assumed.',
      },
      {
        title: 'BS-standard check catalogue',
        body: 'The logbook knows the intervals — weekly alarms, monthly lighting, annual extinguishers — so the calendar builds itself.',
      },
      {
        title: 'Failures stay red',
        body: 'A failed check is a state, not a log line: it stays failed until a pass clears it, with the follow-up action already raised.',
      },
      {
        title: 'Doors, drills & PEEPs',
        body: 'Fire-door registers with bulk import, drill records with outcomes, and personal evacuation plans in the same building file.',
      },
      {
        title: 'Marshal cover',
        body: 'Per-building marshal targets, with tickets read from training records or recorded free-text for people outside the system.',
      },
      {
        title: 'The daily digest & night pack',
        body: 'A morning email of what is due, and a night-pack PDF of the whole building for the person on call.',
      },
    ],
    highlight: {
      title: 'Failures stay loud',
      body: 'A logbook that lets a failed alarm test scroll away is worse than paper. This one holds the state:',
      points: [
        'A failed check turns the item red and keeps it red until a pass clears it',
        'Follow-up actions are raised by default, not by memory',
        'Sign-off staleness is tracked — a changed record asks to be re-attested',
      ],
    },
    related: ['risk-assessments', 'inspections', 'training'],
  },

  rams: {
    name: 'RAMS & method statements',
    category: 'records',
    icon: 'scroll-text',
    brandModule: 'rams',
    tagline:
      'Method statements that reference your real risk assessments, an issue gate that refuses an incoherent pack, and briefings that hold up.',
    hero: {
      title: 'RAMS packs with nothing invented',
      lead: 'Steps reference hazards in the bound risk-assessment versions instead of restating them, so the pack cannot drift from the assessment. Issue freezes a snapshot, briefings record against the exact version, and clients accept the exact thing you sent.',
    },
    workflow: [
      {
        title: 'Write the method statement',
        body: 'Sequenced steps with PPE, plant, trades and hold points — eight starter templates carry the authoring load, and every statement gets its own MS reference.',
      },
      {
        title: 'Bind the assessments',
        body: 'A pack binds specific published risk-assessment and COSHH versions. Suggested bindings rank your own registers against the job — a deterministic rule, not a guess.',
      },
      {
        title: 'Pass the gate, issue the pack',
        body: 'The issue gate refuses a pack where a high-residual hazard is addressed by no step. Issuing freezes the full snapshot — a later revision to the risk assessment never alters what was issued.',
      },
      {
        title: 'Brief the workforce',
        body: 'Version-anchored briefings with signatures, captured for a whole gang at once — and queued offline with sync failures surfaced, never silently lost.',
      },
      {
        title: 'Send it out, take them in',
        body: 'Issue to a client on a share link and record their acceptance against the exact version. On the other side, review contractors’ incoming packs against a proper checklist.',
      },
    ],
    capabilities: [
      {
        title: 'Method-statement library',
        body: 'Reusable statements with starter templates, hold points and PPE vocabularies — written once, used across packs.',
      },
      {
        title: 'Binding by version',
        body: 'Packs bind RA and COSHH versions, not documents-in-general — so "which assessment was this built on" has an exact answer.',
      },
      {
        title: 'The issue gate',
        body: 'A pack with an unaddressed high-residual hazard does not issue. The headline rule, enforced structurally.',
      },
      {
        title: 'Append-only briefings',
        body: 'Briefing records are version-anchored and signed. Re-issuing warns that briefings need re-taking — it never quietly invalidates them.',
      },
      {
        title: 'Client issue & acceptance',
        body: 'Share links carry the pack to people without accounts; their acceptance decision is recorded against the exact version.',
      },
      {
        title: 'Contractor pack reviews',
        body: 'Incoming RAMS from contractors reviewed against a checklist, on the record, beside their other documents.',
      },
    ],
    highlight: {
      title: 'What was in force on the day',
      body: 'After an event, nobody cares what the pack says now. They ask what it said then, and who was briefed on it.',
      points: [
        'Issued versions freeze the full snapshot — bound hazards included',
        'Re-issue writes version n+1 and leaves n readable, with its briefings intact',
        'The investigator’s question has a one-click answer',
      ],
    },
    related: ['risk-assessments', 'permits', 'contractors'],
  },

  sites: {
    name: 'Sites & teams',
    category: 'organisation',
    icon: 'building',
    tagline:
      'Your estate as a hierarchy, your people in groups, permissions that say who can do what — the backbone everything scopes to.',
    hero: {
      title: 'Structure once, scope everywhere',
      lead: 'Model the estate as it really is — regions, sites, areas — put people into groups by hand or by rule, and hand out permission sets instead of guessing. Every register in the platform filters by this.',
    },
    workflow: [
      {
        title: 'Map the estate',
        body: 'Sites in a hierarchy that can be reorganised as the business changes. Each site carries its own timezone, so a permit issued in Warsaw is stamped in Warsaw time.',
      },
      {
        title: 'Group the people',
        body: 'Groups by hand, or by rule — "everyone whose role is supervisor" — kept up to date automatically as people and their details change.',
      },
      {
        title: 'Set the permissions',
        body: 'Administrator, Manager and Standard sets out of the box; build your own from a catalogue of fine-grained keys. The platform refuses the change that would leave you without an administrator.',
      },
      {
        title: 'Read site health',
        body: 'Each site’s overview carries compliance cards — permits, fire safety, risk assessments, COSHH — and clicking through lands on the register already filtered to that site.',
      },
    ],
    capabilities: [
      {
        title: 'Site hierarchy',
        body: 'Regions, sites and areas with clean move semantics — restructure without re-tagging every record.',
      },
      {
        title: 'Rule-based groups',
        body: 'Membership rules over user fields, reconciled automatically — new starters land in the right groups on day one.',
      },
      {
        title: 'Permission sets',
        body: 'Fine-grained permission keys bundled into named sets. The server enforces every one — hiding a button is never the security model.',
      },
      {
        title: 'Custom user fields',
        body: 'Your own fields on every person — role, department, shift — feeding group rules and access rules.',
      },
      {
        title: 'Access rules',
        body: 'Gate templates and features by group, site or user field, with one shared rule engine across modules.',
      },
      {
        title: 'Per-site timezones',
        body: 'Documents stamp local site time, because the clock follows the work — not the server.',
      },
    ],
    highlight: {
      title: 'Permissions the server enforces',
      body: 'Access control that lives in the interface is decoration. Here every check runs where it cannot be skipped:',
      points: [
        'The interface hides what you cannot do; the server refuses it as well',
        'The last administrator cannot be removed — the platform refuses the change',
        'Deactivating a person takes effect immediately, not at their next sign-in',
      ],
    },
    related: ['training', 'contractors', 'documents'],
  },

  assets: {
    name: 'Assets',
    category: 'organisation',
    icon: 'wrench',
    tagline:
      'A register of the kit work happens on — typed, site-assigned, nested, and linked to the checks and actions that concern it.',
    hero: {
      title: 'Know your kit',
      lead: 'From extinguishers to forklifts: an asset register with your own types, parent–child nesting and site assignment — so inspections, actions and observations can point at the exact machine they concern.',
    },
    workflow: [
      {
        title: 'Build the register',
        body: 'Add assets with your own types and fields, assign them to sites, and nest them — the compressor inside the plant room inside the building.',
      },
      {
        title: 'Link the work',
        body: 'Inspections, actions and observations reference assets directly, and the asset’s own page reads the linked records back — the machine’s history in one place.',
      },
      {
        title: 'Keep it current',
        body: 'Archive what is disposed of, restore what comes back, and filter the register by type and site when the auditor asks about lifting equipment.',
      },
    ],
    capabilities: [
      {
        title: 'Custom asset types',
        body: 'Your own types with their own fields, so a vehicle record and an extinguisher record ask different questions.',
      },
      {
        title: 'Parent–child nesting',
        body: 'Assets inside assets — a production line and its stations, a building and its plant.',
      },
      {
        title: 'Site assignment',
        body: 'Every asset belongs somewhere; registers and site views filter accordingly.',
      },
      {
        title: 'Linked records',
        body: 'The inspections, actions and observations that concern an asset, readable from the asset itself.',
      },
      {
        title: 'Archive & restore',
        body: 'Disposals leave the register without destroying the history behind them.',
      },
      {
        title: 'Contractor kit too',
        body: 'Contractor-owned assets are recorded alongside their company, documents and visits.',
      },
    ],
    highlight: {
      title: 'One name for the thing',
      body: 'When every module can point at the same asset record, the machine stops being a description and becomes a history.',
      points: [
        'The extinguisher in the fire logbook is the extinguisher in the register',
        'Actions raised against an asset read back from the asset’s page',
        'Observations reported against the machine join the same thread',
      ],
    },
    related: ['inspections', 'fire-safety', 'actions'],
  },

  contractors: {
    name: 'Contractors',
    category: 'organisation',
    icon: 'hard-hat',
    tagline:
      'Approve who comes on site: documents and insurance verified, RAMS reviewed, inductions done, sign-in at the gate.',
    hero: {
      title: 'Contractor control, end to end',
      lead: 'Keep contractor companies, their insurances and certificates with expiry dates, review the RAMS they send, run inductions, give them a portal scoped to exactly what they need — and a gate kiosk that knows who is on site right now.',
    },
    workflow: [
      {
        title: 'Onboard the company',
        body: 'A company record with contacts, requirement checklists — built from your own templates — and the documents that satisfy them. Send an upload link; they submit, you verify or reject.',
      },
      {
        title: 'Check the paperwork',
        body: 'Insurance and certificates carry expiry dates and drive compliance status per contractor. An override is possible when the business needs it — with the reason on the record.',
      },
      {
        title: 'Let them in — carefully',
        body: 'Portal accounts confined to exactly the activities you grant. Inductions on the record. Their people can be named as permit acceptors and sign on glass, without a seat.',
      },
      {
        title: 'Know who is on site',
        body: 'A gate kiosk checks people in and out with the capture fields you choose, the visits calendar shows who is planned, and the register answers the fire-drill question: who is inside, right now?',
      },
    ],
    capabilities: [
      {
        title: 'Requirement templates',
        body: 'Define once what a contractor of each kind must hold; apply it to every company you onboard.',
      },
      {
        title: 'Verify or reject',
        body: 'Submitted documents are reviewed, not just collected — status per requirement, expiries watched.',
      },
      {
        title: 'RAMS review queue',
        body: 'Incoming method statements reviewed against a checklist, linked to the company record.',
      },
      {
        title: 'Scoped portal',
        body: 'External users see the portal and the activities you granted — nothing else, enforced server-side.',
      },
      {
        title: 'Gate kiosk',
        body: 'Token-based check-in and check-out with your own capture fields — no seat required for visitors.',
      },
      {
        title: 'Inductions & visits',
        body: 'Induction records per person and a calendar of planned visits beside the live gate register.',
      },
    ],
    highlight: {
      title: 'The gate answers the fire-drill question',
      body: 'The muster point is the wrong place to discover your visitor log lives in a book at reception.',
      points: [
        'Check-in and check-out at a kiosk, no account needed',
        'The register shows who is inside at this minute',
        'Capture fields are yours: vehicle, badge, host, whatever the site needs',
      ],
    },
    related: ['rams', 'permits', 'training'],
  },

  training: {
    name: 'Training & competence',
    category: 'organisation',
    icon: 'graduation-cap',
    brandModule: 'training',
    tagline:
      'Who is trained in what, and what expires when — a matrix that answers the competence question at a glance.',
    hero: {
      title: 'Competence you can point at',
      lead: 'Define the requirements, record the training with its evidence, and read the matrix: people down, requirements across, expiries flagged before they bite. It covers your employees, named contractors and anyone else who works under your name.',
    },
    workflow: [
      {
        title: 'Define the requirements',
        body: 'Each requirement carries its category, whether it is mandatory, how long it stays valid and how far ahead renewal should be chased.',
      },
      {
        title: 'Record the training',
        body: 'Records with dates, awarding body, certificate number and the certificate itself attached as evidence — for employees, contractors, or people recorded by name.',
      },
      {
        title: 'Read the matrix',
        body: 'People against requirements, colour-coded: current, expiring, expired, missing. Filter by site or group to see a crew rather than the whole company.',
      },
      {
        title: 'Let the modules use it',
        body: 'Fire safety reads marshal tickets from here, so "cover on this building" means real, in-date competence — not a name in a spreadsheet.',
      },
    ],
    capabilities: [
      {
        title: 'Requirements catalogue',
        body: 'Categories, obligations, validity periods and renewal lead times — the rules of your competence scheme, stated once.',
      },
      {
        title: 'Evidence on the record',
        body: 'Certificates attached to the training record, with awarding body and certificate number where it matters.',
      },
      {
        title: 'The matrix',
        body: 'The one-screen answer to "are we competent to do this work" — filterable by site and group.',
      },
      {
        title: 'Expiry tracking',
        body: 'Expiring soon is visible before expired — with needs-attention counts in the navigation.',
      },
      {
        title: 'Beyond employees',
        body: 'Contractor personnel and named individuals sit in the same register, because competence questions do not stop at your payroll.',
      },
      {
        title: 'Fire-marshal designation',
        body: 'Nominate which requirements count as a marshal ticket; the fire module reads the answer.',
      },
    ],
    highlight: {
      title: 'The matrix view',
      body: 'A competence question deserves a one-glance answer, not a folder audit.',
      points: [
        'People × requirements, colour-coded by status',
        'Expiring flagged ahead of time, driven by each requirement’s renewal lead',
        'Site and group filters show the crew that is actually on the job',
      ],
    },
    related: ['contractors', 'fire-safety', 'sites'],
  },

  documents: {
    name: 'Documents',
    category: 'organisation',
    icon: 'folder-open',
    tagline:
      'Policies, procedures and certificates in one controlled library — versioned, visible to the right people, signed where it matters.',
    hero: {
      title: 'The document library that stays current',
      lead: 'Upload once, file properly, control who sees what, and read documents in the built-in viewer. When a policy needs more than filing — when it needs reading — send it for signature and watch who has signed.',
    },
    workflow: [
      {
        title: 'Upload and organise',
        body: 'Folders and labels keep the library navigable; the built-in viewer opens documents in the browser, no download required.',
      },
      {
        title: 'Control visibility',
        body: 'Decide who can see each document. Visibility is enforced by the server, not the interface — a hidden document is genuinely hidden.',
      },
      {
        title: 'Keep versions straight',
        body: 'Upload a new version without losing the old ones, and mark which version is current — so nobody works from last year’s procedure.',
      },
      {
        title: 'Get it read and signed',
        body: 'Send a document for signature. Requests land in each person’s own queue, and the record shows who has signed and who is still outstanding.',
      },
    ],
    capabilities: [
      {
        title: 'Folders and labels',
        body: 'Structure and cross-cutting tags together, because one hierarchy never fits every question.',
      },
      {
        title: 'In-browser viewer',
        body: 'Read documents where you are — no download-open-delete loop on a site phone.',
      },
      {
        title: 'Version history',
        body: 'New versions stack on the record with one marked current; superseded copies remain readable.',
      },
      {
        title: 'Visibility control',
        body: 'Per-document visibility, enforced at the data layer.',
      },
      {
        title: 'Signature requests',
        body: 'Read-and-sign for the documents that bind people, tracked to completion in personal queues.',
      },
      {
        title: 'Feeds the briefings',
        body: 'Attach documents to a briefing when an update needs to reach the whole team with acknowledgement tracked.',
      },
    ],
    highlight: {
      title: 'Signed, not just stored',
      body: 'Some documents are only worth keeping if people have actually read them.',
      points: [
        'Signature requests per document, per person',
        'Outstanding signatures sit in each person’s "For me" queue',
        'The record answers "who has signed" without a chase email',
      ],
    },
    related: ['briefings', 'sites', 'coshh'],
  },

  briefings: {
    name: 'Briefings',
    category: 'organisation',
    icon: 'megaphone',
    tagline:
      'Push what the team must know — toolbox talks, alerts, policy changes — and see who has actually engaged with it.',
    hero: {
      title: 'Say it once, know it landed',
      lead: 'A briefing carries the message, the attachments and the documents behind it to exactly the people it concerns — with the level of engagement you choose: seen, acknowledged, or signed.',
    },
    workflow: [
      {
        title: 'Write the briefing',
        body: 'Title, message, attachments and linked documents. Publish immediately or schedule it, and set an expiry if it stops mattering after Friday.',
      },
      {
        title: 'Choose the engagement level',
        body: 'Some messages need to be seen, some acknowledged, some signed. Pick the level; the platform holds recipients to it.',
      },
      {
        title: 'Send it to the right people',
        body: 'Target people, groups or sites. Recipients find it in their queue — and can comment and react if you allow it, keeping questions on the record.',
      },
      {
        title: 'Track and chase',
        body: 'The engagement view shows who has seen, acknowledged or signed — and who has not. Outstanding items sit in each person’s "For me" queue until they act.',
      },
    ],
    capabilities: [
      {
        title: 'Three engagement levels',
        body: 'Seen, acknowledged or signed — matched to how much the message binds the reader.',
      },
      {
        title: 'Targeted delivery',
        body: 'People, groups or sites — the same targeting the rest of the platform uses.',
      },
      {
        title: 'Documents attached',
        body: 'Link library documents so the briefing carries the source, not a summary of it.',
      },
      {
        title: 'Comments and reactions',
        body: 'Allow discussion where it helps; keep it off where it does not. Either way, the record stays on the briefing.',
      },
      {
        title: 'Scheduling and expiry',
        body: 'Publish at shift start, expire when superseded — the feed stays current by itself.',
      },
      {
        title: 'Engagement dashboard',
        body: 'Who engaged, who is outstanding — the answer to "did everyone get the memo", literally.',
      },
    ],
    highlight: {
      title: 'Engagement is a record',
      body: 'A noticeboard cannot tell you who read it. This can:',
      points: [
        'Acknowledgements and signatures recorded per person, with timestamps',
        'Outstanding recipients visible at a glance, chased through their own queues',
        'Signatures captured on glass where the message demands it',
      ],
    },
    related: ['documents', 'actions', 'sites'],
  },

  'ai-assistant': {
    name: 'AI assistant',
    category: 'platform',
    icon: 'bot',
    tagline:
      'Ask about your operation in plain language — in the app or on WhatsApp — and get answers scoped to your own data.',
    hero: {
      title: 'Just ask',
      lead: '"How many actions are overdue at Riverside?" is a question, not a report request. The assistant answers from your workspace’s own records, respects your permissions, and replies wherever you asked — web or WhatsApp.',
    },
    workflow: [
      {
        title: 'Ask in your own words',
        body: 'Type it or dictate it. No query language, no report builder — the question you would ask a colleague.',
      },
      {
        title: 'Get a scoped answer',
        body: 'Answers come from your organisation’s data and nothing else, filtered by your own permissions. Confidential records stay confidential — counted where appropriate, never quoted.',
      },
      {
        title: 'Act on it',
        body: 'Answers link into the records they describe, so "show me the overdue ones" ends on the register, not in a transcript.',
      },
      {
        title: 'Take it to WhatsApp',
        body: 'Message the assistant on WhatsApp and get the same scoped answers. The sender is matched to their account, and every inbound message is signature-verified.',
      },
    ],
    capabilities: [
      {
        title: 'On every page',
        body: 'The assistant travels with you through the app — one bubble, always in reach.',
      },
      {
        title: 'The WhatsApp channel',
        body: 'No app to open, no dashboard to learn: answers in the chat your team already uses.',
      },
      {
        title: 'Permission-aware',
        body: 'The assistant sees what you see — no more. Access control applies to questions exactly as it applies to screens.',
      },
      {
        title: 'Voice input',
        body: 'Dictate the question when your hands are full or the gloves are on.',
      },
      {
        title: 'Answers with sources',
        body: 'Numbers come from the same registers the screens show — not a parallel universe of AI figures.',
      },
      {
        title: 'Builds dashboards too',
        body: 'On the paid add-on, the same conversation can compose a saved, refinable dashboard.',
      },
    ],
    highlight: {
      title: 'Your operations, one message away',
      body: 'The people who most need the numbers are the least likely to open a dashboard.',
      points: [
        'Sender matched to their account; answers scoped to their organisation',
        'Every inbound message signature-verified',
        'The same assistant, in the app and in the chat',
      ],
    },
    related: ['dashboards', 'actions', 'documents'],
  },

  dashboards: {
    name: 'Analytics & dashboards',
    category: 'platform',
    icon: 'layout-dashboard',
    paidAddOn: true,
    tagline:
      'Describe the dashboard you want and the AI builds it — saved, refinable, filterable, and delivered to inboxes on schedule. The heart of the Pro plan.',
    hero: {
      title: 'Dashboards you talk into existence',
      lead: '"Permits by site this quarter, incidents by kind, and the overdue actions trend" — typed or dictated. The builder composes real widgets over your registers’ own numbers, so every chart agrees with the register it came from.',
    },
    workflow: [
      {
        title: 'Ask for it',
        body: 'Describe the dashboard in a sentence. The builder proposes widgets from a catalogue of data sources across the platform’s modules.',
      },
      {
        title: 'Refine in conversation',
        body: '"Make that a trend", "split by site", "add fire-safety checks" — the side chat refines the saved dashboard in place.',
      },
      {
        title: 'Filter and drill',
        body: 'A date-range and site filter bar sits above every dashboard, and widgets drill through to the registers behind them.',
      },
      {
        title: 'Deliver it',
        body: 'Export the dashboard as a PDF, any widget to Excel, or schedule email delivery so the Monday numbers arrive without anyone logging in.',
      },
    ],
    capabilities: [
      {
        title: 'A bounded source catalogue',
        body: 'Eleven data sources across the platform’s modules, each with its metrics and dimensions — the AI composes, it does not improvise SQL.',
      },
      {
        title: 'Register-true numbers',
        body: 'Every metric uses the module’s own register logic, so the dashboard and the register can never disagree.',
      },
      {
        title: 'Per-viewer security',
        body: 'Widget data is gated on the viewer: no permission, no numbers — a locked tile instead of a leak.',
      },
      {
        title: 'Excel and PDF export',
        body: 'Per-widget Excel downloads and a print-quality PDF of the whole dashboard.',
      },
      {
        title: 'Email schedules',
        body: 'Recurring delivery to the people who need the numbers, with the PDF attached.',
      },
      {
        title: 'Your palette',
        body: 'Tenant theming carries your brand colours across the app, the dashboards and the PDFs.',
      },
    ],
    highlight: {
      title: 'Honest numbers',
      body: 'An analytics layer that computes its own version of the truth breeds meetings about whose number is right. This one refuses to:',
      points: [
        'Every metric maps to the owning module’s register logic',
        'Tables are grouped aggregates — record-level access control stays with the registers',
        'A viewer without permission sees a locked tile, not the data',
      ],
    },
    related: ['ai-assistant', 'inspections', 'incidents'],
  },
};

// ─── Assembly & helpers ──────────────────────────────────────────────────────

/** Every module across every brand, in catalogue order. */
export const ALL_MARKETING_MODULES: readonly MarketingModule[] = MARKETING_MODULE_SLUGS.map(
  (slug) => ({ slug, ...MODULE_DEFS[slug] }),
);

/** The modules the active brand ships, in catalogue order. */
export function marketingModules(): readonly MarketingModule[] {
  return marketingModulesForBrand(activeBrand.id);
}

/** Brand-filtered catalogue — exported separately so tests can pin both brands. */
export function marketingModulesForBrand(
  brandId: Parameters<typeof brandHasModule>[0],
): readonly MarketingModule[] {
  return ALL_MARKETING_MODULES.filter(
    (m) => m.brandModule === undefined || brandHasModule(brandId, m.brandModule),
  );
}

/** Look up a module by slug within the active brand. Unknown or not-shipped → undefined. */
export function getMarketingModule(slug: string): MarketingModule | undefined {
  return marketingModules().find((m) => m.slug === slug);
}

/** Active-brand modules grouped by category, categories in display order. */
export function modulesByCategory(): ReadonlyArray<{
  readonly category: ModuleCategory;
  readonly modules: readonly MarketingModule[];
}> {
  const shipped = marketingModules();
  return MODULE_CATEGORIES.map((category) => ({
    category,
    modules: shipped.filter((m) => m.category === category.key),
  })).filter((group) => group.modules.length > 0);
}
