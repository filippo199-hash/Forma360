# Forma360 — Phased Build Plan

> A competitor to SafetyCulture. Mobile-first where it matters, desktop-first where it doesn't, i18n from day one, Railway-deployed, built with Claude Code module-by-module with tests.
>
> Source of truth for features: `docs/modules-overview.html`
> Source of truth for tests and edge cases: `docs/edge-cases.html`

---

## Core principles (applies to every phase)

1. **One monorepo, one database, one API.** Modules are folders, not services. Splitting prematurely turns every cross-module test (X-01..X-15) into a distributed-systems problem.
2. **Tests come from the spec.** Every edge-case ID in `edge-cases.html` (e.g. `T-E01`, `I-E03`, `X-E04`) has a corresponding test file. Test is written first and fails; then implementation makes it pass.
3. **i18n plumbing day one, translations day last.** Every user-facing string is `t('key')` from the first line of code. English-only at launch, other 9 languages added as JSON files before public release.
4. **Design target per module, not per app.** Admin/authoring screens are desktop-first. Field-worker flows (inspect, report issue, sign briefing, scan asset) are mobile-first. One responsive Next.js web app; Expo mobile wrapper added in Phase 6.
5. **Permissions at the tRPC boundary.** Every router procedure is wrapped by a permission check. No permission logic in React components. Server is the only source of truth for access.
6. **Multi-tenancy is non-negotiable.** Every table has `tenant_id`. Every query is scoped by `tenant_id`. Indexed `(tenant_id, ...)` composite indexes on all major tables.
7. **Forward-only migrations.** Drizzle migrations are timestamped and never edited once merged. Every feature branch gets its own Railway preview environment with a fresh DB.
8. **Cascade previews on destructive actions.** Archiving sites, deactivating users, archiving templates all need a "here's what depends on this" summary before confirming. Build a generic `getDependents(entity, id)` helper early, reuse everywhere.
9. **No premature microservices, no premature search engine, no premature CQRS.** Postgres with good indexes carries you to 10M rows. BullMQ handles async. That's the architecture.

---

## Tech stack — locked decisions

| Concern | Choice | Why |
|---|---|---|
| Frontend web | Next.js 16 (App Router) + React 19 | Best-in-class SSR, Claude Code writes it fluently. Locked to 16 per ADR 0005. |
| Frontend mobile | Expo (React Native) — Phase 6 | Needed for real offline, camera, QR, GPS, push |
| API | tRPC | End-to-end types, zero API duplication, great DX |
| DB | Postgres 16 | Battle-tested, `pg_trgm` + tsvector for search |
| ORM / migrations | Drizzle | Type-safe, forward-only, migration-first |
| Validation | Zod at every boundary | Shared types front↔back, runtime safety |
| Auth | better-auth | Sessions, SSO, MFA, password reset out of the box |
| Cache / queue | Redis + BullMQ | Notification batching, compliance re-evaluation, scheduled jobs |
| Object storage | Cloudflare R2 | S3-compatible, near-zero egress cost |
| i18n | next-intl | App Router-native, ICU format, lazy-loaded locales |
| UI | shadcn/ui + Tailwind | Copy-paste components, no vendor lock, mobile-friendly |
| Email | Resend | Transactional email, simple API, good deliverability |
| Observability | Sentry + Railway logs | Errors + traces + metrics to start |
| Package manager | pnpm workspaces | Fast, deterministic, monorepo-native |
| Testing | Vitest + Playwright | Unit/integration + E2E |
| Deploy | Railway | Single-platform infra for MVP. Move Postgres to Neon if growth demands it. |

---

## Repo skeleton

