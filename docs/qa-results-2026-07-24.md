# Forma360 — QA Run Results (2026-07-24)

Plan: [qa-access-test-plan.md](qa-access-test-plan.md). Target: https://forma360.io (prod).
Runner: Claude via Chrome extension. OTP read from `filippo199@gmail.com`.

## Entity ID map (fill during provisioning — needed for S4/S5 direct-URL probes)

### Tenant A — "Northwind Facilities"  (owner A0 = filippo199+testa@gmail.com)
| Entity | Name | ID / URL |
|---|---|---|
| Tenant A owner login | Alice Admin | filippo199+testa@gmail.com — signed in ✓ |
| Site Manchester | | |
| Site Manchester/Floor 1 | | |
| Site London | | |
| Group North Team | | |
| Group South Team | | |
| Site Manchester | | (created) |
| Site London | | (created) |
| Group North Team | | (created, Manual) |
| Group South Team | | (created, Manual) |
| Template T-Open | T-Open | 01KY9Q788TXPVS5PF55M29J08R — All users |
| Template T-North | T-North | 01KY9QBRR35P5MSNAXY0YQVSZY — rule→North Team |
| Template T-Mcr | | |
| Template T-NorthMcr | | |
| Template T-South | T-South | 01KY9QQKFGDKM3VWM38SA17K1D — rule→South Team |
| Template T-Invalid | | |

**Invite accept links (7-day expiry, from Gmail):**
- A2 north: `https://forma360.io/en/invite/85dd4412634975ac8287621a39e64f668132e602a7c3ac796a7c2d071f5f4d59`
- A3 south: `https://forma360.io/en/invite/5398154fb1adfeabcba1b1de41a96c33ac3756750161647ca02cb42866396397`
- A1 mgr: `https://forma360.io/en/invite/93ea1c66e05d6b8d099a2dbab5b80698c6161336207c0a7d9b227a82e2fa4f8a`

_Note: T-Mcr / T-NorthMcr / T-Invalid deferred — 3-template group oracle (T-Open/T-North/T-South) is sufficient for the first S3/S4 pass._

### Tenant B — "Southgate Group"  (owner B0 = filippo199+orgb@gmail.com)
| Entity | Name | ID / URL |
|---|---|---|
| Tenant B owner login | Bob OrgB | filippo199+orgb@gmail.com |
| Template B-Secret | | |

---

