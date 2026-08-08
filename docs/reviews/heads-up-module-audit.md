# FreeHS — Heads-Up / Briefings module audit

**Module:** Heads-Up (briefings, recipients, acknowledgement & signature capture, engagement analytics, share links)
**Surface:** ~24 tRPC procedures · 5 web routes · 1 worker · 4 permission keys
**Date:** 8 August 2026
**Deliverable:** 23 tests in `headsUps.audit.test.ts`, of which **7 fail on real defects**

---

## Why this module, and why now

The first three modules were chosen for what they are. This one was chosen for
what it *touches*.

The Documents audit established that its visibility layer holds under every
read path **Documents** exposes — list, get, versions, signature requests, the
folder tree, and global search. But a per-module access rule is only as strong
as the modules that consume it, and Heads-Up is the module that consumes this
one: a briefing attaches a library document and pushes it to a named list of
people. If nothing in that path asks whether each recipient was entitled to
the document, the restriction is decorative — and no amount of reading
Documents tells you anything about Heads-Up.

There is a second reason. This module is where a **legal record** is made.
`signedAt` on a briefing is the evidence that a person was told something
before they were asked to do it. Anything that lets a signature be forged,
duplicated, back-dated or collected against a withdrawn briefing damages the
one artefact the module exists to produce.

Both suspicions were correct, in opposite directions: the signature record is
sound, and the document boundary is not.

---

## Findings

### The document boundary — four defects, one root cause

The `heads_up_documents → documents` join is **never visibility-aware**. It
appears in four places and is wrong in all four.

| ID | Severity | Finding | Root cause |
| --- | --- | --- | --- |
| **HU-D01** | High | **`getForRecipient` discloses a document the recipient may not see.** The fixture attaches a document restricted to the Night shift group to a briefing sent to someone in no group. HU-D00 is the control: `documents.get` refuses that person outright. `getForRecipient` hands them its title and mime type anyway. | `headsUps.ts:456-464` |
| **HU-D02** | High | **`get` does the same for any `headsUp.view` holder** — a key every employee holds, because everybody receives briefings. | `headsUps.ts:311-319` |
| **HU-D03** | High | **`create` lets an author attach a document they cannot open.** The attached ids are filtered by tenant and archived-ness only. Fixing this one is the cheapest of the four, because it stops the disclosure being created rather than filtering it on the way out. | `headsUps.ts:540-551` |
| **HU-D04** | High | **The public share route renders the same join for an unauthenticated visitor.** `/s/[token]` selects `documents.name` through `heads_up_documents` with no viewer at all. | `app/s/[token]/page.tsx` |

**Scope, stated precisely.** The projection is `(documentId, documentVersion,
name, mimeType)` — **no `storageKey`**. So the file's *content* stays
protected: opening it still goes through `documents.get`, which enforces
visibility correctly. What escapes is the document's **existence and title**.

That is not a footnote, and it is not a full breach either. For this class of
document the title is frequently the sensitive part — *"Redundancy
consultation — night shift"*, *"Disciplinary outcome — J Smith"* — and on the
share link it escapes to the open internet. But the honest grading is
disclosure of metadata, not of the file, and the fix should be scoped to that.

### The engagement record — three defects

| ID | Severity | Finding | Root cause |
| --- | --- | --- | --- |
| **HU-R05** | Medium | **An archived briefing still collects signatures.** `loadHeadsUpOrThrow` performs no status check and recipient rows survive archival, so a briefing the author has withdrawn keeps accruing signatures — and the engagement figures keep moving after they believed they had stopped it. | `headsUps.ts:931-976` |
| **HU-R06** | Medium | The same for acknowledgements. | `headsUps.ts:900-925` |
| **HU-R07** | Low/Med | **`markViewed` silently accepts a non-recipient**, returning `{ ok: true }`, while `markAcknowledged` throws `FORBIDDEN` for exactly the same case. A UI that trusts the result shows "viewed" for somebody who was never sent the briefing. | `headsUps.ts:888` |

---