```
forma360/
├── CLAUDE.md                   ← Read every session: stack, conventions, spec pointers
├── docs/
│   ├── modules-overview.html   ← Feature spec (source of truth)
│   ├── edge-cases.html         ← Tests + edge cases (source of truth)
│   └── adr/                    ← Architecture decision records
├── apps/
│   ├── web/                    ← Next.js 16 app (admin + responsive field UI)
│   └── mobile/                 ← Expo app (Phase 6)
├── packages/
│   ├── api/                    ← tRPC routers, one folder per module
│   │   ├── routers/
│   │   │   ├── templates.ts
│   │   │   ├── inspections.ts
│   │   │   ├── issues.ts
│   │   │   └── ...
│   │   └── trpc.ts
│   ├── db/                     ← Drizzle schema + migrations
│   │   ├── schema/
│   │   │   ├── tenants.ts
│   │   │   ├── users.ts
│   │   │   ├── groups.ts
│   │   │   ├── sites.ts
│   │   │   └── ...
│   │   └── migrations/
│   ├── auth/                   ← better-auth config, session helpers
│   ├── i18n/                   ← next-intl config, locale JSON files
│   │   ├── messages/           ← UI strings (one file per locale)
│   │   │   ├── en.json
│   │   │   ├── es.json
│   │   │   └── ...
│   │   └── emails/             ← email templates (subject/preheader/body)
│   │       ├── en/
│   │       │   ├── verification.json
│   │       │   └── password-reset.json
│   │       └── ...
│   ├── ui/                     ← shadcn components shared across apps
│   ├── jobs/                   ← BullMQ worker processes
│   │   ├── workers/
│   │   │   ├── notifications.ts
│   │   │   ├── compliance-eval.ts
│   │   │   ├── schedule-runner.ts
│   │   │   └── digest.ts
│   │   └── queues.ts
│   ├── permissions/            ← Permission-set engine, policy checks
│   └── shared/                 ← Zod schemas, enums, constants, utils
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── railway.json
```

---

## Railway topology

Single project, six services, all communicating over private networking:

1. **web** — Next.js app (public domain)
2. **worker** — BullMQ worker process (no public domain). Runs all scheduled jobs as BullMQ repeatable jobs, including the nightly `pg_dump` → R2 backup.
3. **cron** — Reserved Railway service, defined but empty in Phase 0. Reserved for future long-running scheduled work that doesn't fit inside the worker process (e.g. backfills). See ADR 0006.
4. **postgres** — Primary DB (private only + Railway backups + nightly `pg_dump` → R2)
5. **redis** — Queue + cache (private only)
6. **r2** (external) — Object storage for photos/videos/PDFs/signatures

Each feature branch gets its own Railway preview environment with an isolated Postgres, so migrations are tested against a real DB before merging.

---

# The Phases

Ten phases. Each phase is a coherent deliverable, has a clear exit criterion, and produces working software. Estimates are for one engineer plus Claude Code, full-time; halve or double based on your speed.

---

## Phase 0 — Foundation & Scaffolding

**Goal:** A running "hello world" with every piece of infra wired up. No product features yet — but every subsequent phase slots in without friction.

**Estimated duration:** 1 week

**Deliverables:**
- Monorepo initialised (pnpm + Turborepo)
- Next.js 16 app deployed to Railway with custom domain
- Postgres + Redis provisioned, private networking verified
- Drizzle configured with first migration (empty `tenants` table)
- tRPC wired end-to-end (one `ping` procedure)
- better-auth configured with email/password
- next-intl configured, English-only, one test string rendered via `t()`
- shadcn/ui initialised, theme tokens defined (light + dark)
- BullMQ worker process running, one test job enqueued and processed
- R2 bucket created, signed-URL upload/download test passing
- Resend configured, test email sent
- Sentry configured, test error captured
- Playwright + Vitest set up, one test of each passing
- GitHub Actions CI: typecheck + lint + test + migrations on every PR
- Railway branch deployments enabled
- `CLAUDE.md` drafted with stack, conventions, spec pointers, module order
- Daily automated `pg_dump` → R2 cron

**Exit criterion:** You can push a branch, get a preview URL, log in with a test account, and see "Hello {name}" rendered from the DB via tRPC, in English, with theme switching.

