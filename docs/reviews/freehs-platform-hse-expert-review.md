# FreeHS — Whole-platform review

## Independent review by four HSE practitioners

**Product:** FreeHS (freehs.software) — the entire platform
**Surface reviewed:** all 14 navigation areas — AI (home), Sites, Inspections
(+ Templates, Schedules, Approvals), Observations, Actions, Heads Up, Risk
Assessments, COSHH, Permits, Fire Safety, Assets (+ Maintenance), Documents,
Contractors, Settings — plus the platform layer: onboarding, permissions,
notifications, search, i18n, mobile/offline, analytics, audit
**Date:** 3 August 2026

---

## Methodology & scope (read this first)

The four practitioners who reviewed Risk Assessments, COSHH, Permits and Fire
Safety were asked a new question: *"Forget the individual modules — could you
run your whole safety management system on FreeHS? Live in it for a week: set
up your company, invite your team, work every module, and tell us where the
platform holds together and where it doesn't."*

**How the review was performed.** As with all four prior reviews, the live app
is behind an authenticated login wall (anonymous request → HTTP 403) and no
browser automation was available, so every finding is verified against the
**shipped implementation on `main`** — this time across the whole codebase:
every router, every web route, all 16 background workers, the email template
registry, the permission catalogue and seeds, all 10 locale bundles, and the
navigation/search/settings chrome. The heavy lifting was done by a systematic
three-track code survey (workflow modules; supporting modules; platform
chrome), and the two most serious claims below were independently re-verified
by hand. File:line evidence for every material claim is in the Engineering
appendix.

**Where the four brand modules now stand.** Both hardening rounds landed
before this review: Permits closed all 15 findings from its review (evaluated
gas gate, lifecycle guards, gang/entry log, permit PDF, site-scoped authority)
and Fire Safety closed all 12 (failed checks stay red, FRA attestation
hardening, FRA PDF, due digest). The reviewers acknowledge this throughout —
the brand modules are now the *strongest* part of the product. **This review
is therefore about the connective tissue**: what happens between the modules,
underneath them, and around them.

**The one-paragraph conclusion, up front.** FreeHS's individual modules are
now genuinely good — in places excellent. The platform around them is not yet
finished: the alert layer silently fails for exactly the most safety-critical
emails (a registry bug — PF-1), the Actions hub mislabels and loses the
corrective actions the HSE modules generate (PF-2), scheduled inspections are
never flagged as missed (PF-3), there is no dashboard or analytics anywhere,
the home page is an AI assistant that doesn't know the four HSE modules exist,
and search can't find a permit or a COSHH assessment. The modules are strong
soloists; the orchestra needs a conductor.

Severities: **Critical** (a safety notification or record is silently lost),
**High** (defeats a core platform duty or blocks adoption), **Medium**
(pushes users into bad practice / real capability missing), **Low** (polish).

---

## The reviewers

| # | Reviewer | Role | Organisation | Platform lens |
|---|----------|------|--------------|---------------|
| 1 | **Priya Nair, CMIOSH** | Group HSE Manager | Precision-engineering firm, ~800 staff, 3 sites | Running the whole system: onboarding, the action loop, KPIs, cross-module truth |
| 2 | **Tom Whitfield, GradIOSH** | H&S Advisor | Building-services contractor, ~40 staff + subs | The field: mobile, offline, QR reporting, the daily grind across modules |
| 3 | **Dr. Aisha Bello, CFIOSH** | Head of OH&S | NHS trust, thousands of staff | Alerts that must arrive, contractors at the door, multilingual workforce |
| 4 | **Marcus Lindqvist, CMIOSH (ISO 45001 lead auditor)** | EHS consultant / auditor | FM & logistics clients | Governance: permissions, audit trail, data lifecycle, systemic failure modes |

---

# 1 · Priya Nair — Group HSE Manager

> *"A safety management system lives or dies on one loop: something is found →
> an action is raised → the right person is told → it gets done → I can see
> the trend. I set up the company, invited my team, and followed that loop
> through every module."*

### Setting up the company — first friction on day one

**PF-7 (High) — My deputies can't find the user-management screen.** I made my
site managers "Manager" (the seeded set). Manager holds `users.invite` and
`users.manage` — but the Settings page gates its whole tab bar on the
admin-only `org.settings` key, so a Manager opening Settings sees exactly one
tab: "My profile". The invite screen works if you *type the URL*; there is
simply no way to discover it. The single most important onboarding path —
"safety manager adds the team" — is invisible to the role designed to do it.

