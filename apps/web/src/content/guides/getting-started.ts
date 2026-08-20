/**
 * Getting-started guides — the first hour with the product. Part of the
 * guide library (see `./index.ts` for conventions and brand gating).
 */
import { activeBrand } from '../../lib/brand';
import type { Guide } from './index';

export const GETTING_STARTED_GUIDES: readonly Guide[] = [
  {
    slug: 'try-before-you-sign-up',
    title: 'Try it without an account',
    area: 'getting-started',
    requiresSandbox: true,
    summary:
      'Get a real, seeded workspace in a few seconds — no email, no card — and keep it if you like it.',
    minutes: 3,
    sections: [
      {
        heading: 'Pick what you need to get done',
        intro:
          'The Try it now page asks one question: what do you need to get done? Each tile builds a different working workspace around that job.',
        steps: [
          'Open Try it now from the homepage.',
          'Pick a tile — risk assessments, inspections, hazards & near misses, permits to work, incidents, or contractors & RAMS.',
          'Answer the one follow-up question. It genuinely changes what gets built — “COSHH” seeds a different workspace than “fire risk assessment”.',
          'Watch the build narration; it lists exactly what is being created. It takes a few seconds.',
        ],
        note: 'You land signed in, inside a real workspace with two sites, a small team and worked records — not a video, not a canned demo. Each scenario deliberately leaves one decision open for you to make.',
      },
      {
        heading: 'Poke at it properly',
        bullets: [
          'Everything is editable — it is your workspace, not a shared demo. Break whatever you like.',
          'The records are internally consistent: an inspection mid-conduct really is mid-conduct, a permit awaiting a decision really is blocked on the thing it says.',
          'The banner at the top is the only thing marking it as a trial workspace.',
        ],
        tip: 'You can build a handful of workspaces per hour, so trying two different tiles side by side is a perfectly good way to evaluate.',
      },
      {
        heading: 'Keep it — or walk away',
        steps: [
          'To keep the workspace, use the save prompt in the banner and enter your email address.',
          'Verify with the code we send you. The workspace — including everything you changed — is now yours, signed in with that address from now on.',
          'To walk away, just close the tab. Nothing is saved to your name until you ask us to.',
        ],
      },
    ],
  },
  {
    slug: 'create-your-workspace',
    title: 'Create your free workspace',
    area: 'getting-started',
    summary: `Sign up with just an email address — no password, no card — and get a working ${activeBrand.name} workspace.`,
    minutes: 3,
    sections: [
      {
        heading: 'Sign up',
        intro: 'Sign-in is passwordless: your email address and a one-time code, every time.',
        steps: [
          'Open Get started and enter your name, your email address and your organisation’s name.',
          'Enter the six-digit code from the email we send you.',
          'You land in your new workspace, signed in, as its first administrator.',
        ],
        note: 'There is no password to invent, store or forget — and nothing for anyone to phish out of your team later.',
      },
      {
        heading: 'What a new workspace already has',
        bullets: [
          'Three permission sets — Administrator, Manager and Standard — ready to hand out.',
          'Sensible observation categories (including good practice) and four default action types, so registers work before you configure anything.',
          'Every module switched on. Use what you need; the rest sits quietly in the navigation.',
        ],
      },
      {
        heading: 'A sensible first hour',
        steps: [
          'Add your sites under Settings → Sites — even two or three top-level sites make every register immediately more useful.',
          'Invite two or three colleagues under Settings → Users (see “Invite your team and set permissions”).',
          'Pick the module closest to your day job and do one real piece of work in it — one risk assessment, one inspection template, one hazard report.',
        ],
        tip: 'Resist configuring everything first. One real record teaches you more about how the platform fits your operation than an afternoon of settings.',
      },
    ],
  },
  {
    slug: 'invite-your-team',
    title: 'Invite your team and set permissions',
    area: 'getting-started',
    summary:
      'Get colleagues into the workspace with the right level of access — and understand how permission sets work.',
    minutes: 5,
    sections: [
      {
        heading: 'Invite people',
        steps: [
          'Open Settings → Users and choose to invite a user.',
          'Enter their name and email address, and pick a permission set — Standard is the right default for most of the team.',
          'They receive an email invitation; sign-in is the same passwordless code flow you used.',
        ],
        note: 'Invites are free — there are no seats to count. A reporting culture works best when everyone who might notice a hazard can hold an account.',
      },
      {
        heading: 'Understand the three default sets',
        bullets: [
          'Standard — do the work: report hazards, conduct inspections, close your own actions, read what is shared with you.',
          'Manager — run the work: manage registers, assign actions, approve inspections, handle incidents.',
          'Administrator — run the workspace: everything, including settings, users and permissions.',
        ],
        tip: 'Permissions are enforced by the server, not just hidden in the interface — so granting the smaller set is genuinely safe, not cosmetic.',
      },
      {
        heading: 'Build your own sets when you need them',
        steps: [
          'Open Settings → Permissions to see the catalogue of fine-grained permission keys, grouped by module.',
          'Create a set — for example, “Fire warden”: fire-safety recording plus their own actions, nothing else.',
          'Assign it from the user’s page. A person holds one set; change it any time.',
        ],
        note: 'The platform will refuse any change that would leave the workspace without an administrator — you cannot lock yourself out.',
      },
      {
        heading: 'When someone leaves',
        steps: [
          'Open their page under Settings → Users and deactivate them. It takes effect immediately — including sessions already signed in.',
          'Their history stays: inspections they conducted, actions they closed and signatures they gave remain on the record.',
          'For a data-protection erasure request, use anonymise — it removes the person while keeping the records lawful and coherent.',
        ],
      },
    ],
  },
  {
    slug: 'find-your-way-around',
    title: 'Find your way around',
    area: 'getting-started',
    summary:
      'The navigation, your personal queue, search and the assistant — the four habits that make the platform quick.',
    minutes: 4,
    sections: [
      {
        heading: '“For me” is your home',
        intro:
          'The first entry in the navigation is not a module — it is your queue: the actions you owe, the acknowledgements and signatures waiting on you, and your unfinished drafts, merged into one list.',
        bullets: [
          'For most of the team, this page is the product: open it, clear it, done.',
          'Counts in the navigation show where something needs attention, so you navigate to the red rather than from memory.',
        ],
      },
      {
        heading: 'The navigation, in three blocks',
        bullets: [
          'Run the day-to-day — inspections, hazard reports, incidents, permits and actions: the modules your team touches every shift.',
          'Registers — risk assessments, COSHH, fire safety and RAMS: the documents that live for years.',
          'The organisation — sites, assets, contractors, training, documents and briefings: the structure everything scopes to.',
        ],
        note: 'You only see modules you have permission to open — a shorter menu is not a missing feature.',
      },
      {
        heading: 'Search and the assistant',
        bullets: [
          'Global search (the magnifying glass, or Cmd/Ctrl-K) jumps to any record or page by name.',
          'The assistant bubble in the corner answers questions about your data — “how many actions are overdue?” — scoped to what you are allowed to see.',
          'On a phone, the tab bar keeps your queue and the reporting modules one thumb away.',
        ],
        tip: 'Search is the fastest way to move between records you already know exist; the assistant is the fastest way to answer questions you would otherwise build a report for.',
      },
    ],
  },
];
