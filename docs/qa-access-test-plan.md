# Forma360 — Exploratory & Access-Control Test Plan

> **Purpose.** A detailed, executable test plan for a Chrome-driven exploratory
> pass over production. It exists to answer two questions at once:
> 1. **Does each user-facing path make sense?** (UX sanity — dead ends,
>    confusing states, broken flows.)
> 2. **Is the access model correct?** (multi-user, multi-permission-set,
>    cross-group / cross-site / cross-tenant data isolation.)
>
> Author: QA design pass, 2026-07-24. To be executed the same afternoon.
> Runner: Claude via the Chrome extension, driving real sessions on
> `https://forma360.io`. Results captured per §4.

---

## 0. The access model (so every "Expected" below is derivable, not guessed)

Confirmed from source (`packages/permissions/src/access.ts`,
`packages/api/src/routers/templates.ts`):

- **Managers bypass everything.** A user holding the module's `*.manage`
  permission (e.g. `templates.manage`) sees **all** rows regardless of access
  rule. Administrators hold every key, so they always see all.
- **Non-managers are gated per-row by the row's access rule:**
  - `accessRuleId = null` → **visible to everyone** (open content).
  - Non-null rule → visible **iff** `resolveAccessRule(rule, user)` is true:
    - `(rule.groupIds is empty OR user ∈ any rule group)`
    - **AND** `(rule.siteIds is empty OR user ∈ any rule site)`
  - **Invalidated** rule (`invalidatedAt != null`, e.g. it referenced a group
    that was later archived) → **deny** for non-managers.
- The same primitive gates templates, inspections, issues, actions, training,
  and (via folder access) documents. **Test it once thoroughly on templates,
  then spot-check the others** — if the primitive leaks, it leaks everywhere.

**The two highest-value bug classes to hunt:**
- **B-ISO (isolation leak):** a user sees a row they should not — cross-group,
  cross-site, or worst of all **cross-tenant**. Severity: Critical.
- **B-IDOR (direct-object access):** `list` correctly hides a row, but opening
  it by **direct URL / ID** (`/templates/<id>`, `/inspections/<id>`, deep API
  route) returns it anyway because the `get`/detail path doesn't re-enforce the
  filter. Severity: Critical. **This is the single most likely real bug** and
  gets its own suite (§S4).

---

## 1. Environment & safety

- **Target:** production, `https://forma360.io`. There is no staging.
- **Isolation from real data:** all fixtures live in **two throwaway tenants
  created for this test** (§2). Do **not** run destructive tests (archive,
  deactivate, anonymise, delete) against the real "Forma360 Ltd" operating
  data. Every actor and every seeded row below belongs to a test org.
- **Auth:** email OTP. All actors use Gmail **plus-aliases of one inbox**
  (`filippo199+<tag>@gmail.com`) so every OTP lands in `filippo199@gmail.com`
  and the runner can read the code. Login is the user's step where a human
  must fetch/enter the code, unless the runner is authorised to read the OTP
  from the inbox during the session (confirm in §7).
- **Session switching:** the Chrome extension drives one profile. To act as a
  different user, **sign out** (avatar → sign out) or use an **incognito
  window** per actor. Keep a scratchpad note of "who am I logged in as now."
- **Evidence:** screenshot every FAIL/BUG and every access-control assertion
  (both the positive "can see" and negative "cannot see"). Store refs in the
  bug log.

---

## 2. Test fixtures — the cast & the seed data

### 2.1 Tenants
| ID | Org name | Purpose |
|----|----------|---------|
| **A** | Northwind Facilities | Primary test org — all role/group/site matrix |
| **B** | Southgate Group | Isolation control — must be invisible from A |

### 2.2 Actors (Tenant A unless noted)
| Actor | Email alias | Permission set | Group(s) | Site(s) | Why they exist |
|-------|-------------|----------------|----------|---------|----------------|
| **A0** | `filippo199+testa@gmail.com` | Administrator (owner) | — (all) | — (all) | Creates Tenant A (fresh throwaway org — NOT the real account); sees everything; runs admin flows |
| **A1** | `filippo199+mgr@gmail.com` | Manager | North Team | Manchester | Manager bypass: sees all templates incl. invalidated |
| **A2** | `filippo199+north@gmail.com` | Standard | North Team | Manchester | Positive visibility for North/Manchester content |
| **A3** | `filippo199+south@gmail.com` | Standard | South Team | London | Negative visibility — must NOT see North/Manchester |
| **A4** | `filippo199+inspector@gmail.com` | **Custom** "Inspector" (`inspections.view/conduct/sign`, `templates.view` only) | none | none | Minimal perms + no memberships → sees only open content; nav heavily gated |
| **A5** | `filippo199+deact@gmail.com` | Standard | South Team | London | Deactivate → login-blocked → reactivate tests |
| **A6** | `filippo199+contractor@gmail.com` | Contractor portal (external) | — | — | External surface; must see ONLY their portal |
| **B0** | `filippo199+orgb@gmail.com` | Administrator | — | — | Owns Tenant B; isolation control |

