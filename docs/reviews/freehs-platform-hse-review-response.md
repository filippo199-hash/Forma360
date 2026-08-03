# FreeHS platform HSE expert review — engineering response

Disposition of all 32 findings in
[`freehs-platform-hse-expert-review.md`](./freehs-platform-hse-expert-review.md)
(four-practitioner whole-platform review). Work was sequenced by the
review's own "today → this sprint → this quarter" priority order,
grouped into eight delivery waves (A–H). Every finding below links the
fix, the tests that prove it, and its status.

**Status legend** — ✅ Resolved · 🟡 Partially resolved (remaining scope
stated) · every fix carries edge-case-ID'd tests per the house rule
"the test comes first".

---

## Wave A — the "today" tier

### PF-1 (Critical) — Four unregistered email templates; permit dedup stamp burned before delivery ✅
- `EMAIL_TEMPLATES` registry now contains all templates on disk
  (29 entries); `EMAIL_TEMPLATE_KEYS` is exported and a
  registry-completeness test (`packages/shared/src/email.test.ts`)
  readdir-scans `emails/en/` and fails the build if any file is ever
  unregistered again — the class of bug, not just the instance.
- Permit expiry watch (`packages/jobs/src/workers/permit-expiry-watch.ts`)
  now stamps `expiryWarningSentAt` / `expiryEscalatedAt` and writes the
  event **only after ≥ 1 delivery succeeded**; total failure leaves the
  permit unstamped so the next 15-minute tick retries. Test PW-J04.

### PF-22 (High) — `nav.fireSafety` renders the raw key ✅
`nav.fireSafety` added to all 10 locale bundles (and overrides checked).

### PF-29 (Low) — `.length(26)` Zod guards on 30-char user ids ✅
Corrected in `documents.ts` and `assets.ts` (and audited repo-wide).

### PF-32 (Low) — brand leak + unenforced flags ✅
"A Forma360 administrator" copy replaced with the brand-aware product
name; heads-up flag enforcement and the `share.ts` `void now` tidied.

## Wave B — the Actions hub (PF-2/4/9/13)

### PF-2 (Critical) — five source types mislabeled "Standalone" ✅
`actions.get` resolves risk_assessment / coshh_assessment /
fire_risk_assessment / fire_logbook_entry / fire_door_inspection with a
label and a working `href` back-link; list + board chips and the filter
enum carry all nine source types. Test AC-E03/AC-E01.

### PF-4 (Critical) — zero action notifications ✅
Assignment emails on create + reassignment (never self-assignment),
`action-assigned` + `action-due-digest` templates, and the daily
`forma360-action-reminders` worker (06:30): due-within-3-days once,
overdue weekly re-ping; stamps cleared when the due date moves; stamps
written only after delivery. Tests AC-E05/AC-E06 + worker suite. Wave G
added the in-app bell mirror and a per-user email mute.

### PF-9 (High) — 100-row hard cap hides the oldest overdue ✅
`actions.list` gains `offset` + `totalCount` (pager UI included) — every
action is reachable. Test AC-E01.

### PF-13 (Med) — issue→action loses assignee/auto-due/type ✅
`createFromIssue` now accepts `actionTypeId`, validates required custom
questions, applies `computeAutoDueAt`, and the dialog has assignee +
type pickers — full parity with the other create paths. Test AC-E04.

## Wave C — alerts that arrive (PF-12/15/16)

### PF-12 (Critical) — both observation email links broken; QR bypasses alert recipients ✅
Direct path links `/en/observations/{id}` (the `/issues` route never
existed); the queued path builds locale-correct URLs (tenant id removed
from the locale slot); the anonymous QR submission now fans out through
the category's configured critical-alert recipients (same path as
logged-in reports).

### PF-15 (Med/High) — scheduled Heads Ups never publish ✅
`publishHeadsUp` extracted to `packages/api/src/heads-up-publish.ts`
(recipient freeze preserved) and the `forma360-heads-up-publish` worker
(*/5 min) publishes due drafts. Reminder deep-links are locale-prefixed
and recipient-appropriate. Test HU-J01.

### PF-16 (Med) — `reminderDays` stored but no worker reads it ✅
Daily `forma360-document-expiry` worker (06:15): thresholds = each
reminder lead + expiry itself, `lastExpiryReminderAt` dedupe, recipients
= uploader + `documents.manage` holders. Migration 0064. Worker test
suite; Wave G added the bell mirror + email mute.

## Wave D — permissions & onboarding (PF-7/8/14/25/26/27/28/30)

### PF-7 (High) — settings tabs gated on org.settings only ✅
Each tab shows for the permission its page needs (users.invite /
users.manage / permissions.manage / groups.manage /
users.customFields.manage); Managers see the tabs they can use.

### PF-8 (High) — permission matrix raw keys; no backfill ✅
Matrix i18n for all 4 FreeHS modules / 14 keys in all 10 locales;
migration 0065 idempotently backfills the FreeHS keys (and, added in
Wave E, `analytics.view`) into pre-existing system permission sets.