**Key files created:**
- `CLAUDE.md`
- `packages/db/schema/tenants.ts`
- `packages/api/trpc.ts`
- `apps/web/app/[locale]/page.tsx`
- `.github/workflows/ci.yml`

---

## Phase 1 — Organisational Backbone (Groups, Sites, Users, Permissions)

**Goal:** The data and permissions model that every other module will depend on. Build this wrong and you will refactor it six times.

**Estimated duration:** 2 weeks

**Deliverables:**

### 1.1 Core tenant & user model
- `tenants` table (one row per company — per-company pricing model, not per-seat)
- `users` table with custom user fields (role, department, shift, etc.)
- `sessions`, password reset, MFA via better-auth
- User activation / deactivation (soft delete, data retained)
- GDPR data anonymisation tool (S-E09)

### 1.2 Permission sets
- Granular permission catalogue (e.g. `templates.create`, `issues.settings`, `actions.manage`, ~80 permissions total)
- `permission_sets` table with JSON array of permission keys
- Default sets seeded: Administrator, Manager, Standard
- Custom permission set creation
- Assignment: exactly one permission set per user
- `requirePermission(perm)` middleware on every tRPC procedure
- Block deletion of permission sets with users assigned (S-E01)
- Block last-admin from downgrading themselves (S-E02)

### 1.3 Groups
- `groups` table, `group_members` join
- Manual membership
- CSV bulk add/remove
- **Rule-based membership** (auto-add/remove by custom user field match)
- Limits enforced: 5 rules/group, 15,000 users/rule-based group, 100 groups/user
- Block custom-field deletion when referenced by membership rules (S-E04)

### 1.4 Sites
- `sites` table with parent_id self-reference (hierarchy: Country → Region → Area → Site)
- Up to 50,000 sites per tenant
- `site_members` join
- Custom site labels (rename "Site" → "Branch", etc.)
- Site Matrix view (grid of users × sites)
- Rule-based site membership
- Site archival with cascade preview (X-E02)
- Move a site within the hierarchy preserves all linked data (G-17)

### 1.5 Advanced access rules
- Combine group + site membership ("Auditors group AND Manchester site")
- Reusable policy primitive — called by templates, inspections, issues, actions, training in later phases
- Invalid-access-rule detection when a group is deleted (G-E06)

### 1.6 Settings admin shell
- Settings page with section routing (Groups, Sites, Permissions, Users, plus placeholders for future modules)
- Standard-user Settings page (personal only: name, email, password, timezone, language, notifications, memberships read-only)
- CSV bulk user import with upsert semantics (S-E05)
- Full user list CSV export

### 1.7 `getDependents(entity, id)` helper
- Generic function returning "what depends on this entity?" for cascade previews
- Registered by each module as they're built; used by every destructive action

**Tests mapped:** `S-01` through `S-17`, `G-01` through `G-19`, and edge cases `S-E01` through `S-E09`, `G-E01` through `G-E09`.

**Exit criterion:** An admin can create a tenant, invite users via CSV, create groups (manual and rule-based), create a site hierarchy, assign memberships, create a custom permission set, and see all destructive actions blocked or previewed correctly.

---

## Phase 2 — Core Loop Part 1: Templates & Inspections

**Goal:** The heart of the product. Build a template, conduct an inspection, get a report out. This is the feature people pay for.

**Estimated duration:** 3 weeks

**Deliverables:**

### 2.1 Template authoring (desktop-first)
- Template builder UI: drag-and-drop sections, pages, questions
- All ~30 question types (text, number, multiple choice, checkbox, slider, date, time, media, signature, instruction, site, asset, location, weather, etc.)
- Global Response Sets
- Per-question logic rules (show/hide, require, score)
- Per-question triggers (create action, flag, notify)
- **Template versioning** — every save is an immutable version (T-E04)
- Template access rules (groups + sites)
- Template archival with dependency summary (X-E07)
- Template duplication
- Template import/export (JSON)

