# ADR 0014 — Navigation information architecture

- **Status:** accepted
- **Date:** 2026-08-03
- **Supersedes:** the flat sidebar introduced in PR "feat(issues): frontend
  module + global left navigation sidebar" and extended piecemeal by
  PF-14, PF-22, PF-27 and the Incidents module (ADR 0013).

## Context

The left sidebar grew one entry at a time. Every module that shipped
added a row to a single flat list, and by the time FreeHS carried Risk
Assessments, COSHH, Permits and Fire Safety it had **nineteen top-level
entries in one undifferentiated column**, ordered by nothing more
principled than the order the modules were built in.

Six specific problems followed from that:

1. **No scanning structure.** Nineteen peers with no grouping means the
   eye reads every label to find one. The list mixed things a user opens
   ten times a shift (Observations) with things an administrator opens
   twice a year (Templates).
2. **Authoring surfaces ranked as destinations.** Templates, Schedules
   and Approvals were promoted to top-level siblings of the modules they
   serve — a fix for PF-14 ("four working areas have no navigation
   entry") that solved reachability by flattening hierarchy.
3. **Brand modules split the core list.** The four FreeHS-only entries
   were spliced into the middle of the array, so Heads Up and Assets —
   unrelated to each other and to what sat between them — ended up as
   neighbours separated by four safety modules.
4. **Deep surfaces stayed unreachable.** `/permits/board`,
   `/coshh/point-of-work`, `/fire-safety/logbook`,
   `/observations/qr-codes`, `/contractors/gate` and half a dozen others
   were only reachable from inside their module's landing page, or by
   typing the URL. Several of them are the *most* used page in their
   module for a field user.
5. **The menu carried no state.** Nothing in the chrome said that three
   actions were overdue or that eleven inspections were waiting for
   approval. You found out by clicking.
6. **Phones got the desktop menu in a drawer.** Below `md` the only way
   to change module was a hamburger in the top-left — the least
   reachable corner of a one-handed phone — opening the same nineteen-row
   list.

There was also a correctness bug: `isActive` special-cased Inspections to
light up for `/approvals` and `/schedules`. Once those became entries in
their own right (PF-14) the special case was never removed, so visiting
Approvals highlighted two rows and the menu misreported where you were.

## Decision

### 1. Group by the shape of the work, not the shape of the database

Four named groups, plus an unlabelled orientation block at the top:

| Group | Entries |
| --- | --- |
| *(unlabelled)* | Dashboard, My work, AI assistant |
| **Risk & control** | Risk assessments, COSHH, Permits, Fire safety |
| **Inspect & verify** | Inspections, Schedules, Approvals, Templates |
| **Report & fix** | Observations, Incidents, Actions, Heads Up |
| **Organisation** | Sites, Assets, Maintenance, Documents, Contractors |
| *(pinned foot)* | Settings |

The groups follow the plan → check → act arc that HSG65 already put in
every practitioner's head, without naming it: you assess and control a
risk, you verify the control is real, you respond to what the
verification found, and all of it hangs off the organisational records
underneath. Ordering within a group is by frequency of use, not
alphabetically.

Brand-only modules now occupy a group of their own, so the FreeHS
catalogue no longer interleaves with core entries — and on Forma360,
where that group is empty, it disappears entirely rather than leaving a
heading behind.

### 2. The IA is a data model with tests, not JSX

`apps/web/src/lib/nav-model.ts` builds the menu from
`{ locale, brandId, permissions }` and nothing else. Three gates run in
order — **brand** (ADR 0010), then **permission** (PF-27, administrators
bypass), then **emptiness** (a group that lost all its items loses its
heading too).

Everything a menu can get wrong is decidable from that model: which
entries a role sees, which group they land in, which one is active for a
URL, whether two entries can be active at once, whether every
destination is unique and locale-prefixed. `nav-model.test.ts` asserts
all of it (NAV-E01..NAV-E10). The sidebar, the mobile drawer and the tab
bar are then purely presentational and share one source of truth, so
they cannot drift apart.

### 3. Sub-navigation appears only under the active entry

Deep surfaces become children of their module and render indented
beneath it **while that module owns the route**. A resting menu stays
module-length; standing on Permits reveals Live board and Permit types
without a disclosure control to hunt for, and without an accordion state
to remember.

Children inherit their parent's permission and may raise it — Permit
types needs `permits.manage`, the site gate needs `contractors.gate` —
so a viewer never sees a sub-entry they cannot open.

### 4. Badges are personal, and there are only four

`myWork`, `approvals`, `actions`, `headsUp`. Every one is either the
caller's own queue or a queue the caller owns. Org-wide totals stay on
the dashboard: a number in permanent chrome has to mean "you, now", or
it becomes wallpaper within a week and stops being read at all.

### 5. "My work" is the landing surface

The dashboard answers *how is the organisation doing* and is gated on
`analytics.view`, which most front-line users do not hold. Nothing
answered *what do I do next*. `myWork.counts` / `myWork.list`
(`packages/api/src/routers/myWork.ts`) merge assigned actions, pending
acknowledgements, awaited signatures, unfinished inspections and — for
callers holding `inspections.manage` — the approvals queue, sorted
overdue-first across modules rather than grouped by module.

The router carries **no permission gate on purpose**: every row is keyed
on `ctx.auth.userId`, so gating it would be checking whether you are
allowed to see your own name. The approvals fold-in is the one place a
permission is consulted, and it stays out of the personal `total` because
it is not work assigned to you.

### 6. Phones get a tab bar

Five thumb-reachable slots fixed to the bottom: four destinations chosen
by `buildMobileTabs` from the same gated model, then "More", which opens
the full grouped drawer. Priority order is fixed — a tab bar that
reorders between sessions destroys the muscle memory that justifies it —
and Report (raise an observation) outranks browsing, because on a phone
in the field the dominant intent is to record something.

The header hamburger stays. It and the "More" tab each own an instance of
the same drawer, so neither has to lift open-state into the layout.

### 7. Collapsible rail

The sidebar collapses to a 56 px icon rail, persisted in `localStorage`.
Collapsed, group headings become separators and badges degrade from a
number to a dot — a dot still says "something is here" without claiming a
figure the rail has no room to print.

## Consequences

- The active-state alias is gone. Exactly one entry can be active for any
  route, asserted by NAV-E06 over every entry in the model.
- Adding a module means adding one entry to `sectionBlueprint` and one
  `nav.<key>` string in ten locales. The gating, ordering, active
  matching and mobile promotion all follow from the model.
- `myWork.counts` is polled every 60 s by whichever nav surfaces are
  mounted; React Query dedupes them to one request. It is aggregates
  only, and failure is silent — a menu that renders an error where a
  count belongs is worse than a menu with no count.
- Floating chrome (assistant launcher, offline chip) is raised on phones
  to clear the fixed tab bar, and signed-in `<main>` reserves its height
  below `md`.
- Landing surfaces changed: the sidebar wordmark and the mobile header
  wordmark now point at `/my-work` rather than `/ai`.
- Ten new `nav.*` keys plus a `nav.child.*` block and a `myWork`
  namespace ship in all ten locales.

## Alternatives considered

- **Keep the flat list, just reorder it.** Cheapest, and it fixes
  nothing above `md`: nineteen peers is past the point where ordering
  alone helps, and it leaves the deep surfaces unreachable.
- **A mega-menu / command palette as the primary nav.** Global search
  (PF-6) already covers "I know what I want and can name it". Navigation
  has to also serve "show me what exists", which a search box cannot.
- **Persisted accordion groups.** Collapsible sections with remembered
  state give each user a different menu shape, which makes support
  conversations and documentation harder, and hides entries behind a
  state the user set once and forgot.
- **Badge everything.** Rejected: see §4. Four numbers that always mean
  "you, now" get read; fifteen that sometimes mean "the org, this month"
  do not.

## Amendment (4 Aug 2026) — the practitioner panel's IA

A four-practitioner design review of the shipped menu
(`docs/reviews/freehs-navigation-ia-hse-expert-review.md`, disposition in
`freehs-navigation-ia-review-response.md`) replaced the grouping this ADR
originally recorded. The model, the gates and the testing discipline are
unchanged; the shape is not.

### Groups

`groupRisk` / `groupVerify` / `groupRespond` are retired in favour of
four groups named for what the user is doing, not for an abstraction:

- **(unlabelled top block)** — Dashboard, Ask AI. Both answer *about*
  everything rather than being a place you work.
- **For me** — My actions, My acknowledgements. Ungated, because both can
  only ever show rows addressed to the caller. For the majority of
  licensed users who are not safety professionals, this block is the
  application.
- **Do the work** — Inspections, Hazards & near misses, Incidents,
  Permits, Actions: the golden thread in reading order.
- **Records & registers** — Risk assessments, COSHH, Fire Safety, RAMS:
  documents that live for years and get reviewed. One seam to point an
  auditor at.
- **The organisation** — Sites, Assets, Contractors, Documents,
  Briefings: the things work happens to and with, plus the distribution
  channel alongside Documents.

Permits sit in the work group (a live control issued and closed within a
shift), Fire Safety in the registers group (its centre of gravity is the
FRA and the statutory calendar) — both contested placements the panel
argued through and settled.

### Nesting changes what "active" means

Templates, Schedules, Approvals and Maintenance became children of
Inspections and Assets, but their routes are top-level (`/approvals`,
not `/inspections/approvals`). `activeNavItem` therefore falls back to
matching an item's *children* — otherwise standing on `/approvals`
highlighted nothing and hid the sub-navigation that got you there.
`NavChild` also gained an optional badge so Approvals kept its queue
count on the way down.

### Counts are a menu feature, not a module feature

`myWork.counts` is now the single batched nav-counts endpoint: the
caller's own queues plus per-module needs-attention numbers, each gated
on both the brand catalogue (no query for a module the deployment does
not ship) and the caller's view permission. A sixteen-entry menu costs
one request. Group headings aggregate their items and show the total
only while folded — open, the items speak for themselves.

### The report decision moves into the flow

"Observations" versus "Incidents" is a judgement an untrained reporter
should never have to make from a menu, and getting it wrong sends a
serious injury down a path where nobody is alerted. The ＋Report
affordance states the distinction in its labels, and `/report` asks the
one question that settles it — *was anyone harmed?* — then routes.

## Amendment (5 Aug 2026) — the menu carries destinations only

Two of the panel's additions are withdrawn from the menu. Neither the
model, the gates nor the testing discipline changes.

- **The ＋Report button is gone.** A dropdown of *verbs* pinned above a
  list of *places* made the top of the menu two different kinds of thing,
  and every destination behind it is one tap away inside its module. The
  `/report` triage route survives and still asks the question that
  settles hazard-versus-incident; it is now reached from the modules and
  from links, not from the chrome. `nav/report-button.tsx` and the
  `nav.report` strings are deleted.
- **"For me" is one entry, not a group.** *My actions* and *My
  acknowledgements* were two doors onto `/my-work`, which already merges
  actions, acknowledgements, signatures, drafts and approvals into one
  overdue-first queue with filter chips. A heading plus two rows to reach
  a page that then re-splits itself is a group that earns nothing, so the
  `groupForMe` section collapses into a single `forMe` entry sitting
  under Ask AI in the unlabelled top block. `/my-work/actions` and
  `/my-work/acknowledgements` stay routable for direct links; the parent
  entry lights up for all three (NAV-E05).

Consequences: `NavBadgeKey` loses `myActions` / `myAcknowledgements` and
gains `forMe`, whose count is the sum of the two personal queues — one
number for one door. `MOBILE_TAB_PRIORITY` leads with `forMe`, so the
tab bar promotes one more browsable module than before.
