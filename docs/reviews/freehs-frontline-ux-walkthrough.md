# FreeHS — UXW-2, the frontline day

**Pass:** UXW-2 (playbook: `docs/ux-walkthrough-playbook.md` §5)
**Persona:** P3 — Marek Kowalski, roofer; phone 390×844; everyday words,
English functional but not native; two minutes of patience, standing up;
zero product training. Invited to the workspace as a **Standard** user by
his foreman.
**Worlds:** W2 (seeded `hazard`/`withActions` tile, plus a foreman-side
setup layer: a live Hazard QR, one action assigned to Marek, a published
briefing needing acknowledgement) and W5 (a dead-zone moment mid-incident
report — network cut, app killed, reopened).
**Date:** 21 August 2026
**Instrument:** `tools/ux-explorer` (phone-390 preset) against a local
production build of post-merge `main` (all 18 UXW-1 fixes live).
**Result:** the day-script ran end to end — QR hazard report (anonymous),
colleague's injury reported through the dead zone, briefing acknowledged;
the assigned action could **not** be completed and the training card could
**not** be opened. **10 findings: 3×S2, 4×S3, 3×S4, 0×S1.**

One-sentence verdict: **capture is excellent on the phone — the draft
machinery survived a dead zone with the app killed — but the loop back is
broken: the worker cannot close his own action, cannot see his own
training, and after reporting an injury is shown a blank form instead of
his report.**

---

## Findings

| ID | Shape | Sev | Where | Finding |
| --- | --- | --- | --- | --- |
| UXW2-07 | E-act | **S2** | `/[locale]/incidents/new` (post-submit) | After the dead-zone round trip (draft restored, submitted online, photos step shown), **"Done — open the incident" landed on a blank new-report form** — no reference, no confirmation, draft cleared. The natural frontline read is "it didn't save — type it again": duplicate-report risk, or walking away unsure. The incident WAS saved, exactly once (`IN-000001`, DB-verified) — the defect is the post-submit navigation carrying stale flow state after a remount. |
| UXW2-08 | E-act | **S2** | `/[locale]/actions/[actionId]` | The full-page action view — the page **every My-work link opens** — has **no status controls at any viewport** (verified at 390px and 1280px, as the assignee). Details render read-only; the attachments uploader is present; Open/In-progress/Completed chips exist only in the desktop board's side-sheet (`/actions?action=`). The assignee cannot start or complete his own action from the page he is sent to — "everyone clears their own For me queue" (the marketing page's words) is not true on the device the frontline holds. |
| UXW2-09 | E-flow | **S2** | `/[locale]/training` as Standard | The **Standard set holds no `training.view`**, yet the nav offers Training to Standard users and the page targets "My training" — so it errors on every visit. The seeded set's own description promises "…complete actions **and training**". Either Standard gains sight of its OWN training record (my lean — a worker checking his tickets is core frontline) or the nav entry gates on the permission like the brand catalogue gates modules. |
| UXW2-03 | E-flow | S3 | Sandbox banner, all signed-in pages | The claim banner ("You're in a demo workspace… **Add your email so you can come back to it** / Save my work") shows to an **invited member**, not just the visiting owner. For Marek — who has an email and an account — it is noise at best; at worst "Save my work" invites a non-owner into the claim flow. Whether a member tapping it can claim (or corrupt) the workspace needs a triage check; the banner should target the provisioning admin only. |
| UXW2-05 | E-act | S3 | Incident form, People affected | On 390px the injured person's **Full name input renders about one character wide**, squeezed beside the category dropdown — Marek cannot read back "Tomasz Nowak" on the form that is otherwise built mobile-first. |
| UXW2-06 | E-words | S3 | Incident form, offline submit | Submitting in the dead zone left the button at "Submitting…" with **no failure verdict** in the observed window (~3 s + settle). Nothing was lost — the draft banner appeared and everything survived — but the worker standing in the stairwell never learns whether it went. An offline-detected "No signal — saved on this phone, send when you're back in coverage" would match what the machinery actually did. |
| UXW2-10 | E-words | S3 | `/[locale]/training` error state | The FORBIDDEN from UXW2-09 renders as "**Could not load this view. / Try again**" — a permission refusal dressed as a transient load failure, with a retry that can never succeed. The refusal should explain itself (`serverErrorMessage` class). |
| UXW2-01 | E-words | S4 | Invite accept; briefings; users list | The sandbox visitor's display name is literally "**You**", which composes into "**You invited you to join Demo workspace**" on the invite-accept card, "Created by You" on briefings, "Invited by You" in the admin list. Sandbox workspaces are an acquisition surface — name the seeded admin something human, or stop interpolating the raw name there. |
| UXW2-02 | E-words | S4 | `/scan/[token]` + thanks screen | The public page leads with the product noun — heading "Report observation: Hazard", thanks copy "Your observation has been submitted" — where the poster's promise and the worker's word is *hazard*. The form itself is plain-worded; only the frame is jargon-first. |
| UXW2-04 | E-words | S4 | `/[locale]/incidents` empty state | An untouched register says "No incidents **match these filters**" with no filters applied — implies data is being hidden. House pattern elsewhere is "No X yet…". |