**PF-8 (High) — The permission editor shows raw code for the four FreeHS
modules.** Building a custom permission set, the matrix renders
`settings.permissions.modules.permits` as a section heading and
`settings.permissions.perms.permits_issue` as a checkbox label — the i18n
entries for all 14 FreeHS keys were never added, in any locale. The modules
this brand exists to sell are the ones the admin can't read. (Also noted: any
tenant created *before* the FreeHS modules landed has Manager/Standard sets
frozen without the 14 new keys — seeding is first-time-only, there's no
backfill migration, and system sets are read-only in the UI.)

What *is* good here: the invite panel itself (name, email, permission set,
groups, sites, CSV import), the terminology setting (sites vs projects,
threaded genuinely everywhere), the branding upload, and the risk-matrix
editor with per-severity floors and correct snapshot semantics. The bones of
settings are right; the gate and the labels are wrong.

### The action loop — the platform's nervous system, and it's damaged

The four HSE modules now reliably *generate* corrective actions (RA planned
controls, COSHH findings, FRA findings, failed fire checks, failed door
inspections). Then I went to the Actions module to manage them:

**PF-2 (Critical) — Actions from the HSE modules are mislabeled "Standalone"
with no link back to their source.** The Actions list and board render a
source chip from a four-branch check (inspection / issue / maintenance /
standalone); the five newer source types — `risk_assessment`,
`coshh_assessment`, `fire_risk_assessment`, `fire_logbook_entry`,
`fire_door_inspection` — all fall through to **"Standalone"**. The detail page
is worse: `actions.get` only resolves source context for the four old types,
so an action raised by a fire-door failure shows *"Standalone action"* with no
back-link at all. "Show me the risk assessment that generated this control" —
the golden thread every auditor pulls — is severed at the hub. And the
source-type *filter* only accepts the three original values, so these actions
can't even be isolated in the list.

**PF-4 (Critical) — The Actions module sends no notifications. None.** No
email when an action is assigned to you, none when it falls due, none when it
goes overdue. Every peripheral module has a reminder worker (RA
acknowledgements, permit expiry, fire digest, contractor docs, maintenance,
schedules) — the module that tracks the *corrective actions themselves* is
completely silent. An operative who never opens the app never learns they own
an action.