## Bug log
| ID | Sev | Module | Actor | Path | Expected | Actual | Evidence | Repro |
|---|---|---|---|---|---|---|---|---|
| **B6 (FIXED ✓ verified live)** | **S6 (feature dead-end / whole path unreachable in UI)** | Inspections / signature workflow | C0 (Carol, Tenant C) | template with a signature workflow → conduct → submit → status page | Submitting a signature-workflow inspection should route the signatory to a page where they can sign | ~~Submit sets status `awaiting_signature_workflow`, but the status page only branched on `awaiting_signatures` (a different, item-level mechanism) → **no branch matched → blank card**. The signatory had no way to sign; the entire workflow-signing feature (a fully-built, tested backend: `signWorkflow`, signer rows, request/completion emails) was unreachable from the UI.~~ **FIXED** in `7b4a54a`: `inspections.get` now returns `viewerCanSignWorkflow` (server-computed, mirrors `signWorkflow`'s sequential/parallel turn rules) + name-enriched signers + `viewerSignerName`; status page gains an `awaiting_signature_workflow` branch (signer roster + inline SignaturePad when it's the caller's turn, else a "waiting" message). 3 backend tests added. **Verified live** (deploy 59096087): inspection 01KYA14R3NC1Y3KYFXMYE9QEED status page now shows "Awaiting signatures · 0 of 1 · Carol Test Pending · Your signature is required" + the pad pre-filled "Carol Test" (was blank). | before ss_7860jmcmk (blank card); after ss_6532urv5i (roster + pad) | Submit any template with an enabled signature workflow |
| **B7 (FIXED ✓ verified live)** | S5 (feature incompleteness / discoverability) | Inspections / signature workflow | C0 (Carol) | in-app discovery of pending signatures | A signatory who misses the request email should be able to find inspections awaiting their signature in-app | ~~`inspections.listAwaitingMySignature` was fully built + tested but had **zero** web consumer → the only way to reach a pending signature was the email link.~~ **FIXED** in `7765391`: new `AwaitingSignatureBanner` at the top of `/inspections` lists the caller's pending signatures (sequential: only their turn; parallel: all pending) and deep-links each to the status page; renders nothing when empty. 4 i18n keys × 10 locales. **Verified live** (deploy 48eb40f6): banner "✏ 1 inspection awaits your signature" (ICU singular correct) → Sign → status page → after signing, queue empties and the banner disappears. Follow-up to B6. | ss_30350rv4v (banner), ss_85027w6s6 (empty after) | — |
| **B3 (FIXED ✓ verified live)** | **S2 (broken access control / IDOR)** | Templates API | A3 (South, Standard) | tRPC `templates.get` / `templates.getVersion` by id | A user who can't see a template (list hides it) must not be able to read its content by id either | ~~As A3, `templates.get(T-North)` returned HTTP 200 with T-North's full content~~ — the `get`/`getVersion` endpoints gated only on `templates.view`+tenant, not the access rule. **FIXED** in commit `6d87a52`: both now apply the same rule as `list` for non-managers (managers bypass); conduct unaffected (reads via `inspections.get`). **Verified live post-deploy (c7dacbcf)**: A3→T-North now **403 FORBIDDEN**; A3→T-South (own team) **200**; A3→T-Open (public) **200**. Blocked without over-restricting. | ss_53731waww (200 leak, before) | — |
| **B4 (FIXED ✓ verified live)** | **S2 (core feature broken)** | Inspections / conduct | A1 (Mandy Manager) | conduct → answer "Site conducted" → submit | Selecting the "Site conducted" site should set `inspection.siteId` so the report shows the site and site-filtering finds the inspection | ~~The site answer saved into `responses` but `inspection.siteId`/`siteName` stayed null → report showed "Site conducted —" and the inspection was invisible to `?site=` filters / Sites-overview / `{site}` token.~~ **FIXED** in commit `cf84bbd`: new `syncConductedSite()` resolves the first `type:'site'` response, validates the site belongs to the tenant, and writes `inspection.siteId` on every `saveProgress` and on `submit` (also used for actions raised on submit). 2 regression tests added (happy path + cross-tenant-id rejection). **Verified live** (deploy 17455a82): new inspection 01KY9YA1Z2RBB6EFVGSQRTB1FJ → after selecting Manchester, `siteId`+`siteName` populated; **report shows "Site conducted: Manchester"** (ss zoom). Schema comment (template-schema.ts:606) confirmed the intent: "'site' auto-populates the inspection's site". | before ss_1211gelkd ("—"); after: report shows "Manchester" | — |
| **B5 (FIXED ✓ verified live)** | S3 onboarding | Observations | new tenant | /observations/new | A fresh tenant should be able to report an observation without a manual setup detour | ~~Report-observation form is category-gated and a fresh tenant had **no categories** → empty dropdown, no way forward.~~ **FIXED** in `41c2187`: `signUpWithTenant` seeds 4 defaults (Hazard, Near miss, Quality, Environmental) in the same tx as permission sets; admins can rename/archive/add. Test asserts the seed. **Verified live**: new tenant "Contoso Test" → dropdown shows the 4 defaults → created OBS-000001 end-to-end. | ss_06039nbq2, ss_478890ftx | — |
| B2 (FIXED ✓ verified live) | S4 minor / UX | Settings / My profile | A2 | /settings/profile | "Your permission set" should show the set **name** ("Standard") | ~~Showed raw ULID~~ → **FIXED** in commit `0c991b6`: `users.get` now resolves the set name via leftJoin; profile shows "Standard". Verified live post-deploy (902c95f3). | ss_1244x4sqh (before), profile now shows "Standard" | — |
| B1 (FIXED ✓ verified live) | S2 (silent over-permission) | Templates / Visibility | A0 | template editor → Visibility step | Setting "Specific groups & sites" + a group and then clicking the top-right Publish should publish WITH that restriction | ~~Selecting a group then clicking the top-right Publish (rather than the card's Save/Publish) silently discarded the selection → template published "visible to everyone".~~ **FIXED** in commit `638c8fa`: on the Visibility tab the top-bar Publish now always commits the current audience (save→publish), saving any dirty draft first. **Verified live**: repro (new template → Visibility via stepper → Specific + North Team → top-right Publish) now publishes T-B1-Regression with Access = "[auto] Template: T-B1-Regression" (restricted), NOT "All users". | ss_1411d0pjw (before), ss_4563vp28o (after: restricted) | — |

## Coverage matrix
| Test ID | Actor(s) | Result | Bug | Notes |
|---|---|---|---|---|
| S1.1 Sign-up new tenant | A0 | PASS | — | Alice Admin / Northwind Facilities created; landed in empty app |
| S1.2 OTP delivery | A0 | PASS | — | Code arrived <60s (051075), Gmail-read worked |
| S9.2 Empty state (templates/sites/groups/inspections) | A0/A2 | PASS | — | Proper empty states everywhere, no skeletons |
| **S3.1 Group visibility oracle — North** | A2 (North/Manchester, Standard) | **PASS** | — | Start-inspection template picker shows **T-North + T-Open only; T-South correctly ABSENT**. ss_2459r9mje |
| **S3.1 Group visibility oracle — South (paired negative)** | A3 (South/London, Standard) | **PASS** | — | Picker shows **T-South + T-Open only; T-North correctly ABSENT**. Perfect mirror of A2 → cross-group template isolation is enforced BOTH directions. ss_9415mrgpl |
| S1.5-partial Invite accept + OTP login | A2 | PASS | — | Invite link → confirm name → OTP emailed → signed in as North Worker |
| S2.3 Standard user settings gating | A2 | PASS | — | /settings shows only "My profile"; no Users/Company/Permissions/Groups tabs |
| S4.4-partial Admin page direct URL | A2 | PASS | — | Direct nav to /templates redirected to /settings/profile (admin-gated layout) |
| **S4 IDOR — templates.get/getVersion by id** | A3 (South) | **PASS (after B3 fix)** | B3 | Was a leak (200) → now 403 for forbidden template; 200 for own/public. Server enforces access rule on the read path. |
| S2.5 Server-side enforcement — inspections.create | (code-verified) | PASS | — | inspections.create loads caller memberships + resolveAccessRule → FORBIDDEN if not satisfied (templates.ts:567-617). Live E2E not yet run. |
| **S5.1 Cross-tenant list isolation** | B0 (Tenant B admin) | **PASS** | — | B0 sees 0 of Tenant A's templates, sites, users. All lists empty. ss_2056npy5l / ss_5490hruwp / ss_7406rzma2 |
| **S5.3 Cross-tenant read by ID** | B0 | **PASS** | — | `templates.get(A's T-North id)` from B0's admin session → **404 NOT_FOUND** (tenant-scoped query, no row). Even admin + known id can't cross the tenant boundary. |
| **S3.2 Manager bypass** | A1 (Mandy Manager, North) | **PASS** | — | Start-inspection picker shows **all 4 templates** (T-Open, T-North, T-South, T-B1-Regression) incl. South-only, despite A1 being only in North. Managers hold templates.manage → bypass filter. ss_95424umg4 |
| S7.2 Inspection lifecycle (conduct→submit→complete→report) | A1 | PARTIAL PASS | B4 | Start → fill Title page → answer question → submit → **Completed**; report renders (Title+Page1) with PDF/Word/Share buttons; "Prepared by" = full name. BUT the answered **site is missing from the report** (B4). Responses persist correctly with normal timing. |
| S4 IDOR — inspections.create | (code-verified) | PASS | — | create loads memberships + resolveAccessRule → FORBIDDEN if unsatisfied (inspections.ts:567-617). Live E2E deferred. |
| B3 regression unit tests | — | PASS | — | 2 tests added to templates.test.ts (commit 812df61); non-member→FORBIDDEN, member/manager→ok, open template→ok. All green. |
| B4 fix downstream validation | A1 | PASS | — | After the fix, the Manchester **site overview shows the conducted inspection** (000003) under "Inspections: 1"; pre-fix inspections (siteId null) correctly absent. Full chain works: answer site → siteId set → report shows it → site overview links it. ss_9275ivsiq |
| B4 regression unit tests | — | PASS | — | 2 tests in inspections.test.ts (commit cf84bbd): saveProgress+submit populate siteId; cross-tenant site id ignored. |
| S7.9 Schedules (create/recurrence/materialise) | A1 | PASS | — | Create schedule for T-Open, weekly Mon 09:00 Europe/London, assigned North Team; **human-readable summary** correct ("…every Monday at 09:00…"); saved → detail page (Pause/Materialise/Delete); "Materialise now" → job enqueued. Clean. ss_62362t75d |
| S7.5 Actions (standalone create) | A1 | PASS | — | Create action "Fix warehouse door hinge" with Site=Manchester → AC-000001 Open; detail page shows all fields, site saved, recurrence option, Share/Archive. Board (Open/In-progress/Completed/Cancelled) + List/Board + saved views present. Clean. ss_2440mss81 |
| S7.10 Observations (create + fresh-tenant) | A1 / Tenant C | PASS (after B5 fix) | B5 | Fresh tenant now has 4 seeded categories → select Hazard → fill title → submit → OBS-000001 created end-to-end. Detail page (Category/Assignee/Priority/Reported-by) renders. |
| **S7.3 Signature workflow (configure → submit → sign → complete)** | C0 (Carol, Tenant C) | **PASS (after B6 fix)** | B6 | Built "Sign Test" template → enabled signature workflow (Sequential, 1 signatory=Carol) → published → conducted (site Head Office) → submitted → status `awaiting_signature_workflow`. Pre-fix: blank status card (dead-end). Post-fix (deploy 59096087): status page shows roster "Carol Test — Pending", "0 of 1 signatures collected", "Your signature is required" + SignaturePad pre-filled "Carol Test". **Full loop verified**: drew signature → Save → "Signature saved" → status flipped to **Completed** ("All signatures and approvals are in", Completed 24/07/2026 13:39) with View report / PDF / Word / Share link. ss_6532urv5i (pad), ss_10892eeig (completed) |
| **S7.3b Signature-workflow discoverability (banner)** | C0 (Carol) | **PASS** | B7 | AwaitingSignatureBanner on /inspections lists Carol's pending "Sign Test" ("✏ 1 inspection awaits your signature", ICU singular) → Sign button deep-links to the status page → after signing, queue empties and banner disappears (empty-state correct). ss_30350rv4v, ss_85027w6s6 |
| **S3.3 Documents folder visibility by group + parent cascade** | A0 admin / A2 North / A3 South | **PASS** | — | Alice created folders: **North Only**→North Team, **South Only**→South Team, **Shared All**→public, + unrestricted child **North Sub (inherits)** inside North Only. Oracle held both directions: **A2 (North)** sees North Only ▸ North Sub + Shared All, **South Only absent**; **A3 (South)** sees South Only + Shared All, **North Only + North Sub both absent**. Key result: the empty-ruled child does **not** leak to South — parent restriction cascades. Admin sees all (bypass). ss_2467dwqii (A2), ss_2768oia0x (A2 child), ss_7634b38cb (A3 mirror) |

## Observations (non-bug)
- Fresh-tenant observation form blocks on an empty category dropdown (see S7.10) — onboarding-friction candidate, not a defect.
- Schedule detail, action detail, and all pickers correctly show tenant sites (Manchester/London) — no cross-tenant leakage in any picker checked.
| S1.3 Invite flow assigns set+group+site at invite | A0 | PASS | — | Invite form has Permission-set dropdown + group checkboxes + site checkboxes; all assigned at invite time (no post-accept step). A1/A2/A3 invited, emails sent, pending rows correct |
| S7.11 Site create (Site vs Project type toggle) | A0 | PASS | — | Selecting "Site" correctly hides Project-only fields (Client/dates/status); Manchester+London created |
| S7.13 Group create (manual mode) | A0 | PASS | — | North Team + South Team created |

## Observations (non-bug, worth noting)
- Sidebar terminology default = "Sites & Projects"; nav = AI Assistant, Sites & Projects, Inspections, Observations, Actions, Heads Up, Assets, Documents, Contractors, Settings.