## What held up

- **The dead-zone story is genuinely strong** — the pass's designed
  torture test. Half-filled injury report → network cut → submit attempted
  → browser killed → reopened online: "**A locally saved draft was
  restored**" with every field intact — title, chips, site, location,
  narrative, the injured person's name — then submitted cleanly, once. The
  IN-A12 lesson is real in the field.
- **The public QR flow end to end**: plain-worded form (required title
  only; "leave blank to stay anonymous"; "a picture is half the report"),
  and a proper receipt — "Thanks! … Your reference number is below —
  **OBS-000004**" a worker can quote to the foreman.
- **The incident form's language is field-correct**: "What happened?",
  tap-chips for kind, severity optional with an honest explainer ("pick
  one if you can judge it… triage still sets the final value"), "What
  happened, in your words", and a skippable dedicated photos step at the
  moment of capture ("worth ten statements later").
- **Several UXW-1 fixes verified live under a real Standard user**: invite
  carried the Standard set untouched (DB-checked); accept landed on My
  work; **no admin checklist for a non-admin**; nav reads "My work";
  the site picker committed on a single tap in the phone form.
- **My work is exact**: precisely his two items with due date and type;
  acknowledgement round trip dropped the counter to zero immediately; the
  mobile quick-nav bar carries live badges.
- **Per-tenant reference counters** (both tenants' first incidents are
  IN-000001, correctly independent), and the in-app notification bell
  delivered his assignment despite the (harness-fake) email provider
  failing — the NP-AC1 separation holding.

## Harness notes (for triage, not findings)

- Foreman-side world setup ran through the real admin UI except the action
  assignment (done in the DB after a portal-sheet selector fight — the
  UserPicker UI itself is already covered by PR #55's QA) and the invite
  link (token read from the DB; the Copy-link UI path was verified in the
  UXW-1 re-verification).
- Photo/file upload is not exercisable by the explorer yet (no
  `setInputFiles` action) — the action-attachment and incident-photo
  upload paths ran only as far as their buttons. Driver gap, worth adding
  before UXW-4.
- The Resend key is fake in this environment: invite email delivery failed
  by design (logged, invite stayed active) — which is precisely the
  scenario UXW1-12's Copy link exists for.
- UXW2-07's repro rode the dead-zone path (remount + restored draft); the
  uninterrupted happy path may navigate correctly — triage should test
  both before fixing.

## Route ledger (this pass)

`/[locale]/invite/[token]` · `/[locale]/my-work` · `/[locale]/incidents` ·
`/[locale]/incidents/new` · `/[locale]/actions` (admin) ·
`/[locale]/actions/[actionId]` · `/[locale]/briefings` (admin + worker) ·
`/[locale]/briefings/[headsUpId]/view` · `/[locale]/training` ·
`/[locale]/observations/qr-codes` (admin) · `/scan/[token]` (anonymous,
full submit round trip)

Deliberately not exercised: photo capture (driver gap above), the More
sheet's full contents, Observations register as the worker, the training
admin surfaces (blocked by UXW2-09 anyway), emoji reactions and comments
on the briefing.