### 2.2 Scheduling
- Recurring inspection schedules (daily, weekly, monthly, custom cron)
- Assign to users, groups, or sites
- Missed-schedule handling (T-E03 duplicate-on-sync resolution)
- Schedule pause/resume

### 2.3 Inspection conducting (mobile-first)
- Inspection list (scoped by site, permission, assignment)
- Conduct inspection UI: responsive, works great on phone
- Draft autosave every 30s
- Photo capture, annotation, compression
- GPS capture
- Inspection snapshots the template version at start (T-E04)
- Multi-signature support (sequential and parallel)
- Signer deactivation edge case (T-E01)
- Duplicate-signer validation (T-E02)
- Approval page
- Completion marks inspection immutable

### 2.4 Inspection output
- Inspection profile page: overview, responses, media, activity log, linked items
- PDF report generation (server-side render via BullMQ job)
- Public share link (expiring, revocable)
- CSV export with reference IDs for linked items (X-E08)
- Custom views with filters (site, date, template, status, flagged)
- Bulk export

### 2.5 Deletion & archival
- Soft delete with admin confirmation + cascade preview (X-E05)
- Deleted inspections break gracefully when referenced by issues/actions/compliance/assets

**Tests mapped:** `T-01` through `T-XX` in the test plan, plus edge cases `T-E01` through `T-E10`.

**Exit criterion:** A manager can build a real inspection template with branching logic, a field worker can conduct it offline-ish (autosave + reconnect, not true offline yet), sign it, submit it, and download a polished PDF.

---

## Phase 3 — Core Loop Part 2: Issues

**Goal:** The capture surface for hazards, near-misses, and observations. Cross-links to Phase 2's inspections and Phase 4's actions.

**Estimated duration:** 2 weeks

**Deliverables:**

### 3.1 Issue categories (desktop admin)
- Category creation with per-category config
- Custom fields (visible/required per category)
- Custom questions (up to 10 per category, text or multiple choice)
- Access rules ("Report only" / "Report + view" / full edit)
- Notification rules (Private / Summary / Detailed)
- Critical Alerts (bypass DND)
- Linked templates (up to 25 per category)

### 3.2 Issue reporting (mobile-first)
- Category picker
- Title + dynamic form rendering based on category config
- GPS, photo, video, PDF attachments
- Weather autofetch
- Submit → logged with timestamp + notifications fire

### 3.3 Issue QR codes
- QR generation per category (optionally pre-filled with site)
- Public URL for contactless reporting (no login required)
- Rate limiting + spam protection on public submissions

### 3.4 Issue profile (responsive)
- Three tabs: Overview, Files, Activity
- Comments, file uploads, field updates
- Full audit trail (who changed what, when)

### 3.5 Cross-module creation
- Start inspection from issue (pre-linked template list)
- Create action from issue (auto-linked)
- Each appears in the issue's Overview tab

### 3.6 Investigations
- Create investigation from issue
- Link multiple related issues, inspections, media
- Own workspace, access controls, audit trail

### 3.7 Issue output
- Public share link, PDF export
- Custom views with filters
- Bulk operations

**Tests mapped:** `I-01` through `I-XX`, edge cases `I-E01` through `I-E08`.

**Exit criterion:** A worker scans a QR code on a wall, files a near-miss with a photo in under 30 seconds; the category owner gets notified; a manager opens the issue, starts a linked inspection, and everything is cross-referenced.

---

## Phase 4 — Core Loop Part 3: Actions

**Goal:** Turn findings into follow-through. Cross-links to everything.

**Estimated duration:** 2 weeks

**Deliverables:**

### 4.1 Action types & fields (admin)
- Custom action types ("Corrective Action", "Work Order", "Preventive Maintenance", etc.)
- Per-type required and custom fields (text, currency, date/time)
- Priority levels with auto-calculated due dates (e.g. High = 24h)
- Custom statuses with transition controls
- Labels

