# FreeHS — Documents module audit

**Module:** Documents (library, folders, labels, per-document access control, expiry reminders)
**Surface:** ~22 tRPC procedures across three routers · a dedicated visibility layer · 4 web routes · 1 worker · 3 permission keys
**Date:** 8 August 2026
**Deliverable:** 34 tests — 31 in `documents.audit.test.ts`, 3 in `document-expiry.audit.test.ts` — of which **3 fail on real defects**

---

## Why this module, and why this shape of audit

Documents is the module the rest of the platform leans on. RAMS packs, COSHH
sheets and fire risk assessments all hang their evidence off it, and it is the
**only** module that ships its own access-control layer on top of the
permission catalogue.

That layer is why the audit exists. `document-visibility.ts` implements four
interacting rules:

1. the document's own group/site visibility,
2. every ancestor folder's visibility, cascading down,
3. an explicit ACL grant on the document,
4. an explicit ACL grant on any ancestor folder,

and its own comment states that callers holding `documents.manage` *"must
bypass this themselves; this function makes no permission assumptions."*

Four interacting rules plus a manual opt-in, spread across a dozen read paths,
is precisely the shape that leaks exactly one path — and reading cannot prove
it doesn't. The only way to know is to build a restricted document and a viewer
outside the restriction, then ask every read path in turn.

## The headline: it holds

**DC-A01 to DC-A13 ask every read path the module exposes** — `list`, `get`,
`versions.list`, `signatureRequests`, the folder tree, and **global search**,
which reaches documents from outside the module entirely — with a real viewer
who is in no group and on no site.

Every path holds:

- a document restricted on its own row is hidden from a non-member and shown
  to a member;
- a **completely unrestricted** document inside a restricted folder is hidden,
  which is the rule a read path filtering on the document row alone would miss;
- so is one **two levels** below the restriction;
- an explicit user grant admits an outsider to exactly that document and not
  its unglanted sibling, and revoking it closes the door again;
- global search leaks nothing, and still finds the document for someone
  entitled to it;
- `documents.manage` bypasses everything, as documented.

The folder layer is equally solid: a folder cannot be its own parent, cannot be
reparented under its own descendant, and cannot be deleted while it holds
documents or sub-folders. Tightening a parent folder hides its contents
immediately, so the cascade is live rather than copied at filing time.

That last one matters more than it sounds. The cycle guard in
`makeFolderVisibilityChecker` seeds its memo with `true` before descending, so
a cycle would resolve to **visible** — an unreachable loop of folders readable
by everyone. The reparenting guards are what stand between that and production,
and they are correct.

---

## Findings

| ID | Severity | Finding | Root cause |
| --- | --- | --- | --- |
| **DC-T05** | High | **The visibility arrays are the one input not validated against the tenant.** `documents.update` carefully checks `siteId`, `responsibleUserId`, `responsibleGroupId` and `folderId` — and writes `visibleToGroupIds` / `visibleToSiteIds` straight through. They are plain `jsonb` with no foreign key, so a cross-tenant or stale group id persists cleanly and then matches nobody. The document is restricted to a group that does not exist in this tenant: readable only by managers, while the UI shows a rule that resolves to nothing. It is the single input that decides who may read the document, and it is the one nobody guarded. | `documents.ts:404-443` |
| **DC-T07** | Medium | **`documents.access.grant` performs no tenant check on `subjectId`.** The input is a bare `z.string().min(1).max(64)` with no `assertUsersInTenant` / `assertGroupsInTenant`. A cross-tenant or simply mistyped subject writes a grant row that grants nothing, and returns success — so an administrator believes they have shared a document with someone and has not. The failure is silent in the direction that matters: nobody complains about access they never knew they were promised. | `documents.ts:657-681` |
| **DOC-A01** | Medium | **The expiry reminder link is hardcoded to English.** `viewUrl` is built as `${appUrl}/en/documents/${id}` while the recipient's `locale` is carried right beside it and used only for the email body. A French-speaking document owner gets a correctly translated email pointing at the English page. This is the **third worker in three audited modules** to do exactly this — training TR-A9 and contractors CT-O03 were the same line — which makes it a platform pattern rather than three coincidences. | `document-expiry.ts:167` |

---

## Verified correct — no action

All asserted by passing tests, so the fix pass does not churn what is right.

**The access layer** — every point in the bullet list above.

**Folder integrity** — self-parenting refused, descendant-reparenting refused
(with a `seen` set that survives a pre-existing cycle), deletion refused while
the folder holds documents or sub-folders, and the visibility cascade applied
live on read rather than denormalised at write.

**Permissions** — every procedure in all three routers refuses a caller holding
no documents key; a `documents.view` holder can mutate nothing; and
`documents.folders.manage` is genuinely enforced apart from `documents.manage`,
so a user with document rights and no folder rights can create a document and
cannot create a folder. That last one is worth naming: the equivalent key in
Contractors (`contractors.gate`) turned out to gate nothing at all, so a
separate key that actually separates is not a given here.

**Tenancy** — the listing never returns another tenant's documents; a foreign
document id is unreadable through `get`, `versions` and `signatureRequests`,
and unmutatable through `update` and `archive`; a document cannot be filed into
another tenant's folder; a folder cannot be reparented under one.

**The expiry worker** — the per-recipient `try`/`catch` combined with a
`delivered` count means one bad mailbox neither blocks the stamp nor re-mails
everybody on the next run. That is **exactly** the case the contractors overstay
worker got wrong (CT-O02), and this worker gets it right, including the
"never stamp *told* when nobody was" guard. Both are now pinned so they cannot
regress quietly.

---

## What to fix first

1. **DC-T05** — run `visibleToGroupIds` and `visibleToSiteIds` through
   `assertGroupsInTenant` / `assertSitesInTenant`, which already exist and are
   already called four lines above for other fields. Roughly six lines.
2. **DC-T07** — same treatment for `subjectId`, branching on `subjectType`.
   Turning a silent no-op into a `BAD_REQUEST` is the whole fix.
3. **DOC-A01** — and, since this is the third occurrence, fix it as a platform
   pattern rather than a third one-off: a shared `appLink(appUrl, locale, path)`
   helper that every worker uses, so the next one cannot get it wrong.

---

## Three modules in

| Module | Tests | Defects | Character |
| --- | --- | --- | --- |
| Contractors | 52 | 18 | Cold audit, never reviewed |
| Training | 32 | 4 | Reviewed and fixed twice as prose |
| Documents | 34 | 3 | Never reviewed, but carefully built |

Contractors and Documents were both audited cold, and the results differ by a
factor of six. That is the useful signal: the runbook is not manufacturing
findings, it is measuring. Documents is the best-built module examined so far,
and its own access layer — the part most likely to be wrong — is the part that
is most right.

The recurring platform-level pattern is now visible because three modules have
been through the same lens: **workers hardcode `/en/` in the links they send.**
Three for three. That is a shared helper, not three tickets.

And the gap is unchanged. Everything here is router, worker and data. The web
layer — four routes and a folder-tree component — is reachable only by reading,
and Documents has no e2e spec at all. Three modules is more than enough
evidence: the next investment is the authenticated browser journey, not a
fourth module.
