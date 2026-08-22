# FreeHS — SWP-D, error injection

**Pass:** SWP-D, the sweep the sweeps doc deferred (playbook
`docs/ux-walkthrough-playbook.md` §5: *"kill the network on each family of
mutation; the restore-or-name rule; double-click every submit"*).
**Date:** 22 August 2026
**Instrument:** `tools/ux-explorer` against a local production build, using
the `failRequests` action added for this pass — it fails **individual**
requests by URL substring, with either a dead connection or an HTTP error
status answered in the tRPC error envelope. Taking the whole network away
(`offline`) cannot ask this question; it asks "what happens with no
signal", where the question that matters is *"does the user learn that
**this** write failed, and is their typing still there?"*
**Result:** **3 findings (1×S2, 1×S3, 1×S4)**, all fixed in the same pass.

One-sentence verdict: **the two defects here are both the same shape —
a convenient one-liner, repeated everywhere, that looks like it does the
job and does not: `toast.error(err.message …)` puts the server's own
kebab-case guard keys on a worker's phone in 88 places, and
`disabled={isPending}` fails to stop a double tap in 87.**

---

## The rule being tested

The house rule is NR-01, recorded in `CLAUDE.md`: *never disable the box
during a save; each commit fires an independent mutation; a failure
restores the exact text or names it in a toast.* **Silent loss is the one
banned outcome.** So each probe asked three questions, in order:

1. **Told?** Does the user learn that *this* write failed?
2. **Kept?** Is their typing still on screen and still submittable?
3. **Doubled?** Does an impatient second tap write two records?

## Findings

| ID | Shape | Sev | Where | Finding |
| --- | --- | --- | --- | --- |
| SWPD-01 | E-words | **S3** | 88 call sites, every module | `onError: (err) => toast.error(err.message.length > 0 ? err.message : X)` shows **whatever the server said**. Every domain guard in `packages/api` throws a stable kebab-case key by design — `gas-test-stale`, `residual-above-initial`, `conditions-required` — so a refusal a worker is *meant* to act on arrives as a key, and an unexpected failure arrives as internal text. `serverErrorMessage` exists precisely for this and these call sites bypass it. The observation form's failure toast, caught live, read `Injected failure (ux-explorer SWP-D)` — the server's sentence, verbatim, on a phone. |
| SWPD-03 | E-act | **S2** | Every create form in the product | **A burst of taps creates a record per tap.** Three taps on *Report an incident* produced **three incidents — IN-000001, IN-000002, IN-000003** — each with its own reference number in a statutory register, and the reporter was told nothing. Two taps on *Report observation* produced two. `disabled={mutation.isPending}` is on both buttons and is **not a guard**: it only reaches the DOM after React re-renders, and every tap in the burst lands before that. This is the BUG-12 stale-closure class, applied to submission, and it is not one form — **87 buttons across the app** are guarded this way and this way only. |
| SWPD-02 | E-words | S4 | Report an incident → Submit | The failure panel says *"Your report is saved on this device — retry when you have signal."* The reassurance is right, and is the best failure copy in the product; the **diagnosis** is not. A server 500 with four bars of signal sends the reporter to check their phone instead of telling somebody. |

## What held up — and this is the interesting half

Four of the five probes passed, and the pattern in *which* four is the
finding behind the finding.

- **D1, incident submit (500).** Told, with a red inline panel; kept,
  every field intact; and reassured — *"Your report is saved on this
  device"*. This is the IN-A4 / IN-A12 lesson done properly and it is the
  strongest answer in the product.
- **D4, permit accept (500).** The `appConfirm` ceremony first (the
  UXW3-01 fix, working), then translated copy — *"Something went wrong.
  Check the form and try again."* Crucially the permit is **not** shown
  as accepted: the Acceptor row still offers Accept / Refuse, and the
  History carries no acceptance event. A worker is never told they are
  covered by a permit that does not name them.
- **D6, attachment upload (500).** *"Could not upload the file. Please
  try again."* — translated, with no phantom thumbnail left behind. This
  is the path where failure matters most, because a photograph is the one
  thing a re-render can never reconstruct.
- **D2, observation create — the "kept" half.** Title, description and
  category all survived the refusal, and the box was never disabled.

**The pattern:** every one of those is an error path a developer had to
*write*. The permit page resolves through `permitErrorText`, contractors
through `contractorErrorMessage`, the upload has real translated copy,
the incident form has a hand-built panel. The only leaking path is the
one-line tRPC shorthand — the convenient thing to type. That is why
SWPD-01 is 88 call sites and not one: nobody chose to show a raw message,
they chose the short form, 88 times.

## What the fixes were

- **SWPD-01** — all 88 call sites now go through `useServerErrorToast` /
  `useServerErrorMessage`, which resolves a guard key against the
  `serverErrors` catalogue (kept complete by SE01) and otherwise falls
  back to the call site's existing generic copy. Both branches are
  strictly better than what shipped. The BUG-17 guard grows a **second
  scan for the toast path** — it could not see this class, because a toast
  is not JSX. The scan matches the bare member access and not a call
  wrapping it, so the module-local resolvers stay legal, and it exempts
  `err.message === 'key' ? …` because *comparing* the key to choose copy
  is the correct pattern, not the bug.
- **SWPD-03** — `useSubmitGuard` (`src/lib/use-submit-guard.ts`), a ref
  that flips synchronously, with `run` / `runAsync` / `take` / `release`
  so it fits both the `mutate` and `await mutateAsync` shapes. `isPending`
  narrows the window; only a ref closes it. It is applied to all **ten
  record-creating `/new` forms** — incidents, observations, actions,
  assets, COSHH, documents, fire safety, permits, RAMS, schedules — which
  are the surfaces where a duplicate is a records problem rather than
  noise. `disabled={isPending}` stays on every one of them, because that
  is what makes the button look busy, which is the half of the job a ref
  cannot do. The input boxes stay enabled throughout, per NR-01. Pinned by
  five unit tests, including the burst and the release-after-failure case.
- **SWPD-02** — the copy now says nothing is lost and to try again
  shortly, which is true whether the cause is signal or server.

## SWPD-01b — the sibling that was nearly left alone

Trying to prove the *positive* half of the SWPD-01 fix — that a real
guard key now renders as its human sentence — needed a real refusal.
Rather than build the domain state for one, `failRequests` gained a
`message` option so any guard key can be sent back on demand. The first
attempt showed **"Something went wrong."**

That call site was not an SWPD-01 site at all. It was the other
shorthand: `onError: () => toast.error(t('saveError'))`, which discards
the error entirely and shows generic copy. 56 call sites did that, and
the `serverErrors` catalogue — 261 entries, kept complete by SE01 —
was therefore almost entirely unreachable from the UI. Every guard the
product's authors wrote a careful sentence for was answered with
"Could not save."

All 56 now resolve through `useServerErrorToast` with the same string as
their fallback, so the worst case is exactly what shipped before and the
common case is the sentence the server already wrote. This was the last
of the class: **zero `onError` handlers in the app now discard or leak
the server's message.**

The method note underneath it: **verifying the positive branch of a fix
is worth the trouble.** The negative branch (a failure is named at all)
passed on the first try and told me nothing I did not already know.

## Method notes worth keeping

- **Read the page in the SAME batch as the failure.** The explorer resumes
  a new invocation by reloading the last URL, and a reload clears a form —
  so a follow-up dump of "was my text kept?" answers *no* every time,
  whatever the app did. This nearly produced a false silent-loss finding
  against the observation form, which in fact keeps everything.
- **A toast has a lifetime.** The first D2 dump waited 4 s and caught an
  empty `alert` node; sonner had already dismissed it. "No error shown" and
  "error shown and expired" look identical in an aria snapshot taken late.
- **Playwright's `click()` waits for the button to be enabled again**, so
  two ordinary clicks are not a double tap — the second lands *after* the
  first submission finished, which is a legitimate second submit. The
  first SWPD-03 evidence (two records two seconds apart) was that
  artefact, and it nearly shipped as the finding. The `clickBurst` action
  added for this pass fires n clicks in **one JavaScript task**, with no
  actionability wait and no re-render between them, which is what a double
  tap actually is. Re-run that way, the incident form produced three
  records from three taps and the bug was real after all — but the
  correction matters: **an instrument that retries is not measuring what
  you think it is.** This is the third time in the programme that the
  harness nearly wrote a finding about itself.
- **Match the procedure name, not the module name.** Observations are
  `issues.issues.create` on the wire — the UI was renamed, the router was
  not. The first probe silently created a real record because the
  injection matched nothing. An injection that does not fire looks exactly
  like an app that handled the failure perfectly.

## Not covered

- The `abort` (dead-connection) mode on modules that claim offline
  support — the incident draft and the RAMS briefing queue — is a
  different question from a 500 and deserves its own probe: *does a
  server error enter the offline queue, or vanish between the two?*
- **The other 77 buttons.** `useSubmitGuard` is applied to the ten
  record-creating `/new` forms; the class is wider — 87 buttons app-wide
  rely on `disabled={isPending}` alone, on edit dialogs, settings panels
  and status changes. Those are stated here rather than quietly left,
  because a duplicate edit is usually idempotent where a duplicate
  *record* is not, and because a blanket sweep of 87 call sites is a
  bigger diff than this pass should carry. The durable answer for the
  highest-stakes creates is server-side idempotency — the RAMS briefing
  queue already does exactly that with a `clientRef` and a partial unique
  index (RS-A7), which is the pattern to copy when a create must survive
  a retry as well as a tap.
- Nothing else, as it turns out. The sibling shorthand —
  `onError: () => toast.error(t('saveError'))` — was going to be left
  here as "smaller harm, bigger diff", and then a probe walked into it:
  archiving an observation category with open observations, the server
  says *"This category still has open observations."* and the user was
  shown **"Something went wrong."** It never leaks, but it throws away
  the one sentence that tells the reader what to do, and the
  `serverErrors` catalogue has **261 entries** that these call sites made
  almost entirely unreachable. All 56 of them are converted too. See
  SWPD-01b below.