### 4.2 Action creation entry points
- From inspection question (notes/media carry over, logic can require)
- From issue (auto-linked)
- From asset profile (Phase 5 — wire up later)
- From maintenance table (Phase 5)
- From sensor alert (Phase 5)
- Standalone
- Duplicate detection (same template + site + question → "possible duplicate" indicator, X-E04)

### 4.3 Recurring actions
- Schedule recurring standalone actions
- Pause/resume

### 4.4 Action management
- Action list with filters (status, priority, assignee, site, due date)
- Bulk assign, bulk status change, bulk reassign
- Action detail with comments, files, activity log
- Merge duplicate actions (X-E06)

### 4.5 Notifications
- Assignment, due-soon, overdue notifications
- User preferences honoured
- Batching when >N notifications in 5 min (X-E03)

### 4.6 Closing the loop
- Mark complete (with optional resolution notes, photos)
- Reopen
- Automatic status updates when linked source changes (e.g. source inspection deleted → "Source inspection deleted" indicator, X-E05)

**Tests mapped:** `A-01` through `A-XX`, edge cases `A-E01` through `A-E0X`.

**Exit criterion:** An inspector flags a broken extinguisher during an inspection, an action is auto-created and assigned with a 24h due date, the maintenance tech gets a push notification, completes the action on their phone with a photo, and the loop is closed with full traceability.

---

## Phase 5 — Ambient Modules: Heads Up, Assets & Maintenance, Documents

**Goal:** The three supporting modules that sit on top of the core loop. Can be built in parallel or sequentially; they're largely independent.

**Estimated duration:** 4 weeks (can parallelise to ~2.5 if you have help)

### 5A — Heads Up

- Heads Up authoring (desktop): text, images, video, PDF attachments
- Target audience: users, groups, sites (combinations)
- Acknowledgement request (read receipt)
- Signature request
- Quiz questions (multiple choice)
- Scheduled publishing
- Expiry dates
- Heads Up feed (mobile-first consumption)
- Delivery tracking: sent, read, acknowledged, signed
- Notifications (batched per X-E03)
- Analytics: reach, engagement, signature rates

### 5B — Assets & Maintenance

- Asset types with custom fields
- Asset register (single + bulk CSV add)
- Parent-child asset hierarchy (nested sub-assets)
- Asset profiles with full activity timeline
- Asset QR codes (scan to start inspection, create action, log reading)
- Readings (odometer, hours, cycles) from inspections or manual entry
- **Time-based maintenance plans** (every N days)
- **Usage-based maintenance plans** (every N km/hours)
- **Combined maintenance plans** (whichever comes first)
- Maintenance table (all plans, all assets, flat view)
- Create action from maintenance row
- Overdue maintenance indicators propagate to parent asset (X-14)
- Live Map for telematics-enabled assets (Phase 2+ if integration-only)
- Telematics integration interface (deferred to Phase 7)

### 5C — Documents

- Upload (PDF, Word, images, etc.)
- Folder hierarchy with subfolders
- Labels for additional categorisation
- Per-file and per-folder access control (users + groups)
- Site assignment for filtering (not access control)
- Version history
- Document freshness tracking (for Phase 8 compliance rules)
- Search (Postgres tsvector on filename + extracted text)
- PDF preview inline

**Tests mapped:** `H-01..`, `AS-01..`, `D-01..`, plus their edge cases.

**Exit criterion:** A manager publishes a Heads Up requiring signatures on an updated SOP document; every targeted user gets it in their feed; meanwhile, the fleet manager's excavator hits 500 hours, a maintenance plan flips to "Due", and a work-order action is created automatically.

---

## Phase 6 — Mobile App (Expo) + Offline Sync

**Goal:** A real native mobile app for the flows that need it. Offline sync for field workers with poor connectivity.

**Estimated duration:** 4 weeks

**Deliverables:**