### PF-14 (Med) — orphaned routes; invitees land on /templates ✅
Templates / Schedules / Approvals / Maintenance in the sidebar
(permission-gated); invite acceptance lands on the AI home.

### PF-25 (Med) — signature-workflow status invisible; notify/requireNote dead ✅
`awaiting_signature_workflow` in every status surface (conduct, list
filters, export enum); `requireNote` is enforced at submit (client
click-to-jump + server `missingNotes` gate, 'note-required'); notify
timing documented as delivered-at-submit.

### PF-26 (Med) — `document_access` written but never consulted ✅
`document-visibility.ts`: user/group grants + folder-ancestor walk
enforced on list and get. Router tests.

### PF-27 (Med) — nav shows modules users can't open ✅
`NAV_PERMISSION` map filters the sidebar by module view permission
(admins unaffected).

### PF-28 (Med) — site media/plans gated on sites.view only ✅
Write surfaces re-gated (`sites.manage`).

### PF-30 (Med) — approvals: no self-approval bar, no notifications ✅
Self-approval FORBIDDEN (creator or conductor); decision emails to the
submitter on approve/reject; submit notifies `inspections.manage`
holders. Wave G added bell mirrors.

## Wave E — eyes on the whole (PF-3/5/6/24)

### PF-3 (Critical) — 'missed' never written; vanishing occurrences; no my-schedule ✅
- Hourly `forma360-schedule-missed-sweep`: pending occurrences >24 h
  past due flip to `missed`; assignee + schedule owner emailed
  (deduped); status flip first, email best-effort. Test SCH-J01.
- `inspections.create` links the started occurrence
  (pending/missed → `in_progress`); submit completes it — the "Past
  inspections" table now has data.
- `listUpcoming` includes missed rows (30-day window) and the
  inspections page carries a **My schedule** card with Start buttons and
  missed/overdue badges.

### PF-5 (High) — no dashboard, analytics or reports ✅
`analyticsRouter` (`dashboard` / `trends` / `siteComparison`), gated by
the forward-declared `analytics.view` (backfilled in 0065); `/analytics`
page: needs-attention tiles across every module (brand tiles follow the
ADR 0010 catalogue; the fire tile reuses `fireSafety.overview` so the
semantics live once), 8-week inline-SVG trend charts (no chart
dependency — ground rule 9), site-vs-site table with a reconciling
"no site" row; nav entry in all 10 locales. Tests AN-E01..E05.

### PF-6 (High) — search blind to half the product ✅
Global search covers permits, COSHH substances, risk assessments, fire
buildings, FRAs, contractors, sites and templates — all
permission-gated server-side; Cmd-K categories added.

### PF-24 (High) — AI assistant can't answer about the brand modules; no safety guardrail ✅
Six caller-backed tools (`list_permits`, `list_coshh_substances`,
`list_risk_assessments`, `fire_safety_overview`,
`list_contractors_on_site`, `list_sites`) — routed through tRPC so brand
gating and permissions hold; SYSTEM_PROMPT gains a safety guardrail: the
assistant never declares anything "safe", never authorises work, never
improvises emergency instructions — it reports what the company's own
records say and points to the competent person. Tool-definition tests.

## Wave F — the field (PF-10/11/17/18/19)

### PF-10 (High) — no PWA; offline only in conduct; photos dropped ✅
Manifest + icons + minimal service worker (`/offline` fallback;
navigations network-first; the SW never replays POSTs); localStorage
offline queue with typed replay for fire logbook entries, COSHH
point-of-work chains and permit acceptance — deduped server-side via
`client_request_id` (migration 0066, unique partial indexes; tests
FS-E31, CO-E25); pending chip + auto-flush on reconnect; conduct photo
uploads keep failed files with a visible Retry instead of dropping
them.

### PF-11 (High) — QR page: no photo, site ignored, English-only ✅
Photos (≤3, camera capture) upload through the token-gated
`/api/scan-upload/[token]` route (rate-limited, images only, tenant
prefix enforced; failed uploads retained for retry); the site picker
renders when the category enables it (options shipped in the public
config); the page is served in the visitor's language via
Accept-Language negotiation over all 10 locales (`scanPage` namespace).
Attachments bind with a null uploader (anonymous). Server tests in
`issues.test.ts` (media scope + mime + site).

### PF-17 (Med) — fire equipment split across two systems ✅
`fire_logbook_checks.asset_id` (migration 0066) links a recurring check
to a maintained asset; `fireSafety.logbook.assetHistory` joins the
service history onto the asset page ("Fire safety history" section);
link/unlink control on the fire checks table. Test FS-E30.

