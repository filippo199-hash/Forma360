# FreeHS — RAMS (Risk Assessment & Method Statement) module

## Independent review by four HSE practitioners

**Product:** FreeHS (freehs.software)
**Module reviewed:** RAMS — method statements, packs, briefings, client acceptance, third-party review (FreeHS module B6)
**Surface reviewed:** `/en/rams` — register, start screen, pack page, briefing, library, reviews, client share route, PDF pipeline, integrations
**Date:** 3 August 2026

---

## Methodology & scope (read this first)

The eighth review in the series, and the second of a module built from a
practitioner specification (`docs/specs/rams-module-spec.md`, itself drawn from
the gap analysis where a RAMS builder was the contractor segment's **Blocker**).

**How the review was performed.** As with every prior review, findings are
verified against the **shipped implementation on `main`** — the 1,312-line
domain library, the schema, ADR 0015, the 2,682-line router, all six web
routes, the components, the PDF pipeline, the tests, and every integration
point. The three most serious findings were each re-verified by hand.

**Two corrections to the record, made before the criticism.** During this
review two of the reviewer's own working assumptions were checked and found
wrong; both are corrected here rather than repeated. **RS-E14 (the permit
`requiresRamsPack` gate) is not missing** — it is thoroughly covered in
`permits.test.ts:1366-1515`, correctly placed in the permits suite because it
is a permits-side gate. And the web surface calls **18** of the router's **38**
procedures, not 16 (`exportCsv` is reached through `useUtils`, not a hook).

**Headline.** The server-side module is genuinely strong: a well-designed issue
gate, a clean three-object model, a comprehensive PDF, 227 i18n keys at perfect
parity across all 10 locales, and every one of the spec's eighteen edge cases
covered. **And the module still cannot complete its own core workflow**, because
roughly half of the web surface did not ship. The builder route that every
authoring path links to does not exist; the client-acceptance route crashes.
This is the first module in the series where excellent engineering produces a
product that does not work.

Severities: **Critical** (the module's core workflow cannot be completed, or
data is exposed), **High** (defeats a core duty or corrupts a record),
**Medium**, **Low**.

---

## The reviewers

| # | Reviewer | Organisation | What they tested |
|---|----------|--------------|------------------|
| 1 | **Tom Whitfield, GradIOSH** | Building-services contractor, ~40 staff | T1: template → bind RA → issue → brief three operatives on a phone. **His Blocker; his module** |
| 2 | **Priya Nair, CMIOSH** | Precision engineering, ~800 staff | P1: author her own pack, *and* review a contractor's before a permit is issued |
| 3 | **Dr. Aisha Bello, CFIOSH** | NHS trust | A1: receive-only — review, reject, accept a contractor's pack |
| 4 | **Marcus Lindqvist, CMIOSH** | EHS consultant / ISO 45001 auditor | M1: what was in force on the day, who was briefed, did the permit reference it |

---

# 1 · Tom Whitfield — the module is his, and he cannot use it

> *"This is the one I said was a Blocker. I got further than I expected and
> then hit a wall I genuinely did not expect: I pressed the button that
> creates my RAMS and the application 404ed."*

### RS-A1 (Critical) — the builder does not exist, and everything depends on it

The start screen offers the three motions the spec asked for — library
template, duplicate a previous pack, blank — and they work. Then its primary
button, *Create and build*, does this on success:

```
router.push(`/${locale}/rams/${result.packId}/build`)
```

**There is no `build` route.** The pack directory contains `page.tsx` and
`brief/` and nothing else. The pack page's own "Open builder" button links to
the same non-existent route. Both 404.

That is not a cosmetic gap, because the builder *is* the authoring half of the
module. Twenty of the router's thirty-eight procedures — `packs.saveDraft`,
`bindRiskAssessment`, `bindCoshh`, `addDocument`, `suggestBindings`,
`methodStatements.saveDraft`, `methodStatements.publish` and the rest — are
called from nowhere in `apps/web`. They are the builder's API, and the builder
was never shipped.

**The consequence is a closed loop with no entry point:**

1. The issue gate requires at least one bound, published risk assessment
   (`no-risk-assessment` otherwise).
2. The only way to bind one is `bindRiskAssessment` — unreachable.
3. `packs.create` accepts a method statement or a source pack to clone, but
   **no bindings**. The duplicate path copies bindings from an existing pack —
   and no pack can acquire them in the first place.
4. So no pack can be issued. And `briefings.record` refuses anything that is
   not `issued`.

**No pack created in this application can ever be bound, issued or briefed.**
The pack page renders the issue-gate checklist as its primary content, tells me
"bind a risk assessment", and offers me a button to a page that doesn't exist.
It is a very well-built machine for telling me what I am not allowed to do.

I'll note one thing factually, because it matters for how this is triaged: the
commit that added the web surfaces describes a builder in its message —
*"structural step editor with hazard references and hold points, one-click
binding from ranked suggestions"*. That commit's own file list contains no
build route, and none of those mutations appear anywhere in the app. It was not
lost in a later merge; it was never in the commit. Someone should find out
whether that file exists on a machine somewhere before it gets rewritten.

### If it had worked — the briefing screen still isn't a briefing

I read the briefing page carefully, because it's where my crew actually meets
this product.

**RS-A6 (High) — there is no signature, and there are no hazards.**
- The page captures name, category and organisation. **There is no signature
  pad**, despite the page's own docstring promising signatures one after
  another, despite the router accepting `signatureData`, and despite the PDF
  printing a "Signed" column — which is therefore structurally `—` for every
  row, forever. A briefing register with no signatures is not evidence.
- The screen shows scope, steps, hold points, PPE and the emergency block. It
  shows **no hazards, no control measures and no COSHH** — the underlying query
  doesn't return them. I cannot brief a crew on a *risk assessment* without the
  risks. The "RA" half of RAMS is missing from the one screen where the RA
  actually reaches a human.

**RS-A7 (High) — the offline queue can double-record and can drop entries.**
Three of the five offline behaviours from the inspection flow are here
(localStorage, `online` listener, `beforeunload`) which is good — but there's no
periodic retry, so a phone that never fires an `online` event just sits. Worse,
two real bugs: recording a second briefee while the first is in flight re-sends
the first (the flush passes the whole queue, and the router does no dedup), so
one operative is recorded twice; and a successful flush clears the *entire*
queue rather than the entries it sent, so anything added mid-flight is erased
unsent. Both are masked by an optimistic "Recorded ✓" that fires before the
server answers. The router even accepts a `clientRef` "so an offline replay is
idempotent" — it is never stored, and no such column exists.

**Verdict:** I asked for this module and I still can't write a method
statement. Ship the builder — or, until it exists, remove the two links so
nobody hits a 404 and take the reviews page down. Then fix the briefing screen,
because a briefing with no signatures and no hazards isn't one.

---

# 2 · Priya Nair — both sides blocked, for different reasons

> *"I wanted to author a pack for a guarding modification, and separately to
> review a specialist's pack before my team issued them a hot-work permit.
> Neither worked, and the second one surprised me more than the first."*

### Authoring
Everything Tom found. My assessments are all in FreeHS already and the module
is built to bind published RA *versions* — exactly right, and exactly what I
asked for so the RA stops being retyped into Word. I just can't reach it.

### The permit gate — the one integration that genuinely works
`requiresRamsPack` exists on the permit type, is persisted, and the permit
issue gate enforces it properly: it accepts either an issued own pack or an
accepted, in-date third-party review, and refuses with distinct errors
(`rams-pack-required`, `rams-pack-not-issued`, `rams-acceptance-expired`). It
is covered by a genuinely thorough test. Credit — this is the shape I asked for
and it was built correctly.

**RS-A11 (Medium)** — but the gate lives only in the router. Every other permit
precondition has a pure helper in the shared library, which is how the permit
page previews blockers *before* you press Issue. The RAMS blocker is invisible
until the mutation fails. My issuer discovers it at the worst possible moment,
standing at the job.

### RS-A4 (Critical for my second workflow) — the review queue can never be filled
The receive side is the half that matters to me as a *client*, and the module
has a good decision workspace: a checklist, verdicts per item, accept /
accept-with-conditions / reject, validity dates. The reviewer's experience is
well thought through.

**There is no way to get a pack into it.** `reviews.submit` is the only
procedure that creates a review row, and nothing in the web app calls it. There
is no "log a received pack" form anywhere. The reviews page will render its
empty state on every real tenant, permanently. An entire feature — the one the
spec called *"what turns this from a contractor feature into a platform one"* —
has a decision UI and no intake.

**RS-A12 (Medium)** — and on the authoring side, the library's "Start pack"
button navigates to `/rams/new?methodStatementId=…` while the new-pack page
never reads search params. The template selection is silently discarded and I
land on a blank picker. There is also no way to *edit* a method statement:
`saveDraft` and `publish` are unreachable, so the library is read-and-clone
only — I can duplicate a starter template into a copy I can never change.

**Verdict:** The two things I specifically wanted — bind my real RAs, and gate
a permit on an accepted pack — are the two things designed best. One is
unreachable and the other can't be fed. That's a delivery failure, not a design
failure, which is at least the better of the two problems to have.

---

# 3 · Dr. Aisha Bello — the receive-only persona, entirely blocked

> *"Estates never authors a RAMS. We receive them, review them, accept or
> reject them. That is my whole interaction with this module, and none of it
> is reachable."*

RS-A4 is my module. No intake, so no reviews, so the workspace I'd live in is
permanently empty. Everything below is what I found looking at the parts I
*could* reach.

### RS-A2 (Critical) — the client acceptance route crashes for the recipient
When a contractor sends me a share link, this is what I see. The public
`/s/[token]` layout renders `<html><body>{children}</body></html>` and
**does not mount the tRPC provider**. The acceptance component is a client
component that calls a tRPC mutation hook; without a provider it throws. The
read view is in the same tree, so it goes down with it.

The neighbouring public route, `/scan`, mounts the provider *and carries a
comment explaining why it must*. The share route did not get the same
treatment. So: an external recipient following the link gets a render error,
not a pack. Neither accept nor request-changes is reachable. Everything
downstream of "issue to the client" is dead — and unlike the builder, this one
would be invisible to anyone testing while logged in.

The token handling underneath it is otherwise careful — existence, revocation
and expiry are checked on read *and* independently re-checked on write, and
withdrawing a pack revokes its links. That makes the missing provider all the
more frustrating: the hard part was done properly.

### RS-A10 (Medium) — and the public endpoint has no integrity guard
`publicDecide` never checks whether the link has already been decided. A client
can flip accepted → changes-requested → accepted indefinitely, each pass
overwriting the acceptance name and timestamp. The UI hides the form after a
decision, but the endpoint is public and unprotected, and there is no rate
limiting on it. For an artefact whose entire purpose is *"the client accepted,
and here is the record"*, an overwritable acceptance is a hole. It also doesn't
check the pack's status, and `cancel` — unlike `withdraw` — doesn't revoke
links, so a cancelled pack remains acceptable.

### RS-A3 (High) — a read permission hands out a bearer credential
`packs.get` selects client links with no column projection and returns the rows
whole — **including the `token`**. `packs.get` needs only `rams.view`;
*creating* a link needs `rams.issue`. So any viewer can lift every live client
share token out of the network payload and re-share it to anyone. The RA and
COSHH selects immediately above it are explicitly projected, which shows the
pattern was understood and missed in one place.

### RS-A13 (Medium) — English where translation is legally load-bearing
The i18n work here is, in fairness, the best in the platform: 227 keys with
**perfect parity across all ten locales** and no missing keys behind any `t()`
call. Two things escape it, and they're both imported constants rather than
JSX, which is why the lint rule didn't catch them:

- the **author's declaration** — the legal statement a person signs when
  issuing a pack — renders as hardcoded English to a German or Japanese author;
- the **eight review checklist labels** render as English inside a localised
  page. The constant's own comment says the ids *"key the i18n labels"* — but
  no such keys exist. The indirection was designed and never built.

**Verdict:** My entire use case is unreachable, and the one part of it a
contractor would touch — the share link — crashes on arrival. The underlying
review model and the token lifecycle are good work; none of it is connected.

---

# 4 · Marcus Lindqvist — the pattern, and what it says about delivery

> *"I've reviewed eight modules now. This one is the clearest data point in
> the series, because for the first time the server work is excellent and the
> product still doesn't function. The defect isn't in the engineering. It's in
> what counts as 'done'."*

### The pattern, stated plainly
In the incidents review I raised **IN-A7**: six procedures shipped with no UI,
rated Medium because a practitioner could still work, just not correct records.
The same pattern here is **twenty** procedures — and it has crossed from
friction into non-function. The platform is shipping routers ahead of interfaces
and calling the module released.

The root cause is visible and fixable: **no test touches a web path.** The whole
RAMS suite exercises the router; there are no component tests and no e2e spec.
That is precisely why a 404 on the primary call-to-action, a missing tRPC
provider on a public route, and three separate actions-hub gaps all shipped
together. One Playwright spec that creates a pack and issues it would have
caught the first and most serious of them in the first minute.

And one detail I'd put in front of whoever owns quality here: there is a test
named *"resolves a label and a working back-link in the actions hub"* that
asserts the type, the href, the reference and the title — **and never asserts a
label.** The label is the one thing that is broken. A test named after the
defect it doesn't check is worse than no test, because it buys confidence
nobody has earned.

### RS-A5 (High) — re-issue forges the author's declaration
The draft issue path is correct: the attestation text is displayed in full and
requires an explicit tick — the M-2 lesson from the risk-assessment review,
applied properly. The **re-issue** path on the same page calls the same mutation
with `confirmAttestation: true` **hardcoded**, showing no text and requiring no
tick, and dropping the re-issue note entirely. The router's own input comment
says *"Must be true — the attestation is shown in full before signing."*

So the record will say a named person attested a declaration they were never
shown. For a signed document that is the worst class of defect — not a missing
control, but a control the record falsely claims was applied.

It compounds: re-issue creates version n+1, which **invalidates every briefing**
(correct behaviour, and the right lesson from Heads Up) — with no confirmation
dialog and no warning. And since the builder is unreachable, re-issue can only
ever produce a byte-identical new version whose sole effect is to un-brief the
entire crew.

### RS-A8 / RS-A9 (Medium) — the golden thread breaks at both ends
- **Actions:** the server side is right — `'rams'` is in the source union, the
  filter enum, and `get` resolves a working `href`. The web side has three
  gaps: the detail page's label chain has no `rams` branch, so a RAMS-sourced
  action falls through and is labelled **"Fire door inspection"**; the list and
  board fall back to "Standalone"; and the source filter omits it entirely, so
  I can't isolate them. A back-link that works under a label that lies is
  arguably worse than PF-2's honest "Standalone".
- **Search:** the server queries RAMS packs behind `rams.view` and returns
  them — and the UI's category list has no `rams` entry, so the results are
  **fetched and discarded.** This is PF-6 reintroduced, in a file that carries a
  comment about having fixed PF-6.

### The PDF — the best thing in the module
Ten numbered sections against the frozen version content, never the mutable
draft: job details, RAs referenced, COSHH, the full sequence with hold points,
emergency, welfare, supporting documents, the **author declaration with its
signature block**, the **briefing register**, and **client acceptance**.
Withdrawn packs carry an unmissable banner. Gated correctly on both paths —
session + `rams.view` on the export route, HMAC on the render route, tenant
re-scoped from the row. This is a credible client-facing and audit artefact and
it is the strongest work here.

Two content gaps: section 2 is a **metadata table only** — reference, title,
version, hazard count, worst residual band — with no hazards and no controls, so
the "RA" in the RAMS PDF is five columns *about* an assessment rather than the
assessment; and the residual band prints with a naive capitalise, so
`very_high` renders as **"Very_high"** on a document handed to a client.

**Verdict:** I can't answer M1 — what was in force, who was briefed — because
nothing can be issued and nothing can be signed. When that's fixed the audit
story is genuinely good: frozen versions, an append-only trail, a real PDF.
What needs fixing first isn't code, it's the definition of done.

---

# Consolidated findings

### Where the reviewers agree
1. **RS-A1 — the module cannot complete its core workflow.** The builder route
   doesn't exist; both links to it 404; twenty procedures are unreachable; no
   pack can be bound → issued → briefed. *All four.*
2. **RS-A2 — the client acceptance route crashes** (no tRPC provider), killing
   everything downstream of "issue to the client". *Bello.*
3. **RS-A4 — the receive side has a decision UI and no intake**, so its queue is
   permanently empty. *Nair, Bello.*
4. **RS-A3 — client share tokens are handed to any `rams.view` holder.**
   *Bello, Lindqvist.*
5. **RS-A5/A6/A7 — the records that do exist can't be trusted:** re-issue
   attests without showing the declaration; briefings capture no signature and
   show no hazards; the offline queue can double-record and drop entries.
   *Whitfield, Lindqvist.*
6. **Root cause: no test touches a web path**, and one test is named after the
   defect it doesn't check. *Lindqvist.*

### What everyone praised (protect these)
- The **PDF/print layout** — ten sections off the frozen version, correctly
  gated on both paths.
- **i18n discipline** — 227 keys at perfect parity across all 10 locales, every
  `t()` call resolving. The best in the platform.
- The **issue-gate design**, including returning every failure at once and the
  deliberate ordering so an author who *has* bound an unpublished RA isn't told
  to bind one.
- The **permit `requiresRamsPack` gate** and its thorough test (RS-E14).
- **Version binding and snapshot-on-issue**; `withdraw` revoking client links;
  the HMAC render route; the AI agent wiring; and **all eighteen** spec'd edge
  cases covered.

---

# Prioritised issue register

| ID | Sev | Summary | Raised by |
|----|-----|---------|-----------|
| RS-A1 | **Critical** | `[packId]/build` route does not exist; the primary CTA and the pack page both 404; 20 procedures unreachable; no pack can be bound → issued → briefed | All four |
| RS-A2 | **Critical** | `app/s/layout.tsx` mounts no `TRPCProvider` → the client acceptance view throws; accept and request-changes both dead | Bello |
| RS-A4 | **Critical** (for the receive side) | `reviews.submit` unwired — no intake form, so the review queue can never be populated | Nair, Bello |
| RS-A3 | High | `packs.get` returns client-link rows unprojected, leaking the share **token** to any `rams.view` holder | Bello, Lindqvist |
| RS-A5 | High | Re-issue hardcodes `confirmAttestation: true` — the record claims an attestation never shown; also silently invalidates every briefing with no warning | Lindqvist |
| RS-A6 | High | Briefing captures **no signature** (PDF column permanently "—") and shows **no hazards/controls/COSHH** | Whitfield |
| RS-A7 | High | Briefing offline queue: in-flight re-send duplicates a briefee; success clears entries added mid-flight; `clientRef` idempotency key accepted and never stored; no periodic retry | Whitfield |
| RS-A8 | Med | Actions hub: RAMS actions labelled **"Fire door inspection"** on detail and "Standalone" in list/board; no source filter | Lindqvist |
| RS-A9 | Med | Global search: server returns RAMS results, UI has no category entry → results discarded (PF-6 regression) | Lindqvist |
| RS-A10 | Med | `publicDecide`: no re-decision guard, no rate limit, doesn't check pack status; `cancel` doesn't revoke links | Bello |
| RS-A11 | Med | The permit RAMS gate lives only in the router, not the shared helpers → invisible in the permit UI until the mutation fails | Nair |
| RS-A12 | Med | Library "Start pack" loses the template (page never reads search params); no way to edit a method statement (`saveDraft`/`publish` unreachable) | Nair |
| RS-A13 | Med | Author attestation and the 8 review-checklist labels render as hardcoded English in a localised app; `worstResidualBand` prints "Very_high" on the client PDF; PDF §2 is metadata-only | Bello, Lindqvist |
| RS-A14 | Low | Inert `pendingClientAcceptance` chip; CSV/seed/duplicate/createLink errors swallowed; share URL unrecoverable after navigation and no revoke UI; `renderPdf` doesn't verify the version belongs to the pack; `tenantId` serialised to the public client view | All |

---

# Engineering appendix (root cause & pointers)

- **RS-A1** — `apps/web/app/[locale]/rams/new/page.tsx:71`
  (`router.push(.../build)`) and `[packId]/page.tsx:168` (`<Link href=.../build>`);
  the directory contains only `page.tsx` and `brief/`. Gate:
  `packages/shared/src/rams.ts:504-505` (`no-risk-assessment`). Create accepts
  no bindings: `packages/api/src/routers/rams.ts:1023-1031`. Briefing requires
  issued: `rams.ts:~2166`. Unreachable procedures include `packs.saveDraft`,
  `update`, `bind/unbindRiskAssessment`, `bind/unbindCoshh`,
  `add/removeDocument`, `suggestBindings`, `cancel`, `raiseAction`,
  `getVersion`, `methodStatements.{saveDraft,publish,archive,get,getVersion}`,
  `client.{revokeLink,publicGet}`, `reviews.submit`. Commit `0cee5d2`'s message
  describes the builder; its file list does not contain it.
- **RS-A2** — `apps/web/app/s/layout.tsx` (14 lines, no provider) vs
  `apps/web/app/scan/layout.tsx:20,27` which mounts `TRPCProvider` with an
  explaining comment. Consumer: `components/rams/client-acceptance-view.tsx:37`.
- **RS-A3** — `rams.ts:943-949`: `.select()` with no projection on
  `ramsClientLinks`, returned as `clientLinks`; `packs.get` requires
  `rams.view`, `client.createLink` requires `rams.issue` (`rams.ts:2241`).
- **RS-A4** — `rams.ts:2513` (`reviews.submit`); no caller in `apps/web`.
- **RS-A5** — `[packId]/page.tsx:236-244` (hardcoded `confirmAttestation: true`,
  no text, no `reissueNote`) vs the correct draft path at `:178-199`; router
  contract comment at `rams.ts:1611`; version bump at `rams.ts:1646`.
- **RS-A6** — `[packId]/brief/page.tsx` has no signature pad; router accepts
  `signatureData` (`rams.ts:2152`); PDF column
  `components/rams/rams-print-layout.tsx:358`. `briefings.forPack`
  (`rams.ts:2096-2130`) returns no hazards/controls/COSHH.
- **RS-A7** — `brief/page.tsx:151-154` (flush passes the whole queue),
  `:104-105` (`setQueue([])` on success), `:148` (optimistic success); no
  dedup in `rams.ts:2187-2222`; `clientRef` accepted at `rams.ts:2155` with no
  column in `schema/rams.ts` or `migrations/0069_rams.sql`; no periodic retry
  (cf. `inspections/conduct-shell.tsx:261-263`).
- **RS-A8** — `actions/[actionId]/page.tsx:677` declares `'rams'` but the label
  ternary at `:716-730` has no branch → falls through to
  `sourceLinkFireDoorInspection`; `actions/page.tsx:142-165` (no case) and
  `:45-56` (`SourceFilter` omits rams). Server correct at
  `routers/actions.ts:418-419, 843-844, 1021-1036`.
- **RS-A9** — `routers/search.ts:367-388, 477-481` (server) vs
  `components/global-search.tsx:126-219` (`categoryDefs`, no rams entry).
- **RS-A10** — `rams.ts:2402-2408` (`publicDecide` checks link only, not prior
  decision or pack status); `cancel` at `rams.ts:1856-1883` doesn't revoke,
  unlike `withdraw` at `:1836-1845`.
- **RS-A11** — gate `ramsPackGateError` at `routers/permits.ts:440-480`, called
  at `:1663-1668`; no corresponding helper in `packages/shared/src/permits.ts`.
- **RS-A12** — `library/page.tsx:134` navigates with `?methodStatementId=`;
  `new/page.tsx:21` imports only `useParams, useRouter`.
- **RS-A13** — `[packId]/page.tsx:179` → `RAMS_AUTHOR_ATTESTATION`
  (`shared/rams.ts:635-639`); `reviews/page.tsx:162` →
  `RAMS_REVIEW_CHECKLIST[].label` (`shared/rams.ts:567-574`, whose comment
  claims i18n keys that don't exist); `rams-print-layout.tsx:154-156`
  (`textTransform: 'capitalize'` on the band).
- **Verified correct (no action):** issue-gate ordering
  (`shared/rams.ts:500-505`); snapshot-on-issue; `withdraw` revoking links;
  PDF gating (`api/exports/rams-pdf/route.ts:52-84`,
  `render/rams/[packVersionId]/page.tsx:30-51`); permits gate + RS-E14
  (`permits.test.ts:1366-1515`); AI tools (`agent-tools.ts:439-470`,
  `ai-agent.ts:472-495`); nav model incl. brand + permission gating; i18n
  parity (227 keys × 10 locales).

### Suggested sequencing
1. **Before anything else:** ship `[packId]/build`, or remove both links to it
   and hide the reviews page, so the product does not advertise what it cannot
   do. Add `TRPCProvider` to `app/s/layout.tsx`. Project the `clientLinks`
   select to drop `token`.
2. **Then:** `reviews.submit` intake; re-issue attestation + briefing-invalidation
   warning; briefing signature capture and hazards on the brief screen; fix the
   flush race (and either store `clientRef` or delete it).
3. **Then:** actions-hub label/filter, search category, `publicDecide` guards,
   the permits shared helper, the two English constants and the band leak.
4. **Structural, and the reason for all of the above:** one Playwright spec that
   creates a pack, binds an RA, issues it and briefs one person. It would have
   caught RS-A1, RS-A2 and RS-A8 on the first run.

---

*Prepared as an independent practitioner review of the FreeHS RAMS module,
following seven prior reviews. Findings verified against the shipped
implementation on `main`; the three Critical findings were each re-verified by
hand. Two of the reviewer's own working assumptions were checked and corrected
in the methodology note rather than repeated.*
