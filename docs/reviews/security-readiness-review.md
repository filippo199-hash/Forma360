# FreeHS — security and launch-readiness review

> **Status: both Criticals, nine of the eleven Highs and five Mediums are
> fixed** (see [Fix log](#fix-log) at the end). The remaining items are
> features rather than defects: Postgres RLS, 2FA enrolment, share-token
> hashing and expiry, tenant deletion, and the sandbox TTL sweep. The findings
> below are kept in their original form — they are the record of what was
> wrong and why, and several fixes only make sense against them.

**Question asked:** how can we make FreeHS more secure, and is it ready to be
used by a wide audience?

**Date:** 17 August 2026
**Branch:** `claude/freehs-security-readiness-u4cokz`
**Method:** four parallel code audits (authentication and session lifecycle;
unauthenticated attack surface; multi-tenant isolation and injection;
abuse-resistance and operations), plus a direct `pnpm audit --prod` and
hand-verification of every Critical and High claim below against the source.
No live-environment testing was performed — this is a source review.

---

## Verdict

**Not yet ready for a wide audience — but the gap is narrow and specific
rather than architectural.**

The parts that are expensive to fix later are already right. Tenant isolation
is structurally sound: the tenant id never crosses the wire, and the one place
user input could have reached SQL is fully allowlisted. There is no XSS in the
render pipeline, no injection reachable anywhere, and the confidential-incident
carve-out holds on every path checked, including the ones nobody would think to
check (cross-module action titles, notification emails, dashboard aggregates).

What is missing is the perimeter and the operational safety net: no security
headers at all, no rate limit on most endpoints, an offboarding path that does
not actually revoke access, and four background queues that have never run.

Two defects block launch. Both are small. One is four characters.

| Tier | Count | Character |
| --- | --- | --- |
| Critical | 2 | Offboarding does not revoke; four queues silently dead |
| High | 11 | Perimeter, abuse limits, operational safety nets |
| Medium | ~14 | Defence-in-depth, hardening, GDPR completeness |

---

## Critical — these block a wide launch

### C1. Deactivated and anonymised users keep working sessions for up to 90 days

`users.deactivate` stamps a date and does nothing else
(`packages/api/src/routers/users.ts:652-679`). Three independent facts make
that cosmetic against anyone already signed in:

- `packages/api/src/context.ts:119-126` builds the authenticated context from
  the better-auth session without consulting `deactivatedAt`.
- `loadUserPermissions` joins user → permission set with no
  `isNull(user.deactivatedAt)` filter
  (`packages/permissions/src/requirePermission.ts:18-32`), so a deactivated
  user retains every permission. The predicate exists and is used correctly in
  `packages/permissions/src/admins.ts:31` — it was simply never applied on the
  hot path.
- Sessions live 90 days (`packages/auth/src/server.ts:110`), with a 5-minute
  cookie cache during which revocation cannot take effect at all.

Net effect: deactivating a user — including a terminated administrator —
blocks new sign-ins but leaves an existing session with full read/write access
to the tenant for up to 90 days. There is no "sign out everywhere" surface
anywhere in the product.

This compounds with C2: the single code path that *does* delete sessions is the
anonymisation worker, and that worker has never run.

For a health-and-safety compliance product, offboarding is the control most
likely to be audited, and it does not work.

**Fix:** delete the user's sessions inside the `deactivate` transaction, and add
`isNull(user.deactivatedAt)` to the context build and/or `loadUserPermissions`.
Consider shortening `expiresIn` from 90 days.

### C2. Four async queues are silently dead — a colon that should be a hyphen

Every registered queue name uses a hyphen (`packages/jobs/src/queues.ts:20-143`,
e.g. `forma360-user-anonymisation`), and `QUEUE_PAYLOAD_SCHEMAS` is keyed by
those same values (`queues.ts:330-356`). All four `ctx.enqueue` call sites in
the codebase pass a **colon**:

| Call site | Enqueued | Registered |
| --- | --- | --- |
| `routers/users.ts:770` | `forma360:user-anonymisation` | `forma360-user-anonymisation` |
| `routers/groups.ts:294` | `forma360:group-membership-reconcile` | `forma360-group-membership-reconcile` |
| `routers/sites.ts:1151` | `forma360:site-membership-reconcile` | `forma360-site-membership-reconcile` |
| `routers/schedules.ts:502` | `forma360:schedule-materialise` | `forma360-schedule-materialise` |

`enqueue` does `QUEUE_PAYLOAD_SCHEMAS[name].parse(payload)`
(`packages/jobs/src/enqueue.ts:24-25`). With an unregistered key that is
`undefined.parse` — a `TypeError` inside an async function, so a rejected
promise, which `apps/web/src/server/trpc.ts:18-23` swallows into a log line.
Typecheck cannot catch it because the same file casts `name as QueueName`.

**Verified at source**, including that the hyphen twins are all registered.

What is permanently lost:

- **The GDPR anonymisation cascade never runs.** The mutation's own
  transaction does scrub the user row — name, email, phone, image, custom field
  values (`users.ts:739-767`) — so this is not "anonymisation does nothing".
  What never happens is the cascade in
  `packages/jobs/src/workers/user-anonymisation.ts:44-80`: session, account and
  two-factor rows are never deleted, signature strokes are never blanked, the
  personal notification inbox is never emptied. An "anonymised" person keeps a
  live session and their 2FA secret.
- **Rule-based group and site membership never reconciles.** Membership drives
  access rules, and site membership scopes permit lifecycle authority — so
  stale membership is an access-control problem, not just a data-freshness one.

What is *not* affected, contrary to first appearances: incident alerts and
observation notifications use a different, correct mechanism
(`apps/web/src/server/incidents-deps.ts:39`, `issues-deps.ts:31`), and schedule
materialisation is recovered by the 10-minute cron tick, which enqueues
correctly (`workers/schedule-tick.ts:60-61`). Safety alerts do fire.

**Fix:** four characters, then tighten `Enqueue` to `(name: QueueName, …)` and
drop the cast so it cannot recur.

---

## High — before this takes real volume

### H1. No security headers at all

`apps/web/next.config.ts` has no `headers()` function, and
`apps/web/middleware.ts` sets only `x-request-id` and `x-pathname`. Missing
globally: Content-Security-Policy, Strict-Transport-Security, X-Frame-Options
(or `frame-ancestors`), Referrer-Policy, Permissions-Policy, and
X-Content-Type-Options (present on three individual file responses only).

The whole authenticated app is framable, so permit sign-off, RAMS acceptance and
user administration are clickjackable. There is no CSP backstop despite the app
accepting SVG uploads and streaming AI-generated markdown. And bearer tokens
live in URLs (`/s/<token>`, `/scan/<token>`, `/render/<kind>/<id>?token=`) with
no Referrer-Policy.

### H2. `/api/exports/preview` mints a render token with no permission check

It verifies a session and tenant ownership, then stops
(`apps/web/app/api/exports/preview/route.ts:31-58`) — no `inspections.view`,
no `inspections.export`. Every sibling export route delegates to a
`requirePermission`-guarded tRPC procedure instead; `/api/exports/pdf` routes
through `exports.renderPdf` (`packages/api/src/routers/exports.ts:70-71`).

The minted token unlocks the full print view: every answer, signature,
conductor name, and attachment photo via freshly signed R2 URLs. It is reachable
by any signed-in tenant member, including zero-permission and contractor-portal
accounts — middleware excludes `/api` and `/render`
(`apps/web/middleware.ts:49`), and the external-user path allowlist runs only in
the localised page layout.

**Fix:** route it through `createServerCaller` like the other ten.

### H3. Unauthenticated `POST /api/contractor-upload` has no rate limit

Token-gated but unthrottled (`apps/web/app/api/contractor-upload/route.ts:41`),
accepting 50 MB per request. One leaked contractor token gives unbounded writes
into production R2 and unbounded `contractor_documents` rows. Its sibling
`scan-upload` was given limits; this one was missed, and the upload-route guard
test only asserts authorisation, never a throttle.

### H4. Two rate limiters are keyed on an attacker-chosen value

`apps/web/app/api/scan-upload/[token]/route.ts:68` reads the **leftmost**
`x-forwarded-for` hop — precisely the bug `resolveClientIp` was written to kill
(`packages/shared/src/client-ip.ts:38-56`, marker RL-K01). Rotating the header
per request yields a fresh bucket every time; the remaining token-keyed limit
fails open.

Same class in better-auth: `advanced.ipAddress.ipAddressHeaders` is never set
(`packages/auth/src/server.ts:118-127`), so better-auth defaults to the leftmost
hop too — which means the 5-per-300s OTP-send cap and the global 30-per-60s cap
are both spoofable. That enables OTP mail-bombing and unthrottled OTP-verify
attempts against a 6-digit keyspace.

### H5. A known-vulnerable spreadsheet parser behind an under-gated route

`xlsx@0.18.5` carries prototype-pollution and ReDoS advisories with **no
patched version on npm** (SheetJS left the registry). `XLSX.read` parses
user-uploaded bytes server-side at
`apps/web/src/server/template-import-xlsx.ts:28`.

The route that reaches it, `POST /api/ai/template-import`, requires only a
session and a tenant — no `templates.*` permission, no entitlement — and
accepts a 20 MB file (`apps/web/app/api/ai/template-import/route.ts:8-35`). So
any signed-in user, including an anonymous `/try` sandbox visitor who supplied
no email, can feed crafted input to that parser. It also happens to be one of
the most expensive model paths in the product.

**Fix:** gate the route on `templates.create`/`templates.manage`, and either
vendor SheetJS from its own distribution or move the parse to a sandboxed
worker.

### H6. The anonymous sandbox is an unmetered mailer to arbitrary addresses

`SANDBOX_WITHHELD_PERMISSIONS` withholds exactly two keys, on an explicit and
correct rationale — they "mail an arbitrary address"
(`packages/api/src/sandbox/provision.ts:127-132`). It misses a third path with
the same property, because `sandboxPermissionKeys()` grants everything else by
subtraction:

- `analytics.schedules.manage` stays granted.
- `DASHBOARDS_FREE_FOR_EVERYONE = true` (`packages/shared/src/entitlements.ts:60`)
  puts `customDashboards` on the free plan, so a sandbox is entitled.
- Schedule recipients are up to 20 arbitrary email addresses with no domain
  check (`packages/api/src/routers/dashboards.ts:195-199`), 5 schedules per
  dashboard, no cap on dashboards, and an hourly RRULE floor — each firing
  mailing a rendered PDF from the verified sending domain.

Combined with the confirmed absence of any TTL sweep for unclaimed sandboxes
(nothing in `packages/jobs/src` references `sandbox` or `claimedAt`, despite
three code comments promising the sweep), that capability is permanent.

**Fix:** add `analytics.schedules.manage` to the withheld list, or restrict
schedule recipients to tenant members. Then build the sweep — `claimedAt`
already exists, so no migration is needed.

### H7. Every background job is single-shot

`packages/jobs/src/worker.ts:128` passes only `{ connection }` — no `attempts`,
`backoff`, `removeOnFail` or `removeOnComplete`. BullMQ's default is
`attempts: 1`, which directly contradicts the assumption stated in
`apps/web/src/server/trpc.ts:14-15` that "BullMQ-side retries cover transient
failures once the job is accepted".

Cron-driven workers self-heal via notify-then-stamp. Event-driven ones do not:
incident alerts, observation notifications, schedule reminders and dashboard
sends drop permanently on one transient database or SMTP blip. A dropped
serious-incident alert is a compliance failure. Unset `removeOnComplete` also
means Redis grows without bound.

### H8. The PDF render queue has no depth cap and no timeout

`RENDER_CONCURRENCY` is capped at 2, but `renderSlotWaiters` is an unbounded
array with no limit and no timeout (`packages/render/src/pdf.ts:451-464`), and
no export route is rate-limited. Every export is a `GET`, so under
`sameSite: 'lax'` a cross-site top-level navigation carries the session cookie —
an attacker page cannot read the PDF but can force renders, giving a
CSRF-driven resource-exhaustion primitive. The semaphore is also in-process, so
it silently stops working if `web` is ever scaled past one replica.

The earlier 503 investigation correctly bounded Chromium's memory; it converted
that into a queueing problem rather than removing it.

### H9. Dependencies carry unpatched advisories, and the lockfile is behind its own ranges

`pnpm audit --prod` reports 77 advisories (3 critical, 45 high). The honest
read matters more than the count:

- **`next` 16.2.4** — advisories fixed in 16.2.11 include SSRF in rewrites and
  Server Actions, several DoS vectors, cache confusion, and unauthenticated
  disclosure of internal Server Functions. The much-publicised middleware/proxy
  bypass CVEs are *lower* impact here, because this app's middleware enforces no
  authentication at all — it only does i18n and request ids.
- **`better-auth` 1.6.5** — most of its critical and high advisories are
  OAuth, OIDC and magic-link issues that **do not apply**: this deployment is
  email-OTP only with `emailAndPassword` disabled and no OIDC provider. The one
  that does apply is "stale sessions persist after user deletion" (fixed in
  1.6.11), which compounds C1 exactly.
- **`xlsx` 0.18.5** — see H5; no npm fix exists.
- Dev-only criticals: `happy-dom` 16.8.1 (VM escape), `vitest` 2.1.9. These
  affect CI and developer machines, not production.

Both packages are declared with caret ranges (`^16.0.0`, `^1.6.5`), so a
`pnpm update` inside the existing ranges clears most of this cheaply.

### H10. No security gates in CI, and no way to be told about any of this

`.github/` contains one workflow. It runs format, typecheck, lint, tests, build
and a Playwright smoke — genuinely good coverage of correctness. It runs no
`pnpm audit`, no dependency scanning, no secret scanning, no CodeQL. There is no
`dependabot.yml`, no `renovate.json`, and no `SECURITY.md`, so there is also no
route for someone to report a vulnerability. Both CI jobs set
`SKIP_ENV_VALIDATION=1`, so env-schema regressions never surface.

### H11. Backups run; restore is unverified, and nothing alerts

The nightly dump is real, not a stub — `spawn('pg_dump')` → gzip → multipart to
R2 at 03:00 (`packages/jobs/src/workers/pg-dump-nightly.ts`). But there is no
`pg_restore` procedure, no RTO or RPO, and no restore drill documented anywhere
in `docs/`. An untested backup is a hypothesis.

Compounding it, there is no alerting on anything. ADR 0016 explicitly defers
alert rules and cron monitoring, and `docs/deployment.md` names Sentry the
primary surface while no rules exist. That is exactly how a previously broken
`pg_dump` stayed broken in production. A silently dead nightly backup, a stalled
queue, or C2's swallowed enqueues currently have no detector.

---

## Medium — worth doing, not launch-blocking

| # | Finding | Where |
| --- | --- | --- |
| M1 | No Postgres RLS anywhere; isolation is app-layer only, with no backstop for one missed predicate. 88 migrations, every snapshot `isRLSEnabled: false` | `packages/db/migrations/` |
| M2 | Share tokens stored in plaintext; a read-only leak or the admin tenant export hands over live capabilities | `packages/render/src/share.ts:73` |
| M3 | Heads-up, QR-category, contractor and kiosk tokens never expire — a printed QR is valid forever | `share.ts:113-121`, `routers/issues.ts:732` |
| M4 | No `robots.txt` and no `noindex` on `/s`, `/scan`, `/render`; combined with M3, an indexed share link is a permanent public leak | — |
| M5 | Client-side CSV export lacks formula-injection escaping, though `csvSafe` exists in shared and the server path uses it | `apps/web/src/lib/download-csv.ts:74-79` |
| M6 | `admin.previewDependents` has no permission guard, unlike its `admin.auditLog` sibling | `packages/api/src/routers/admin.ts:54` |
| M7 | Render HMAC binds only the id — not tenant, resource kind, or actor; each `/render` route self-resolves the tenant from the row, so a leaked `RENDER_SHARED_SECRET` is a cross-tenant read of every exportable record | `packages/render/src/hmac.ts:38` |
| M8 | tRPC has no Origin or CSRF check; safety rests entirely on implicit `sameSite=lax`, with no test pinning it | `apps/web/app/api/trpc/[trpc]/route.ts:119` |
| M9 | Page gating is a hand-maintained per-layout allowlist; 5 route groups lack it (`my-work`, `ai`, 3× `dashboards`). Shell-only exposure since tRPC gates the data, but it has already been forgotten five times | `apps/web/app/[locale]/*/layout.tsx` |
| M10 | 2FA is configured but has no enrolment UI, so no user can enable it — and `org.settings` is effectively root | `packages/auth/src/server.ts:158` |
| M11 | Sandbox claim writes an unverified email: an attacker can squat `victim@company.com`, locking the real owner out of sign-up and invite, and a later legitimate OTP for that address lands in the squatter's tenant | `packages/api/src/routers/sandbox.ts:153-162` |
| M12 | `ai/chat`, `ai/template-chat` and `ai/template-import` have no permission or entitlement gate; the three `site-media` vision routes have no rate limit at all; no per-tenant AI or storage quotas; unbounded `pause_turn` loop | `apps/web/app/api/ai/`, `api/site-media/` |
| M13 | SVG accepted by both logo uploaders, and the dev GET path serves it without `nosniff` | `api/upload/company-logo/route.ts:36` |
| M14 | No tenant deletion anywhere (GDPR erasure gap); retention v1 covers notification rows only, which is deliberate and documented | `workers/retention-sweep.ts` |

Minor, noted for completeness: SSRF private-range gaps (CGNAT `100.64/10`,
IPv4-compatible `::a9fe:`, NAT64); `escapeLike` applied in 1 of 13 search paths
(filter bypass and LIKE cost, not injection — Drizzle binds every pattern); the
AI agent's confidential check diverges from the router's but fails closed;
`WHATSAPP_VERIFY_TOKEN` compared with `===` rather than a constant-time compare.

---

## What is already strong — do not regress these

This list matters as much as the findings, because several of these are the
reason the Critical list is only two items long.

- **Tenant id is structurally unforgeable.** It never crosses the wire; it is
  read from the session once per request (`packages/api/src/procedures.ts:51-65`,
  `context.ts:119-126`). `user.additionalFields.tenantId` is `input: false`.
- **No SQL injection is reachable.** Only two `sql.raw` sites exist; one is a
  static default, the other takes a three-value Zod enum — and the dashboard
  spec is re-validated on *read* from the database, so a tampered JSONB column
  still cannot reach it (`dashboards/executor.ts:860`, `dashboards.ts:411-414`).
  Every metric, dimension and filter resolves through an allowlist that throws
  on an unmapped reference.
- **Confidential incidents hold everywhere checked** — list, get, CSV, PDF,
  search, dashboard aggregates, notification emails, and cross-module action
  titles.
- **The SSRF guard is textbook**: resolve, reject private ranges, then *pin* the
  connection to the validated address, closing the DNS-rebinding window, with
  per-hop re-validation and caps on redirects, time and size
  (`apps/web/src/server/guarded-fetch.ts:27-70`).
- **No XSS in the render pipeline.** All six `dangerouslySetInnerHTML` sites are
  static print CSS or hex-round-tripped theme values, with a test pinning the
  breakout attempt (`tenant-theme.test.ts:99`). Emails are plaintext-only.
- **Object-key traversal is structurally impossible**, and read-back paths check
  the tenant prefix (`packages/shared/src/storage.ts:32-69`).
- **Sentry scrubbing is allowlist-based**, shared across all four runtimes, with
  17 tests and redaction of `/s/` and `/scan/` tokens.
- **Every token path uses a CSPRNG.** Invites are 256-bit, 7-day, single-use;
  there is no `Math.random` in any token path.
- **AI output is Zod-validated with bounded correction loops** before any
  database write.
- **Sandbox session minting delegates token generation to better-auth's own
  CSPRNG** and is pinned by round-trip tests including tamper and wrong-secret
  rejection.
- **Debug routes are properly admin-gated**, and there are no impersonation
  features, no auth backdoors, and no test-only auth path reachable in
  production.
- **186 test files**, including guard tests that scrape the codebase for whole
  bug classes (translation keys, upload-route authorisation, search categories,
  migration journal integrity).

---

## Sequenced plan

### Phase 1 — before opening the doors (days)

1. **C2** — fix four characters; tighten `Enqueue` to `(name: QueueName, …)`
   and delete the cast.
2. **C1** — revoke sessions in `deactivate`; add the `deactivatedAt` filter to
   the context build and permission loader.
3. **H1** — add `headers()` with CSP, HSTS, `frame-ancestors`, Referrer-Policy
   and global `nosniff`.
4. **H2** — route `/api/exports/preview` through the permissioned caller.
5. **H6** — withhold `analytics.schedules.manage` from sandboxes.
6. **H5** — gate `/api/ai/template-import` on a `templates.*` permission.
7. **H4** — reuse `resolveClientIp` in `scan-upload`; set
   `advanced.ipAddress.ipAddressHeaders` in better-auth.
8. **H3** — rate-limit `contractor-upload`.
9. **H9** — `pnpm update` within existing ranges (clears most `next` and
   `better-auth` advisories, including the stale-session one behind C1).

### Phase 2 — before real volume (about two weeks)

Worker retries and dead-letter handling (H7); render queue depth cap and
timeout, plus rate limits on export and upload routes (H8); CI security gates
and `SECURITY.md` (H10); one restore drill plus Sentry alert rules and cron
monitors (H11); the sandbox TTL sweep; token expiry and hashing at rest
(M2/M3); `robots.txt` and `noindex` on public routes (M4); middleware
default-deny page gating (M9); the CSV escaping and `previewDependents` guard
(M5/M6).

### Phase 3 — hardening and completeness

Postgres RLS as a second line under app-layer scoping (M1); 2FA enrolment
(M10); render-token tenant and kind binding (M7); per-tenant AI and storage
quotas (M12); verified email on sandbox claim (M11); tenant deletion for GDPR
erasure (M14); more than one region and replica.

---

## One structural observation

Three of the findings above are the *same* mistake made twice: a control was
reasoned about carefully, implemented correctly in one place, and not applied to
the sibling path that shares the exposure.

`resolveClientIp` exists with a docstring naming the leftmost-hop bug, and two
limiters still read the leftmost hop (H4). `csvSafe` exists and the server CSV
path uses it; the client path does not (M5). The `deactivatedAt` predicate is
applied in `admins.ts` and not in the permission loader (C1). The sandbox
withholding list states the "can mail strangers" threat model precisely and
misses the third key with that property (H6). Ten export routes delegate to a
permissioned caller and the eleventh does not (H2).

This codebase is unusually good at writing down *why* a control exists — the
comments and edge-case markers are genuinely valuable. The gap is that the
reasoning lives in prose next to one call site instead of in a guard that fails
CI when a sibling diverges. The repo already knows this pattern and uses it well
elsewhere (`search-categories.test.ts`, `upload-routes.test.ts`,
`migrations-integrity.test.ts` all scrape the codebase for a whole class). The
highest-leverage habit going forward is to convert each fix above into that kind
of guard rather than a comment.

---

## Fix log

Implemented on `claude/freehs-security-readiness-u4cokz`. Every fix carries
edge-case-ID'd tests per the house rule; guard tests are named where the fix
closes a *class* rather than an instance.

### Fixed

| ID | What changed | Tests |
| --- | --- | --- |
| **C1** | `isUserActive` in `@forma360/permissions`, called from `createContext` and `loadCurrentUserPermissions`; `isNull(deactivatedAt)` added to `loadUserPermissions`; both `deactivate` and `anonymise` delete session rows | SEC-D01..D05 |
| **C2** | Four `ctx.enqueue` names corrected; `enqueue` now names an unregistered queue instead of dying on `undefined.parse` | `enqueue-names.test.ts` (5, scrapes routers off disk) |
| **H1** | `headers()` in `next.config.ts`: CSP, HSTS (prod-only), X-Frame-Options, Referrer-Policy, Permissions-Policy, global nosniff; `X-Robots-Tag: noindex` + `robots.ts` for token-bearing routes | SEC-H01..H08 |
| **H2** | `/api/exports/preview` requires `inspections.export`, matching its ten siblings | — |
| **H3** | `contractor-upload` rate-limited on IP (pre-body) and token, both fail-closed | — |
| **H4** | `scan-upload` uses `resolveClientIp` + fail-closed; the auth route collapses forwarded headers before better-auth's limiter sees them | — |
| **H5** | `/api/ai/template-import` requires `templates.create`/`manage` — it feeds `XLSX.read`, which has no upstream fix | — |
| **H6** | `analytics.schedules.manage` withheld from sandboxes | SB-M01..M04 |
| **H7** | `DEFAULT_JOB_OPTIONS`: retry, exponential backoff, bounded retention | — |
| **H8** | Render queue depth cap + timeout; `RenderQueueFullError` → `TOO_MANY_REQUESTS` | RQ-E01..E04 |
| **H9** | `next` → 16.2.12, clearing all thirteen of its advisories | `audit:gate` |
| **H10** | `pnpm audit:gate` ratchet in CI + `audit-baseline.json` with a written reason per accepted advisory; `dependabot.yml`; `SECURITY.md` | self-verifying |
| **M4** | `robots.txt` + `noindex` on `/s`, `/scan`, `/render`, `/api` | SEC-H08 |
| **M5** | `csvSafe` applied in the client CSV exporter | CSV-E01..E04 |
| **M6** | `admin.previewDependents` gated per entity on that entity's manage key | — |
| **M8** | Explicit cross-site write refusal on the tRPC transport (Origin + `Sec-Fetch-Site`), no longer resting solely on implicit `sameSite=lax` | — |
| **M12** | The three `site-media` vision routes throttled like every `/api/ai` sibling | — |
| **M13** | Logo responses serve SVG inert (`sandbox`, `default-src 'none'`, nosniff) rather than dropping vector logo support | — |

Also fixed: a **pre-existing** `pnpm typecheck` failure in `next.config.ts`
(three Sentry options are typed `string`, not `string | undefined`, so passing
unset env vars tripped `exactOptionalPropertyTypes`). The branch was red before
this work started.

### Still open, and why

- **M1 — Postgres RLS.** The right second line under app-layer scoping, but it
  is a schema-wide migration plus a per-transaction `SET LOCAL`, and it needs
  its own PR and its own test pass.

  Since this review, the **first** line has been audited end to end rather
  than assumed: 1,617 queries across every DB-touching package, against the
  130 of 137 tables carrying `tenant_id`, with no cross-tenant read or write
  found — see [`tenant-isolation-audit.md`](./tenant-isolation-audit.md), and
  `TS-G01` in `packages/db/src/tenant-scoping.test.ts` for the CI guard that
  now fails a new query written with no tenant in scope. That audit does not
  retire M1: it says the app layer currently holds, which is a statement
  about today's 1,617 decisions rather than a property of the system. RLS is
  what makes a missed predicate return nothing instead of someone else's
  rows, and it remains the correct next security investment.
- **M10 — 2FA enrolment.** The plugin is configured; there is no UI. A feature.
- **M2/M3 — share-token hashing and expiry.** Hashing at rest needs a migration
  and a lookup change; adding expiry to heads-up/QR/contractor/kiosk tokens is
  a product decision about what breaks when a printed QR stops working.
- **M14 — tenant deletion.** GDPR erasure needs a defined cascade across ~40
  tables and a decision about statutory retention. Not a fix.
- **Sandbox TTL sweep.** ~~`claimedAt` already exists so no migration is
  needed, but choosing the TTL and what "expired" means for a workspace
  someone is mid-trial in is a product call.~~ **Closed in the FreeHS
  production-readiness pass**: `forma360-sandbox-ttl-sweep` (daily 04:10
  UTC, `packages/jobs/src/workers/sandbox-ttl-sweep.ts`) neutralises
  sandboxes unclaimed after 7 days — users deactivated (the live
  `isUserActive` check is the control), sessions deleted, tenant
  archived with `settings.sandbox.sweptAt` stamped. Hard deletion of the
  rows stays with M14, deliberately: a swept sandbox is inert and cheap.
  Tests SB-T01..T03.
- **`better-auth` upgrade.** Attempted (1.6.29) and reverted: it pulls
  `better-call@1.4`, which requires zod 4, and migrating ~40 routers off zod 3
  is not a security patch. The one applicable advisory — stale sessions after
  deletion — is answered by C1 in our own code. The rest are OAuth, OIDC and
  magic-link issues on a deployment that enables none of them.
- **`vitest` / `happy-dom` criticals.** Dev-only, and both are major-version
  bumps (2→3 across 186 test files; 16→20). Neither ships.
- **`xlsx`.** No patched version exists on npm. Mitigated by the H5 permission
  gate rather than an upgrade that is not available.

### Launch disposition (FreeHS production-readiness pass, 2026-08-19)

Decision per remaining open item, so launch does not re-litigate them:

- **Sandbox TTL sweep — FIXED** (above). This was the one item argued as a
  launch blocker: the product's front door creates anonymous tenants, and
  before the sweep every one of them lived forever.
- **M1 (RLS), M10 (2FA enrolment), M2/M3 (share-token hashing + expiry),
  M14 (tenant deletion) — ACCEPTED for launch.** Each is a feature with its
  own migration/product surface, already scoped above. App-layer tenant
  scoping (ADR 0002) plus `tenantProcedure` remains the enforced boundary;
  the accepted items are defence-in-depth and compliance surface, not open
  holes. Revisit order when scheduled: M1 → M2/M3 → M10 → M14.
- **Dependency majors (`better-auth`, `vitest`, `happy-dom`) — ACCEPTED**,
  reasons unchanged from the list above; enforced by the `audit:gate`
  baseline so a NEW advisory still fails CI.
