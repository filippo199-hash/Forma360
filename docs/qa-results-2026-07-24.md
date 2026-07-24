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
| **B13 (FIXED ✓ verified live)** | **S4 (broken primary CTA / UX)** | Heads Up / composer | any publisher | New heads up → fill → click **Publish** | The "Publish" button should publish the heads-up (status → Published, recipients notified) | ~~The composer's `save(andPublish)` called the **same** `headsUps.create` for both buttons — and `create` always writes `status:'draft'`; `andPublish` only set a *scheduled* `publishAt`. So clicking "Publish" (no schedule) created a **draft** and toasted "Saved as draft" — the primary CTA never published (the unused `publishedToast` i18n key betrayed the intent). Users had to save → open detail → click Publish again.~~ Found live in S7.6: composer "Publish" → status Draft. **FIXED** in `75beed1`: immediate Publish now chains `create → headsUps.publish({headsUpId})` (publish resolves recipients from the just-stored `recipientSpec`, incl. broadcast-to-all — same as the working detail-page Publish); scheduled publishAt still creates a draft. **Verified live** (deploy a49464f3): composer "Publish" → status **Published** + toast **"Heads up published"** (4 recipients), not a draft. ss_54624auru | new/page.tsx `save()` create-only; live "Saved as draft" after Publish | New heads up → Publish (no schedule) → lands as Draft (pre-fix) |
| **B12 (FIXED ✓ verified live)** | **S1 (PII / GDPR — incomplete anonymisation)** | Settings / users.anonymise (S-E09) | admin | anonymise a user | Anonymisation must scrub **all** PII so the person is unidentifiable and can't log in | ~~`users.anonymise` overwrote `name` + `email` (tombstone) + set `deactivatedAt`, but never touched `firstName`/`lastName`/`phone` — columns added *after* the handler shipped (migrations 0025, 0032). Since the UI renders "firstName lastName" everywhere, an anonymised user's **real name (and phone) survived across the whole app.**~~ Found live during S6: anonymising A3 left `name`="Anonymised User"/`email` tombstoned but `firstName`="South"/`lastName`="Worker". **FIXED** in `e0f9714`: scrub `firstName`/`lastName`/`phone` → null in the same tx; S-E09 test strengthened to seed + assert them. **Verified live** (deploy 8833214e): re-anonymising A3 on the fixed build → `firstName`/`lastName` now **null** (were "South"/"Worker"). | code: users.ts anonymise `.set()` missing first/last/phone; live before/after A3 | Anonymise any user with a first/last name → their real name still shows (pre-fix) |
| **B9 (FIXED ✓ verified live)** | **S2 (visibility leak via AI, MEDIUM)** | AI assistant `list_documents` | non-manager | ask the assistant "list our documents" | The AI must only surface documents the user can see (same folder/group/site visibility as `documents.list`) | ~~The `list_documents` agent tool queried `documents` filtered **only by tenant**, bypassing the B8 per-folder/group/site filter → a South user could ask the assistant to list documents and get the **names + ids of North-only documents**. (Content download was already blocked by B8; this leaked existence/names.)~~ **FIXED** in `5ea03b2`: routed through the user-scoped tRPC caller (`caller.documents.list`), reusing the B8 non-manager filter; added to `CALLER_TOOL_NAMES` with a test asserting the invariant. Surfaced by the cross-module IDOR audit. **Verified live** (deploy cba49d6f): as South Worker, asked the AI "List every document we have, by name" → **"There are no documents registered for this company yet — the document list is empty"** (the tenant's only doc is the North-only "B8 North Secret", correctly hidden). ss_3879g2yas | ai-agent.ts pre-fix `from(documents)` tenant-only | Ask the AI assistant to list documents as a non-member of the folder's group |
| **B8 (FIXED ✓ verified live)** | **S1 (broken access control / IDOR — file-content disclosure, HIGH)** | Documents API + download route | any tenant user | tRPC `documents.get`/`versions`/`signatureRequests` + `GET /api/documents/download?documentId=` | A user who can't see a folder (list hides it) must not be able to read/download its documents by id either | ~~`documents.list` filters by folder + own group/site visibility, but the by-id reads checked **only tenant ownership**. `documents.get`/`versions.list` (both `documents.view`, held by Standard) returned the doc + storage keys; and `/api/documents/download` (session-only, no visibility, not even a permission check) **302-redirected to a signed R2 URL for the actual file**. A South-team Standard user could download a North-only file by id — full cross-group content disclosure.~~ **FIXED** in `48f619e`: new `isDocumentVisibleToUser` (reuses the exact own+ancestor-folder predicates `list` uses); `get`/`versions`/`signatureRequests` assert it for non-managers → FORBIDDEN; download route checks perms + visibility → 404 for hidden docs (managers/admins bypass, parity with `list`). Regression test added. Heads-up attachments use a separate route (unaffected). **Verified live** (deploy 48389558): uploaded "B8 North Secret" into the North-only folder (id 01KYA3TVV2WZ9PWZ77A2NJ3R4G). As **Alice(admin)** the download → `opaqueredirect` (302→R2 file) + get → 200; as **South Worker (non-member)** the *identical* requests → **download 404, get 403 FORBIDDEN, versions FORBIDDEN, list absent**. IDOR closed; admin bypass intact. | code: download/route.ts pre-fix tenant-only `where`; test: documents.test.ts B8; live probe admin-vs-South | As South Standard user, `GET /api/documents/download?documentId=<north-only doc>` returned the file (pre-fix) |
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
| **S4 IDOR — documents by-id read/download** | A0 admin (control) / A3 South (attacker) | **FAIL→FIXED ✓ verified live** | B8 | Static audit (prompted by the B3 pattern) found list filters visibility but `get`/`versions`/`signatureRequests` + `/api/documents/download` did not → cross-group file-content disclosure. Fixed + regression-tested. **Live probe** (post-deploy 48389558): a North-only doc served to admin (302→file / get 200) is blocked for South non-member on all 4 paths (download 404, get/versions FORBIDDEN, list absent). |
| **S6.1 Last-admin guard (S-E02)** | A0 (sole admin) | **PASS** | — | As the only Administrator, `permissions.assignToUser(self→Standard)` → blocked "You are the last administrator…"; `users.deactivate(self)` → blocked "Cannot deactivate yourself." Both server-enforced. |
| **S6.2 Permission-set reassignment** | A0 → A2 | **PASS** | — | `permissions.assignToUser(A2, Manager)` flips A2's set to Manager; revert to Standard clean. Server derives perms live from the set (no stale server cache). |
| **S6.3 Cascade preview + rule invalidation (G-E06)** | A0 | **PASS** | — | `admin.previewDependents({entity:'group'})` accurately reports `accessRules: 1` (the referencing rule) + 0 elsewhere; after `groups.archive`, the rule appears in `accessRules.listInvalid` — archiving a group invalidates rules referencing it. |
| **S6.4 Archive template pauses schedules (T-E05)** | A0 | **PASS** | — | Archiving T-Open flipped its schedule `paused:false→true` in the same tx; `inspections.create` on the archived template → "Cannot start an inspection on an archived template". |
| **S6.5 User anonymise (S-E09)** | A0 → A3 | **PASS (after B12 fix)** | B12 | Anonymise requires deactivation first + a matching `confirmEmail` (wrong → "Confirm email does not match"). Found B12 (first/last/phone not scrubbed) → fixed → re-anonymise scrubs all PII. |
| **S6.6 Site FK integrity** | A0 | **PASS** | — | Created a throwaway site + linked asset; `sites.archive` → the asset survives (get + list, no orphan crash), keeping its reference to the now-archived (still-existing) site. Hard-delete `ON DELETE SET NULL` is DB-enforced (migration 0051) + unit-tested; the UI exposes only archive. |
| **S7.6 Heads-up publish** | A0 | **PASS (after B13 fix)** | B13 | Composer (title/description/engagement=Acknowledge/Send-to=Everyone) + live preview works. **Detail-page Publish is a real mutation**: Draft→Published, "Published to 4 recipients", recipients resolved from spec. The composer "Publish" saved a draft (B13) → fixed to chain create→publish → **now publishes directly** (verified live). |
| **S7.7 Assets & maintenance** | A0 | **PASS** | — | Asset create + detail (Overview/Readings/Maintenance/Media/Actions/Inspections/Observations tabs render, no crash even with an archived site ref). **Reading** recorded via `assets.readings.add` ("Hours run=1234"). **Maintenance program** "Quarterly service" created + listed. **Contractor↔asset link**: Acme Subcontractors linked + shows in `listForAsset`. Detach/resync backend-tested. |

## Observations (non-bug)
- Fresh-tenant observation form blocks on an empty category dropdown (see S7.10) — onboarding-friction candidate, not a defect.
- Schedule detail, action detail, and all pickers correctly show tenant sites (Manchester/London) — no cross-tenant leakage in any picker checked.
| S1.3 Invite flow assigns set+group+site at invite | A0 | PASS | — | Invite form has Permission-set dropdown + group checkboxes + site checkboxes; all assigned at invite time (no post-accept step). A1/A2/A3 invited, emails sent, pending rows correct |
| S7.11 Site create (Site vs Project type toggle) | A0 | PASS | — | Selecting "Site" correctly hides Project-only fields (Client/dates/status); Manchester+London created |
| S7.13 Group create (manual mode) | A0 | PASS | — | North Team + South Team created |

## Observations (non-bug, worth noting)
- Sidebar terminology default = "Sites & Projects"; nav = AI Assistant, Sites & Projects, Inspections, Observations, Actions, Heads Up, Assets, Documents, Contractors, Settings.
- Northwind (Tenant A, created before the B5 fix) has **no observation categories** — B5 only seeds *new* tenants; it does not backfill existing ones. So the observations module is unusable for any pre-B5 tenant until an admin adds a category (Observations → Categories). Minor; go-forward is covered by B5. Candidate: a one-time backfill (seed defaults for any tenant with zero categories) — **not done** (would touch real-tenant data; needs a decision).

## Cross-module IDOR audit (after B3 + B8)

Both B3 (templates) and B8 (documents) were the same bug class: **`list` applies a per-row visibility/access filter for non-managers, but the by-id `get`/download skips it.** Audited every module's read paths for a recurrence (4 parallel agents + manual review of search/AI). Result: **the class does NOT recur** — templates + documents were the only two modules with per-row read visibility, and both are now fixed.

| Module(s) | `list` per-row-filters for non-managers? | Verdict |
|---|---|---|
| issues, actions | No — tenant + `X.view`; access-rule gates **create** only | NO BUG (symmetric) |
| assets, heads-up | No — tenant + `X.view` | NO BUG (symmetric) |
| inspections, schedules, inspectionsExport, exports (+ PDF/DOCX routes, share-links) | No — tenant + `inspections.*`; template access-rule gates **create** only | NO BUG (symmetric) |
| siteMedia, sitePlans, sites, contractors (+ `/api/files`) | No — tenant + `X.view` | NO BUG (symmetric) |
| search (`search.global`) | **Yes for documents** — and it correctly applies the folder/group/site filter (search.ts:186-203); doesn't search templates | CORRECT |
| **AI assistant `list_documents`** | Should mirror `documents.list` but queried tenant-only | **B9 — FIXED** |

**Two design gaps surfaced (NOT the audited class; ADR-deferred — need a product decision, not fixed):**
1. **Inspection reads don't re-check the pinned template's access rule.** A template's access rule is enforced at `inspections.create` but never at read (list/get/export/share are symmetric tenant+`inspections.view`). So a tenant member with `inspections.view` can read/export any inspection instance of a restricted template. ADR 0007 explicitly defers read-path gating. Policy question: should inspection reads inherit the template's access rule?
2. **Contractor portal users get tenant-wide `*.view`.** `contractor-activities.ts` (L10-11) explicitly states data-level scoping is "a later refinement" — an activity grants `inspections.view`/`issues.view`/`actions.view`/`documents.view` **across the whole tenant**, so a portal contractor can read all tenant inspections/issues/actions (not just their own contractor's). Documents are already narrowed by the B8 non-manager filter; the others are not. A real scoping weakness, deferred by design. Recommend scoping portal reads to the contractor's own records.

### Both gaps closed on request (2026-07-24)

The two "deferred design" gaps above were subsequently **implemented** (user: "do all of it").

- **B10 — inspection reads gated by the template access rule** (commit `70ef460`). Extends the B3 template-content gate to instances: `inspections.get` → FORBIDDEN and `inspections.list` → filtered for a non-manager who fails the pinned template's access rule; `exports.requireInspection` (renderPdf/renderDocx/createShareLink/**listShareLinks**) applies the same gate (closes the `inspections.view`-level share-token leak). Managers bypass. New `packages/api/src/access-rule.ts`; ADR 0007 addendum records read-visibility vs the evidence snapshot. Tests: inspections.test (non-member get/list forbidden/filtered, member+manager pass, open template still visible) + exports.test (share reads/mint forbidden for a non-member holding export).
- **B11 — contractor portal reads scoped to their own contractor** (commit `856e0eb`). New `packages/api/src/contractor-scope.ts` (`loadContractorScope`); `inspections`/`issues`/`actions` list+get constrain rows to those authored (issues: `reportedByUserId`; actions: `createdBy` OR `assigneeUserId`) within the caller's contractor. Internal users unaffected. Test in `read-authz.test.ts`: two contractors' portal users see only their own actions; get on another contractor's / an internal record → NOT_FOUND; admin unrestricted. `contractor-activities.ts` header updated.
  - **Residual (documented, not yet done):** secondary by-id sub-reads (signatures / comments / share-links keyed by an entity id) are not yet contractor-scoped; the portal UI does not expose them. Follow-up task spawned.

Full API suite green after both: **271 tests / 28 files**.

**B11 verified live (contractor portal, deploy d64302ed):** As Alice, created contractor "Acme Subcontractors" → invited portal user Sam (filippo199+contractor@gmail.com; Inspections/Observations/Actions) → accepted via email + OTP → onboarding gate → portal home. As **Sam**, `actions.list` = **0** and `inspections.list` = **0** despite Tenant A holding internal records (A1's AC-000001, Alice's inspections). Sam then created an action → their list shows **exactly 1** ("Sam contractor task", **AC-000002**); the AC-**000002** counter proves AC-000001 exists internally yet is invisible to Sam. Portal Actions board renders only Sam's card. Two-directional: own records visible, all other records (internal + other contractors') hidden. ss_7264f2dr6.

B10 is covered by the inspections + exports unit/integration tests (non-member get/list forbidden/filtered, share reads/mint forbidden); no separate live probe run (the QA tenant had no restricted-template instance conducted by a non-member to probe).

## B14 — detail pages hang on an infinite loading skeleton for a stale/deleted/forbidden id (S9.3 error states)

**Severity: medium-high (broad).** Found while testing S9.3 (bad ids in detail-page URLs). Navigating to `/{locale}/inspections/{id}` with a nonexistent (or no-access) id sat on a loading skeleton **indefinitely** — verified stuck at **420 s** (7 min) on a real, online browser (`navigator.onLine === true`). The API was fine throughout: `inspections.get` returned `404 NOT_FOUND` in ~470 ms.

**Root cause (client-side, app-wide).** The React Query client (`apps/web/src/components/trpc-provider.tsx`) used a blanket `retry: 1`. On the 404 it scheduled a retry; with `networkMode: 'online'` React Query **pauses** a pending retry whenever its online-manager reports the browser offline — and that state can latch even while `navigator.onLine` is true (laptop sleep/wake, network handoff, VPN blip). The query stayed `status: 'pending'`, `fetchStatus: 'paused'`, `error: null`, `data: undefined` **forever**, so the page's not-found branch (which keys off `error`) never rendered. Confirmed by reading the live React Query cache state via the page's fiber tree.

**Fix (commit `04aa905`).** Replace `retry: 1` with `shouldRetryQuery` (new pure, unit-tested `apps/web/src/lib/trpc/retry.ts`): **never retry a definitive 4xx** (NOT_FOUND / FORBIDDEN / BAD_REQUEST …) — it won't succeed on retry, and skipping it sends the query straight to `error` so the page renders its not-found state immediately (no retry ⇒ no pause). Transient 5xx / network errors still retry once. Applies to **every tRPC query** in the app. 3 unit tests (4xx→no retry, 5xx→one retry, network→one retry).

**Second bug surfaced (commit `92d60a4`).** Even with the query reaching `error` fast, a page only shows not-found if it has an **error branch**. Two detail pages gated solely on `isLoading || data === undefined` → `<Skeleton>`:
- `sites/[siteId]/page.tsx` — no error branch at all.
- `templates/[templateId]/page.tsx` — had an error branch but as **dead code below** the loading gate (on error `data` is undefined, so the gate returned the skeleton first and the error block was unreachable).
Both fixed by moving the error check **inside** the loading gate with a NOT_FOUND-specific message. Added reusable `common.notFound` ("Not found.") across all 10 locales. (The inspections family — `[inspectionId]/{page,status,report,signatures}`, `approvals/[inspectionId]` — already had the correct in-gate error branch, so the retry fix alone resolves them.)

**Verified live (deploy `04aa905`):**
- Bad inspection id `01KY0000000000000000000000` → renders **"Inspection not found."** within ~3 s (was 420 s+ skeleton). ss_42490acnj (before) → alert (after).
- Valid inspection `01KY9YA1Z2RBB6EFVGSQRTB1FJ` → conduct page loads normally (Completed, doc 000003, full Details) — **no regression** from the retry change. ss_66510iyo3.
- Sites/templates bad-id pages: fix deployed in `92d60a4` (verification pending deploy).

| Case | Before | After |
|---|---|---|
| S9.3 bad inspection id | infinite skeleton (7 min+) | "Inspection not found." in ~3 s ✓ |
| S9.3 bad site id (`sites/[id]`) | infinite skeleton | "Not found." (92d60a4) |
| S9.3 bad template id (`templates/[id]`) | infinite skeleton (dead error branch) | "Not found." (92d60a4) |
| valid inspection id | loads | loads (no regression) ✓ |

**Residual (minor, not fixed):** the `enabled: id.length === 26` gate means a *malformed-length* id (e.g. a truncated link) disables the query entirely (never fires) → still an infinite skeleton. Rare (deep-links carry full 26-char ULIDs); a follow-up could render not-found when the id is structurally invalid.

### B14 systemic sweep — every detail page (2026-07-24)

After fixing sites/templates I swept **all** detail-page routes for the same "skeleton with no reachable error branch" shape. The inspections family (`[inspectionId]/{page,status,report,signatures}`, `approvals/[inspectionId]`) was the **only** group already correct. Six more pages hung on a bad id:

| Page | Bug shape | Fix (commit `6d5bcf0`) |
|---|---|---|
| `schedules/[scheduleId]` | no error branch | in-gate `<DetailNotFound>` |
| `contractors/[contractorId]` | no error branch | in-gate `<DetailNotFound>` |
| `actions/[actionId]` | no error branch | in-gate `<DetailNotFound>` |
| `assets/[assetId]` | no error branch | in-gate `<DetailNotFound>` |
| `heads-up/[headsUpId]` | no error branch | in-gate `<DetailNotFound>` |
| `observations/[observationId]` | not-found block was **dead code below** the gate | moved above gate; kept back-link; `<DetailNotFound>` message |

New shared `apps/web/src/components/detail-not-found.tsx` owns the `common.notFound` / `common.error` distinction so the pattern is one component, not eight copies. All six queries throw NOT_FOUND server-side (verified in the routers). typecheck + lint + the retry unit test all green.

**Verified live — all 9 detail-page families** (deploys `04aa905` / `92d60a4` / `6d5bcf0`). Each bad id `01KY0000000000000000000000` renders a not-found alert in ~3 s with **0 skeletons** (was 7 min+):

| Page | Result |
|---|---|
| `inspections/{id}` | "Inspection not found." ✓ |
| `sites/{id}` · `templates/{id}` | "Not found." ✓ |
| `actions/{id}` · `assets/{id}` · `schedules/{id}` | "Not found." ✓ |
| `heads-up/{id}` · `contractors/{id}` | "Not found." ✓ |
| `observations/{id}` | "Not found." + back-link ✓ |
| valid `inspections/{id}` | loads normally (no regression) ✓ |

**Net B14 outcome:** every detail page in the app now resolves a stale/deleted/forbidden id to a not-found message in ~3 s instead of an infinite loading skeleton. Root fix (no-retry-on-4xx) is global; per-page error branches make each page render that state. Three commits: `04aa905` (retry predicate + tests), `92d60a4` (sites/templates + `common.notFound` ×10 locales), `6d5bcf0` (6 pages + shared component).

## S8.3 — Gate kiosk (public, unauthenticated) — PASS, no security bug

The contractor gate kiosk exposes two **public** procedures (`contractors.gate.publicByToken` read, `selfCheckIn` write). Adversarially reviewed + probed:
- **Token = capability, high entropy:** `regenerateToken` = `randomBytes(24).toString('hex')` → **48 hex chars / 192-bit** (live-confirmed `tokenLen:48, hex:true`). Not brute-forceable/enumerable. Only exposed to authed managers (`gate.config`/`regenerateToken` require `contractors.manage`).
- **All reads/writes scoped to the token's tenant.** `publicByToken` derives `tenantId` from the token then filters every query by it; `selfCheckIn` resolves `tenantId` from token and loads the visit via `loadVisitOrThrow(db, tenantId, visitId)` (`and(eq(tenantId), eq(id))`) — a **cross-tenant visitId → NOT_FOUND**, so a token-holder cannot check-in another tenant's visit.
- **Bad token → NOT_FOUND** (live, unauthenticated: `badTokenStatus:404`). No crash/leak.
- **No stored XSS:** `capturedFields` = `z.record(fieldId, z.string().max(2000))`; **no `dangerouslySetInnerHTML`** anywhere in the contractor/gate UI → React escapes values.
- **Live:** generated a token for Northwind (throwaway tenant), then an **unauthenticated** (`credentials:'omit'`) `publicByToken` returned `200` with tenant-scoped (empty — no in-window visits) data. ✓

Inherent trust model (whoever has the kiosk token can operate the kiosk) is by design; mitigation is token secrecy + `regenerateToken`. No rate-limit on the public write (low-severity availability note; needs the token).

## S7.4 — Issue → action conversion — PASS (API + UI, bidirectional)

Live in Northwind (seeded a category + observation, both were 0 before): observation **OBS-000001** → `actions.createFromIssue` → action **AC-000003** (priority high). `createFromIssue` stamps `sourceType:'issue'`, `sourceId`, writes a `created` activity.
- **Linkage (API):** `actions.list({sourceType:'issue', sourceId})` returns exactly the one action (`linkedMatch:true`).
- **Forward (UI):** observation detail → **Actions** tab shows "Replace leaking valve" / Open / High, linking to `/actions/{id}`.
- **Reverse (UI):** action detail shows "Linked to observation OBS-000001 — S7.4 leaking valve near pump" + Open button.
- **Regression:** both `observations/[id]` and `actions/[id]` render normally post-B14 (the moved/added error branches didn't break the happy path).

## B15 — deep links are lost on login (S9.6 deep-link-after-login)

**Severity: medium (UX / notification links).** An unauthenticated user who clicks a deep link — an email notification (heads-up, action assignment, schedule reminder), a shared observation, a bookmark — was bounced to the marketing homepage and, after signing in, landed on `/templates`, **never the page they clicked**.

**Root cause.** All 13 module layouts gate on session and, when null, did `redirect(\`/${locale}\`)` — discarding the intended path (no `?next=`/`callbackUrl`). Post-OTP, `sign-in-card.tsx` hard-navigated to `\`/${locale}/templates\`` unconditionally. **Confirmed live:** an unauthenticated (`credentials:'omit'`) request to `/en/inspections/{id}` → `opaqueredirect` → `finalUrl: https://forma360.io/en`, path dropped.

**Fix (commit pending).** New pure helper `apps/web/src/lib/sign-in-redirect.ts`:
- `signInHref(locale, pathname)` → `/{locale}/sign-in?next=<path>` (used by all 13 layouts, reading the path from the middleware's `x-pathname` header). Deep links now go **straight to sign-in** carrying their destination (skips the marketing bounce).
- `safeNextPath(next, locale)` — the **open-redirect guard** (the security boundary, since `next` is attacker-controllable): a destination is honoured only if it starts with `/{locale}/`, isn't protocol-relative (`//host`), and has no backslash tricks; otherwise falls back to `/{locale}/templates`. Used by the sign-in page (already-signed-in redirect) and `sign-in-card.tsx` (post-OTP navigation).
- 6 unit tests cover the guard (accepts local paths; rejects `https://`, `//host`, `/\evil`, cross-locale, empty/null).

**Behaviour change (intentional):** an unauthenticated hit to a protected route now lands on the **sign-in page** (with the deep link preserved) rather than the marketing homepage. The `/{locale}` root still shows marketing. Sign-up + invite-accept flows keep their `/templates` landing (a brand-new user/invitee has no prior deep link). Verification pending deploy.
