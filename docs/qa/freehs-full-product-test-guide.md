# FreeHS — full-product browser test guide

> **What this is.** The single source a browser-driving agent works from to
> exercise **every module, every screen, every control** in FreeHS and report
> what is broken. It is written to be read *without* access to the codebase:
> every expectation below is stated in terms of what a user sees.
>
> **Scope:** all 20 modules + Settings + the public token surfaces + exports
> + permissions + mobile + offline.
>
> **How to read a row.** Each control has three parts: **Do** (the click),
> **Expect** (what must happen), **Flag if** (what counts as a defect). If
> reality differs from *Expect* in any way — even cosmetically — write it up.
> "It probably meant to do that" is not a verdict you are allowed to reach.

---

## Contents

| § | Section |
|---|---------|
| 0 | [How to run this](#0-how-to-run-this) |
| 1 | [Environment, accounts and fixtures](#1-environment-accounts-and-fixtures) |
| 2 | [Defect reporting format](#2-defect-reporting-format) |
| 3 | [Universal checks — run on EVERY screen](#3-universal-checks--run-on-every-screen) |
| 4 | [Getting in: sandbox, sign-up, sign-in, invite](#4-getting-in-sandbox-sign-up-sign-in-invite) |
| 5 | [Global chrome: nav, search, notifications, theme, locale](#5-global-chrome-nav-search-notifications-theme-locale) |
| 6 | [For me (/my-work)](#6-for-me-my-work) |
| 7 | [Inspections + Templates + Schedules + Approvals](#7-inspections--templates--schedules--approvals) |
| 8 | [Observations (issues)](#8-observations-issues) |
| 9 | [Incidents](#9-incidents) |
| 10 | [Permits to work](#10-permits-to-work) |
| 11 | [Actions](#11-actions) |
| 12 | [Risk assessments](#12-risk-assessments) |
| 13 | [COSHH](#13-coshh) |
| 14 | [Fire safety](#14-fire-safety) |
| 15 | [RAMS](#15-rams) |
| 16 | [Sites & projects](#16-sites--projects) |
| 17 | [Assets](#17-assets) |
| 18 | [Contractors](#18-contractors) |
| 19 | [Training & competence](#19-training--competence) |
| 20 | [Documents](#20-documents) |
| 21 | [Briefings (Heads Up)](#21-briefings-heads-up) |
| 22 | [AI Assistant](#22-ai-assistant) |
| 23 | [Dashboards (paid)](#23-dashboards-paid) |
| 24 | [Settings — every page](#24-settings--every-page) |
| 25 | [Public / token surfaces](#25-public--token-surfaces) |
| 26 | [Exports, PDFs and downloads](#26-exports-pdfs-and-downloads) |
| 27 | [Permissions & access-control matrix](#27-permissions--access-control-matrix) |
| 28 | [Mobile & offline](#28-mobile--offline) |
| 29 | [Cross-module integrity sweep](#29-cross-module-integrity-sweep) |
| 30 | [Final report template](#30-final-report-template) |

---

## 0. How to run this

### 0.1 The four rules

1. **Click everything.** Every button, icon, chip, tab, row, menu item,
   breadcrumb, link, toggle, filter, sort header, and empty-state CTA. An
   icon with no label is still a control — hover it, read its tooltip, click
   it. If a control does nothing, that is a finding.
2. **Never assume intent.** If a screen is empty, report "empty". If a button
   is disabled, report *why it appeared to be disabled* and whether the
   product told you. Do not repair the product in your head.
3. **Push past the happy path.** Every module section below has an
   **Edge cases** table. The happy path passing means nothing on its own —
   most real defects live in the second-click, the back-button, the empty
   field, the past date, the duplicate submit.
4. **Evidence or it didn't happen.** Screenshot every failure, every
   permission assertion (positive *and* negative), and every screen you
   describe as "empty" or "confusing". Note the URL and the actor.

### 0.2 Order of work

Run in this order — later sections depend on data created earlier:

```
§4  get in                       →  §24 settings (create sites/groups/users)
→  §7  templates & inspections    →  §8  observations   →  §11 actions
→  §12 risk assessments           →  §13 coshh          →  §15 rams
→  §10 permits                    →  §14 fire safety    →  §9  incidents
→  §17 assets  →  §18 contractors →  §19 training       →  §20 documents
→  §21 briefings →  §16 sites     →  §6  for me         →  §22 ai  →  §23 dashboards
→  §25 public surfaces  →  §26 exports  →  §27 permissions  →  §28 mobile
→  §29 cross-module sweep  →  §30 report
```

Reason for the order: Actions are raised *by* other modules, so test them
after their sources exist. Permits gate on risk assessments, RAMS and
training, so those come first. "For me" is only meaningful once work has been
assigned to you.

### 0.3 Time budget guidance

If you cannot complete everything, prioritise in this order and say plainly
in the report what you did not reach:

1. §3 universal checks (they find shared-layer regressions that hit
   every module at once — the highest-value class).
2. §10 Permits, §9 Incidents, §12 Risk assessments, §14 Fire safety — the
   modules where a defect has legal consequences for the user.
3. §27 permissions/access — an isolation leak is the most severe defect
   class the product can have.
4. Everything else.

---

## 1. Environment, accounts and fixtures

### 1.1 Target

- **Product:** FreeHS — `https://freehs.software`
- **Brand behaviour to expect:** the product name shown everywhere is
  **FreeHS**. The sign-in page says "Sign in to FreeHS".
  **Flag any user-visible occurrence of the string "Forma360"** anywhere in
  the UI, in an email, or in a generated PDF. (Internal identifiers in
  URLs/downloads are out of scope — only what a user reads.)
- **Modules FreeHS ships that a generic build does not:** Risk assessments,
  COSHH, Permits, Fire Safety, Incidents, RAMS, Training. All seven must be
  present in the nav.

### 1.2 Two ways in — use both

| Route | What it gives you | Use it for |
|---|---|---|
| **`/try` (sandbox)** | An instant, seeded, signed-in workspace. No account. Six scenario tiles, each with refinements. | Fast module-by-module walk-throughs with realistic data already present. |
| **Full sign-up** | A real empty tenant you own, with email OTP. | Everything that needs multiple users, permissions, invites, settings, and empty-state testing. |

**Sandbox mechanics you must know:**
- A signed-in visitor is redirected away from `/try`. **Sign out first.**
- Creation is rate-limited (roughly **5 workspaces per hour**). If creation
  starts failing, that is why — do not burn attempts, and do not report it as
  a defect unless the product fails to *tell* you that is what happened.
- The six tiles are: **Risk assessments** (refinements: general / COSHH /
  fire / manual handling), **Inspections** (site walk / equipment / vehicles /
  fire checks), **Observations** (capture only / with actions / anonymous),
  **Permits** (hot work / confined space / working at height / electrical),
  **Incidents** (record only / with investigation / with RIDDOR),
  **RAMS** (review pack / build pack / contractor docs).
- A sandbox workspace is a normal tenant. Everything in this guide applies to
  it, including Settings.
- A **"Save my work"** banner appears in the signed-in shell. It takes an
  email and must never *block* you.

### 1.3 The cast — create these in a full tenant

Use plus-aliases of one inbox so every OTP lands in one place:
`youraddress+<tag>@gmail.com`.

| Actor | Alias tag | Permission set | Groups | Sites | Exists to prove |
|---|---|---|---|---|---|
| **ADMIN** | `+admin` | Administrator (tenant owner) | — | — | Sees everything; runs all admin flows |
| **MGR** | `+mgr` | Manager | North Team | Manchester | Manager bypass on access rules |
| **STD-N** | `+north` | Standard | North Team | Manchester | Positive visibility |
| **STD-S** | `+south` | Standard | South Team | Bristol | **Negative** visibility — must NOT see North/Manchester-scoped content |
| **CUSTOM** | `+custom` | Custom set: `permits.view` + `inspections.view` only | — | Manchester | Nav gating and per-module refusals |
| **OUTSIDER** | `+outsider` | Administrator of a **second, separate tenant** | — | — | Cross-tenant isolation |

Create at minimum: **2 sites** (Manchester, Bristol — with Bristol as a
sub-site of nothing, and one sub-site under Manchester), **2 groups**
(North Team, South Team), **1 custom user field**.

### 1.4 Session hygiene

You will be switching identities constantly. Before every assertion, confirm
**who you are** (avatar menu / profile page). Use a separate incognito window
per actor where you can. Keep a running note: *"window 1 = ADMIN, window 2 =
STD-S"*. A permission finding attributed to the wrong actor is worse than no
finding.

### 1.5 Viewports

Test each module at least once on **desktop 1440×900**, and the modules
marked 📱 below at **390×844 (phone)**. Supervisors use those in a yard.

📱 = Inspections (conduct), Observations (report), Incidents (report),
Permits (detail), RAMS (briefing), Fire safety (logbook), Training (my
training), For me.

---

## 2. Defect reporting format

Keep a running `FREEHS-TEST-REPORT.md`. Every finding gets this shape — no
prose-only findings.

```markdown
### [SEVERITY] <module> — <one-line summary>
- **Actor:** ADMIN / STD-S / anonymous
- **URL:** /en/permits/01J...
- **Viewport:** desktop 1440×900
- **Steps:** 1. … 2. … 3. …
- **Expected:** <quote the expectation from this guide, or state it plainly>
- **Actual:** <what happened, verbatim — quote error text exactly>
- **Screenshot:** <ref>
- **Reproducible:** yes / no / intermittent (n of m attempts)
```

### Severity definitions — use these, not your own

| Severity | Meaning | Examples |
|---|---|---|
| **CRITICAL** | Data loss, cross-tenant/cross-user leak, a safety-critical control that lets through what it must block, or a page that 500s for a whole class of user. | A permit issues with an out-of-limits gas reading. A user sees another tenant's incident. Public share page errors for everyone. |
| **HIGH** | A core flow cannot be completed, or the product records something untrue. | Cannot publish a risk assessment at all. PDF shows a different date than the screen. Saved edit silently discarded. |
| **MEDIUM** | Flow completes but with a broken step, wrong state, or a dead control. | Button does nothing. Filter doesn't filter. Back button loses your place. Count badge is wrong. |
| **LOW** | Cosmetic, copy, alignment, minor inconsistency. | Truncated label, inconsistent capitalisation, missing tooltip. |
| **QUESTION** | You could not tell whether it is a defect. | An unlabelled icon whose purpose you cannot determine. |

**Two things always get logged regardless of how minor they feel:**
- **A raw translation key on screen** (text that looks like
  `permits.detail.actions.suspend` instead of "Suspend"). Always at least
  MEDIUM — it means a string is missing.
- **A raw error code on screen** (text like `illegal-transition` or
  `INTERNAL_SERVER_ERROR` instead of a sentence). Always at least MEDIUM.

---

## 3. Universal checks — run on EVERY screen

These are shared-layer behaviours. A failure here usually means *every*
module is affected, which is why they come first and why you should log them
even when you find them in a module you were testing for something else.

### 3.1 The screen itself

| # | Check | Expect | Flag if |
|---|---|---|---|
| U-01 | Page loads | Content or a proper empty state within a few seconds | Blank white page, spinner that never resolves, 500, or a raw stack trace |
| U-02 | Every visible string | Real English sentences | Any `dotted.key.path` text, any `{placeholder}` left unsubstituted, any `undefined`/`null`/`NaN`/`[object Object]` |
| U-03 | Empty state | A sentence saying what this is and a CTA to create the first record | A bare empty table, or "No data" with no way forward |
| U-04 | Loading state | Skeleton or spinner | Content flashing wrong values then correcting, or layout jumping |
| U-05 | Error state | A human sentence, and a way to retry | A raw code, a blank area, or a silent failure |
| U-06 | Horizontal scroll | Page body never scrolls sideways; wide tables scroll inside their own container | Whole page scrolls sideways at any viewport |
| U-07 | Dark mode | Toggle the theme. All text remains readable, no white-on-white or black-on-black | Any unreadable region, any element that keeps a hard-coded light background |
| U-08 | Browser back | Returns you to where you were, with filters/tab intact where reasonable | Back lands on a blank page, re-submits a form, or loses an in-progress edit without warning |
| U-09 | Reload mid-flow | Refresh on a detail page: the record loads at the same state | Reload 404s a record that exists, or resets a saved state |

### 3.2 Dates and numbers — a known-fragile area

| # | Check | Expect | Flag if |
|---|---|---|---|
| U-10 | Date format | Every date reads **`16 Aug 2026`**. Date+time reads **`16 Aug 2026, 17:00`** | Any `8/16/2026`, `16/08/2026`, `2026-08-16`, or seconds shown |
| U-11 | Same date, two places | A record's date on the list, the detail page, and the PDF are **identical** | Any disagreement between list / detail / export |
| U-12 | Time zone | Times on a permit/incident and its PDF match the site's local time | PDF shows UTC while the screen shows local (or vice versa) |
| U-13 | Counts and badges | A nav badge or "N overdue" chip equals the number of rows you can actually see when you click through | Badge says 3, list shows 0 |
| U-14 | Plurals | "1 action" not "1 actions"; "0 actions" not "0 action" | Any broken singular/plural |

### 3.3 Writes, saves and caches — the highest-yield class

| # | Check | Expect | Flag if |
|---|---|---|---|
| U-15 | **Create-then-navigate** | Create any record, then immediately navigate to its list or detail. The new record is there | "The record you just saved could not be found", or the list not containing what you just made |
| U-16 | **Edit-then-back** | Save an edit, go back to the list. The list shows the new value | List shows the stale value until manual refresh |
| U-17 | Double-submit | Click a Create/Save button twice quickly | Two duplicate records created, or an unhandled error |
| U-18 | **Fast typing into a field that saves** | Type quickly into any quick-add/inline field and commit several entries in a burst | Characters lost, the field clearing mid-word, focus stolen, or an entry silently not saved |
| U-19 | **Never disabled while saving** | An input you are typing into must not become disabled mid-keystroke | Field disables and your next keystrokes go nowhere |
| U-20 | Failure is visible | Force a failure (e.g. go offline, then save) | A save that fails silently. The user must always be told, and given the text back |
| U-21 | Optimistic-concurrency | Open the same record in two tabs, edit and save in tab A, then save in tab B | Tab B silently overwrites A. Expect a conflict message instead |

### 3.4 Dialogs, confirms and destructive actions

| # | Check | Expect | Flag if |
|---|---|---|---|
| U-22 | Confirmation style | Destructive actions ask in an **in-page dialog** | A native browser `confirm()` box (grey OS-style alert). Report as MEDIUM — it can freeze the page |
| U-23 | Dialog has a title | Every dialog/sheet shows a heading | A title-less dialog |
| U-24 | **Reset on close** | Fill a create dialog, press **Cancel**, **Escape**, and the **X** — reopen it | Any of the three leaves the old values behind |
| U-25 | Focus | After closing a popover/selector, focus returns to the field you clicked | Focus jumps to the top of the page or is lost |
| U-26 | Escape | Escape closes the topmost dialog only | Escape closes everything, or nothing |
| U-27 | Archive vs delete | Archive keeps the record readable; delete removes it. The dialog says which | A dialog that says "archive" and destroys, or vice versa |

### 3.5 Downloads and files

| # | Check | Expect | Flag if |
|---|---|---|---|
| U-28 | CSV export | A file actually lands in Downloads, opens, and has a header row + the rows you filtered to | Nothing downloads, a 0-byte file, or the export ignores your filters |
| U-29 | PDF export | A PDF lands, opens, and its content matches the screen | A new browser tab containing raw JSON or text, a broken PDF, or content that disagrees with the record |
| U-30 | Upload | Attach an image and a PDF. It appears, and survives a page reload | Upload appears to succeed then vanishes on reload; no error when it fails |
| U-31 | Upload limits | Try an oversized file and a disallowed type (e.g. `.exe`) | Silent failure. Expect a clear message |
| U-32 | Photo from phone | On mobile, take/choose a photo | Nothing happens, or an HEIC photo is rejected without explanation |

### 3.6 Permissions and gating

| # | Check | Expect | Flag if |
|---|---|---|---|
| U-33 | Nav gating | A user without a module's view permission does not see its nav entry | Entry visible but the page refuses — a door that opens onto a wall |
| U-34 | **Direct-URL access** | Take a record URL you can see as ADMIN, open it as a user who must not see it | The record renders. **This is CRITICAL.** |
| U-35 | Cross-tenant | Take any record URL from tenant A, open it signed in as tenant B's admin | Anything other than a clean not-found. **CRITICAL.** |
| U-36 | Action gating | A read-only user does not see edit/delete/publish controls | Controls visible then refuse on click, or worse, succeed |

### 3.7 Navigation

| # | Check | Expect | Flag if |
|---|---|---|---|
| U-37 | Every nav entry | Clicking it lands on a real page with content | 404, blank, or "Coming in Phase N" placeholder (log it — say which) |
| U-38 | Every child entry | Expand each parent; each child resolves | A child that 404s or duplicates its parent |
| U-39 | Breadcrumb / back link | Returns to the correct parent list | Back link goes to the wrong list or the home page |
| U-40 | Active highlight | The nav entry for the current page is highlighted | Nothing highlighted, or the wrong entry |
| U-41 | Deep link with query | Registers that accept `?site=<id>` land pre-filtered | Param ignored |

---

## 4. Getting in: sandbox, sign-up, sign-in, invite

### 4.1 Marketing + `/try`

| Do | Expect | Flag if |
|---|---|---|
| Load `https://freehs.software` signed out | Homepage renders; a way to try it without signing up is findable within one screen | You cannot find the way in, or it is below three folds |
| Click through to `/try` | Six scenario tiles, each with a short description and selectable refinements | Fewer than six, an unlabelled tile, or refinements that do nothing |
| Pick each tile in turn (across separate workspaces) | A workspace is provisioned with progress feedback, then you land **inside the module the tile promised** | Landing on a generic home page, or on the right page with an **empty register** |
| Read the seeded data as a practitioner | Data is coherent: severity matches the description, dates are plausible, "two still open" means two are open, counts on the page match the tiles | Any internal contradiction — e.g. an incident described as a fracture with two weeks off but badged "Minor / 0 days lost"; an inspection promised as "underway" with zero answers; a review queue promising contractor packs and showing none |
| Try to complete the one open decision each tile leaves you | You can finish it | A dead end |
| Sandbox banner → **Save my work** | Takes an email, confirms, and **does not block** further use | A hard gate, or a save that reports success and doesn't stick |
| Create a 6th/7th workspace within the hour | A clear message that you have hit the limit | A generic failure with no explanation |

### 4.2 Sign-up (`/sign-up`)

| Do | Expect | Flag if |
|---|---|---|
| Submit with a blank name/email/company | Inline validation on each field | Silent no-op, or a server error |
| Submit with a malformed email | "Check the address" style inline error | Accepted, then an OTP that never arrives |
| Submit valid details | "Account created. We sent a 6-digit code to …" | No code, or a code that never validates |
| Enter a wrong OTP | "That code didn't match. Try again or request a new one." | A raw error, or being logged in anyway |
| **Resend code** | A new code arrives; the old one stops working | Old code still works |
| **Edit details** | Returns to the form with your values intact | Form cleared |
| Sign up with an email whose domain matches an existing org | A "…already has an account" modal offering **Request to join** or **Create separate account** | No modal — a silent duplicate org |
| Choose **Request to join** | Confirmation that the admins were notified | Nothing happens |
| Sign up again with an email already in use | "An account already exists for this email. Sign in instead." | A second account created |

### 4.3 Sign-in (`/sign-in`)

| Do | Expect | Flag if |
|---|---|---|
| Request a code | "We sent a 6-digit code to … It expires in 10 minutes." | No expiry stated |
| Wait for expiry, then use the code | Refused with a clear message | Expired code accepted |
| **Use a different email** | Back to the email step, cleanly | Stuck on the code step |
| Enter a code with spaces / pasted | Accepted (trimmed) | Refused for whitespace |
| Sign in as each of the six actors | Lands on **For me** | Lands on a 404 or a module they cannot see |
| Sign out (avatar menu) | Returns to a signed-out state; the back button does **not** restore the session | Back button shows the signed-in app |

### 4.4 Invite (`/invite/[token]`)

| Do | Expect | Flag if |
|---|---|---|
| Invite a user from Settings → Users, open the emailed link | "…invited you to join …" with name confirmation | Broken link, or a page that does not name the inviter/org |
| Accept, verify OTP | Signed in, with the permission set the admin chose | Wrong permission set, or landing signed-out |
| Re-open the same link after accepting | "This invitation has already been accepted" + a link to sign-in | The link works twice |
| Open a cancelled invite's link | "Invitation not found" / expired message | It still works |
| Open a made-up token | Clean not-found page | 500 or a stack trace |

---

## 5. Global chrome: nav, search, notifications, theme, locale

### 5.1 Navigation model

The signed-in nav, as an **Administrator on FreeHS**, must contain exactly
these entries in this order, in four blocks separated by hairline rules:

**Block 1 (top):** For me · AI Assistant · Dashboards *(only on a paid plan)*

**Block 2 — do the work:**
- **Inspections** → children: Templates, Schedules, Calendar, Approvals
- **Observations** → children: QR codes, Categories
- **Incidents**
- **Permits** → children: Live board, Permit types
- **Actions** → children: Categories

**Block 3 — records & registers:**
- **Risk assessments**
- **COSHH** → children: Point of work, LEV register
- **Fire Safety** → children: Logbook, Settings
- **RAMS** → children: Method statement library, Contractor RAMS review

**Block 4 — the organisation:**
- **Sites** *(may read "Projects" or "Sites & Projects" depending on the
  tenant's terminology setting)* · **Assets** → Categories · **Contractors**
  → Site gate, Calendar · **Training** → Matrix, Requirements ·
  **Documents** · **Briefings** · **Settings**

| # | Check | Expect | Flag if |
|---|---|---|---|
| N-01 | Click all **19** top-level entries (18 module entries + **Settings**, pinned to the foot of the menu) and all **20** children | Every one resolves to a real page | Any 404 / blank / placeholder |
| N-02 | Children appear | A parent's children are revealed when that section is active | Children unreachable |
| N-03 | Badges | Badges appear on For me, Approvals, Actions, Incidents, Permits, Risk assessments, Fire Safety, Training. Each number equals what you find on the page | Any mismatch (see U-13) |
| N-04 | Collapse / expand menu | Rail collapses to icons and back; icons still identify their module | Collapse hides the ability to navigate |
| N-05 | As **CUSTOM** (permits + inspections view only) | Only those two modules (plus ungated For me / AI) appear; empty blocks disappear entirely, separators included | A visible group heading with nothing under it, or a module they cannot use |
| N-06 | Entering Dashboards | The nav rail folds automatically to give the grid room | Nothing happens (LOW) or the grid is unusable |
| N-07 | Free plan | **Dashboards** is absent from the nav | Present but refuses on click |

### 5.2 Global search (Cmd-K / the search icon)

| Do | Expect | Flag if |
|---|---|---|
| Open with the keyboard shortcut and by clicking the icon | Both open the same dialog | Only one works |
| Type one character | "Type at least 2 characters to search" | A search fires on 1 char |
| Search a term you know exists in several modules | Results grouped under category headings | Results ungrouped, or a category heading that is a raw key |
| Check the categories present | Assets, Inspections, Observations, Actions, Heads Up, Documents, Permits, COSHH substances, Risk assessments, Fire safety buildings, Fire risk assessments, Contractors, Sites & projects, Templates, Incidents, RAMS packs, Training, Evacuation plans (PEEPs), Contractor RAMS reviews | **A result row that shows no category label, or an unlabelled group** — that means a server result type has no client entry |
| Arrow keys + Enter | Navigates and opens the highlighted result | Keyboard nav dead |
| Escape | Closes | Stays open |
| Search a nonsense string | "No results found" with a hint | Blank dialog |
| Search as **STD-S** for a Manchester-only record | Not returned | Returned — **CRITICAL**, search is a read path too |

### 5.3 Notification bell

| Do | Expect | Flag if |
|---|---|---|
| Open the bell | List of notifications, newest first, unread marked | Empty when you know events happened |
| Count badge | Equals the number of unread rows | Mismatch |
| Click a notification | Navigates to the record it is about | Dead link or wrong record |
| **Mark all read** | Badge clears; state survives reload | Badge returns on reload |
| Trigger a real one (assign yourself an action) | It arrives in-app | Never arrives |

### 5.4 Theme and locale

| Do | Expect | Flag if |
|---|---|---|
| Toggle theme | Whole app switches; choice survives reload | Partial switch, or reset on reload |
| Switch locale (10 languages available) | UI translates; the app does not break | Untranslated *keys* (not merely untranslated English text — note that separately as LOW), layout breaking on long German strings, or a page that errors |
| In a non-English locale, check dates | Still formatted consistently for that locale, never `MM/DD` for a UK user | Ambiguous numeric dates |
| Switch back to English | Everything returns | Stuck locale |

### 5.5 The report chooser (`/report`)

A deliberate fork in front of the two modules a reporter most often confuses.
Reach it from wherever the product offers "Report something".

| Do | Expect | Flag if |
|---|---|---|
| Open `/report` | "Report something" and one question: **was anyone harmed?** | A taxonomy question ("observation or incident?") instead |
| **Yes — someone was harmed or made ill** | Goes to `/incidents/new`; the hint says managers are alerted and the RIDDOR clock is checked | Lands on the observation form — **HIGH**, a serious injury down the hazard path alerts nobody |
| **No — but it could have gone wrong** | Goes to `/observations/new` | Wrong destination |
| As a user with **`issues.report` only** | Only the "No" choice is offered | The incident choice offered, then refused |
| As a user with **neither** reporting permission | "You don't have permission to report here. Ask an administrator for reporting access." | A blank page or a raw error |
| Footnote | Reassures that either choice can be moved later | Absent (this is what stops a reporter freezing) |

### 5.6 Signed-out marketing and legal pages

| Route | Expect | Flag if |
|---|---|---|
| `/about`, `/contact` | Render signed out | 404 |
| `/privacy`, `/terms`, `/data-deletion` | Render, and name the **FreeHS** entity, its registered address and company number consistently | Any mention of a different product name, or placeholder legal text |
| All of the above | Reachable from the site footer | Orphaned pages |

---

## 6. For me (`/my-work`)

The landing surface. It merges everything addressed to *you*.

**Routes:** `/my-work` · `/my-work/actions` · `/my-work/acknowledgements`

| # | Do | Expect | Flag if |
|---|---|---|---|
| MW-01 | Land here after sign-in | Four tiles: **Overdue**, **Open actions**, **To acknowledge**, **Unfinished inspections** | Missing tiles, or tiles reading 0 when you know work exists |
| MW-02 | Click each tile | Filters/navigates to that subset | Dead tile |
| MW-03 | The list | Everything waiting on you, **most overdue first** | Wrong order — overdue items below future ones |
| MW-04 | Filter by type | All / Action / Training / Acknowledgement / Signature / Inspection / Approval | A type that filters to nothing when rows of that type are visible under "All" |
| MW-05 | Click a row of each kind | Opens the right record in the right module | Wrong destination |
| MW-06 | `/my-work/actions` | "My actions" — everything assigned to you | Shows other people's actions — a leak |
| MW-07 | `/my-work/acknowledgements` | Briefings + risk assessments awaiting your sign-off | Shows items already acknowledged |
| MW-08 | Complete one item (acknowledge a briefing) | It leaves the list; the badge decrements | Item stays, or badge stale |
| MW-09 | As a brand-new user with nothing assigned | "Nothing waiting on you" with an explanation | A bare empty page |
| MW-10 | 📱 Phone | Usable one-handed, tiles stack, rows tappable | Horizontal scroll or tap targets under ~40px |

---

## 7. Inspections + Templates + Schedules + Approvals

**Routes:** `/inspections` · `/inspections/[id]` · `/inspections/[id]/status`
· `/inspections/[id]/report` · `/inspections/[id]/signatures/[slot]` ·
`/templates` · `/templates/[id]` · `/schedules` · `/schedules/new` ·
`/schedules/[id]` · `/schedules/calendar` · `/approvals` ·
`/approvals/[inspectionId]`

### 7.1 Templates — list

| Control | Do | Expect | Flag if |
|---|---|---|---|
| **New template** | Click | Create dialog: name + a choice of blank / from AI / import | Dialog with no way to proceed |
| Row click | Click a template | Opens the editor | — |
| **Duplicate** | On a published template | A new draft copy appears named "… copy" | Duplicate is published, or shares state with the original |
| **Archive** / **Unarchive** | Archive one | Removed from the startable list; still readable; **any schedule using it is paused in the same step** | Schedule keeps firing after archive — **HIGH** |
| **Copy public link** / QR dialog | Open | A QR image, **Download PNG**, **Copy link** | PNG doesn't download, or the link 404s |
| **Export CSV** | Click | File lands; contains your templates | See U-28 |
| Filter/search | Type | List narrows | — |

### 7.2 Template editor

Tabs to exercise: **Pages/content**, **Response sets**, **Logic**,
**Settings** (branding, signature workflow), **Visibility**, **Publish**.

| Control | Do | Expect | Flag if |
|---|---|---|---|
| **Add inspection page** | Click | New page added, focusable | — |
| Add each question type | Add every type the builder offers (text, number, multiple choice, checkbox, date, media, signature, site, asset, instruction) | Each renders in the builder and later in conduct | A type that builds but doesn't render when conducting |
| **Item settings** panel | Select each item | Its settings appear; deselect shows "Select an item to edit its settings" | Panel shows the previous item's settings |
| Instruction → **Video link** | Paste a YouTube link | Accepted; renders during conduct | Broken embed |
| **Duplicate question** / **Delete** | Use both | Copy appears / item removed | Delete removes the wrong item |
| **Add action** on a question | Add | The question carries an action definition | — |
| **Response sets** tab → **New response set** | Create a custom set with 3 options | Usable on a multiple-choice question | — |
| Attach a **global response set** | Attach | Options appear | — |
| **Logic** tab | Pick a multiple-choice question, add a trigger (e.g. answer "No" → **Require action**, and a **jump**) | Triggers save; **Remove jump** works | Logic saved but not honoured during conduct — **HIGH** |
| **Show only when…** (visibility control) | Set a condition on a question | The question hides/shows correctly during conduct | — |
| **Preview** | Click | Shows the form as a user will see it | Preview differs from real conduct |
| **Save draft** | Click | "Saved" feedback; reload keeps changes | Silent loss |
| **Publish** | Click | Confirmation, then the template is startable | Publishing a template with validation errors |
| **Validation errors** panel | Deliberately break the template (empty question title, logic pointing at a deleted question) | Errors listed, publish blocked | Publish succeeds with a broken template |
| **Visibility** tab | Restrict to one group/site, save | Only members see it in the picker | See §27 |

**Template edge cases**

| # | Do | Expect |
|---|---|---|
| T-E01 | Publish, then edit and save again | A **new draft version** is created; the published version is untouched and still what running inspections use |
| T-E02 | Start an inspection, then publish a changed version of the same template | The running inspection **keeps the version it started on** |
| T-E03 | Nest logic very deeply (dozens of levels) | Refused with a clear message, not a crash |
| T-E04 | Two tabs, edit and save the same template in both | Second save reports a conflict rather than overwriting |
| T-E05 | Assign the same user to two signer slots | Refused with a clear message |
| T-E06 | Archive a template with a live schedule | Schedule pauses; message says so |
| T-E07 | Import a template JSON that is malformed | Clear error, no partial import |

### 7.3 Inspections — list and conduct

| Control | Do | Expect | Flag if |
|---|---|---|---|
| **Start inspection** | Click | Template picker; only **published** templates listed | Draft/archived templates offered |
| Picker → **Start** | Pick one | Conduct screen opens; a document number is stamped | No reference number |
| **Continue** on a row | Click | Resumes exactly where you left off, answers intact | Answers lost |
| **View report** | On a completed one | Read-only report | — |
| Row menu → **Archive** | Archive | Leaves the default list; recoverable via filters | Hard-deleted |
| Filters (status, template, site, date) | Apply each | List narrows correctly; combinations work | A filter that returns everything |
| **Export CSV** | Click | Respects current filters | Exports everything regardless |

**Conducting (📱 do this one on a phone too)**

| Control | Do | Expect | Flag if |
|---|---|---|---|
| Answer each question type | Fill everything | Each saves as you go | An answer type that never persists |
| **Add photo** | Attach from camera and gallery | Thumbnail appears; survives reload | Photo lost on reload — **HIGH**, a photo cannot be re-created |
| **Remove** photo | Click | Removed | Removes the wrong one |
| **Sign** → **Clear** → **Save signature** | Draw, clear, redraw, save | Signature captured and rendered | Signature saved blank |
| **Attach file** (evidence) | Attach a PDF | Appears; downloadable | — |
| Conditional questions | Answer the trigger both ways | Dependent questions appear/disappear live | Logic ignored |
| A "requires action" answer | Give the failing answer | An action is offered/created and linked | No action raised |
| **Open action: …** link | Click | The linked action opens | Dead link |
| **Submit inspection** | Leave a required question blank and submit | Blocked, with the blank ones identified | Submits incomplete |
| **Submit** with everything filled | Submit | Confirmation, status advances | — |
| Go offline mid-inspection, answer, come back online | Answers queue and sync, and you are **told** if a sync fails | Silent loss — **CRITICAL** |

### 7.4 Inspection status, signatures, report

| Control | Do | Expect | Flag if |
|---|---|---|---|
| `/status` page | Open | Status, signature slots, export buttons | — |
| **Sign** on a slot | Sign as the named signer | Slot fills; timestamped | Anyone can sign any slot |
| Sign the same slot twice / from two tabs | Second attempt refused cleanly | Duplicate signature or a crash |
| **Reopen** | On a submitted inspection (as a manager) | Returns to editable | Reopen available to someone who shouldn't have it |
| **Download PDF** | Click | PDF matching the on-screen record, incl. photos and signatures | Missing media, or a JSON blob |
| **Download Word** | Click | .docx opens in Word | Corrupt file |
| **Share link** → **Generate link** → **Copy** | Generate, open the link **in a signed-out window** | Public read-only view of that inspection | Requires login (defeats the purpose), or shows *other* records |
| **Revoke** | Revoke, reopen the link | Clean "this link has been revoked" | Still works — **CRITICAL** |
| `/report` page | Open | Read-only report incl. actions raised | — |

### 7.5 Schedules

| Control | Do | Expect | Flag if |
|---|---|---|---|
| **New schedule** | Create: template + assignees + recurrence + start | Saved; upcoming occurrences listed | Recurrence accepted but no occurrences generated |
| Recurrence options | Try daily, weekly-on-days, monthly, and an end date | Upcoming list matches what you asked for | Wrong dates (check month-end and DST carefully) |
| **Pause** / **Resume** | Toggle | Occurrences stop/resume | Paused schedule still generates |
| **Materialise now** | Click | Occurrences appear immediately | Nothing happens |
| **Delete** | Delete | Gone; existing inspections untouched | Deletes the inspections too — **HIGH** |
| **Calendar** view | Open `/schedules/calendar` | Occurrences on the right days; navigate months | Off-by-one day (check across a month boundary) |
| Schedule for a user, sign in as them | It appears in their **For me** / "My scheduled inspections" | Not visible to the assignee |

### 7.6 Approvals

| Control | Do | Expect | Flag if |
|---|---|---|---|
| `/approvals` | Open as a manager | Inspections awaiting a decision; count matches the nav badge | Mismatch |
| Open one | Click | Full inspection content + approve/reject | Content not readable before deciding |
| **Approve** | Approve | Status terminal; logged with who and when | — |
| **Reject** | Reject with a comment | Returns to the conductor with the reason visible to them | Reason lost |
| Reject with no comment | Blocked, asking for one | Empty rejection accepted |
| As a **non-manager** | Open `/approvals` | Not in nav; direct URL refused | Visible/usable — see U-34 |

---

## 8. Observations (issues)

**Routes:** `/observations` · `/observations/new` · `/observations/[id]` ·
`/observations/categories` · `/observations/categories/[id]` ·
`/observations/qr-codes`

### 8.1 Register and reporting

| Control | Do | Expect | Flag if |
|---|---|---|---|
| **Report observation** | Click | Report form | — |
| Report form: title, description, category, site, priority | Fill and **Submit** | Created; you land on it or the list, and it is **there immediately** | See U-15 |
| **Add media** | Attach photos | Appear on the observation | Lost |
| **Map** button | Click | Location picker | Dead button |
| Submit with required fields blank | Blocked with inline errors | Silent no-op |
| **Cancel** | Click | Returns without creating | Creates anyway |
| Filters: status/category/site/priority/date | Each | Narrows correctly | — |
| Empty state | New tenant | "No observations yet" + **Report your first observation** | Bare empty table |

### 8.2 Observation detail

| Control | Do | Expect | Flag if |
|---|---|---|---|
| **Edit** | Change fields, save | Saved; activity log records the change | No audit trail |
| **Add comment** | Post a comment | Appears with author + time; edit/delete only your own | You can edit someone else's |
| **Add action** | Create a linked action | Action created and linked both ways | One-way link |
| **Start an inspection from this observation** | Pick a published template | Inspection opens (new tab) and is linked back | Not linked |
| **Share** | Generate/copy | Works like §7.4 | — |
| **Close observation** | Close | Status closed; further edits refused with "reopen it to make changes" | Silent edits after close |
| **Reopen observation** | Reopen | Editable again | Reopen on a non-closed record offered |
| **Archive** / **Delete** | Both | Archive keeps it readable; Delete asks for confirmation and removes it | Delete with no confirm |
| Attachments → **Remove** | Try on someone else's attachment | Refused unless you are a manager | Anyone can delete anyone's evidence |
| Linked actions panel | Complete the linked action | Reflected here | Stale |

### 8.3 Categories

| Control | Do | Expect | Flag if |
|---|---|---|---|
| **Add category** | Create | Appears in the reporter's dropdown | Not offered when reporting |
| Category detail cards | Open one | Details, Notifications, Critical alerts, Observation fields, Custom questions, Linked templates, Visibility, Access | A card that is empty with no explanation |
| **Custom questions** → **Add question** / **Add choice** / **Remove question** | Build a 3-question set | Questions appear on the report form for that category only | Appear for every category |
| **Notifications** | Nominate a user | They are notified on a new observation in that category | No notification |
| **Critical Alerts** | Nominate; report a critical observation | Alert sent | — |
| **Link templates** | Link a published template | Offered as a quick-start on matching observations | — |
| **Visibility** / **Access** | Restrict to a group | Only those users can report into / see it | See §27 |
| **Delete** a category with open observations | Refused: "This category still has open observations." | Deleted, orphaning records — **HIGH** |
| **Restore** an archived category | Restored | — |

### 8.4 QR codes

| Control | Do | Expect | Flag if |
|---|---|---|---|
| **Create QR code** | Create for a site/category | Row appears | — |
| Show dialog → **Copy link**, **Download PNG** | Both | Link copies; PNG downloads and scans | PNG blank or unscannable |
| Open the QR link **signed out** | A public report form (`/scan/<token>`) | Requires sign-in, or **errors outright** — this public route has broken before, check it carefully |
| Submit an observation from the public form | Created in the right tenant/category/site, appears in the register | Lands in the wrong place |
| Upload a photo from the public form | Attaches | Fails silently |
| **Rotate** | Rotate | Old link stops working, new one works | Old link still live — **HIGH** |
| **Revoke** | Revoke, reopen | Clean refusal | Still works — **CRITICAL** |
| Made-up token | `/scan/rubbish` | Clean not-found | 500 |

---

## 9. Incidents

**Routes:** `/incidents` · `/incidents/new` · `/incidents/[id]` ·
`/incidents/[id]/investigation`

The lifecycle is strict: **reported → triaged → investigating →
actions outstanding → closed** (and **reopened**). Cancel is separate.

### 9.1 Register

| Control | Do | Expect | Flag if |
|---|---|---|---|
| Needs-attention strip | Look at the top | Chips like "N reports awaiting triage", "N re-screens needed" — each clickable and filtering | Chip count ≠ filtered rows |
| Filters | Status (Open/Reported/Triaged/Investigating/Actions outstanding/Closed/Cancelled/All), kind, severity, site, **RIDDOR only**, **Late report** | Each narrows correctly | — |
| Search | Title or reference | Matches both | — |
| **Export CSV** | Click | Downloads; respects filters; **confidential incidents are counted but their details are not readable** | Confidential detail present in the CSV — **CRITICAL** |
| **Report incident** | Click | The report form | — |

### 9.2 Reporting (📱 phone)

| Control | Do | Expect | Flag if |
|---|---|---|---|
| Kind selector | Pick each of: Injury, Ill health, Dangerous occurrence, Sharps/splash, Violence & aggression, Damage, Environmental, Near miss | The form **changes** to that kind's fields | Same fields for every kind |
| Kind-specific blocks | Sharps → device/procedure/contamination; V&A → nature/perpetrator/weapon/police/crime ref; Dangerous occurrence → category; Damage → what was damaged + cost band; Environmental → what was released + containment | Each renders and saves | A block that saves nothing |
| **When did it happen?** | Enter a **future** date/time | Refused: an incident cannot have happened in the future | Accepted — **HIGH** |
| **People affected** → **Add person** | Add a person with injury kind + body parts + first aid + hospital treatment | Saved against the incident | — |
| **How serious was the outcome?** | Set it | Recorded as the provisional severity | Ignored |
| **Add photos** | Attach several | All attach; failures name the files that did **not** attach | Silent partial failure — **HIGH** |
| **Submit report** | Submit | Confirmation + **Done — open the incident** | — |
| Offline draft | Fill the form offline | "Your report is saved on this device"; on return, "A locally saved draft was restored" | Draft lost |
| Sharps / V&A | Report one | Marked **confidential** by default | Not confidential — **CRITICAL** |

### 9.3 Incident detail — the worked file

| Section | Control | Expect | Flag if |
|---|---|---|---|
| Header | **Download PDF** | PDF matches the screen, in the **site's local time** | UTC vs local mismatch |
| Header | **Edit details** ("Correct the record") | Corrections allowed with a note; the timeline records them | Silent edit, or no correction path at all |
| Triage | **Triage this incident** | Severity + investigation level (Basic / Full) + lead investigator | — |
| Triage | Pick a level **below** what the severity demands | Refused: severity requires a fuller investigation | Accepted — **HIGH** |
| Triage | **Confirm triage** | Status → triaged; lead notified | Lead not notified |
| People | **Add person**, **Record absence**, **End today** | Absence periods recorded; lost-time recalculates | Days count wrong |
| People | Absence ending **before** it starts | Refused | Accepted |
| People | **Remove person** / **Remove absence** | Confirms, warns that RIDDOR counting recalculates | No warning |
| People | Push accumulated absence past **7 days** on a "not reportable" incident | A **re-screen** banner appears and the register chip lights | No prompt — **CRITICAL**, this is a statutory duty |
| RIDDOR | **Screen now** | Category list incl. **Not reportable**; a reasoning box; a computed statutory deadline | No deadline shown |
| RIDDOR | Screen as **Not reportable** with no reasoning | Refused, or clearly recorded as a negative determination with reasons | Determination lost |
| RIDDOR | Screen as reportable | Deadline chip appears ("RIDDOR: Nd left"), turning to **RIDDOR OVERDUE** past it | No countdown |
| RIDDOR | **Record HSE submission** (online / phone + reference) | Determination freezes; **RIDDOR submitted** chip | Determination still editable after submission |
| Investigation | **Start investigation** before triage | Refused: triage first | Allowed |
| Investigation | **Open workspace** | The investigation workspace | — |
| Investigation | **Upgrade to full**, **Reassign lead** | Both work and are logged | — |
| Reviews | **Prompt selected reviews** (RA / COSHH / FRA) | Selected assessments get their review pulled to now, and say why | Nothing changes on the target records |
| Reviews | **Skip with reason…** | Reason required and recorded | Skips silently |
| Lifecycle | **Close incident** with RIDDOR unscreened | Refused: screen it first | Closes — **CRITICAL** |
| Lifecycle | **Close** with open actions | Refused: close or cancel the actions first | Closes |
| Lifecycle | **Close** with everything discharged | Closes; effectiveness review scheduled ~90 days out | No review scheduled |
| Lifecycle | **Reopen** with a reason | Reopened; investigation becomes revision n+1 | Overwrites the approved revision — **CRITICAL** |
| Lifecycle | **Cancel record** (duplicate / raised in error) | Reason required; record terminal | Cancels with no reason |
| Effectiveness | **Record verdict** → *Not effective* | Incident reopens | Verdict recorded but nothing happens |
| Linked records | Check Observation / Permit / Contractor / Asset links | Each opens the right record | Dead links |
| Timeline | Read every entry | Human sentences with actor + time, and the **detail** of what changed | Raw event codes, or entries with no detail |
| Confidential | As a user **without** confidential access, open a sharps/V&A incident | Counted in totals but detail refused with a clear message | Detail visible — **CRITICAL** |

### 9.4 Investigation workspace

| Control | Do | Expect | Flag if |
|---|---|---|---|
| Revision selector | Switch revisions | Approved revisions render **fully** and read-only | Frozen revision renders empty |
| **Add photos / files**, **Add reference** (CCTV, physical) | Add each | Attached and visible | — |
| **Take statement** | Witness name + statement + signature | Saved; "signed"; taken-by recorded | Signature not captured |
| RCA **Method**: Five whys | **Add why** repeatedly, mark the **Root cause** | Chain builds; root cause must be **last**; only **one** root cause allowed | Multiple root causes accepted, or root cause mid-chain |
| RCA: Causal factors (HSG245) | **Add factor** with narrative | Saved | — |
| Sequence of events | **Add row** (when + what) | Rows ordered | — |
| **Findings** | Add findings; tick **Requires action** on some | Saved | — |
| Conclusion & sign-off | Fill conclusion, root-cause statement, recurrence likelihood, lessons learned | Saved | — |
| **Submit for approval** | Submit with an incomplete why-chain / no root cause / no conclusion | Refused, naming what is missing | Submits incomplete |
| **Submit** as someone who is not the lead | Refused: only the lead can submit | Allowed |
| **Approve…** as the **submitter/lead** | Refused: separation of duties | Self-approval allowed — **CRITICAL** |
| **Approve…** as a different manager | Requires an **assignee and due date on every action-bearing finding** | Approves with unassigned findings |
| **Approve** as the **only** available approver | Allowed **only** with a logged justification | Silently allowed, or hard-blocked with no route forward |
| After approval | Findings generate corrective actions — **exactly once** | Duplicate actions on a second approval — **HIGH** |
| **Return for rework…** | Reject with a note | Back to draft; note visible to the investigator | Note lost |
| After approval | Try to edit the approved revision | Refused: frozen; reopen to change | Editable — **CRITICAL** |

---

## 10. Permits to work

**Routes:** `/permits` · `/permits/new` · `/permits/[id]` · `/permits/board`
· `/permits/types`

**Lifecycle:** `draft → issued → active → (suspended ⇄ active) → closed`.
Also: `issued → draft` is **refusal** (bounce back to the issuer — distinct
from cancel), and `cancelled` is terminal from draft/issued/active/suspended.

### 10.1 Register and board

| Control | Do | Expect | Flag if |
|---|---|---|---|
| Status filter | All open / Draft / Issued / Active / Suspended / Closed / Cancelled / All | Narrows correctly | — |
| Site filter, search (title or reference) | Both | Work | — |
| Columns | Ref, Permit, Type, Validity, Acceptor, Status | All populated | Blank refs |
| **New permit** | Click | The raise form | — |
| **Permit types** | Click | The type catalogue | — |
| **Live board** (`/permits/board`) | Open | Counts: **Overdue — not closed**, **Active**, **Awaiting acceptance**, **Suspended**; permits grouped by site; "N inside" per permit; "Updated <time>" | Counts disagree with the register — **HIGH** |
| Board auto-refresh | Wait a minute | Timestamp updates | Frozen board |

### 10.2 Raising a permit (`/permits/new`)

| Control | Do | Expect | Flag if |
|---|---|---|---|
| **Permit type** | Open the dropdown | Nine standard types + any custom | Fewer than nine |
| Pick a type | Select "Hot work" | Panel shows **maximum duration** and "Before issue this type requires: …" + a precondition count | No preview of what is required |
| Title / description / site / area | Fill | — | — |
| **Valid from / Valid to** | Set `to` **before** `from` | Refused: "the end must be after its start" | Accepted |
| Validity longer than the type's max | Set 48h on a 12h type | Refused: window too long | Accepted — **HIGH** |
| **Risk assessment** | Link one | Only **published** RAs offered | A draft RA linkable |
| **Acceptor: A colleague** | Pick yourself | Refused at issue: you cannot issue a permit to yourself | Allowed — **CRITICAL** |
| **Acceptor: A contractor** | Name + organisation | External acceptor recorded | — |
| Overlapping window at the same site | Create a second overlapping permit | A **conflict warning** with a count and "same area" marker | No warning — **HIGH** |
| **Create draft permit** | Submit | Draft created with a reference | — |
| **Cancel** | Click | No permit created | — |

### 10.3 Permit detail — the gate

This is the most safety-critical screen in the product. Work through it in
order and try to break every gate.

| Section | Control | Expect | Flag if |
|---|---|---|---|
| Preconditions | Tick each item; untick one | Progress "n/total confirmed"; each tick records who and when | Ticks not attributed |
| Preconditions | Try **Issue permit** with any unticked | Refused: every precondition must be checked off | **Issues anyway — CRITICAL** |
| Evidence → Gas readings | **Record** a reading | Shows the acceptable range, and marks it **within limits** or **OUT OF LIMITS**; the verdict is stored with the reading | No verdict shown |
| Gas readings | Enter a physically impossible value (e.g. 250 % O₂, negative ppm) | Refused: outside the physically possible range | Accepted — **HIGH** |
| Gas readings | Enter a value with the **wrong unit** for the limit | Refused: unit mismatch | Accepted |
| Gas readings | Record an **out of limits** reading, then issue | Refused: cannot issue until a reading is back in range | **Issues — CRITICAL** |
| Gas readings | Wait past the type's freshness window, then issue | Refused: the latest gas test is too old | Issues on a stale test — **CRITICAL** |
| Gas readings | Issue with **no** reading on a type that requires one | Refused | Issues |
| Evidence → Isolation certificate | Save a reference | Recorded | — |
| Isolation | Issue an isolation-requiring type without it | Refused | Issues |
| Evidence → Rescue plan | Enter a plan | Recorded | — |
| Rescue plan | Issue a confined-space type without it | Refused | Issues |
| Evidence → Attachments | Add each kind (isolation certificate / rescue plan / gas test / other) | Uploads and lists | — |
| Competence | Name a worker with **expired** or **missing** required training | "Blocked: competence not met" naming the person and the requirement; **Open Training** link works | Issue proceeds — **CRITICAL** |
| Safe system of work | Check the RA link | Shows the linked RA; if the type requires one and it's missing/withdrawn/unpublished, issue is blocked with the specific reason | Generic or absent blocker |
| Safe system of work | RAMS requirement | "This permit type requires a RAMS pack"; satisfied only by an issued pack **or** an in-date accepted contractor review; **Open RAMS** link works | Requirement satisfiable by a draft pack or an expired review — **HIGH** |
| Signatures | **Authorise** (where the type demands it) | Recorded with name/time | — |
| Signatures | Try to authorise as the named **acceptor** | Refused | Allowed — **CRITICAL** |
| Signatures | **Issue permit** | Status → Issued; "Waiting for the named acceptor to sign on" | — |
| Signatures | **Accept permit** as someone other than the named acceptor | Refused: only the named acceptor | Allowed — **CRITICAL** |
| Signatures | **Accept permit** as the acceptor | Confirmation dialog explaining that accepting authorises work to start → status **Active** | No confirmation |
| Signatures | **Refuse** as the acceptor with a reason | Permit returns to **Draft**, reason visible to the issuer. (Refusing must be possible **without** cancelling the permit) | No refuse option, only cancel — **HIGH** |
| Signatures | **Record acceptance** for an external acceptor | Requires typing the acceptor's name **exactly**, countersigned by the issuer | Any name accepted |
| Conflicts | Issue while overlapping permits exist | Requires ticking "I have reviewed the overlapping permits and accept the combined risk" | Issues with no acknowledgement — **HIGH** |
| People | **Add person** with each role (Supervisor / Worker / Entrant / Standby) | Listed | — |
| People | **Log entry** / **Log exit** | "in since <time>"; "N inside now"; the log lists entered/exited/**STILL IN** | Counts wrong |
| People | Log entry twice for one person | Refused: already inside | Double entry |
| People | **Log someone not on the list** (ad-hoc) | Recorded | — |
| Actions | **Suspend** with a reason | Status Suspended; a red banner: work must not continue | No banner |
| Actions | **Resume — safe to continue** | Requires an explicit attestation; on gas types, a **fresh in-range re-test taken after the suspension** | Resumes with no attestation or on the pre-suspension reading — **CRITICAL** |
| Actions | **Extend** | New expiry; at most the type's per-extension limit; must be **later** than now and than the current end | Accepts a past or shorter expiry |
| Actions | **Extend** on a type needing re-authorisation | The authorising engineer must extend | Anyone can |
| Actions | **Extend** into a window that now conflicts | Conflict re-checked and acknowledged again | Conflicts checked only at issue — **HIGH** |
| Actions | **Hand over** to the current acceptor | Refused: they already hold it | Allowed |
| Actions | **Hand over** to the authoriser | Refused | Allowed |
| Actions | **Hand over** to someone else | Status returns to **Issued** until the incoming acceptor signs on | Goes straight to Active |
| Actions | **Close** with anyone still logged inside | Refused: log every entrant out first | **Closes — CRITICAL** |
| Actions | **Close** with any of the four close-out checks unticked | Refused | Closes |
| Actions | **Close** properly | Closed; "Closed by <name> on <time>" | — |
| Actions | Try any action on a **closed** or **cancelled** permit | Refused, clearly | Terminal permits still mutable — **HIGH** |
| Actions | **Cancel permit** with a reason | Cancelled; reason recorded | — |
| Expiry | Let a permit pass its validity while open | Overdue banner: confirm the state of the work then close; the board's "Overdue" count includes it; a warning/escalation appears in the history | No expiry handling — **HIGH** |
| Accept / handover | Try on a permit whose window has already passed | Refused: extend it first | Allowed |
| History | Read it | Every event in plain English with actor and time | Raw codes |
| **Download PDF** | Click | PDF matches the record, **in the site's local time**, with signatures and readings | UTC/local mismatch, or missing evidence |

### 10.4 Permit types (`/permits/types`)

| Control | Do | Expect | Flag if |
|---|---|---|---|
| The catalogue | Open | Nine standard types marked **Standard**, plus custom ones | — |
| **Add type** | Create "Diving operations" | Created; configurable | — |
| **Required training** | Attach requirements | Enforced at issue (§10.3 competence) | Cosmetic only |
| **Maximum validity** (hours) | Change it | Enforced on new permits; **live permits keep the rules they were issued under** | Live permits retro-changed — **HIGH** |
| **Gas limits** → **Add limit** | Add label, unit, min, max | Saved and evaluated against readings | — |
| Gas limits | Set min **above** max | Refused | Accepted |
| Gas limits | Set a limit outside physical bounds | Refused | Accepted |
| **Remove limit** | Remove | Removed; existing permits unaffected | — |
| **Gas test freshness** (minutes) | Set it | Enforced (§10.3) | — |
| **Precondition checklist** → **Add** / **Remove precondition** | Add three, remove one | Reflected on new permits | — |
| **Archive** / **Restore** | Archive a type with open permits | Warns with the open count; existing permits unaffected; not offered for new ones | Open permits broken by the archive — **HIGH** |

---

## 11. Actions

**Routes:** `/actions` · `/actions/new` · `/actions/[id]` ·
`/actions/categories` · `/actions/categories/[typeId]` · `/actions/settings`

| Control | Do | Expect | Flag if |
|---|---|---|---|
| **Create action** | Standalone action with title, assignee, due date, priority, type | Created | — |
| Action **type** dropdown | Open it | Real types (**Corrective**, **Preventive**, **Improvement**, **Maintenance**) — not only "No type" | Only "No type" — the defaults were never seeded |
| Due date in the past | Set one | Refused: due dates cannot be in the past | Accepted |
| Assignee who has left / is deactivated | Try | Refused with a clear message | Accepted, orphaning the action |
| Filters | Status, assignee, priority, due, **source**, **site** | Each narrows correctly | — |
| **Source** filter | Check the options | Must include every module that raises actions: inspection, observation, incident, risk assessment, COSHH, fire safety, RAMS, permit, standalone | **A source visible on a row that has no filter entry — the source vocabulary is out of sync** |
| Saved views → **Save view** | Save a filter combination, reload, re-apply | Persists | Lost |
| Row → open | Click | Detail | — |
| Detail: status transitions | Open → In progress → Completed; also Cancel | Each recorded with actor + time | — |
| Detail: **Type-specific questions** | On a type that defines them | Questions appear and save | — |
| Detail: **Recurrence** | Set a recurring action | Next occurrence generated on completion | — |
| Detail: **Attachments** | Add and **Remove** | Works; you can only remove your own unless you manage actions | — |
| Detail: comments | **Post**, **Edit**, **Delete** | Only your own editable/deletable | — |
| Detail: **Share** | Generate/copy/revoke | As §7.4 | — |
| Detail: **Archive** / **Restore** | Both | Archive hides from the default list | — |
| Source link | On an action raised by another module, click through | Opens the source record (inspection question / observation / incident finding / RA control / permit / FRA finding / drill) | **Dead or missing link — the action is unattributable** |
| **Categories** (`/actions/categories`) | Create a type; add custom questions; archive it | New actions can use it; archived types unavailable for new actions | — |
| Duplicate type name | Create a second "Corrective" | Refused: name already exists | Duplicate created |
| **Settings** (`/actions/settings`) | Open | Real settings, saved and reloaded | Placeholder |
| Assign an action to **STD-S**, sign in as them | It appears in their **For me** and **My actions** | Not visible to the assignee |

---

## 12. Risk assessments

**Routes:** `/risk-assessments` · `/risk-assessments/[id]` ·
`/settings/risk-matrix`

The editor follows the HSE five steps: **1 Identify hazards · 2 Who might be
harmed · 3 Evaluate risks and controls · 4 Record findings · 5 Review.**

| Section | Control | Expect | Flag if |
|---|---|---|---|
| Register | Stats: Active / Drafts / Reviews due / Waiting for me | Each clickable and accurate | Counts wrong |
| Register | Search by title or reference; filter by status/site/type | Works | — |
| Register | **New assessment** — title, activity, type (**Standing** / **Point-of-work**), location | Created as a draft | — |
| Step 1 | **Add hazard** — quick-add box: type and press Enter | Hazard added without clearing anything else you typed | **Text lost, or the box disabled while saving** |
| Step 1 | Add several hazards **fast, in a burst** | All land | Any dropped — **HIGH** |
| Step 1 | Pick from the **hazard library** | Presets insert with proper labels | A preset showing a raw key |
| Step 1 | **Remove hazard** down to the last one | Refused: an assessment needs at least one hazard | Allowed |
| Step 2 | Who might be harmed — tick groups incl. **Residents / service users**, **Young persons**, **New & expectant mothers**; **Add group** free text | Saved | — |
| Step 2 | Tick Young persons or New & expectant mothers | A prompt offers to **create the person-specific assessment**, linked to this one | No prompt |
| Step 3 | **Matrix picker** — click a cell for **initial** risk | L×S = score with a band | — |
| Step 3 | Score **residual** higher than initial | Refused: residual cannot exceed initial | Accepted — **HIGH** |
| Step 3 | Score residual with **no controls** | Refused: a residual score needs controls behind it | Accepted |
| Step 3 | **Add control** at each tier (Eliminate / Substitute / Engineering / Administrative / **PPE**) | Saved with its tier | — |
| Step 3 | Leave a hazard controlled by **PPE only**, no justification | Refused: justify why higher-tier controls are not reasonably practicable | Accepted — **HIGH** |
| Step 3 | Leave a residual at **High/Critical** with no justification | Refused: add a further control or explain why it is tolerable | Accepted |
| Step 3 | Control status **Planned — creates an action** | On publish, an action is created and linked | No action |
| Step 4 | **Ready to publish?** panel | Live checklist: ≥1 hazard, all scored, no unjustified PPE-only | Checklist lies |
| Step 4 | **Publish assessment** with an unscored hazard | Refused, naming it | Publishes |
| Step 4 | **Publish** with planned controls and no owner/due date | The publish dialog demands an **owner and due date** for each | Publishes with unassigned actions |
| Step 4 | **Publish** properly | Sign-off confirmation; **version 1** created; "Signed off by <name> on <date>" | No version, or no named signatory |
| Step 5 | **Review every (months)** + next review date; **Save schedule** | Saved; register shows "Review due" when it lands | — |
| Step 5 | **Record a review** — trigger + outcome + notes | Logged in the review history; next review pushed forward | Not logged |
| Versions | **View** an old version | Renders **as it was in force**, read-only | Renders current content — **CRITICAL**, this is the audit answer |
| Versions | Edit a published assessment | Allowed, but readers still see the published version until you **Publish changes (v n+1)**; an "unpublished changes" banner appears | Edits silently visible to readers, or editing blocked entirely (it should not be) |
| Distribution | **Distribute** to people (+ **Select everyone**, optional deadline) | Recipients get it in their acknowledgements | — |
| Distribution | **Share via Heads Up** on an unpublished assessment | Refused: publish first | Shares a draft |
| Distribution | As a recipient, **I have read and understood it** | Acknowledgement recorded with the **version** | Version not recorded |
| Distribution | Republish a new version | Previously-acknowledged users show **Re-acknowledgement pending** | Old acknowledgement counted as current — **HIGH** |
| Distribution | Miss an acknowledgement deadline | Marked **Overdue**; the chase email arrives | No chase |
| Header | **Download PDF** / **Print** | Matches the record, incl. matrix, controls, sign-off | — |
| Header | **Move to draft** | Returns to draft; readers keep the last published version | Readers lose the record |
| Header | **Archive** | Read-only, still findable | Disappears entirely |
| Change log | Open | Every change with actor + time | Empty |

**Risk matrix settings** (`/settings/risk-matrix`)

| Control | Expect | Flag if |
|---|---|---|
| Band thresholds (Low up to / Medium up to / High up to) | Each must be higher than the last — otherwise refused | Non-monotonic thresholds accepted |
| **Severity overrides** (floors) | A severity-5 hazard cannot band below the floor | Floor ignored |
| **Preview** | Reflects your settings live | Stale preview |
| **Also apply to open drafts** | Drafts re-band; **published versions keep the matrix they were signed against** | Published versions re-banded — **CRITICAL** |

---

## 13. COSHH

**Routes:** `/coshh` · `/coshh/new` · `/coshh/[substanceId]` ·
`/coshh/[substanceId]/assessments/[assessmentId]` · `/coshh/point-of-work` ·
`/coshh/lev`

| Section | Control | Expect | Flag if |
|---|---|---|---|
| Inventory | Chips: **WEL exceeded**, **No assessment**, **Review due** | Accurate and clickable | — |
| **Add substance** | Drop a **PDF safety data sheet** | AI reads it; fields pre-fill; you can correct everything | Extraction failure not surfaced, or fields silently wrong |
| Add substance | Drop a **non-PDF** | Clear message: SDS must be a PDF | Silent failure |
| Add substance | AI extraction fails | "Could not read the sheet automatically. The file is attached — fill in the rest" and the file **is** attached | File lost on extraction failure |
| Add substance | **Enter the details manually** link | Manual form | Missing |
| Add substance | Add a duplicate name | Warning + **Open <ref>** + **Create anyway** | Silent duplicate |
| Substance | **Where it is kept** → **Add location** (site + area) | Listed; **Remove location** works | — |
| Substance | **Hazard profile** | Pictograms, signal word, H/P statements, physical form, storage class | Empty with no explanation |
| Substance | **Safety data sheets** → **Upload new version** | New version becomes **Current**; older kept | Old version lost |
| Substance | **Still current** | Review date pushed forward and recorded | — |
| Substance | **Edit exposure limits** (WEL) → **Add agent**, 8-hr TWA, 15-min STEL, source | Saved; used to judge monitoring | Editor missing/unreachable |
| Substance | **Record substitution decision** | Status recorded | — |
| Substance | On a **carcinogen/mutagen**, publish an assessment with substitution *not considered* | Refused | Publishes — **HIGH** |
| Substance | **Exposure monitoring** → **Record result** | Compared to the WEL: **Within limit** / **Exceeds WEL** / **Not comparable** | No comparison, or a wrong verdict |
| Substance | Record a result above the WEL | Substance flagged **WEL exceeded** on the register | No flag |
| Substance | **Archive** | Hidden from the inventory, still readable | — |
| Assessment | **New assessment** (task/activity) | Draft created | — |
| Assessment | Fill routes of exposure, persons exposed, counts, quantity/frequency/duration bands, LEV required, health surveillance, exposure monitoring, emergency notes, plain-language summary, assessor, review frequency | All save | Any field that doesn't persist |
| Assessment | **Publish** with no routes of exposure | Refused | Publishes |
| Assessment | **Publish** with no controls | Refused | Publishes |
| Assessment | **Publish** with no SDS attached | Refused | Publishes |
| Assessment | **Publish** properly | A **signed version** is created; later edits do not destroy it | Editing an active assessment destroys what was attested — **CRITICAL** |
| Assessment | **View version** | As it was, read-only | Shows current content |
| Assessment | **Move to draft**, **Record review** | Both work and log | — |
| Assessment | Add controls across tiers (Eliminate → Substitute → Engineering → Administrative → RPE → Other PPE) | Saved with tiers | — |
| **Point of work** (`/coshh/point-of-work`) | Open | The point-of-work list/flow, populated and usable | Empty page with no explanation |
| **LEV register** (`/coshh/lev`) | Add a unit; **Record test** (thorough examination) | Next test date computed | — |
| LEV | Record a **failed** examination, then try to return the unit to service | Refused: record a passing examination first | Allowed — **HIGH** |
| Health surveillance | **Enrol** a person, **Record check**, **End** | Each recorded; enrolling twice refused | Duplicate enrolment |
| Activity log | Read | Every event in plain English incl. "Review prompted after an incident" | Raw codes |

---

## 14. Fire safety

**Routes:** `/fire-safety` · `/fire-safety/new` · `/fire-safety/[buildingId]`
· `/fire-safety/logbook` · `/fire-safety/fra` · `/fire-safety/fra/[fraId]` ·
`/fire-safety/peeps` · `/fire-safety/peeps/[buildingId]` ·
`/fire-safety/settings`

### 14.1 Register and building creation

| Control | Do | Expect | Flag if |
|---|---|---|---|
| Register | Columns: Building, Checks, Fire doors, Duties, Fire risk assessment | Each populated; **FRA in place** / **No fire risk assessment** / **FRA review due** correct | A building with a published FRA reading "FRA missing" |
| Attention chips | Checks overdue / due soon / FRA reviews due / PEEP reviews due / **failed checks** / **failed doors** | Each clickable, counts accurate | — |
| **Add building** | Name, address, use, **height (m)**, **storeys**, **residential** | Created | — |
| Systems flags | Tick fire alarm / emergency lighting / sprinklers / dampers / risers | A **preview** shows how many checks will be scheduled, then they are | Preview count ≠ checks created |
| Regime classification | Create a residential building at **12 m**, one at **20 m**, one at **7 storeys** | The duty chips (**Residential 11 m+**, **High-rise 18 m+**) apply correctly at each threshold | Wrong classification — **HIGH**, this drives statutory duties |
| **Archive** | Archive a building | Records kept; confirmation says so | — |

### 14.2 Building tabs

Tabs: **Logbook · Fire doors · Drills · PEEPs · Marshals · Risk assessments ·
Building information**

**Logbook**

| Control | Expect | Flag if |
|---|---|---|
| **Due now** panel | Overdue/due checks listed; "Nothing due" when clean | — |
| **Log check** → date, **Result** (Pass / Defects found / Fail), notes, call point/zone | Saved; **next due date recalculated** | Next due not moved |
| Record a **Fail** | The check holds a red **Failed — awaiting re-test** state until a **Pass** clears it | A fail that resets to "OK" on the next due date — **HIGH** |
| **Raise an action for the defects** | Default **on** when defects/fail; creates a linked action | Off by default, or no link |
| **Add check** (custom) / **Edit check** / **Remove check** | Custom checks addable, renamable; standard checks **cannot** be renamed | A standard check renamable |
| **Remove check** | Confirms; history kept | History destroyed |
| **Create asset for this check** / link an existing asset | Asset created and linked; appears on the asset's **Fire safety history** | One-way link |
| Tenant-wide logbook (`/fire-safety/logbook`) | All buildings; filter by building/check; **Export CSV** | Filters ignored by the export |

**Fire doors**

| Control | Expect | Flag if |
|---|---|---|
| **Add door** — ref, floor, type, rating, self-closing | Added | — |
| **Bulk add** — paste `FD-1-01, 1` style lines | Preview count, then "N doors added" | Parser silently dropping rows |
| **Inspect** — the six-point checklist (gaps, seals, closer, glazing, hinges, signage) + outcome + defects | Recorded; next due set | — |
| A **failed** door | Held in a failed state and counted in the attention chip until a pass | Cleared by time |
| **History** | Inspection history for that door | Empty despite inspections |
| **Remove** | Confirms; history kept | — |

**Drills**

| Control | Expect | Flag if |
|---|---|---|
| **Record drill** — date, evacuation time (min/sec), people present, accounted for, lessons, notes | Saved | — |
| Accounted **>** present | Refused: cannot exceed present | Accepted — **HIGH** |
| Target evacuation time | Set on the building; drill compares against it | No comparison |
| **Download PDF** | Drill record PDF | — |
| Lessons → follow-up | An action can be raised, shown as **Follow-up raised** | — |

**PEEPs**

| Control | Expect | Flag if |
|---|---|---|
| **Add PEEP** — person, assistance needs, equipment, buddy, plan summary, review months | Saved with a next-review date | — |
| **Record review** | Review logged, date pushed | — |
| **End** | Ended; record kept | Deleted |
| **Night pack (PDF)** | A PDF of the building's PEEPs/plans for out-of-hours | Fails, or is publicly accessible without login — it must be permission-gated |

**Marshals**

| Control | Expect | Flag if |
|---|---|---|
| **Add marshal** — a colleague **or** a free-text name; role (Fire marshal / Deputy); area covered | Both routes work | Free-text refused |
| Training status | For a linked colleague: **In date / Expiring soon / Expired / Not trained** from the training matrix; a free-text marshal reads as local/unbacked, **never** as verified training | A free-text name showing a training status — **HIGH** |
| Add the same person twice | Refused | Duplicate |
| Coverage | Per-building marshal cover flag + target | Target ignored |
| `/fire-safety/settings` | Designate which training requirements count as a fire-marshal ticket | Page unreachable, or the setting has no effect on the building page **and** the marshal list (check **both**) |

### 14.3 Fire risk assessment (FRA)

| Control | Expect | Flag if |
|---|---|---|
| Create an FRA on a building | Draft created | — |
| Fill: persons at risk, the **fire triangle** (ignition sources / fuel sources / oxygen sources), evaluation, responsible person, risk rating | All save with **real labels** (this form has shipped with raw keys before — read every label) | Any raw key on this form — **MEDIUM at minimum** |
| **Add finding** / **Update** / **Remove** / **Resolve finding** | All work | — |
| **Publish** with no persons at risk | Refused | Publishes |
| **Publish** with any of the three fire-triangle sections empty | Refused, naming which | Publishes |
| **Publish** with no evaluation / no responsible person / no risk rating | Refused | Publishes |
| Rate **Intolerable** with no actionable significant finding | Refused | Publishes |
| Rate **Intolerable** and publish | Everyone holding fire-safety manage rights is alerted | No alert — **HIGH** |
| Edit a **published** FRA | Allowed — but the frozen version is preserved and an **attestation-stale** banner appears | Either edits destroy the signed version (**CRITICAL**) or editing is refused outright (also wrong) |
| **Record review** / **Move to draft** / **Archive** | Each works and logs | — |
| **Raise action** from a finding | Action created once, linked | Duplicate actions |
| **Download PDF** (`/api/exports/fra-pdf`) | Matches the record | — |
| Daily due digest | With overdue checks, the digest email arrives once per day | Multiple duplicate emails, or none |

---

## 15. RAMS

**Routes:** `/rams` · `/rams/new` · `/rams/[packId]` · `/rams/[packId]/build`
· `/rams/[packId]/brief` · `/rams/library` ·
`/rams/library/[methodStatementId]` · `/rams/reviews` ·
`/rams/reviews/[reviewId]`

**Two lifecycles:** our own packs (draft → issued → superseded / withdrawn /
cancelled), and contractors' packs we review (pending → accepted / accepted
with conditions / rejected).

### 15.1 Register and creation

| Control | Expect | Flag if |
|---|---|---|
| Needs-attention chips: packs awaiting client acceptance / contractor packs to review / acceptances expiring | Accurate, clickable | — |
| **New RAMS pack** → three routes: **From the library**, **Copy a previous pack**, **Blank** | All three work; library route pre-fills steps; copy carries bindings | A route that produces an empty pack |
| **Create and open the builder** | Lands in `/rams/[packId]/build` — a real builder | **404 or a missing page — CRITICAL, the module cannot produce its deliverable** |
| **Export CSV**, search by reference/title/client | Work | — |

### 15.2 The builder

| Section | Control | Expect | Flag if |
|---|---|---|---|
| Job details | Title, client, site, location, planned from/to, supervisor, scope of works | Save | — |
| Bindings | Bind risk assessments (by **version**) and COSHH assessments | Bound; **Suggested for this job** offers ranked matches from your own records | Suggestions empty or irrelevant |
| Bindings | Bind an **unpublished** RA | Refused: publish it first | Accepted |
| Bindings | **Remove** a binding | Removed | — |
| Steps | **Add step** — title, what is actually done, **hazards this step addresses** (drawn from the bound RA versions), step controls, PPE, hold point | Saved; steps numbered densely 1..n | Gaps or duplicates in numbering |
| Steps | **Move up** / **Move down** / **Remove step** | Reorders and renumbers | Numbering breaks |
| Steps | Hold point + kind (isolation proved / permit issued / inspection passed / atmosphere tested / client approval / supervisor check) | Badged **Hold point** | — |
| Emergency | First aid, emergency procedure, rescue plan, nearest A&E | Save | — |
| Logistics | Welfare, access and egress, environmental controls, permits expected, competence and training | Save | — |
| Autosave | Watch the indicator | "Saving…" → "All changes saved" | Stuck on "Saving…", or no indicator |

### 15.3 The issue gate

| Do | Expect | Flag if |
|---|---|---|
| Open **Before you can issue** | A live checklist of blockers, or "Everything needed to issue this pack is in place" | Gate silent until you press Issue |
| Issue with **no steps** | Refused | Issues |
| Issue with **no bound risk assessment** | Refused | Issues |
| Bind an RA with a **high residual** hazard that **no step addresses**, then issue | Refused: "A high-residual hazard is addressed by no method step" — and it names the hazard | **Issues — HIGH, this is the module's headline rule** |
| Issue with the emergency block incomplete | Refused | Issues |
| Issue without ticking the **author declaration** | Refused | Issues |
| Read the declaration text | Real prose (deliberately untranslated) | A raw key |
| **Issue pack** with everything satisfied | Version 1 issued; a **full frozen snapshot** taken | — |
| After issue, edit the pack | Refused: "create a new version to make changes" | Editable — **CRITICAL** |
| Change the bound RA and republish it | The **issued** pack does not change | Issued pack mutates — **CRITICAL** |
| **Re-issue** | Signing event; version n+1; a warning that existing briefings are invalidated | Silent re-issue |
| After re-issue | Version n's briefings remain readable but "not current"; briefees show **Needs re-briefing** | History rewritten |
| **Withdraw** with a reason | Red banner: work must not proceed under it | No banner |
| **Download PDF** | Pack PDF incl. steps, bound hazards, PPE, hold points | Hazards missing from the PDF |

### 15.4 Briefing (📱 phone)

| Control | Expect | Flag if |
|---|---|---|
| **Brief the crew** on a **draft** pack | Refused: must be issued first | Allowed |
| Briefing screen | "What can hurt you, and what stops it", who is at risk, substances in use | Content thin or missing |
| Capture: name, category (Employee / Subcontractor / Agency / Visitor / Client rep / Other), organisation, questions raised | Saved | — |
| **Confirm briefed and understood** without acknowledging first | Refused | Allowed |
| Signature capture + **Sign again** | Captured and stored | Blank signature saved |
| Batch/group capture | Multiple people in one sitting | — |
| **Offline**: brief three people with no connection, then reconnect | They queue and sync; **a sync failure is surfaced with a Retry now control** | Silent loss — **CRITICAL** |
| Offline: submit the same briefing twice (queue + manual) | Recorded once | Duplicate briefing records |
| **Who has been briefed** register | Everyone, with the version they were briefed on; "N briefed on an older version" after a re-issue | Version not tracked |

### 15.5 Client issue and contractor review

| Control | Expect | Flag if |
|---|---|---|
| **Create share link** with a client contact name | Link created | — |
| **Show link** / **Copy** | Copies a working URL | — |
| Open the link **signed out** | The pack renders publicly with an accept/reject decision | **Errors or requires login — CRITICAL** |
| Client accepts | Decision recorded against the **exact version** | Version not recorded |
| Client tries to decide **twice** | Refused: already decided | Second decision overwrites |
| **Revoke** then reopen | Clean refusal | Still works |
| Re-issue after a link was made | The old link is marked **points at superseded vN** with a prompt to create a new one | Client silently sees stale content — **HIGH** |
| `/rams/reviews` → **Log a received pack** | Contractor + pack title + site + description → opens the checklist | Intake form missing |
| Review checklist | Every point answerable Pass / Fail / N/A | — |
| **Record decision** = *Accepted* with unanswered checklist points | Refused, naming the count | Accepted |
| Record *Accepted* with **failed** checks | Refused: record a decision that reflects them | Accepted |
| *Accepted with conditions* with no conditions written | Refused | Accepted |
| **Accepted until** in the past | Refused | Accepted |
| An accepted review | Satisfies a permit's RAMS requirement while in date, and stops satisfying it once expired | Expired review still satisfies a permit — **HIGH** |
| **Method statement library** | **Duplicate**, **Edit**, **Start a pack**, **Restore starter templates** | Starters present (8 of them); restore works | Library empty with no restore route |

---

## 16. Sites & projects

**Routes:** `/sites` · `/sites/[siteId]` · (admin CRUD lives in
`/settings/sites`)

| Control | Expect | Flag if |
|---|---|---|
| Register | All sites/projects; terminology follows the tenant setting (Sites / Projects / both) | Terminology setting ignored |
| **New** | Create a site | — | — |
| Site detail tabs: **Overview**, **Team**, **Plans**, **Media** | All four render | A tab that 404s or is empty with no explanation |
| Overview: **compliance cards** | Permits / Fire / RA / COSHH cards, each **permission-gated and brand-gated** | A card shown to someone without that module's view right |
| Compliance card → click through | Lands on the module register **pre-filtered to this site** | Filter not applied |
| Overview quick actions: **Report observation**, **Create action**, **Start inspection**, **New asset**, **Upload document** | Each opens the right flow with the site pre-selected | Site not pre-filled |
| **Team** → **Add** / remove members | Membership changes; affects visibility (see §27) | — |
| **Plans** → upload a site plan; **Link to** a pin | Plan renders; pins link to records | Pin links dead |
| **Media** → upload photos | Uploaded; the AI analyse/compare/draft-observation features (if surfaced) behave or fail loudly | Silent failure |
| **Edit** / **Save changes** / **Archive** / **Restore** | Each works | Archive orphans records with no warning |
| Archive a site referenced by access rules | The affected rules are invalidated and surfaced somewhere an admin can see | Silent breakage — **HIGH** |
| Sub-sites | Create a child site; move it | Hierarchy correct; excessive nesting refused | Infinite nesting |

---

## 17. Assets

**Routes:** `/assets` · `/assets/new` · `/assets/[assetId]` ·
`/assets/categories` · `/assets/settings`

| Control | Expect | Flag if |
|---|---|---|
| Register | Paged list; search; filter by category/site/status | Paging broken (check page 2) |
| **New asset** — name, type/category, site, parent, description, photo | Created | — |
| Parent asset | Set an asset as its own parent | Refused | Accepted |
| Parent asset | Nest very deeply | Refused with a clear message | Accepted |
| Archived category | Assign a new asset to an archived type | Refused | Accepted |
| Asset detail: **Record** (reading) | Reading saved with date and value | — |
| Asset detail: **Photos** | Upload/remove | — |
| Asset detail: **Fire safety history** | Fire logbook entries against this asset | Empty when links exist |
| Asset detail: **Activity** with filters (incl. **Actions**) | Populated | — |
| Asset detail: **Raise an action** | Action created and linked | — |
| **Manage categories** → **New category** | Created | — |
| Category → **Add field** (custom fields per category) | Fields appear on assets of that category | Fields ignored |
| Category → **suggested fields** panel | Suggestions offered; **nothing is added until you press Add**; each is editable | Fields added without consent |
| **Archive category** | Existing assets keep their data; no new assets can use it | Existing asset data lost — **HIGH** |
| `/assets/settings` | Renders real settings | Placeholder |

---

## 18. Contractors

**Routes:** `/contractors` · `/contractors/[contractorId]` ·
`/contractors/gate` · `/contractors/calendar` · `/contractors/templates` ·
`/portal` · `/gate/[token]` · `/contractor-upload/[token]`

| Control | Expect | Flag if |
|---|---|---|
| Register | Name, trade, contact, **Compliance** (Compliant / Non-compliant / No requirements), requirements count | Compliance status disagrees with the documents on file — **HIGH** |
| Search + paging (**Previous** / **Next**) | Work | Paging broken |
| **New contractor** — name, trade, contact name/email, notes, **email language** | Created | — |
| **Add requirement** — name, **Blocking** vs **Advisory** | Blocking requirements gate compliance; advisory do not | Advisory affecting compliance |
| **Remove** a requirement | Confirms it removes its documents too | Silent document loss |
| **Upload document** — with start and expiry dates | Status **Pending review** | — |
| **Verify** | Status Verified; compliance recalculates | Not recalculated |
| **Reject** with a reason | Reason recorded and visible | Reason lost |
| Let a verified document **expire** | Contractor becomes non-compliant; requirement shows **Missing / expired** | Expired document still counts — **HIGH** |
| **Set compliance status** (override) | Manual override recorded with who and why | Untracked override |
| **Copy upload link** / regenerate | Link works signed out at `/contractor-upload/[token]`; contractor can upload against the named requirements | Requires login |
| Upload link after regeneration | Old link dead | Old link live — **HIGH** |
| **Apply templates** (`/contractors/templates`) | Requirement templates apply in bulk by trade | Applying a template for a trade with none: clear message ("Create one under Requirement templates first"), not a crash |
| **Portal users** → **Invite user** | Contractor user invited; can sign into `/portal` | — |
| Portal user with an email already used | Refused: that email already belongs to a portal user | Duplicate |
| `/portal` as a contractor user | Sees **only** their own contractor's records | Sees anything else — **CRITICAL** |
| Portal → **I acknowledge — continue** (induction) | Acknowledgement recorded | — |
| **Visits** → **Schedule** / **Log arrival** (walk-in) | Visit records created | — |
| **Calendar** (`/contractors/calendar`) | Visits on the right days | Off-by-one |
| **Site gate** (`/contractors/gate`) | Configure capture fields; **Generate kiosk link** / **Regenerate** / **Take offline** | Page visible to someone who cannot use it (a door onto a wall) |
| `/gate/[token]` signed out | Kiosk: **Check in** / **Check out**, capturing the configured fields | Requires login |
| Kiosk after **Take offline** | Clean refusal | Still live — **HIGH** |
| **On site now** | Live count of people checked in | Wrong count |
| Overstay | Leave someone checked in past their window | Overstay alert fires | No alert |
| **On site now with open permits** | Cross-references contractors and open permits | Empty despite both existing |
| **Serviced assets** → link/**Unlink** | Works | — |
| **Archive** a contractor | Removed from the register; banner on the record; existing history kept | Records orphaned |

---

## 19. Training & competence

**Routes:** `/training` (Gaps) · `/training/matrix` · `/training/compliance`
· `/training/requirements` · `/training/me` · `/training/person` ·
`/training/person/[userId]`

| Tab / control | Expect | Flag if |
|---|---|---|
| **Gaps** | Expired / Expiring soon / Never held, with "N to chase" | Count ≠ rows |
| Gaps → **Record** | Opens the record dialog pre-filled with that person + requirement | Not pre-filled |
| **Matrix** | People × requirements grid; legend; **Sort by gaps**; filter by site/requirement; **As at** date | A cell whose colour disagrees with the record behind it |
| Matrix → **Export CSV** / **Export PDF** | Both land and match the on-screen grid | — |
| Matrix → **As at** a past date | Historic status (someone in date then, expired now, shows as in date) | Always shows today |
| **Compliance** | Overall / Statutory only / Mandatory only; by requirement; by area | Percentages that don't reconcile with the matrix |
| **Requirements** → **Add requirement** — name, category, **Obligation** (Statutory / Mandatory / Discretionary), validity months (or never expires), chase lead days, evidence note, description | Created | — |
| Requirement → **Assign** by Role / Group / Site / Person | Assignment drives the matrix and gaps | Assignment ignored |
| **Archive** a requirement | Warning that it leaves the matrix and gap list; existing records kept | Records destroyed |
| **Record training** — person (a colleague **or** someone without an account), requirement, date achieved, expiry (**auto-computed** from validity), awarding body, certificate number, **certificate photo**, source, notes | Saved; expiry computed correctly | Expiry not computed, or computable dates wrong at month boundaries |
| Record with a **future** achieved date | Refused | Accepted |
| Record a duplicate | Refused, or clearly handled as a supersede | Silent duplicate |
| Supersede a record | Old marked superseded, not deleted | Deleted |
| **Verify** a record | Marked **Verified** with who and when | Anyone can verify their own — check whether that is gated |
| **Void** with a reason | Voided; reason recorded | No reason required |
| **Import records** → **Download template**, **Choose a CSV file** / **Or paste CSV**, **Dry run**, **Import** | Dry run reports what *would* happen without writing; import reports N imported, N failed with **per-row** errors; duplicates skipped and counted | Dry run writes data — **HIGH**; or failures reported only as a total |
| **My training** (`/training/me`) | Your own records and expiries | Shows others' |
| **Person** (`/training/person/[userId]`) | One person's wallet; **No certificate attached** where none | — |
| Expiry notifications | With a record expiring inside the chase window, the person **and** the recorder are notified | No notification |
| Cross-module | A person with expired training named on a permit blocks issue (§10.3) | Not enforced — **CRITICAL** |

---

## 20. Documents

**Routes:** `/documents` · `/documents/new` · `/documents/[documentId]`

| Control | Expect | Flag if |
|---|---|---|
| **New folder** | Created; nestable | — |
| Folder → move inside its own sub-folder | Refused: cycle | Accepted — **HIGH** |
| Folder → set itself as parent | Refused | Accepted |
| **Delete folder** holding documents | Refused: move or archive them first | Deletes, orphaning documents |
| **Delete folder** holding sub-folders | Refused | Deletes |
| **Upload document** — file, title, labels, expiry | Uploaded; appears in the folder | — |
| Labels → **Create** / **Save** / **Delete label** | Work; duplicate label name refused | Duplicate labels |
| Document detail → **Edit**, **Move**, **Make current** | Version becomes current; older versions kept | Old versions lost |
| Download | The right file, with its original name | Wrong file — **CRITICAL** |
| **Folder access** / **Folder settings** | Restrict a folder to a group; verify with STD-S | Restriction ignored — **CRITICAL** |
| Direct URL to a restricted document as STD-S | Refused: "You do not have access to that document" | Renders — **CRITICAL** |
| Document expiry | Set an expiry in the near past/future | Expiry notification fires; expired documents flagged | No flag |
| **Archive** a document | Hidden from the list, still findable via filters | Hard-deleted |

---

## 21. Briefings (Heads Up)

**Routes:** `/heads-up` · `/heads-up/new` · `/heads-up/[id]` ·
`/heads-up/[id]/view`

| Control | Expect | Flag if |
|---|---|---|
| Nav label | Reads **Briefings** | Reads "Heads Up" in the nav (LOW, but log it) |
| **New briefing** — title, body, attachments, recipients | Draft created | — |
| Engagement mode: **Acknowledgement required** / **Signature required** | Hint text explains each; recipients get the matching control | Wrong control for the mode |
| **Publish** | Recipients notified; it lands in their inbox and **For me** | Not delivered |
| Try to acknowledge an **unpublished** briefing | Refused | Allowed |
| As a recipient: **Acknowledge** / **Sign** | Recorded with time; leaves your queue | Stays in the queue |
| As a **non-recipient**: open the briefing URL | Refused: "This was not sent to you" | Renders — **CRITICAL** |
| **Remind** / **Remind all** | Reminder emails to outstanding recipients only | Reminds people who already responded |
| **Sync all users as recipients** | Adds everyone currently in the tenant | Adds deactivated users |
| Share link: **Create link** / **Copy link** / **Disable link** | Public view works; disable kills it | Disabled link still works |
| Engagement stats | Acknowledged / pending counts match the recipient list | Mismatch |
| **Archive** | Hidden; recipients keep their record | — |
| Attachment (e.g. a risk-assessment PDF shared from §12) | Downloads and is the right document | Wrong file |

---

## 22. AI Assistant

**Route:** `/ai`

| Control | Expect | Flag if |
|---|---|---|
| Empty state | "How can I help?" + suggestion of what it can answer | Blank |
| Ask a question about your data ("how many open actions do I have?") | A streamed answer, with "Looking up …" tool feedback, that **matches what the registers show** | An answer that contradicts the registers — **HIGH** |
| Ask about a **confidential** incident as a user without access | It must not reveal the detail | Reveals it — **CRITICAL** |
| Ask about another tenant's data | Nothing found | Any leak — **CRITICAL** |
| **New** conversation / history list / **Delete conversation** | Work; history persists across reloads | History lost |
| **Copy** on a response | Copies the text | — |
| Disclaimer | "AI responses may not always be accurate" is visible | Absent |
| Send an empty message | Blocked | Empty turn sent |
| Interrupt/close mid-stream | Clean stop | Page stuck "Thinking…" forever |
| Network failure mid-stream | "Something went wrong. Please try again." | Silent hang |

---

## 23. Dashboards (paid)

**Routes:** `/dashboards` · `/dashboards/new` · `/dashboards/[id]`

| Control | Expect | Flag if |
|---|---|---|
| On a **free** plan | The nav entry is absent; direct URL shows an upgrade page ("Custom dashboards are a paid feature") with **Talk to us about upgrading** — **not** a permission error | A raw error, or the feature working when unpaid |
| As an **Administrator** on a free plan | Still gated (the *plan* lacks it, not the person) | Admin bypass — **HIGH** |
| **New dashboard** | A chat: describe what you want, typed **or dictated** (mic button) | Mic button present but non-functional with no explanation |
| Describe "permits by status this month" | A dashboard proposal with widgets; you can accept it | Nothing generated, or an error loop |
| Rendered dashboard | Charts render; a filter bar (**date range + sites**) sits above them | Filters that don't affect the charts |
| Each widget's numbers | **Reconcile them against the module's own register** for the same filters | Any disagreement — **HIGH**, this is the whole promise |
| Drill-down link on a widget | Opens the underlying register, filtered | Dead |
| **Ask AI about this widget** | A side chat answering from that widget's current data | — |
| Per-widget Excel export | `.xlsx` downloads and opens with the widget's data | Corrupt |
| A widget whose data the **viewer** cannot see | A lock marker instead of the data (not an error page) | Data shown — **CRITICAL** |
| **Publish** / **Visibility** (private / selected / tenant) | Non-owners only ever see published dashboards | A draft visible to others |
| **Archive** / **Restore** | Archive pauses its schedules in the same step | Schedules keep sending after archive — **HIGH** |
| Email schedules → **Add schedule** (rrule, ≤ 5 per dashboard, ≤ 20 recipients incl. external) | Created; **Pause** / **Edit** / **Delete** work | Limits not enforced |
| Schedule delivery | A PDF arrives by email at the scheduled time and matches the dashboard | Blank or stale PDF |
| **Dashboard PDF** download | Matches the screen | — |
| Two tabs editing the same dashboard | Conflict reported | Silent overwrite |

---

## 24. Settings — every page

**Route root:** `/settings`. Walk **every** entry in the settings nav:
Users · Groups · Sites · Permissions · Custom fields · Profile · Templates ·
Actions · Observations · Assets · Heads Up · Documents · Training ·
Integrations · Billing · Company · Risk matrix · Audit · Notifications.

> **First check:** click all of them. Note which render real settings and
> which show a **"Coming in Phase N"** placeholder — list them explicitly in
> the report. A placeholder is not automatically a defect, but an unlabelled
> dead page is.

### 24.1 Profile (`/settings/profile`)

| Control | Expect | Flag if |
|---|---|---|
| First/last name, phone | Save; reflected in the header and on records you author | Not reflected |
| Email | Read-only with a note explaining why | Editable and breaking sign-in |
| Permission set | Shown, read-only | Editable by yourself — **CRITICAL** |

### 24.2 Company (`/settings/company`)

| Control | Expect | Flag if |
|---|---|---|
| Company name, slug, **Copy slug** | Save; slug copies | — |
| **Terminology**: Sites / Projects / Both | Nav and every register's wording changes accordingly | Setting ignored somewhere (check the nav **and** at least two registers) |
| **Time zone** | A **picker**, not a free-text field | A text field, or an abbreviation like `BST` being accepted (it resolves to Bangladesh Standard Time — **HIGH**) |
| Time zone effect | Permit/incident PDFs print in the tenant's zone unless the site overrides it | No effect |
| **Branding** — logo upload, brand colour, **Primary button** sample | Applied across the app and to rendered PDFs/share pages | Applied on screen but not in PDFs |
| Branding from a website URL (if offered) | Fetches and proposes a palette; contrast remains readable | An unreadable palette accepted |
| **Data retention & export** → **Download tenant data (JSON)** | A real JSON export downloads | Empty file |
| Plan | Shows the current plan | — |

### 24.3 Users (`/settings/users`)

| Control | Expect | Flag if |
|---|---|---|
| List | All users with status and permission set | — |
| **Invite user** — email + permission set + groups/sites | Invite sent; appears under **Pending invitations** | — |
| Invite an existing member | Refused: email in use | Duplicate |
| Pending invitations → **Resend** / **Cancel** | Resend sends a fresh link; cancel kills the old one | Cancelled invite still redeemable — **HIGH** |
| **Import CSV** | Template available; dry-run/preview; per-row errors | Partial import with no report |
| **Export CSV** | Downloads the user list | — |
| Row → **Deactivate** | User cannot sign in; their records remain; they disappear from assignee pickers | Deactivated user still assignable |
| Row → **Reactivate** | Restores access | — |
| Row → **Anonymise** | Explicit warning that it is permanent; after it, their name is replaced everywhere but records survive | Records deleted, or the name still visible somewhere — check a record they authored **and** an audit entry |
| **Last administrator** | Try to deactivate / anonymise / demote the only admin | Refused with a clear message | Allowed — **CRITICAL**, the tenant is locked out |
| User detail (`/settings/users/[userId]`) | Profile, groups, sites, custom fields — all editable | — |

### 24.4 Permissions (`/settings/permissions`)

| Control | Expect | Flag if |
|---|---|---|
| The three system sets | **Administrator**, **Manager**, **Standard** present and badged as system | Missing |
| **New permission set** | Create with a name + description | — |
| Editor | Every permission grouped by module, with readable labels | A raw key as a permission label |
| Save a set granting only `permits.view` | A user with it sees Permits and nothing else | Sees more — **CRITICAL** |
| Assign a set to a user | Takes effect on their next page load | Requires sign-out to take effect (log it) |
| **Delete** a set in use | Refused, or reassigns with warning | Silently orphans users |
| Remove `org.settings` from the last admin | Refused | Allowed — **CRITICAL** |

### 24.5 Groups (`/settings/groups`) and Sites (`/settings/sites`)

| Control | Expect | Flag if |
|---|---|---|
| **New group** — name, description, **mode** (manual / rule-based) | Created | — |
| **Members** → **Add** / **Remove** | Membership changes | — |
| Rule-based group | Set a rule on a custom user field; change a user's field value | Membership **re-materialises** (may take a moment — recheck after a minute) | Never updates — **HIGH** |
| **Archive** a group referenced by an access rule | The rule is invalidated and surfaced | Silent breakage |
| **New site** / **Add sub-site** | Hierarchy correct | — |
| Site **Members** → **Add** / **Remove** | Drives site-scoped visibility (§27) | — |
| Move a site in the hierarchy | Children move with it; excessive depth refused | Orphaned children |
| **Archive** a site | Confirmation names what is affected | No warning |

### 24.6 Custom fields (`/settings/custom-fields`)

| Control | Expect | Flag if |
|---|---|---|
| **New field** — text / select / multi-select, required flag, options | Created; appears on every user profile | Not shown |
| **Add option** / **Remove option** | Work | — |
| Set a value on a user; use it in a group rule | Rule evaluates | — |
| **Delete** a field used by a rule | Refused with the reason | Silently breaks the rule — **HIGH** |

### 24.7 Notifications (`/settings/notifications`)

| Control | Expect | Flag if |
|---|---|---|
| The matrix | Grouped by module (Actions, Inspections & schedules, Observations, Heads Up, Documents, Training, Risk assessments, Permits, Fire safety, Incidents, Contractors, Organisation) with **Email** and **In-app** columns | Groups missing, or a raw key as a group label |
| Toggle one off | Saved immediately; survives reload; that notification stops arriving | Preference ignored — **HIGH** |
| Toggle one on | It starts arriving | — |
| These are personal | Another user's preferences are unaffected | Global effect — **HIGH** |
| A failed save | "Could not save the preference." | Silent |

### 24.8 Audit (`/settings/audit`)

| Control | Expect | Flag if |
|---|---|---|
| The stream | Tenant-wide, reverse-chronological, every module | Modules missing (compare with what you did today — **every** action in this test should be findable) |
| Filters: module, user, event type, search, date | Each narrows correctly | — |
| **Load more** | Pages back through history | Broken paging |
| System actions | Attributed to **System**, not to a person | A worker's action attributed to a user |
| As a non-admin | Not in nav; direct URL refused | Visible — **CRITICAL** |

### 24.9 Module settings pages

| Page | Expect |
|---|---|
| `/settings/actions` + `/settings/actions/[typeId]` | Action types and their custom questions (same surface as `/actions/categories`) — check both routes agree |
| `/settings/assets` | Asset categories/fields |
| `/settings/risk-matrix` | See §12 |
| Templates / Observations / Heads Up / Documents / Training / Integrations / Billing | Either real settings or a labelled placeholder |

---

## 25. Public / token surfaces

These are the routes an anonymous person hits. They have broken as a class
before (a shared provider change 500'd every one of them at once), so test
them **all in one pass, signed out, in a clean incognito window**.

| Route | Source | Expect | Flag if |
|---|---|---|---|
| `/s/[token]` | Inspection share link (§7.4) and RAMS client link (§15.5) | Renders the record read-only | **Any 500 — CRITICAL** |
| `/scan/[token]` | Observation QR (§8.4) | Public report form; submission lands in the right tenant | 500, or lands in the wrong tenant |
| `/gate/[token]` | Contractor kiosk (§18) | Check in / check out | Requires login |
| `/contractor-upload/[token]` | Contractor document upload (§18) | Upload against named requirements | Requires login |
| `/invite/[token]` | User invite (§4.4) | Accept flow | — |
| `/portal` | Contractor portal user | Only their own contractor's data | Any other data — **CRITICAL** |

For **every** one of the above, also test:

| # | Do | Expect |
|---|---|---|
| P-01 | Garbage token (`/s/aaaa`) | Clean "this link is not valid" page, never a 500 |
| P-02 | Revoked token | "This link has been revoked" |
| P-03 | Expired token | "This link has expired" |
| P-04 | Reload the page | Same content, no error |
| P-05 | Read every string on it | No raw keys, no error codes (these pages get a cut-down copy bundle and have shown raw keys before) |
| P-06 | 📱 phone viewport | Usable |
| P-07 | Check for leakage | The page shows **only** the intended record — no nav, no other records, no tenant-wide data |

---

## 26. Exports, PDFs and downloads

Produce **every** document the product can make, open each one, and compare
it to the record on screen.

| Document | Where from | Check |
|---|---|---|
| Inspection PDF | Inspection status page | Answers, photos, signatures, document number, dates |
| Inspection Word (.docx) | Inspection status page | Opens in Word; same content |
| Risk assessment PDF | RA detail | Hazards, matrix scores, controls, sign-off name and date |
| COSHH assessment | Substance/assessment | Hazard profile, controls, WEL |
| FRA PDF | FRA detail | Fire triangle, findings, rating, responsible person |
| Night pack PDF | Building → PEEPs | PEEPs and plans; **must be permission-gated** |
| Drill PDF | Building → Drills | Times, muster roll, lessons |
| Permit PDF | Permit detail | Signatures, gas readings + verdicts, preconditions, **site local time** |
| Incident PDF | Incident detail | Persons, absences, RIDDOR determination, investigation, **site local time** |
| RAMS pack PDF | Pack detail | Steps, bound hazards, PPE, hold points, attestation |
| Dashboard PDF | Dashboard | Charts render (not blank boxes) |
| Widget XLSX | Dashboard widget | Opens in Excel |
| CSVs | Inspections, incidents, RAMS, fire logbook, training matrix, users, contractors, templates, actions | Header row + filtered rows |
| Tenant data JSON | Settings → Company | Non-empty, valid JSON |

| # | Cross-cutting check | Flag if |
|---|---|---|
| X-01 | A file actually lands in Downloads | Nothing downloads, or a 0-byte file (a download that starts and aborts) |
| X-02 | Export twice in quick succession | Second one fails |
| X-03 | Export while a chart/photo is still loading | Blank regions in the output |
| X-04 | Every PDF's dates | Match the screen and each other (see U-10..U-12) |
| X-05 | Every PDF's branding | Tenant logo/colour applied; product name is **FreeHS** | Wrong brand |
| X-06 | A large export (100+ rows) | Completes; does not time out |
| X-07 | Two PDFs at once (two tabs) | Both succeed |

---

## 27. Permissions & access-control matrix

The single highest-severity defect class. Run this deliberately, not
incidentally.

### 27.1 The model you are testing against

- A user holding a module's **manage** permission sees **all** rows in that
  module regardless of access rules. Administrators hold everything.
- For everyone else, a row with **no access rule** is visible to all; a row
  **with** a rule is visible only if the user is in one of its groups **and**
  one of its sites (an empty list on either side means "any").
- A rule that has been **invalidated** (because it referenced a group or site
  that was later archived) **denies** non-managers.

### 27.2 The suite

| # | Setup | Actor | Expect | Severity if wrong |
|---|---|---|---|---|
| A-01 | Template restricted to North Team + Manchester | **STD-N** | Visible and startable | HIGH |
| A-02 | Same | **STD-S** | Not in any list, not in the picker | **CRITICAL** |
| A-03 | Same, **direct URL** to the template | **STD-S** | Clean refusal | **CRITICAL** |
| A-04 | Same | **MGR** (holds templates.manage) | Visible — manager bypass | MEDIUM |
| A-05 | Archive North Team so the rule invalidates | **STD-N** | Now denied | HIGH |
| A-06 | Same | **MGR** | Still visible | MEDIUM |
| A-07 | Any record URL from tenant A | **OUTSIDER** (tenant B admin) | Clean not-found | **CRITICAL** |
| A-08 | Global search for a restricted record | **STD-S** | No result | **CRITICAL** |
| A-09 | AI assistant asked about a restricted record | **STD-S** | Not disclosed | **CRITICAL** |
| A-10 | A dashboard widget over a source they cannot read | **STD-S** | Lock marker, not data | **CRITICAL** |
| A-11 | Restricted document folder | **STD-S** | Not listed; direct URL refused | **CRITICAL** |
| A-12 | Confidential incident (sharps / V&A) | user without confidential access | Counted, detail refused | **CRITICAL** |
| A-13 | `/approvals`, `/settings/audit`, `/settings/users`, `/permits/types`, `/fire-safety/settings` | **CUSTOM** | Absent from nav **and** refused by direct URL | HIGH |
| A-14 | Permit lifecycle actions at a site they are not scoped to | **CUSTOM** | Refused ("no permit authority for this site"); recording checks/readings still allowed where intended | HIGH |
| A-15 | Contractor portal user | portal user | Only their contractor | **CRITICAL** |
| A-16 | Every module's list endpoint | **STD-S** | Never returns a row they cannot open | **CRITICAL** |

**Method for A-03/A-07/A-11 (the direct-URL class):** as ADMIN, copy the URL
of a record. Sign in as the other actor **in a different window**. Paste.
This is the single most likely real defect in the product — a `list` that
filters correctly while the `get` behind it does not.

---

## 28. Mobile & offline

### 28.1 Phone (390×844)

Run the 📱 flows end to end on a phone viewport: report an observation,
report an incident, conduct an inspection, act on a permit, brief a RAMS
crew, log a fire check, view your training, work your For me list.

| # | Check | Flag if |
|---|---|---|
| M-01 | Bottom tab bar / mobile nav reaches every module | A module unreachable on mobile |
| M-02 | No horizontal page scroll anywhere | Any |
| M-03 | Tap targets comfortably tappable one-handed | Controls under ~40px |
| M-04 | Camera capture works for photos and signatures | Camera not offered |
| M-05 | Signature pad works with a finger | Unusable |
| M-06 | Dialogs fit the screen and can be dismissed | A dialog whose action buttons are off-screen — **HIGH** |
| M-07 | Long registers scroll and page | Infinite scroll that never loads more |
| M-08 | Keyboard doesn't cover the field you're typing in | It does |

### 28.2 Offline

Use devtools to go offline (or airplane mode).

| # | Do | Expect | Flag if |
|---|---|---|---|
| O-01 | Navigate offline | The offline page, or cached content — not a browser error page | Chrome's dinosaur |
| O-02 | Fill the **incident report** form offline and submit | "Your report is saved on this device"; on reconnect the draft is restored | Data lost — **CRITICAL** |
| O-03 | Answer inspection questions offline | Queued; synced on reconnect | Lost |
| O-04 | Record RAMS briefings offline | Queued; **Retry now** offered if sync fails | Silent loss — **CRITICAL** |
| O-05 | Any queued action that fails to sync | The failure is **visible**, with the content recoverable | Silent |
| O-06 | Reconnect | A toast/indicator confirms the sync | No feedback |
| O-07 | Submit the same queued item twice | Recorded once | Duplicates |

---

## 29. Cross-module integrity sweep

Run this **last**, on a tenant where you have done everything above. It
catches the seams between modules, which is where this product is most
interesting and most likely to disagree with itself.

| # | Chain | Expect |
|---|---|---|
| C-01 | Inspection question fails → action raised → complete the action | The action links back to the exact question; the inspection report shows its status |
| C-02 | Observation → **Start an inspection from this observation** → submit | Both records reference each other |
| C-03 | Observation → promote to **Incident** | Linked both ways; photos carried across **by reference** (present on both) |
| C-04 | Incident investigation approved → findings become actions → close every action → close the incident | Closure only possible once the RIDDOR duty is discharged **and** every action is closed |
| C-05 | Incident → **Prompt reviews** on an RA, a COSHH assessment and an FRA | All three show a review pulled to now with a "prompted after an incident" entry |
| C-06 | RA published → bound into a RAMS pack → pack issued → RA revised and republished | The **issued pack does not change**; re-issue is required |
| C-07 | RAMS pack issued → linked on a permit whose type requires RAMS | Permit's RAMS gate satisfied; withdraw the pack → gate blocks again |
| C-08 | Contractor RAMS review accepted until a near date → let it expire | The permit gate stops accepting it |
| C-09 | Training requirement expires for a named permit worker | Permit issue blocks with that person and requirement named |
| C-10 | Fire logbook check fails → action raised → asset linked | The action appears on the asset's activity **and** the fire safety history |
| C-11 | Fire drill lessons → follow-up action | Linked and visible from both |
| C-12 | RA distributed → recipient acknowledges → RA republished | Recipient shows **re-acknowledgement pending**; a chase arrives |
| C-13 | Archive a **template** with a schedule, and a **group** used by an access rule and a training assignment | Cascade preview lists the real impact **before** you confirm; nothing silently breaks afterwards |
| C-14 | Deactivate a user who owns open actions, is a permit acceptor, is a fire marshal and is a lead investigator | Every dependency surfaced; nothing is orphaned without warning |
| C-15 | Every record you created today | Findable in **global search** and in the **audit log** |
| C-16 | Every module's needs-attention chip | Reconciles with its register when you click it |
| C-17 | Site Overview compliance cards | Reconcile with each module's register filtered to that site |
| C-18 | Every dashboard widget | Reconciles with the source register (§23) |

---

## 30. Final report template

Write `FREEHS-TEST-REPORT.md`.

```markdown
# FreeHS — full-product test report
Tested <date> · <browser + version> · desktop 1440×900 + phone 390×844
Tenant(s): <sandbox scenarios used> / <full tenant name>
Actors: ADMIN, MGR, STD-N, STD-S, CUSTOM, OUTSIDER, contractor portal user, anonymous

## 1. Verdict
Two or three sentences. Is the product usable end to end by a safety
manager today? What is the single worst thing you found?

## 2. Coverage
| Module | Screens visited | Controls exercised | Fully tested? |
|---|---|---|---|
| ... | | | yes / partial / no — why |

Explicitly list: what you could NOT test, and why (blocked, no data,
no permission, ran out of time).

## 3. Defects
Ordered CRITICAL → LOW, each in the §2 format. Number them FH-001 onward.

### CRITICAL
### HIGH
### MEDIUM
### LOW
### QUESTIONS (couldn't determine)

## 4. Dead or missing controls
Every button, icon, link or tab that did nothing, 404'd, or showed a
placeholder. Table: module | control | URL | what happened.

## 5. Copy and i18n
- Raw translation keys seen (module, key, URL) — one row each.
- Raw error codes shown to the user.
- Wording that is wrong for a UK H&S practitioner. Quote it, and say
  what you would have written.

## 6. Data integrity findings
Anywhere two screens disagreed about the same fact: a count, a date, a
status, a total. Table: fact | place A says | place B says | URL(s).

## 7. Access control
The §27 matrix, filled in with pass/fail per row. Every failure is
CRITICAL and must also appear in §3.

## 8. Cross-module chains
The §29 table, filled in.

## 9. Mobile & offline
What worked, what didn't, per §28.

## 10. What works well
Name it. A report of only complaints is not usable evidence.
```

### Rules for writing it

- **Report what happened, not what you assume was intended.** If a screen was
  empty, say it was empty.
- **Quote exact wording.** "Could be clearer" is useless — paste the sentence
  and write the one you would have used.
- **Separate broken from disagreeable.** A dead end and a wording choice you
  dislike are different findings with different severities.
- **A flow you could not finish is itself the finding.** Record where it
  stopped and what you expected next.
- **Do not fix the product in your head.** If a button's purpose is unclear,
  that is a QUESTION finding — not something to infer and move past.