### 6.1 Expo app foundation
- Expo Router matching web routes where it makes sense
- Shared UI components from `packages/ui` (via `react-native-web`-compatible subset or duplicated mobile variants)
- Auth flow (login, MFA, password reset, biometric unlock)
- Push notifications (Expo Push → APNs/FCM)
- Deep linking (QR codes open app)
- App Store + Play Store metadata, screenshots

### 6.2 Mobile-first features (native capabilities)
- Camera with in-app annotation
- QR/barcode scanner (assets, issues)
- GPS
- Signature pad
- Biometric auth
- Background location (lone worker)
- Offline file cache for documents

### 6.3 Offline sync
- Local SQLite mirror for inspections, issues, actions, documents, assets
- Outbox pattern for writes
- Conflict detection on sync (T-E03, X-E06)
- Merge UI for conflicts
- Sync status indicator in app chrome
- Background sync on reconnect

### 6.4 Mobile-specific UX
- Bottom tab navigation: Home, Inspections, Issues, Actions, More
- Pull-to-refresh everywhere
- Swipe gestures (archive, assign, complete)
- Haptics on key actions

**Tests mapped:** All `Offline`-category tests across every module plus a dedicated offline E2E suite.

**Exit criterion:** A field worker in a basement with no signal can open the app, conduct a full inspection with photos and signatures, log an issue, tick off actions, and it all syncs cleanly when they surface — with conflict handling for anything edited by others.

---

## Phase 7 — Analytics

**Goal:** Turn six modules of operational data into dashboards people actually use.

**Estimated duration:** 3 weeks

**Deliverables:**

### 7.1 Data model
- Materialised views or Postgres views per data source (inspections, issues, actions, heads-up, assets, maintenance, training — training deferred to Phase 10)
- Refresh strategy (near real-time for primary metrics, hourly for rollups)

### 7.2 Chart builder
- Data source picker
- Metric picker (count, sum, avg, percentile, ratio)
- Dimension picker (grouping)
- Filter builder (site, date range, category, assignee, custom fields)
- Chart type (bar, line, pie, table, single number, heatmap, funnel)
- Live preview

### 7.3 Dashboards
- Grid layout with drag-to-resize
- Multiple dashboards per user
- Dashboard sharing (users, groups, everyone)
- Public share link (read-only, expiring)
- Global dashboard filters (site, date range)

### 7.4 Dashboard templates
- Inspection Performance
- Issue Management
- Action Tracking
- Heads Up Engagement
- Asset & Maintenance
- Compliance Overview (Phase 8)
- Team Compliance

### 7.5 Drill-down
- Click any chart element → filtered list of underlying records
- From drill-down: take action (update, start inspection, create Heads Up)

### 7.6 Scheduled reports
- Weekly/monthly CSV emailed to distribution lists
- Configurable filters per report

**Tests mapped:** `AN-01..`, `X-12` (cross-module analytics with global site filter).

**Exit criterion:** A regional manager opens the Safety Performance dashboard, sees overdue actions at Manchester, clicks the bar, sees the three overdue items, reassigns one — all inside the dashboard.

---

## Phase 8 — Compliance

**Goal:** The Vanta-inspired compliance layer. Automated evidence collection from every module. This is a *read layer* — it queries existing data, it does not duplicate it.

**Estimated duration:** 3 weeks

**Deliverables:**

### 8.1 Core model
- `frameworks` (ISO 45001, ISO 9001, custom, etc.)
- `compliance_rules` (belongs to framework, defines evidence requirements)
- `compliance_evaluations` (cached result of a rule on a given period)

### 8.2 Rule evidence types
- Inspection completed (of template X, at frequency Y)
- Issue resolved within SLA
- Action completed (of type X)
- Heads Up signed (by group X)
- Asset maintenance plan not overdue
- Document fresh (not older than N days)
- Training completed (deferred to Phase 10)
- Custom combinations

### 8.3 Rule evaluation engine
- BullMQ worker that re-evaluates a rule when underlying data changes
- Rule → query over Phase 2–5 data → status (Compliant / Non-Compliant / Not Evaluable / Due Soon)
- Cache result with timestamp
- Handle "linked template archived" → rule becomes Not Evaluable (C-E02)
- Handle deleted evidence → rule reverts (C-E07)
- Handle one inspection satisfying rules in two frameworks (C-E11)