## Verified correct — no action

All asserted by passing tests.

**The signature record, which is the part that had to be right.**

- A signature is scoped to `ctx.auth.userId` and never taken from input. HU-R02
  passes a colleague's id in every plausible field (`userId`,
  `recipientUserId`) and their row is untouched — there is no parameter to
  forge.
- A non-recipient can neither acknowledge nor sign.
- Acknowledge-before-sign is enforced when the briefing demands it (H-E09).
- Signing is idempotent in the way that matters: a second signature does **not**
  move the timestamp or replace the stored mark. The record is of when they
  signed, not when they last clicked.
- Drafts are invisible through the recipient view; a recipient's own list shows
  what was sent to them and not the drafts.

**Permissions** — every procedure refuses a caller holding no `headsUp` key,
and a `headsUp.view` holder (i.e. every employee) can publish nothing, edit
nothing, archive nothing, mint no share link, send no reminder and read none of
the analytics.

**Tenancy** — another tenant's briefing is unreadable through `get` and
`getForRecipient`, unmutatable through `update`, `archive` and
`createShareLink`, cannot be acknowledged, and a document from another tenant
cannot be attached.

**Volume** — the engagement roll-up and recipient list both hold at a
200-recipient fan-out.

---

## What to fix first

1. **HU-D03** — refuse at attach time. An author should not be able to attach a
   document they cannot open, and stopping the disclosure being created is
   cheaper and safer than filtering four read paths.
2. **HU-D01 / HU-D02** — make the join visibility-aware. `isDocumentVisibleToUser`
   already exists in `document-visibility.ts` and is exactly the right shape;
   this is calling it, not writing it.
3. **HU-D04** — the public route has no viewer, so there is nobody to check
   against. Either refuse to render *library documents* on a share link (direct
   attachments are fine — they were uploaded to the briefing on purpose), or
   require the attached documents to be unrestricted before a share link can be
   minted.
4. **HU-R05 / HU-R06** — a status check in `loadHeadsUpOrThrow`, or at the two
   call sites that write to the engagement record.
5. **HU-R07** — make `markViewed` refuse a non-recipient, matching its sibling.

---

## A note on the fixture — three bugs of the same species

Worth recording, because it generalises to anyone else writing these suites.
Three times while building this audit a **named actor did not mean what its
name said**:

- the "already acknowledged recipient" held no `headsUp.view`, so the signing
  test failed on the permission check rather than testing signing;
- the "non-recipient" held no `headsUp.view` either — so two tests were passing
  on the permission check and proving *nothing* about recipiency. Fixing that
  one surfaced **two more real defects** (HU-R07 and HU-D02) that had been
  hidden behind a green tick;
- the 200-recipient volume fan-out then silently enrolled that same
  non-recipient, turning "a non-recipient is refused" into a tautology.

The lesson is not "be careful". It is that **a passing test is evidence only if
you know why it passes**, and the cheapest way to check is to make the
assertion fail on purpose once. Two of this module's seven findings were found
that way rather than by design.

---

## Four modules in

| Module | Tests | Defects | Chosen for |
| --- | --- | --- | --- |
| Contractors | 52 | 18 | Cold, never reviewed |
| Training | 32 | 4 | Reviewed and fixed twice as prose |
| Documents | 34 | 3 | Load-bearing; has its own access layer |
| Heads-Up | 23 | 7 | **Consumes** that access layer |

The Documents result and the Heads-Up result belong together. Documents' access
layer is genuinely well-built and holds everywhere it is enforced — and four of
the seven defects here are the same layer being bypassed from outside. That is
the most useful thing the runbook has produced so far, and it is not a finding
either module's own audit could have made.

It also suggests the next axis. Every module that consumes another module's
access rule is a candidate for the same defect: RAMS packs and COSHH sheets
also attach documents, permits reference RAMS, incidents reference nearly
everything. **A "who else reads this?" sweep is now worth more than a fifth
module audited in isolation** — and, still, more than either is the
authenticated browser journey, which none of these four suites can reach.