### 2.3 Groups & Sites (Tenant A)
- Groups: **North Team**, **South Team**, **Rule-Based Auditors** (membership
  by custom field `department = Audit`, to exercise the reconcile job G-E02).
- Sites: **Manchester** (parent) › **Manchester / Floor 1** (child); **London**.
  Child site exercises hierarchy inheritance (G-17 move semantics, G-E07 depth).

### 2.4 Seed rows (Tenant A) — the visibility matrix source
Create these **as A0** (admin), setting each template's access rule in the
Settings step of the editor:

| Row | Type | Access rule | Predicted non-manager visibility |
|-----|------|-------------|----------------------------------|
| **T-Open** | Template | none (null) | Everyone (A2, A3, A4) |
| **T-North** | Template | group = North Team | A2 only |
| **T-Mcr** | Template | site = Manchester | A2 only (A2 ∈ Manchester) |
| **T-NorthMcr** | Template | group North **AND** site Manchester | A2 only |
| **T-South** | Template | group = South Team | A3 only |
| **T-Invalid** | Template | group = a group we then **archive** | Nobody (invalidated) except managers |
| I-North | Inspection | started from T-North | mirrors T-North |
| ISS-South | Issue | access rule = South Team | A3 only |
| DOC-Mcr | Document (in a Manchester-scoped folder) | folder visibility = Manchester | A2 only |
| SCH-North | Schedule | assigned to North Team @ Manchester | A2 target |

**Predicted template list per actor (the oracle):**
- **A0 / A1 (admin/manager):** all 6, including **T-Invalid**.
- **A2 (North, Manchester):** T-Open, T-North, T-Mcr, T-NorthMcr. **(4)**
- **A3 (South, London):** T-Open, T-South. **(2)**
- **A4 (no group/site):** T-Open. **(1)**

Any deviation from this table is a **B-ISO** finding.

---

## 3. Output format (what the runner produces)

Two artefacts, appended to `docs/qa-results-<date>.md`:

**(a) Bug log** — one row per defect:
```
| ID | Severity | Module | Actor | Path/URL | Expected | Actual | Screenshot | Repro steps |
```
Severity: **S1 Critical** (data leak / auth bypass / crash / data loss) ·
**S2 Major** (flow broken, can't complete core task) ·
**S3 Minor** (confusing UX, wrong copy, missing empty/error state) ·
**S4 Cosmetic** (visual only).

**(b) Coverage matrix** — one row per test case ID below:
```
| Test ID | Actor(s) | Result (PASS/FAIL/BUG/BLOCKED/N-A) | Bug ID(s) | Notes |
```

A test is **PASS** only if both the positive and its paired negative hold
(e.g. A2 *sees* T-North **and** A3 *does not*).

---

## 4. Test suites

Each case: **ID · title · actor(s) · preconditions · steps · expected ·
severity-if-fail.** Steps are written so the runner can execute them literally.

### S1 — Auth & onboarding
- **S1.1 Sign-up new tenant (A0, B0).** Steps: /sign-up → email → OTP → org
  name → land in app. Expected: tenant created, admin seeded, default
  permission sets (Administrator/Manager/Standard) exist in Settings →
  Permissions. Fail=S2.
- **S1.2 OTP delivery & validity.** Expected: code arrives < 60s; wrong code
  rejected; expired (>10 min) rejected; 6th attempt rate-limited (plugin
  `allowedAttempts:5`, window 300s). Fail=S2.
- **S1.3 Invite flow (A0 invites A2–A5).** Settings → Users → Invite; assign
  permission set + group + site. Expected: invitee gets email, accepts, lands
  with correct perms/memberships. **Check the invite assigns membership at
  invite time or requires a post-accept edit** — note which. Fail=S2.
- **S1.4 Sign-out / session end.** Expected: after sign-out, protected routes
  redirect to sign-in; back-button doesn't resurrect the session. Fail=S1.
- **S1.5 Deactivated user login (A5).** A0 deactivates A5 → A5 attempts login.
  Expected: blocked with a clear message, **not** a half-broken session.
  Reactivate → login works. Fail=S1.
- **S1.6 Unknown email OTP.** Type a never-invited email in the OTP form.
  Expected: generic "invalid code", **no** tenant auto-created
  (`disableSignUp:true`). Fail=S1.

### S2 — Navigation & permission gating (per permission set)
For each actor, load the app and record the **nav items** and **primary
action buttons** visible. Cross-check against their permission set.
- **S2.1 Administrator (A0).** Sees all 10 modules + Settings (all sub-tabs).
- **S2.2 Manager (A1).** Sees operational modules; **Settings**: no Company/
  billing/integrations/anonymise. Expected: admin-only trio hidden.
- **S2.3 Standard (A2).** Sees view/do surfaces (Inspections conduct, Issues
  report, Actions create, Documents view…). **No** Settings admin pages
  (redirect to profile). No "New template", no "Manage users".
- **S2.4 Custom Inspector (A4).** Sees Inspections + Templates(view). Should
  **not** see Actions/Issues/Assets/etc. nav. Verify the nav is driven by
  permissions, not hardcoded.
- **S2.5 Server-side enforcement (critical).** For each *hidden* button, hit
  the underlying mutation directly (via URL / crafted request in devtools) and
  confirm the **server** rejects it (403), per ground-rule 6 "UI may hide;
  server is source of truth." Fail=**S1**.
  - e.g. A2 (no `templates.create`) POSTs `templates.create` → expect 403.
  - e.g. A2 (no `users.invite`) calls `users.invite` → expect 403.

### S3 — Cross-group / cross-site visibility (the headline)
Using the §2.4 oracle:
- **S3.1 Template list oracle.** For A0, A1, A2, A3, A4 in turn: open
  Templates, record the exact set. Compare to predicted table. Any extra row
  = **S1 (B-ISO)**; any missing row that should show = S2.
- **S3.2 Manager-bypass incl. invalidated.** A1 must see **T-Invalid**
  (manager bypass); A2/A3/A4 must **not**. Fail=S1 either direction.
- **S3.3 Site-only rule.** A2 sees T-Mcr (site match); A3 (London) does not.
- **S3.4 AND semantics.** Put a user in North but **London** (temporarily move
  A2's site to London) → T-NorthMcr (North AND Manchester) must **disappear**
  for them, while T-North (North only) stays. Confirms AND, not OR. Restore.
- **S3.5 Inspections/Issues/Actions spot-check.** Repeat the seen/not-seen for
  I-North, ISS-South, an access-ruled action. Fail=S1.
- **S3.6 Documents folder visibility.** A2 sees DOC-Mcr folder; A3 does not;
  parent-folder cascade behaves (child inherits parent restriction). Fail=S1.
- **S3.7 Schedules & assignment.** A2 sees SCH-North occurrences assigned to
  them; A3 does not. "Assigned to / site" copy correct.

### S4 — Direct-URL / IDOR (horizontal privilege) — **prime bug hunt**
For every row S3 says an actor **cannot** see in a list, try to reach it
directly. This is where `list` filters but `get` may not.
- **S4.1 Template by ID.** As A3, capture T-North's id (from A0's session /
  URL), then load `/en/templates/<T-North id>` **as A3**. Expected: 403 /
  "not found" / redirect — **not** the editor. Fail=**S1**.
- **S4.2 Inspection by ID.** As A3, open `/en/inspections/<I-North id>`.
  Expected: blocked. Also its sub-routes `/status`, `/signatures/<n>`.
- **S4.3 Approvals / export links.** As A3, hit the export/PDF endpoint and
  the public `s/<token>` share route for a North inspection. Expected: token
  route works only with a valid token; authless access to A3-forbidden data
  blocked. Fail=S1.
- **S4.4 Settings pages by URL.** As A2 (standard), directly load
  `/en/settings/users`, `/settings/permissions`, `/settings/company`.
  Expected: redirect to profile (server-guarded), not a flash of admin UI.
- **S4.5 Cross-tenant by ID (feeds S5).** As B0, load a Tenant-A template/
  inspection id. Expected: hard 404/403 — never cross-tenant content.

### S5 — Cross-tenant isolation (must be airtight)
- **S5.1 List isolation.** B0 in Tenant B sees **zero** Tenant-A rows across
  every module (templates, inspections, issues, actions, documents, assets,
  contractors, sites, groups, users, schedules). Any A row in B = **S1**.
- **S5.2 Global search / pickers.** Site selector, group/user picker,
  assignment dropdowns, "@mention", template picker — none surface another
  tenant's entities. Fail=S1.
- **S5.3 Mutation targeting another tenant.** As B0, attempt an update/delete
  passing a Tenant-A id (crafted request). Expected: 403/404, no write.
  Fail=**S1**. (Ground-rule 4: tenant derived from session, never input.)
- **S5.4 Contractor portal cross-tenant.** A6 (contractor for A) cannot reach
  B's portal data and vice-versa.

### S6 — Admin guards & destructive actions (on test orgs only)
- **S6.1 Last-admin guard (S-E02).** In Tenant A, try to remove/downgrade the
  only Administrator (or A0 self-demote). Expected: blocked with a clear
  "cannot drop below one admin" message. Fail=S2.
- **S6.2 Permission-set reassignment.** Change A2 Standard→Manager, verify new
  capabilities appear (and old restrictions lift) **on next load**; change
  back. Watch for stale client-side permission caches. Fail=S2.
- **S6.3 Cascade preview (`admin.previewDependents`).** Before archiving a
  group/site/template that other rows reference, the confirm dialog shows an
  accurate dependent count. Archive a group referenced by T-Invalid's rule →
  rule becomes **invalidated** (feeds S3.2). Fail=S2.
- **S6.4 Archive vs delete semantics.** Archived template: no new inspections
  can start, in-progress stay completable, schedules pause (T-E05). Verify.
- **S6.5 User anonymise (S-E09).** Anonymise A5 (test user) → PII scrubbed,
  references intact, cannot log in. Fail=S1 if PII remains.
- **S6.6 Site FK integrity (new — commit 06110d1).** Delete/archive a site
  that assets/documents/contractor-visits reference → those `site_id`s go
  **null** (ON DELETE SET NULL), rows survive, no orphan crash. Fail=S2.

### S7 — Per-module functional deep-dives (happy path + edge)
Run each **as the least-privileged actor who should be able to** (to catch
over-restriction) and confirm the flow completes. Edge cases in brackets.
- **S7.1 Templates:** create → add sections/questions/logic → response sets →
  publish → duplicate → export/import JSON. [logic depth ≤40 (T-E07); dup
  signer slot rejected (T-E02); optimistic-concurrency conflict (T-E18) when
  two tabs save; response-set snapshot preserved (T-E17).]
- **S7.2 Inspections (A2/A4 conduct):** start → pinned template version →
  save progress → required-question gate → signatures → submit → approve →
  report renders → PDF/Word export → public share link. [required blocks
  submit; concurrent signature same slot (T-E20) → CONFLICT; save-progress
  stale `expectedUpdatedAt` conflict; archived template can't start (T-E04/5).]
- **S7.3 Approvals:** approve & reject paths, terminal status stamped, log
  append-only. [reject reason required; re-approve blocked.]
- **S7.4 Issues → investigations → actions:** raise issue from an inspection
  response, convert to action, assign, resolve. [question-anchor dedup.]
- **S7.5 Actions:** create standalone, saved views (per-user, server-side),
  filters, full-page canvas. [saved view isolation between users A2 vs A3.]
- **S7.6 Heads-up:** publish (button = mutation, not nav), reminder. 
- **S7.7 Assets & maintenance:** create asset, record reading, maintenance
  **program** (not "plan"), detach/delete/resync, link contractor↔asset.
- **S7.8 Documents:** upload, move file, rename folder, folder visibility by
  group/site, PDF preview renders (was a fixed bug — regression check).
- **S7.9 Schedules:** create rrule schedule, human-readable recurrence, month
  calendar, pause/resume segmented control visible, timezone correctness,
  materialise-now, upcoming list. [DST boundary; assigned-group display.]
- **S7.10 Observations:** create with Sites-vs-Projects terminology, category,
  critical alert, `?site=` filtering consistent across module.
- **S7.11 Sites & Projects:** hierarchy create/move, terminology setting
  (Sites↔Projects copy swaps platform-wide), overview "create-here" prefill
  survives client nav (commit 7c120b2 — regression check), drop-pin on plan +
  Google map location.
- **S7.12 Contractors:** directory, compliance docs (multi-doc per category),
  blocking-compliance help text, visits + calendar, gate check-in kiosk,
  overstay >24h alert, portal invite email actually sends (S7-linked).
- **S7.13 Settings:** users CRUD, custom fields (deletion guard S-E04), groups
  (manual + rule-based membership → reconcile job), permission sets CRUD,
  company/terminology, logo upload.
- **S7.14 AI assistant:** template generation (smart picker types, minimal/
  shared response sets), PDF/Excel import → template, web-grounded regulations,
  chat markdown (tables/lists) renders, report visualization (no raw JSON).

### S8 — Contractor portal (external user surface)
- **S8.1 A6 portal scope.** A6 logs into the portal and sees **only** their
  contractor record/activities — no internal modules, no other contractors,
  no other tenant. Layout gating correct. Fail=S1.
- **S8.2 Onboarding.** Invite → email → first-login onboarding → upload a
  compliance doc → status reflects to internal admin (A0). 
- **S8.3 Gate kiosk (public).** The public `/gate` kiosk check-in works
  without auth for the token, captures configured fields, and cannot enumerate
  other tenants' gates. Fail=S1.

### S9 — Cross-cutting
- **S9.1 i18n.** Every string via `t()`; spot-check a non-English locale for
  missing keys / raw keys shown. Terminology (Sites/Projects) respected.
- **S9.2 Empty states.** Each list with zero rows shows a proper empty state,
  not a permanent skeleton (known partial on bad framework id — recheck).
- **S9.3 Error states.** Non-existent id in URL → friendly "not found", not a
  white crash or infinite skeleton. 404 route. 
- **S9.4 Concurrency.** Two tabs editing the same template/inspection →
  optimistic-concurrency conflict surfaces gracefully.
- **S9.5 Mobile (390px).** Spot-check the heavy tables/boards/forms at 390px
  (recent mobile pass) — no horizontal overflow, nav drawer works.
- **S9.6 Deep-link after login.** Hitting a protected deep link while logged
  out → login → **returns to the intended page**, not just the dashboard.

---

## 5. Execution protocol (how the runner drives it)

1. **Provision (as A0 / B0):** create both tenants, groups, sites, custom
   field, permission sets, and the §2.4 seed rows. Record every entity id in a
   scratchpad map `{name → id}` (needed for S4/S5 direct-URL tests).
2. **Per actor:** sign out → sign in as actor (OTP) → run their assigned
   cases → capture the coverage-matrix row + any bug rows. Batch clicks and
   end each case with a screenshot.
3. **Assertions are paired:** always verify the negative next to the positive
   (A2 sees X *and* A3 does not) so a leak can't hide behind a pass.
4. **Direct-URL tests reuse ids** captured in step 1 — do them right after the
   list test for the same row while the id is fresh.
5. **Stop-on-Critical:** any S1 (isolation leak / auth bypass) is logged
   immediately with full repro + screenshot and flagged to the user before
   continuing (don't keep walking past a data leak).
6. **Cleanup:** test orgs are disposable; leave them (don't touch real data).

---

## 6. Decisions — LOCKED (confirmed 2026-07-24)

1. **Throwaway orgs on prod — ✅ confirmed.** Create **two new test tenants**
   on prod (§2). Every destructive test (archive / deactivate / anonymise /
   delete) stays inside these test orgs. **Never touch real Forma360 Ltd data.**
2. **OTP handling — ✅ confirmed.** Runner reads OTP codes from
   `filippo199@gmail.com` via the Gmail connector during the run (fallback:
   ask the user to paste). Unblocks fast session-switching across ~7 actors.
3. **Email aliases — ✅.** `filippo199+<tag>@gmail.com` all land in the one
   inbox; treated as distinct users.
4. **Execution order — ✅ confirmed:** **S5 (tenant isolation) → S4 (IDOR) →
   S3 (group/site visibility) → S2.5 (server enforcement) → S1 (auth)**, then
   functional breadth S7 / S8 / S9.
5. **Sessions:** sequential sign-in/out (incognito per actor where it speeds
   things up). No blocker.

---

## 7. Why this order finds the most bugs

The plan front-loads the **access-control invariants** (S2.5, S3, S4, S5)
because they're (a) the user's stated concern, (b) the highest-severity class,
and (c) the most *derivable* — the §2.4 oracle turns "looks fine" into a
precise pass/fail. Functional breadth (S7) comes after, since a broken button
is obvious on sight while a silent cross-tenant leak is not. Every access test
is written as a **paired** positive/negative so a permissive bug can't pass by
only checking the happy path.