### 8.4 Framework management
- Framework templates (ISO 45001, ISO 9001, UK HSE, OSHA, blank)
- One-click import from template
- Per-rule: frequency, sites scope, responsible group, evidence link
- Custom rule builder

### 8.5 Compliance dashboard
- Framework cards with current score
- Rule-by-rule breakdown
- Evidence drill-down (click a rule → see every inspection/action/etc that satisfied it)
- Trend lines over time
- Goals (target compliance %)
- Non-compliant alerts with escalation
- Report export (PDF + CSV)

### 8.6 Site + group scoping
- Rules scoped to sites
- Responsibilities assigned to groups
- Roll-up views across site hierarchy

**Tests mapped:** `C-01` through `C-24+`, edge cases `C-E01` through `C-E11`, plus `X-03`, `X-14`, `X-15`.

**Exit criterion:** An ops manager imports the ISO 45001 framework template, links it to their existing inspection templates and training, and watches the compliance score populate in real time as their team does their normal work — with zero extra data entry.

---

## Phase 9 — Cross-Module Polish & Performance

**Goal:** Everything from the cross-module test plan (`X-01` through `X-15`) works correctly. Performance is production-ready.

**Estimated duration:** 2 weeks

**Deliverables:**

### 9.1 Notification batching & digests (X-E03)
- Per-user notification preferences (push, email, in-app per event type)
- 5-minute batching window
- Daily digest email
- Do Not Disturb with Critical Alert override

### 9.2 Cross-module cascade handling
- Template archival cascade (X-E07) verified across all referencing modules
- Site archival cascade (X-E02)
- User deactivation cascade (S-E08) — bulk reassignment UI
- Inspection deletion cascade (X-E05)

### 9.3 Search
- Global search with Postgres tsvector
- Cross-module results (templates, inspections, issues, actions, documents, assets, users)
- Permission-aware (you only see what you can access)

### 9.4 Performance
- Every list paginated (cursor-based)
- Indexes audit: every `(tenant_id, ...)` query has a composite index
- N+1 query audit via Drizzle query logging
- 10,000-user tenant load test (S-16)
- 50,000-site tenant load test
- 200-rule-compliance-dashboard load test (C-21)

### 9.5 Export depth (X-E08)
- Every CSV export includes reference IDs + names for cross-module links
- "Deep export" tool that combines multiple data sources for compliance auditors

### 9.6 Audit log
- Every mutation logged with actor, before/after, timestamp, IP
- Audit log viewer in Settings (admin only)
- Retention policy configurable per tenant

**Tests mapped:** All `X-01` through `X-15` cross-module tests.

**Exit criterion:** The full end-to-end flow in `X-01` (report issue → inspection → action → Heads Up) works. Notification storm test passes. 10k-user tenant test passes.

---

## Phase 10 — Internationalisation & Launch Prep

**Goal:** Ship in 10 languages. Get paying customers.

**Estimated duration:** 2 weeks (plus translation vendor turnaround)

**Deliverables:**

### 10.1 Translation completion
- Extract every `t('key')` call into master `en.json`
- Send to translation vendor (Lokalise, Crowdin, or similar)
- Receive and commit 9 other locale files: es, fr, de, pt, it, nl, pl, ja, zh
- QA pass per locale (native speaker ideally)
- RTL support audit (if Arabic added later)

### 10.2 Locale-aware formatting
- Dates, times, numbers, currencies via `Intl.*`
- First-day-of-week by locale
- Timezone handling per user preference
- Unit preferences (km vs miles, C vs F, kg vs lb)

### 10.3 Language picker
- Per-user language setting in Settings
- Tenant default language
- Auto-detect from browser on first visit

