# Forma360 — Multi-user RBAC & Isolation E2E Test Plan

**Target:** production `https://forma360.io` (Chrome-extension-driven by Claude)
**Designed:** 2026-07-24 · **Planned run:** 2026-07-24 afternoon
**Results go to:** `docs/qa/runs/2026-07-24.md` (created at run time) + `QA_TRACKING.md` rows for passes + bug ledger (see §9)

---

## 1. Purpose & scope

Verify, with real browser journeys on production, that:

1. **Permission sets** actually gate what each user can *see* (UI) **and** *do* (server) — UI hiding alone is not a pass; ground rule #6 says the tRPC layer is the source of truth.
2. **Group/site isolation** holds: a user in group A must not see or reach artifacts scoped to group B (templates, schedules, documents, heads-ups), including by **direct URL** and **API call**, not just by list filtering.
3. **Lifecycle flows make sense to a human** — for every core journey we record a UX verdict, not only pass/fail.
4. **Cross-tenant isolation** holds absolutely (S1 severity if broken).

**Out of scope this run:** WhatsApp inbound (Meta app in review — pre-publish delivery is blocked), billing (not built), load/perf, i18n locales other than EN (spot-check only).

**Known-expected failures (log, don't rabbit-hole):**
- PDF report export → "Render engine not configured" (open task #46).
- Non-existent-ID detail pages may show permanent skeleton instead of "not found" (known pattern, QA_TRACKING 2026-05-20).

---

## 2. Method & ground rules

- **Driver:** Claude via Chrome extension, desktop viewport; mobile spot-checks reuse the 390 px iframe harness.
- **Login protocol:** auth is email OTP. **Claude never types OTP codes or passwords** — each account switch is a *login handoff*: Claude fills the email field and clicks send; **you type the 6-digit code** (all test accounts are plus-aliases of filippo199@gmail.com, so every code lands in your one inbox). The schedule (§8) batches all work per account to minimise handoffs (~6 total).
- **OTP rate limit:** `/email-otp/send-verification-otp` allows 5 sends / 5 min. Never retry-spam; if a code is slow, wait, don't resend more than once.
- **Fixture naming:** everything we create is prefixed **`QA-`** (groups `QA-North`, templates `QA-T-Open`, …). Never modify or archive non-`QA-` data. Cleanup in §10 archives `QA-` artifacts only.
- **Expected-blocked guard:** for tests whose expected result is "blocked" (last-admin demotion, forbidden mutation), if the action is unexpectedly *allowed*, **abort before confirming/saving**, screenshot, file the bug. Never complete a destructive unexpected-allow.
- **Evidence:** screenshot per FAIL/WARN; per-page sweep = console errors (`read_console_messages`) + failed network calls (`read_network_requests`) recorded even when the test passes.
- **API-level checks (suite C)** run in the browser console as the *currently signed-in user* via `fetch` against tRPC endpoints — authorized security testing of our own app, read-only or reverted immediately.

---

## 3. Personas & accounts

| ID | Email | Permission set | Groups | Custom field `QA-Region` | Purpose |
|----|-------|----------------|--------|--------------------------|---------|
| **U0** | filippo199@gmail.com | Administrator (system) | — | — | Owner; fixture creation; admin guards |
| **U1** | filippo199+1@gmail.com | **Manager** (system) | — (gains `QA-Rule` via rule in D4) | `West` (set mid-test) | Manager surface; approvals; rule-group reconcile subject |
| **U2** | filippo199+2@gmail.com | **Standard** (system) | `QA-North` | — | In-group actor for North-scoped artifacts |
| **U3** | filippo199+3@gmail.com | **Standard** (system) | `QA-South` | — | Out-of-group probe — the "can they see the other group's stuff?" user |
| **U4** | filippo199+contractor@gmail.com | *(external contractor portal user)* | — | — | Portal gating: must see portal only |
| **T2** | filippo199+tenant2@gmail.com | Administrator of **new tenant** `QA-Tenant2` | — | — | Cross-tenant isolation + signup E2E (also re-verifies the Resend fix) |

Reference — what the system sets actually contain (from `packages/permissions/src/seed.ts`):
- **Administrator** = all 64 keys (holds `org.settings` ⇒ `grantsAdminAccess`).
- **Manager** = everything **except** `billing.manage`, `integrations.manage`, `org.settings`, `users.anonymise` ⇒ **Manager is NOT admin** for layouts gated on `grantsAdminAccess`.
- **Standard** = view keys + `inspections.conduct/sign`, `issues.report`, `actions.create`, `assets.readings.record`, `training.take`, incl. `templates.view` + `analytics.view`.

> ⚠️ Design tension to test explicitly (B6/B7): `/templates` layout redirects **non-admins** to `/settings/profile` — so a **Manager with full `templates.*` keys** and a Standard user with `templates.view` both have **no UI entry point** to templates. Decide whether that's intended; record actual behavior.

**Pre-run fixture audit (F0):** users +1/+2/+3 may already exist with drifted state. As U0, before anything else: confirm/repair each user's permission set + group membership to match this table; snapshot `Settings → Permissions` (screenshot the three system sets) into the run log so expectations are grounded in what production actually holds.

---

## 4. Fixtures (created by U0 in Phase 0, all `QA-` prefixed)

| Fixture | Where | Definition |
|---|---|---|
| Groups `QA-North`, `QA-South` | Settings → Groups | Manual membership: U2 → North, U3 → South |
| Group `QA-Rule` | Settings → Groups | Rule-based: `QA-Region equals West` (no manual members) |
| Custom field `QA-Region` | Settings → Custom fields | Text/select field on users |
| Sites `QA-HQ` (kind: site), `QA-ProjectX` (kind: project, child of QA-HQ), `QA-SiteB` | Sites | Exercises hierarchy + terminology |
| Template `QA-T-Open` | Templates (as U0) | 4 questions: 1 required text, 1 multiple-choice w/ flagged answer that **requires action + evidence**, 1 logic-triggered follow-up, 1 signature slot. **Published.** No access restriction. |
| Template `QA-T-North` | Templates | Simple 2-question template. **Published.** Gated to group `QA-North` — *discovery step D0 locates the gating UI (access rules / template settings); if no UI exists to gate a template to a group, that's finding **GAP-1** and suite D degrades to documenting actual behavior.* |
| Template `QA-T-Draft` | Templates | Created, **never published** |
| Schedule `QA-Sched-North` | Schedules | Weekly on `QA-T-Open`, assigned to group `QA-North`, site `QA-HQ` |
| Document folder `QA-F-North` + 1 PDF | Documents | Folder visibility restricted to `QA-North` |
| Document folder `QA-F-Public` + 1 PDF | Documents | Unrestricted |
| Heads-up `QA-HU-North` | Heads-up | Targeted at `QA-North` (or closest targeting the UI offers) |
| Observation `QA-Obs-HQ` | Observations | Raised at site `QA-HQ` |
| Asset `QA-Asset-1` | Assets | At `QA-HQ`, with one maintenance program |
| Contractor `QA-Contractor-Co` + portal invite for U4 | Contractors | Portal invite email → U4 onboarding |
| Second tenant `QA-Tenant2` | /sign-up as T2 | Own org; create 1 template + 1 inspection inside it |

---

## 5. Master access matrix (the headline of this whole run)

Legend: ✅ see + act · 👁 see only · 🚫 hidden in UI **and** server-denied on direct access · ❓ record actual (design ambiguous — becomes a product decision)

| Artifact / capability | U0 admin | U1 manager | U2 std·North | U3 std·South | U4 portal |
|---|---|---|---|---|---|
| `/templates` admin area | ✅ | ❓ (layout says 🚫 despite templates.\* keys) | 🚫 | 🚫 | 🚫 |
| Start inspection with `QA-T-Open` | ✅ | ✅ | ✅ | ✅ | 🚫 |
| Start inspection with `QA-T-North` | ✅ | ❓ | ✅ | **🚫 ← core leak test** | 🚫 |
| `QA-T-Draft` in start-chooser | 🚫 (draft) | 🚫 | 🚫 | 🚫 | 🚫 |
| See `QA-Sched-North` occurrences | ✅ | ❓ | ✅ | 🚫 | 🚫 |
| Folder `QA-F-North` + its PDF | ✅ | ❓ | ✅ | 🚫 (list + direct URL) | 🚫 |
| Folder `QA-F-Public` | ✅ | ✅ | ✅ | ✅ | 🚫 |
| Heads-up `QA-HU-North` | ✅ | ❓ | ✅ ack | 🚫 | 🚫 |
| `/settings/users`,`/groups`,`/permissions`,`/custom-fields` | ✅ | ❓ (has users.view; org.settings gates?) | 🚫 → redirect | 🚫 → redirect | 🚫 |
| Approvals queue (approve/reject) | ✅ | ✅ | 🚫 (own status only) | 🚫 | 🚫 |
| U2's saved view in Actions | — | 🚫 | ✅ owner | 🚫 (per-user) | 🚫 |
| Internal routes at all (`/inspections`, `/actions`, …) | ✅ | ✅ | ✅ | ✅ | **🚫 portal-only redirect** |
| Anything in Tenant-1 while signed into `QA-Tenant2` | — | — | — | — | — → suite L: 🚫 404/403, never 500, never data |

Every ❓ cell gets resolved to an explicit product decision during the run.

---

## 6. Test suites

Priorities: **P1** must run · P2 if time. Each test: ID · actor · steps · expected.

### Suite A — Auth & session (P1) — actor: various
- **A1** U3 login E2E: `/sign-in` → email → OTP arrives (< 60 s, from `noreply@forma360.io`) → lands signed-in. *(Also re-verifies yesterday's Resend fix for non-owner recipients.)*
- **A2** Wrong OTP: enter obviously wrong code once → friendly error, attempts counter respected (allowedAttempts 5, no lockout confusion).
- **A3** Unknown email at `/sign-in` (e.g. filippo199+ghost@) → generic "invalid code" style response; **no tenant auto-created** (disableSignUp on OTP plugin).
- **A4** Sign-up flow as T2 (this doubles as fixture L-setup): `/sign-up` → org name `QA-Tenant2` → OTP → lands in fresh tenant with seeded permission sets (verify 3 system sets exist in its Settings).
- **A5** Session persistence: hard-reload + new tab keep session; sign-out fully signs out (back button doesn't resurrect an authed page).
- **A6 (P2)** Invite flow: U0 invites +contractor and any miss