**PF-9 (High) — The list truncates at 100 actions, oldest first out.** The
hard cap is 100 with no pagination, default-sorted newest-first — so in a busy
tenant it is precisely the **oldest, most-overdue actions that silently
disappear** from view. My overdue backlog literally cannot be seen. (The
"assigned to me" and "overdue" filters exist and work — but they're opt-in
chips, and there's no My Actions view, badge or count anywhere.)

### Scheduled inspections — the calendar has no memory

**PF-3 (Critical) — A missed scheduled inspection is never flagged, anywhere.**
The occurrence status enum includes `'missed'` — and nothing in the entire
codebase ever writes it (nor `in_progress`, nor `completed`). Consequences,
all verified: an undone weekly statutory inspection just sits "pending"
forever with no flag, digest or escalation; the "Past inspections" table on
every schedule page is permanently empty (it filters on a status nothing
sets); an overdue occurrence *vanishes* from "upcoming" (filtered
`>= now`); and there is no "my scheduled inspections" surface at all — a
frontline worker's only signal is a single reminder email. For a compliance
platform, a scheduler that can't say "this was missed" is half a scheduler.

### Seeing the whole — there is no whole

**PF-5 (High) — No dashboard, no analytics, no reports. Anywhere.** No chart
library in the dependency tree, no analytics router, no KPI route. Each module
has a well-made needs-attention strip and most have CSV export — so answering
"how are we doing this quarter?" means exporting five CSVs and building the
pivot myself. No overdue-action trend, no inspection completion rate, no
site-vs-site comparison, no board pack. The permission keys for analytics
exist (forward-declared); nothing consumes them.

**PF-6 (High) — Search can't find half the product.** Global search covers six
entities (assets, inspections, observations, actions, heads-ups, documents) —
and **none of the four FreeHS modules**, nor contractors, sites or templates.
Cmd-K for "PTW-0123" or "acetone": nothing. On this brand, the search box
covers less than half the nav.

Also filed: the extinguisher problem — fire equipment lives twice (as an asset
with maintenance plans AND inside the fire logbook) with zero linkage, so
"show me the service history of extinguisher #12" spans two systems that can't
be joined (PF-17); and two parallel maintenance systems (plans vs programs)
where the asset page shows only one (PF-18).

**Verdict:** The modules would each pass my procurement review today — the
loop between them wouldn't. Fix the Actions hub (PF-2/4/9), make the scheduler
admit what was missed (PF-3), and give me one dashboard, and this platform
goes from "a set of good tools" to "a safety management system".

---

# 2 · Tom Whitfield — H&S Advisor, building-services contractor

> *"My people live on their phones, in basements and plant rooms with no
> signal. I tested the platform the way they'd use it: thumb, van, site."*

### The good news first — inspections in the field are genuinely excellent
The conduct flow is the best mobile work in the product: single-column layout,
camera capture wired to photo questions, a 1.5-second debounced autosave that
**queues to localStorage when offline** and retries automatically, an amber
"offline" chip so you know where you stand, and a submit gate that lists every
blocking question as a **click-to-jump link with page numbers**. The signature
flow (dedicated mobile sign pages, DPR-aware signature pad, sequential
turn-order, "sign the next slot" chaining) is better than tools we pay real
money for. Credit where due.

### But the offline story stops there

**PF-10 (High) — The flows most likely to be used with no signal have no
offline support at all.** There's no PWA (no manifest, no service worker — the
app can't even be installed to a home screen), and the localStorage resilience
exists in exactly one file: inspection conduct. **Permit acceptance** (signed
at a confined-space entry point), the **fire logbook** (a weekly alarm test
recorded in a plant room) and COSHH point-of-work checks are all plain
online-only mutations. Photos aren't offline-capable even in conduct — a
failed upload just toasts and **drops the photo**.

### QR hazard reporting — right idea, wrong details

The anonymous QR flow (scan a poster → report a hazard, no login, rate-limited,
reference number returned) is exactly what my sites need. But:

**PF-11 (High) — You cannot attach a photo to an anonymous QR report.** The
category admin can enable "media" for the QR form; the page ignores it — no
photo field is ever rendered. A hazard report from the shop floor without a
photo is half a report. (The "site" toggle is ignored the same way, and the
page is hardcoded English regardless of tenant — the one page the workforce
actually sees.)

**PF-12 (Critical, shared with Aisha) — Observation notification emails link
to dead URLs — both paths.** The direct path links `/en/issues/{id}` — a route
that **does not exist** (it's `/observations`). The queued path builds
`/{tenantId}/observations/{id}` — a tenant id where the locale belongs. Every
notification email about a new hazard report 404s. And the anonymous QR path
**bypasses the category's configured critical-alert recipients** entirely,
falling back to "email every manager" — the route the public uses to report
the serious stuff skips the alert list built for the serious stuff.

### Daily-grind friction across the platform
- **Raising an action from an observation loses half the data (PF-13, Med):**
  the dialog has no assignee picker (actions arrive unassigned), skips the
  priority→due-date automation other paths apply, and can't set an action type
  — so per-type required fields are bypassed. Same platform, three
  create-action paths, three behaviours.
- **Four working areas have no navigation entry (PF-14, Med):** `/templates`,
  `/schedules`, `/approvals` and `/maintenance` are reachable only by URL or
  side-door links. Better yet, a newly **invited user's first-ever screen is
  `/templates`** — a page they can never navigate back to. My apprentice's
  first impression is a screen that doesn't exist in the menu.
- **Scheduled Heads Ups never send (PF-15, Med/High):** the composer offers
  "schedule for later" and saves a draft "for the schedule job" — there is no
  schedule job. A toolbox-talk notice scheduled for Monday 07:00 sits in
  drafts forever, silently. (Also: the acknowledgement chase is manual-only,
  and the reminder email links recipients to the *admin analytics* page they
  can't open, without a locale prefix.)
- **Documents look after my RAMS and insurance certs — but nothing chases
  expiry (PF-16, Med):** the UI offers reminder-days checkboxes, the API
  stores them, the docs promise "reminder jobs" — no worker reads the field.
  An expired certificate is a red badge nobody sees unless they browse to it.

**Verdict:** For my inspectors, this is already the best tool we've used — on
that one flow. For everything else my lads touch (permits at the entry point,
the alarm test in the basement, the QR poster in the corridor), the platform
assumes a desk and a signal. Close the offline gap and the QR photo gap and
this becomes the field tool it clearly wants to be.

---

# 3 · Dr. Aisha Bello — Head of OH&S, NHS trust

> *"In a trust the platform's real product is the alert that arrives at the
> right moment: the permit that expired with someone inside, the FRA that came
> back intolerable, the hazard reported at 3am. So I audited the alert layer
> end to end. What I found is the most serious thing in this review."*

### PF-1 (Critical) — The four most safety-critical emails in the product can never be sent

Twenty-three email templates exist on disk. The template registry that the
send function resolves against contains **nineteen**. The four missing are not
random — they are precisely the alerts added by the recent safety-hardening
rounds:

- `permit-expiry-warning` (the pre-expiry warning the Permits review asked for)
- `permit-expiry-escalation` (the "someone may still be in there" escalation)
- `fire-due-digest` (the daily fire-calendar digest the Fire Safety review asked for)
- `fra-intolerable-alert` (the alert when an FRA is rated intolerable)

Every send of these throws "Unknown email template" — and for permits it's
**unrecoverable by design**: the dedup stamp (`expiryWarningSentAt` /
`expiryEscalatedAt`) is written *before* the notify, and the notify error is
caught and logged, so the permit is marked "warned/escalated" forever while
nobody was told. The event log dutifully records an escalation that never
reached a human. An expired confined-space permit escalates to no one. The
fire digest fails politely every morning and is never delivered; the
intolerable-FRA alert is swallowed with a warning.

The bitter irony: the hardening work itself was done well — the workers, the
dedup discipline, the templates, all present. One registry object was never
updated, no test exercises the loader, and the entire alert layer for the two
highest-risk modules fails silently. **This is the first thing to fix on the
whole platform, and it's a one-file fix.**

### The front door — contractors walk past the compliance system

**PF-19 (High) — Contractor compliance does not gate site entry.** The
contractor module derives compliance beautifully (expired insurance flips a
contractor non-compliant automatically, no stale state). And then: neither
staff check-in, nor kiosk self-check-in, nor walk-in creation *ever consults
it*. A contractor with lapsed public-liability insurance walks straight
through the gate; the kiosk never even displays compliance. (The
`overrideReason` parameter sitting unused on check-in shows a block-with-
override was designed and never wired.) Related: the portal induction is
enforced client-side only — a contractor can deep-link past it — and the
induction text is a single hardcoded paragraph with no versioning, so you
can't prove *what* was acknowledged. And permits↔contractors have **no join at
all**: I cannot ask "which permits are open for contractors currently on
site" — even though both modules separately track "is someone still in there".

### Communications to a large, multilingual workforce

- **Every email the platform sends is English, permanently (PF-20, Med/High):**
  only English templates exist, the locale is hardcoded, and there is **no
  locale column on the user record** — the UI language switcher doesn't
  persist. My Portuguese-speaking domestics get every safety alert in English.
- **The UI itself is unevenly translated (PF-21, Med):** measured across all
  10 locales — `permits` and `coshh` are genuinely, well translated
  everywhere; but `riskAssessments` is ~97% English in all nine non-English
  locales, `contractors` 100% English, `settings` ~80% English, and
  `fireSafety` is translated *only* in Italian. The FreeHS brand overrides are
  English in every locale, actually **regressing** already-translated sign-in
  strings. And the Fire Safety nav item has no label key at all — it renders
  the raw `nav.fireSafety` fallback in every language including English
  (PF-22, High — verified by hand).
- **No notification preferences, no in-app notification centre, no digest
  across modules (PF-23, Med):** seven workers email on seven cadences with
  four different recipient-resolution models, only one of them configurable.
  A busy site manager gets an unbatched stream with no way to tune it — which
  trains people to filter it, which is how real alerts get missed. (The fire
  digest's own comment — "a digest that always arrives trains people to delete
  it" — is exactly the right instinct; it needs to become the platform's
  policy, not one module's.)

What I'd praise from my seat: the Heads Up module freezing recipients at
publish and invalidating signatures when the body is edited (correct
compliance behaviour, rarely built); the RA acknowledgement chase worker
(grace, repeat, dedup); the contractor overstay watch; and the AI assistant's
discipline — every read permission-gated server-side, every write through the
real procedures with confirm-before-write. Though on that last point: the
assistant that greets every user cannot answer a single question about
permits, fire safety, COSHH, risk assessments or contractors — the four
modules on the tin (PF-24, High). And there is no safety-advice guardrail in
its prompt; people *will* ask it "is this safe?".

**Verdict:** I could run engagement and comms on this platform's *patterns* —
they're often exemplary. But until PF-1 is fixed I have to assume the most
important alerts don't arrive, and until the gate checks compliance, the front
door isn't part of the safety system. Fix the registry today; wire the gate
this month.

---

# 4 · Marcus Lindqvist — EHS consultant & ISO 45001 lead auditor

> *"Module by module this codebase has learned fast — I've watched three review
> rounds get actioned point by point. So I audited what module reviews don't
> see: the governance layer, and the failure modes that repeat across the
> platform."*

### The systemic finding: silent failure is the platform's default

PF-1 (the email registry) is not just a bug; it's a *pattern*. Look at where
else the platform fails without telling anyone: stamps written before sends
with errors swallowed (permits); a scheduler whose 'missed' state is declared
but never written (PF-3); a UI status (`awaiting_signature_workflow`) that
three surfaces coerce to "In progress" rather than admit they don't know it
(PF-25); reminder fields stored and displayed but read by no worker (PF-16);
an ACL table written by grant/revoke and consulted by no read path (PF-26);
a permission (`org.audit.view`) granted to Manager and implemented nowhere.
In each case the system *accepts* the configuration and silently doesn't
honour it. For an assurance platform, "accepted but not honoured" is the worst
contract: every one of these should either work or refuse loudly. I'd make
"no silent capability" a stated engineering ground rule alongside the twelve
that already exist.

### Permissions & access — good catalogue, leaky enforcement

- **Navigation is brand-gated but never permission-gated (PF-27, Med):** the
  seeded Standard user has no `contractors.*` key yet sees Contractors in the
  sidebar, lands on the page, and watches the query reject. Menus that show
  what you can't open erode trust in what the menu says.
- **Read-permission writes (PF-28, Med):** site media upload, caption rewrite
  and floor-plan pin create/move/archive all require only `sites.view` — any
  read-only user can alter site plans that observations link to as "location
  on plan". (Archive correctly requires manage, which shows this is accident,
  not policy.)
- **Two validation bugs make visible form fields unusable (PF-29, Med):**
  `assets.ownerUserId` and document-ACL user grants both validate IDs at
  exactly 26 chars while user IDs are 30 (`usr_` + ULID) — the Asset Owner
  picker and any user-scoped document grant fail Zod on every submit. Other
  routers document the correct pattern; these two missed it.
- **Approvals allow self-approval and notify no one (PF-30, Med):** approve/
  reject require only `inspections.manage` with no author check, and neither
  direction of the approval flow sends any notification. A sign-off gate that
  neither separates duties nor tells the approver work is waiting is
  ceremonial.

### The audit chrome — per-record excellent, tenant-level absent

Per-record evidence is genuinely strong: append-only event logs on permits,
fire, RA, actions (18 event kinds with field diffs) and issues; recipient
freezing and signature invalidation on Heads Up; version pinning everywhere it
matters. But zoom out (PF-31, Med/High):

- **No tenant-wide audit log** — `org.audit.view` exists in the catalogue and
  nothing implements it; there is no cross-module activity surface.
- **No tenant data export** — nothing a customer can invoke; the only full
  dump is the nightly infrastructure pg_dump spanning *all* tenants.
- **No retention engine** — the 40-year COSHH duty and the RIDDOR horizons
  exist only in comments; nothing implements retention or purge.
- **Anonymisation is half-built** — the inline user scrub works, but the
  cascade worker "logs the trigger and exits": PII in signatures, comments
  and attachments survives. And the whole anonymise capability has no UI.
- Small but telling: the invite email on a FreeHS deployment says *"A
  Forma360 administrator"* — a hardcoded brand leak in the one email every
  single user receives first (PF-32, Low).

### What I'd certify tomorrow
The module-level machinery: the permit lifecycle (still the strongest module
in the codebase), the fire calendar with failed-checks-stay-red, the RA
versioned sign-off, derived contractor compliance, the schedule
materialisation's timezone handling (with its reminder-rollback on enqueue
failure — a lovely piece of defensive design), keyset pagination done
properly on observations, and worker dedup discipline everywhere workers
exist. The craftsmanship is real. The governance shell around it is one
release behind the modules it contains.

**Verdict:** I now trust the *records*. I don't yet trust the *system* to
tell anyone when the records demand attention (PF-1/3/4), to show an auditor
the whole picture (no audit log, no analytics), or to fail loudly when a
promise isn't kept. That last one is cultural, and it's the one to fix first.

---

# Consolidated findings

### Where all four agree
1. **Fix PF-1 today.** Four unregistered email templates silently kill the
   permit expiry warnings/escalations, the fire due digest and the
   intolerable-FRA alert — the exact alerts the hardening rounds added — and
   the permit path burns its one-shot dedup stamp so the alerts are lost
   permanently. One file; highest stakes on the platform.
2. **The Actions hub betrays the modules that feed it** (PF-2/4/9): five
   source types mislabeled "Standalone" with no back-link and no filter; zero
   notifications; a 100-row cap that hides the oldest overdue actions.
3. **The scheduler has no concept of "missed"** (PF-3) — dead status, dead UI,
   vanishing overdue occurrences, no worker.
4. **The platform has no eyes**: no dashboard/analytics (PF-5), search blind
   to the four brand modules (PF-6), an AI home page that can't answer
   questions about them (PF-24), and a nav item (Fire Safety) rendering a raw
   i18n key (PF-22).
5. **The notification layer needs a story, not more workers** (PF-20/23):
   English-only emails with no user locale, no preferences, no centre, no
   cross-module digest, four recipient models.
6. **Onboarding stumbles at the door** (PF-7/8/14): Managers can't find user
   management, the permission matrix shows raw keys for the FreeHS modules,
   and new invitees land on an orphaned route.

### What everyone praised (protect these)
- The four brand modules post-hardening — permits above all.
- Inspection conduct's offline autosave + click-to-jump submit gate; the
  end-to-end signature workflow.
- Schedule materialisation's timezone correctness and reminder rollback.
- Heads Up recipient freeze + signature invalidation on edit.
- Derived contractor compliance, the overstay watch, capability-token uploads.
- Terminology threading, the risk-matrix editor, per-record append-only logs,
  worker dedup discipline, server-side permission gating in search and the AI
  agent, keyset pagination on observations.
- A codebase that documents the bug each guard prevents — and a team that has
  visibly actioned three review rounds point by point.

---

# Prioritised platform issue register

| ID | Sev | Summary | Raised by |
|----|-----|---------|-----------|
| PF-1 | Critical | 4 email templates unregistered (`permit-expiry-warning/-escalation`, `fire-due-digest`, `fra-intolerable-alert`) — sends throw; permit dedup stamp written first + error swallowed → alerts lost permanently | Bello, Lindqvist |
| PF-2 | Critical | Actions from RA/COSHH/FRA/fire-logbook/fire-door mislabeled "Standalone"; no back-link on detail; unfilterable | Nair, Lindqvist |
| PF-3 | Critical | Scheduled-inspection `missed` status never written: no flag/escalation, dead "Past inspections" UI, overdue occurrences vanish, no my-schedule surface | Nair |
| PF-4 | Critical | Actions module sends zero notifications (assignment, due, overdue) | Nair |
| PF-12 | Critical | Both observation notification email links are broken (nonexistent `/issues` route; tenantId in locale slot); anonymous QR bypasses critical-alert recipients | Whitfield, Bello |
| PF-5 | High | No dashboard, analytics, KPIs or reports anywhere (no chart lib, router or route) | Nair, Lindqvist |
| PF-6 | High | Global search covers 6 entities — none of the 4 brand modules, contractors, sites or templates | Nair |
| PF-7 | High | Settings tab bar gated on `org.settings`: seeded Manager (holds `users.invite`) sees only "My profile" | Nair |
| PF-8 | High | Permission matrix renders raw i18n keys for all 4 FreeHS modules / 14 keys, all locales; no permission backfill for pre-FreeHS tenants | Nair, Lindqvist |
| PF-9 | High | Actions list hard-capped at 100, newest-first — oldest/most-overdue silently dropped | Nair |
| PF-10 | High | No PWA; offline support exists only in inspection conduct — permits acceptance, fire logbook, COSHH PoW are online-only; photos dropped on failed upload | Whitfield |
| PF-11 | High | Anonymous QR hazard report: no photo (media toggle ignored), site toggle ignored, English-only page | Whitfield |
| PF-19 | High | Contractor compliance never checked at check-in/kiosk/walk-in; induction client-side only + unversioned; no permits↔contractors join | Bello |
| PF-22 | High | `nav.fireSafety` label missing from all 10 locales + overrides — sidebar renders raw key | Bello |
| PF-24 | High | AI home page has no tools for RA/COSHH/permits/fire/contractors/sites; no safety-advice guardrail in prompt | Bello, Nair |
| PF-15 | Med/High | Scheduled Heads Ups never publish (no worker); manual-only ack chase; reminder deep-link goes to admin page without locale | Whitfield, Bello |
| PF-20 | Med/High | All emails English-only; no user locale column; language choice not persisted | Bello |
| PF-31 | Med/High | No tenant-wide audit log (`org.audit.view` unimplemented), no tenant data export, no retention engine, anonymisation cascade is a stub | Lindqvist |
| PF-13 | Med | Issue→action loses assignee, auto-due and action type vs other create paths | Whitfield |
| PF-14 | Med | `/templates`, `/schedules`, `/approvals`, `/maintenance`, `/settings/assets` orphaned from nav; invitees land on `/templates` | Whitfield |
| PF-16 | Med | Document `reminderDays` stored + offered in UI but no worker reads it | Whitfield |
| PF-17 | Med | Fire equipment duplicated across Assets and Fire Safety with zero linkage | Nair |
| PF-18 | Med | Two parallel maintenance systems (plans vs programs); asset page shows programs only; usage-based plans never notify; maintenance emails go to whole tenant | Nair |
| PF-21 | Med | i18n: `riskAssessments` ~97% / `contractors` 100% / `settings` ~80% English in 9 locales; `fireSafety` Italian-only; FreeHS overrides regress translations | Bello |
| PF-23 | Med | No notification preferences/centre/digest; 4 recipient-resolution models, one configurable | Bello, Lindqvist |
| PF-25 | Med | `awaiting_signature_workflow` renders as "In progress", unfilterable, missing i18n; + inert template features (`notify: immediate`, `requireNote`), workflow swallows in-form signature slots | Lindqvist |
| PF-26 | Med | `document_access` ACL is write-only — never consulted by any read path | Lindqvist |
| PF-27 | Med | Sidebar never permission-gated (Standard sees Contractors without any key) | Lindqvist |
| PF-28 | Med | Site media/pins writable with `sites.view` only; no author checks | Lindqvist |
| PF-29 | Med | 26-char ID validation breaks Asset Owner picker and user-scoped document grants (user IDs are 30 chars) | Lindqvist |
| PF-30 | Med | Approvals: self-approval allowed; no notifications in either direction; queue lacks site/submitter/ageing | Lindqvist |
| PF-32 | Low | Invite email hardcodes "A Forma360 administrator" on FreeHS; Heads Up `expiresAt`/`allowComments` unenforced; observation Priority column shows "No due date" | All |

---

# Engineering appendix (root cause & pointers)

Verified against `main`; the two Critical headliners re-checked by hand.

- **PF-1** — `EMAIL_TEMPLATES` in `packages/shared/src/email.ts:45-65` has 19
  entries; `packages/i18n/emails/en/` has 23. Missing: `permit-expiry-warning`,
  `permit-expiry-escalation`, `fire-due-digest`, `fra-intolerable-alert`.
  Loader rejects unknown keys (`email.ts:179-185`); no call site overrides it.
  Consumers: `packages/jobs/src/worker.ts:345` (permit warning/escalation),
  `worker.ts:387` (fire digest), `packages/api/src/routers/fireSafety.ts:1391`
  (intolerable alert). Loss is permanent for permits: stamp-before-notify +
  swallowed error, `packages/jobs/src/workers/permit-expiry-watch.ts:187-231`.
  No test exercises the real loader. *Fix: register the four templates; add a
  test asserting every `emails/en/*.json` is registered; notify-then-stamp or
  retry-on-stamp for the permit watch.*
- **PF-2** — source chip ternaries `apps/web/app/[locale]/actions/page.tsx:1124-1130`
  (list) and `:1355-1361` (board); `actions.get` resolves only 4 source types
  (`packages/api/src/routers/actions.ts:662-722`); `SourceCard` falls back to
  "Standalone action" (`actions/[actionId]/page.tsx:677-689` — note the latent
  wrong `/inspections/{id}` href fallback); filter enum `actions.ts:390`.
  Writers of the 5 unhandled types: `riskAssessments.ts:1233`,
  `coshh.ts:1302`, `fireSafety.ts:1330,1720,2146`.
- **PF-3** — `'missed'` declared `packages/db/src/schema/schedules.ts:52`,
  written nowhere (repo-wide grep); `listOccurrences` filters `completed`
  which nothing sets (`schedules.ts:538`) → dead UI
  `schedules/[scheduleId]/page.tsx:440-492`; `listUpcoming` filters
  `>= now` (`schedules.ts:574`) and has no UI consumer.
- **PF-4** — no actions queue in `packages/jobs/src/queues.ts:18-100`; zero
  `sendEmail` in `actions.ts`.
- **PF-12** — `issues.ts:751` links `/en/issues/{id}` (route doesn't exist);
  `packages/jobs/src/workers/observation-notify.ts:185` builds
  `/{tenantId}/observations/{id}`; QR path calls legacy notify-all,
  bypassing recipient spec (`issues.ts:1283-1288`).
- **PF-5** — no chart lib in any package.json; no analytics router/route;
  analytics keys forward-declared `packages/permissions/src/catalogue.ts:123-126`.
- **PF-6** — `packages/api/src/routers/search.ts:51-205`: six entities; its
  own docstring says "seven" (`:4`).
- **PF-7/8** — `settings/layout.tsx:36` + `settings-tabs.tsx:59` gate on
  `grantsAdminAccess`; Manager seed lacks `org.settings`
  (`packages/permissions/src/seed.ts:86-88`); matrix i18n keys missing
  (`permission-matrix.tsx:69,87` vs `settings.permissions.*` in en.json);
  seed is first-time-only with no migration backfill (`seed.ts:71-83`).
- **PF-9** — `ACTION_LIST_LIMIT = 100` (`actions.ts:75,421`), no cursor.
- **PF-10** — no manifest/SW anywhere; localStorage only in
  `conduct-shell.tsx`; photo drop `response-input.tsx:563-584`.
- **PF-11** — `apps/web/app/scan/[token]/page.tsx:102-110,144-171` derives
  only description/location; no media/site fields; hardcoded English copy
  (`:19-22`).
- **PF-13** — `AddActionDialog` (`observations/[observationId]/page.tsx:1342-1465`)
  vs `createFromIssue` skipping `computeAutoDueAt` (`actions.ts:969` vs
  `:787,888`).
- **PF-14** — no sidebar hrefs for templates/schedules/approvals/maintenance
  (`site-sidebar.tsx:91-105`); invite lands on `/templates`
  (`invite-accept-card.tsx:124`, `sign-up-card.tsx:163`).
- **PF-15** — composer leaves scheduled as draft "for the schedule job"
  (`heads-up/new/page.tsx:392-394`); no heads-up queue (`queues.ts`);
  reminder link `headsUps.ts:948-949`.
- **PF-16** — `reminderDays` stored (`documents.ts:105,361`), UI
  (`documents/new/page.tsx:543-556`), no worker reads it.
- **PF-17** — zero `assets` references in `packages/db/src/schema/fire-safety.ts`.
- **PF-18** — asset page shows programs only (`assets/[assetId]/page.tsx:106-169`);
  `maintenance-tick.ts:79` filters `planType='time'`;
  `maintenance-notify.ts:87-91` emails all tenant users.
- **PF-19** — no compliance read in `contractors.ts:932-963` (checkIn),
  `:1222-1287` (selfCheckIn), `:843-883` (walk-in); induction gate
  client-side only (`portal/page.tsx:58-87`); one comment-only contractor
  reference in permits (`permits.ts:1296`).
- **PF-20/21/22** — no `locale` column in any schema; locale hardcoded
  (`email.ts:13-14`); translation coverage measured per-namespace across all
  10 bundles (riskAssessments ~97% EN ×9, contractors 100% EN ×9, settings
  ~80% EN ×9, fireSafety translated only in it); `nav` namespace lacks
  `fireSafety` in all bundles + overrides (verified by hand); FreeHS override
  files English in all locales (deep-merged over base → regression);
- **PF-23** — 16 workers, 4 recipient models, no prefs table, no bell in
  `site-header.tsx:67-87`.
- **PF-24** — `ai-agent.ts` tool list: zero references to
  riskAssessments/coshh/permits/fire/contractors/sites; home redirect
  `[locale]/page.tsx:24-26`.
- **PF-25** — `KNOWN_STATUSES` omits `awaiting_signature_workflow`
  (`conduct-shell.tsx:58-64`); list filter + `statusLabel` omit it
  (`inspections/page.tsx:60-75,324-339`); `notify.timing` never read;
  `requireNote` never enforced; slots skipped when workflow enabled
  (`inspections.ts:1046-1101`).
- **PF-26/29** — `document_access` never consulted on reads
  (`documents.ts:614-674` write-only); `.length(26)` on 30-char user IDs:
  `documents.ts:168`, `assets.ts:80,92`.
- **PF-27** — no `useHasPermission` in `site-sidebar.tsx`; Standard seed has
  no contractors key (`seed.ts:28-53`).
- **PF-28** — `siteMedia.ts:70-109`, `sitePlans.ts:216-286` gated on
  `sites.view`.
- **PF-30** — `approvals.ts:31,71`: `inspections.manage` only, no author
  check, no notifications.
- **PF-31** — `org.audit.view` consumed nowhere; no tenant export
  (`exports.ts` is inspection-only); anonymisation worker stub
  (`user-anonymisation.ts:11-14`); retention exists only in comments.
- **PF-32** — `users.ts:404-405` ("A Forma360 administrator");
  `headsUps.ts:1160-1234` (flags unenforced), `share.ts:118` (`void now`);
  `observations/[observationId]/page.tsx:1533-1539` (priority column copy).

### Suggested sequencing
1. **Today:** PF-1 (register the four templates + registry test + fix
   stamp-before-notify). PF-22 (one nav key). PF-29 (two Zod one-liners).
2. **This sprint:** PF-2 (actions source labels/links/filter), PF-4 (assigned/
   overdue action emails), PF-12 (fix both observation links + QR alert
   routing), PF-7/8 (settings gate + matrix i18n + permission backfill
   migration).
3. **This quarter:** PF-3 (missed-occurrence sweeper + my-schedule view),
   PF-5 (one cross-module dashboard — the needs-attention strips already
   compute the numbers), PF-6 + PF-24 (index and teach the brand modules to
   search and the assistant), PF-10 (PWA + offline for permits/logbook),
   PF-19 (compliance gate at check-in), notification story (PF-20/23).

---

*Prepared as an independent practitioner review of the complete FreeHS
platform, following the module reviews of Risk Assessments, COSHH, Permits and
Fire Safety. Findings verified against the shipped implementation on `main`
via a systematic three-track code survey, with the two most serious findings
re-verified by hand; file:line pointers included so each item can be triaged
directly.*