### 10.4 Training module (deferred from earlier phases — minimal version)
- Course builder (video + PDF + quiz)
- Assignment (to groups)
- Completion tracking
- Certification issuance
- Feeds compliance rule engine (training-based evidence)

Training gets a minimal v1 here because multiple compliance tests reference it, but full LMS features (learning paths, paths, re-certification cycles, external SCORM) are v2.

### 10.5 Marketing site
- Landing page
- Pricing page (per-company model explained)
- Docs site
- Demo request / free trial sign-up
- Customer success onboarding emails

### 10.6 Launch prep
- Status page (e.g. BetterStack)
- Customer support tool (Intercom, Plain, or Crisp)
- Help centre content (at least 30 articles covering each module)
- Security page + SOC 2 Type I kickoff
- GDPR DPA template for customers
- Terms of service, privacy policy, DPA, cookie policy
- Billing (Stripe — per-company subscription)
- Referral / affiliate program (optional)

**Exit criterion:** Your website is live, a prospect can sign up, start a trial, see the whole product in their language, invite their team, and pay you money.

---

# What each phase needs as inputs

When we generate the per-phase prompts later, each prompt will need:

1. **The two HTML spec docs** — `modules-overview.html` and `edge-cases.html`
2. **This plan** — for ordering context
3. **The `CLAUDE.md`** — for stack and conventions
4. **The previous phase's output** — so Claude knows what already exists
5. **The specific phase scope** — carved out from this plan
6. **The test IDs** this phase must cover (mapped above)

---

# Risks & pre-commitments

Things to decide now so we don't reinvent them later:

| Risk | Decision |
|---|---|
| Railway Postgres data-loss reports | Railway backups on + nightly `pg_dump` → R2. Move to Neon if we hit $1M ARR. |
| Template versioning retrofit pain | Immutable versions from day 1 of Phase 2. No editing in place, ever. |
| i18n retrofit pain | Every string wrapped in `t()` from Phase 0. No exceptions. |
| Permission-in-UI drift | Permissions enforced only at tRPC layer. UI hides things for UX, not security. |
| Offline sync complexity | Not in v1. Phase 6 only. Web app is online-only through Phase 5. |
| Compliance module becomes a second database | It's a read layer. No writes to operational tables from compliance code. |
| Notification storm at 10k users | Batching built in Phase 4, stress-tested in Phase 9. |
| Search engine temptation | No Meilisearch/Typesense until tsvector provably can't keep up (10M+ rows). |
| Mobile-first over-reach | Template builder, compliance matrix, analytics dashboards are desktop-first. Don't let Tailwind's `sm:` prefix push you into responsive-everything hell. |

---

# Rough overall timeline

| Phase | Duration | Running total |
|---|---|---|
| 0 — Foundation | 1 wk | 1 wk |
| 1 — Org backbone | 2 wks | 3 wks |
| 2 — Templates & Inspections | 3 wks | 6 wks |
| 3 — Issues | 2 wks | 8 wks |
| 4 — Actions | 2 wks | 10 wks |
| 5 — Heads Up + Assets + Documents | 4 wks | 14 wks |
| 6 — Mobile app + offline | 4 wks | 18 wks |
| 7 — Analytics | 3 wks | 21 wks |
| 8 — Compliance | 3 wks | 24 wks |
| 9 — Cross-module polish | 2 wks | 26 wks |
| 10 — i18n + launch | 2 wks + vendor | ~28 wks |

**Approximately 6–7 months of focused work for a public launch with all 10 modules.** Earlier private beta at end of Phase 5 (14 weeks / ~3.5 months) — enough to validate product-market fit with design partners before investing in the mobile app, analytics, and compliance.

---

# What's next

For each phase, we'll write a dedicated prompt that covers:
- Scope (copy-pasted from above)
- Specific deliverables checklist
- Test IDs to cover (from `edge-cases.html`)
- Expected file layout changes
- Definition of done
- Handoff artifacts for the next phase

Phase 0 is the first prompt to generate. Its output is the scaffolding every other phase builds on.