### PF-18 (Med) — plans invisible on the asset page; usage plans never notify; emails to whole tenant ✅
Asset page shows maintenance **plans** with live status beside programs;
`maintenance-tick` evaluates usage-based plans (due at
lastServiceValue+interval from the latest reading, 90 % early warning,
same notificationsLog dedup — test MA-J01); `maintenance-notify` goes to
`assets.maintenance.manage` holders (not every user) with a
locale-prefixed link.

### PF-19 (High) — compliance never gates entry; induction client-side; no permits↔contractors join ✅
Staff check-in and walk-ins refuse non-compliant contractors without a
recorded override reason (the previously dead `overrideReason` is now
load-bearing); the kiosk hard-blocks and displays compliance per visit;
induction text is tenant-editable and **versioned**
(`contractor_induction_config`), acknowledgement is version-aware and
enforced **server-side** in `loadContractorScope` (deep links can no
longer skip it — every contractor-scoped read refuses with
`induction_required`); `contractors.visits.onSiteWithOpenPermits` is the
join the review found missing, surfaced on the contractors page. Tests
CG-E10..E13, CI-E01, CV-E10.

## Wave G — platform services (PF-20/21/23/31)

### PF-20 (Med/High) — English-only emails; language not persisted ✅
`user.locale` column (migration 0067) persisted by the settings language
switcher (+ NEXT_LOCALE cookie for future sessions); `TemplatedEmail`
carries the recipient's locale; the loader serves
`emails/<locale>/<key>.json` with silent English fallback; every
digest/alert worker threads the recipient's locale (the
`usersHoldingPermission` helper now returns it). Full translated email
sets shipped for **it, pt, de, es, fr** (29 templates each); a
placeholder-parity test proves every translation keeps the exact EN
variable vocabulary. ja/nl/pl/zh fall back to English until translated.

### PF-21 (Med) — uneven UI translation; FreeHS overrides regress strings 🟡
- FreeHS overrides now carry translated copy in all 9 non-EN locales
  (the regression is gone).
- `contractors` (was 100 % English ×9): fully translated in Italian and
  Portuguese (262 keys each).
- `fireSafety` (was Italian-only): fully translated in Portuguese
  (294 keys; Italian complete).
- Emails: 5 full locales (see PF-20).
- **Remaining scope**, explicitly: contractors/fireSafety in
  de/es/fr/ja/nl/pl/zh; `riskAssessments` (~280 keys) and `settings`
  (~285 keys) namespaces across the 9 non-EN locales; email templates in
  ja/nl/pl/zh. The extraction + parity-test pipeline used for the
  completed batches makes each remaining batch mechanical.

### PF-23 (Med) — no notification centre, prefs or cross-module digest ✅
`notifications` table + router (list / unreadCount / markRead /
markAllRead / prefs / setPref); header bell with unread badge and
popover inbox; per-user email toggles on the profile page. In-app rows
are written by the same code paths that send the emails (action
assignment, approval pending/decided, heads-up publish, action /
document / schedule digests) — a muted email never hides information,
the bell always learns. Tests NT-E01/NT-E02.

### PF-31 (Med/High) — no audit surface, no export, no retention, stub anonymisation ✅
- `admin.auditLog` merges the seven per-module append-only event tables
  into one `org.audit.view`-gated, reverse-chronological feed —
  `/settings/audit` page with module filter + keyset paging. Test AU-E01.
- Tenant data export: `/api/exports/tenant-data` (org.settings) — one
  JSON document, users without auth material.
- Retention v1: `tenants.retentionMonths` + daily
  `forma360-retention-sweep` trimming **notification rows only** —
  statutory safety records are excluded by design, stated in the UI.
  Test RT-J01.
- Anonymisation cascade is real: sessions/accounts/2FA deleted,
  signature strokes + signer-name snapshots blanked (the signed fact —
  row, timestamp, status — is retained as tenant evidence), personal
  notification inbox deleted. Test UA-J01.

---

## Cross-cutting

- **Migrations** 0063–0067, all forward-only and idempotent
  (`migrations-integrity` suite re-applies them); brand-module ALTERs in
  0066 are `to_regclass`-guarded.
- **New workers registered**: action-reminders, heads-up-publish,
  document-expiry, schedule-missed-sweep, retention-sweep; permit
  expiry + fire digest hardened; maintenance tick/notify extended;
  user-anonymisation implemented.
- **New i18n**: ~450 new UI keys ×10 locales for the fixes themselves,
  plus the PF-20/21 translation batches (~1 900 strings).

## What was deliberately scoped (and why)

- **PF-21** remains partially resolved — the remaining ~7 000
  translation strings are catalogued above; shipping machine-quality
  translations of statutory safety copy in bulk was judged worse than
  an honest, tested partial with a repeatable pipeline.
- **Retention v1 (PF-31)** covers the notification centre only. Widening
  retention to safety records is a per-module legal decision, not a
  sweep — the setting's UI copy says exactly that.
- **PF-24 notify timing**: template "immediate" notify semantics are
  delivered-at-submit (documented in Wave D notes); the editor never
  writes any other value.
