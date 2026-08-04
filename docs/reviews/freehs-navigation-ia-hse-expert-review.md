# FreeHS — Navigation & information architecture

## How four HSE practitioners would organise the menu

**Product:** FreeHS (freehs.software)
**Subject:** the primary navigation — now 20 items, flat
**Question asked of the panel:** *"The platform has grown to twenty menu
items. Show us how you would organise it — what groups, what order, what
names, and what each of your own users should see."*
**Purpose:** design input for an IA change.
**Date:** 3 August 2026

---

## Methodology & scope (read this first)

This is a design review, not a defect review. The four practitioners were shown
the navigation exactly as it ships on `main` today and asked to restructure it
for their own organisations, then to converge on one recommendation.

**The menu as it stands** (a FreeHS deployment, user holding every permission):

```
AI Assistant · Dashboard · Sites · Inspections · Templates · Schedules ·
Approvals · Observations · Incidents · Actions · Heads Up ·
Risk assessments · COSHH · Permits · Fire Safety · Assets · Maintenance ·
Documents · Contractors            … + Settings pinned at the bottom
```

Twenty entries, one undifferentiated column, no sections, no nesting, no
counts. Desktop sidebar and mobile drawer render the identical list.

**Two things to say in fairness before the criticism.** First, this list is
*longer than it was* precisely because earlier feedback was actioned:
Templates, Schedules, Approvals and Maintenance were live, working areas
reachable only by typed URL (platform review PF-14), and Dashboard exists
because PF-5 was built. Both were right calls. But rescuing four orphans into a
flat list traded a discoverability problem for a scanning problem. Second, the
menu is now **permission-gated** (PF-27) — a Standard user genuinely sees
fewer entries — and the sites/projects terminology setting threads through it
properly. The panel's argument is not that the work was wrong; it is that a
20-item flat list is the point at which grouping stops being cosmetic.

---

## The reviewers

| # | Reviewer | Organisation | Menu problem they feel most |
|---|----------|--------------|------------------------------|
| 1 | **Priya Nair, CMIOSH** | Precision engineering, ~800 staff, 3 sites | Uses nearly all of it; needs it to mirror how a safety management system is actually structured |
| 2 | **Tom Whitfield, GradIOSH** | Building-services contractor, ~40 staff | Uses 6 of 20; everything else is noise, and it's a scroll on a phone |
| 3 | **Dr. Aisha Bello, CFIOSH** | NHS trust, thousands of staff | 95% of her users need *two* things; the menu is built for the other 5% |
| 4 | **Marcus Lindqvist, CMIOSH** | EHS consultant / ISO 45001 auditor | The order is build-history, not a logic anyone can follow |

---

# 1 · Priya Nair — Group HSE Manager

> *"I use eighteen of these twenty every month, so I'm not asking you to
> delete anything. I'm asking you to make the list mean something. Right now
> it's alphabet soup with no seams — and the seams already exist in my head,
> because they exist in my safety manual."*

### What's wrong with it for me
- **Four different kinds of thing are mixed together.** Places I *work daily*
  (Inspections, Actions), *registers I maintain* (RA, COSHH, Fire), *supporting
  infrastructure* (Sites, Assets, Documents, Contractors) and *sub-tools of a
  parent* (Templates, Schedules and Approvals only exist because Inspections
  does; Maintenance only exists because Assets does). Presenting all four at
  the same level says they're the same kind of decision. They aren't.
- **Sites at position three** is odd. Sites is infrastructure I configure a few
  times a year, sitting above everything I touch daily.
- **My four compliance registers are scattered** between Heads Up and Assets.
  When an auditor says "show me your risk assessments, your COSHH file and your
  fire risk assessment", I want one seam to point at, because that's how my
  manual is organised and how the audit is run.
- **No counts.** A 20-item menu is navigable *if the menu tells you where the
  problem is.* Every module already computes a needs-attention number —
  overdue actions, RIDDOR clocks, overdue fire checks, due reviews. None of it
  reaches the menu, so I open modules speculatively to find out whether
  anything needs me.

### How I'd set it up
Group by **what kind of thing it is**, in the order the safety cycle runs, and
nest the sub-tools under their parents:

- **Dashboard first**, then the assistant.
- **A daily-work group**: Inspections (with Templates, Schedules and Approvals
  *inside* it), Observations, Incidents, Permits, Actions.
- **A registers group**: Risk assessments, COSHH, Fire Safety. These are the
  documents that live for years and get reviewed — a different rhythm entirely
  from the work group.
- **An organisation group**: Sites, Assets (with Maintenance inside),
  Contractors, Documents. The things work happens *to* and *with*.

That's four groups of three to five, which I can scan. And put the
needs-attention count on the group header as well as the item, so a collapsed
group still tells me it needs opening.

**One thing I'd resist:** don't let me hide modules I'm not using. On a
multi-site estate the module I've "hidden" is the one that lapses.

---

# 2 · Tom Whitfield — H&S Advisor, contractor

> *"I use six: Inspections, Observations, Permits, Actions, Documents,
> Contractors. The other fourteen are somebody else's job. On my phone the
> drawer is a scroll — I've genuinely thumbed past 'Permits' twice on a wet
> Tuesday because it's sandwiched between COSHH and Fire Safety."*

### What's wrong with it for me
- **Length is the whole problem on mobile.** Twenty rows in a drawer means the
  thing I want is off-screen. The desktop sidebar at least shows all twenty at
  once; the phone shows about eleven.
- **My most frequent action isn't in the menu at all.** What I do fifteen times
  a week is *start something* — raise a permit, report a hazard, open today's
  inspection. Every one of those is two taps minimum: find the module, find its
  button.
- **The order fights me.** The five items I never touch (Templates, Schedules,
  Approvals, COSHH, Fire Safety) sit in the middle of the five I use hourly.
- Permission gating helps my labourers, but *I* hold every key, so I see all
  twenty. Gating by permission doesn't help the person whose problem is
  frequency, not authority.

### How I'd set it up
- **Grouping fixes most of it**, because collapsed groups are short. Give me
  Priya's four groups with the ones I don't use collapsed by default and my
  daily group open, and my phone drawer is six visible rows.
- **Put a "＋ Report / Start" action at the top of the drawer**, above the
  menu — hazard, incident, permit, inspection. That's my two-taps-to-one fix
  and it serves the whole workforce, not just me.
- **Remember where I've been.** A small "recent" cluster of the last three
  areas I opened would beat any taxonomy you or I invent.
- Let me **collapse a group and have it stay collapsed**. If COSHH and Fire
  Safety are folded away on my phone forever, that's a correct outcome for a
  building-services contractor — as long as it's *folded*, not *hidden*, so
  it's there the day a client asks.

---

# 3 · Dr. Aisha Bello — Head of OH&S, NHS trust

> *"You have built a menu for safety professionals. The overwhelming majority
> of the people who will ever log into this are not safety professionals —
> they're a nurse who needs to report a needlestick and acknowledge a
> briefing. For them, twenty items is not a menu, it's a search problem."*

### What's wrong with it for me
- **Two audiences, one menu.** Roughly 90% of my licensed users are *doers*
  with three needs: report something, deal with what's assigned to me,
  acknowledge what I've been sent. The other 10% maintain the system. The
  current menu serves the 10%, and the 90% must scan past fourteen modules
  they'll never open to find their two.
- **"Observations" vs "Incidents" is genuinely ambiguous to a new user**, and
  they now sit adjacent. A porter who has just been assaulted does not know
  which one to pick, and picking wrong sends a serious injury down the
  hazard-reporting path with no alert. The menu should not be the place that
  decision gets made — the *report* flow should ask "was anyone hurt?" and
  route it.
- **"Heads Up" means nothing outside this product.** It is the single most-used
  item by frontline staff and it is named in internal jargon. "Briefings" or
  "Announcements" costs nothing and explains itself.
- **Accessibility**: twenty links before the main content is a long tab order
  and a long screen-reader traversal on every page load. Grouping with proper
  landmarks/headings fixes that as a side effect; a flat list of twenty cannot.

### How I'd set it up
- **A short personal block at the very top, above the modules**: *My actions*,
  *My acknowledgements*, and a *Report* button. For most of my staff that block
  **is** the application, and they should never need to look below it.
- Then the grouped modules, permission-gated as now — so a nurse sees the
  personal block plus perhaps Observations, Incidents and Documents, and
  nothing else.
- **Counts on the personal items** ("My actions ③"), because that's what makes
  someone open the app at all.
- **Rename for the audience that isn't in the room**: Heads Up → Briefings;
  Observations → "Hazards & near misses" (or keep the word and subtitle it).
  Both of those are read by people with thirty seconds and no training.

---

# 4 · Marcus Lindqvist — EHS consultant & ISO 45001 auditor

> *"I've now audited seven of these reviews' worth of this product, and I can
> reconstruct your build order from the menu. AI first because it was the home
> page, Sites third because Phase 1 shipped it, the four brand modules in the
> order you wrote them, Maintenance next to Assets because it arrived with it.
> That's archaeology, not information architecture."*

### What's wrong with it for me
- **The order encodes history, not meaning.** No user shares that mental model,
  because no user was there.
- **The menu doesn't express the golden thread.** The platform's real value is
  that a hazard becomes an observation, becomes an incident, becomes an
  investigation, becomes an action, and forces a risk-assessment review. Those
  five things are scattered across the list with Heads Up in the middle. Put
  them adjacent and the menu *teaches* the workflow.
- **Two non-modules lead the list.** Dashboard and AI Assistant are both
  answers-about-everything, not places; they belong together above a rule,
  visually distinct from the modules.
- For audit, I want **the registers adjacent** for the same reason Priya does:
  when I ask for the compliance file, one seam should answer.

### How I'd set it up
Group headers should be **verbs or roles, not abstractions** — a menu that says
"Operational" and "Configuration" tells a user nothing. I'd use:

- **Do the work** — Inspections, Observations, Incidents, Permits, Actions.
- **Keep the records** — Risk assessments, COSHH, Fire Safety.
- **The organisation** — Sites, Assets, Contractors, Documents.

Three groups plus a top block. And one governance point: **the group a module
sits in is a product decision that should be declared once, in the module
catalogue, not inferred from array order in a React component.** Every module
already declares brand and permission; let it declare its nav group and weight
too, so the next module lands in the right place by construction rather than by
someone remembering.

---

# The converged proposal

All four converged on the same shape: **a personal block, then three or four
named groups, with sub-tools nested and counts surfaced.** This is the panel's
joint recommendation.

```
  ▪ Dashboard                                   ← needs-attention overview
  ▪ Ask AI

  ── FOR ME ─────────────────────────────
  ▪ My actions                        ③        ← Actions, pre-filtered to me
  ▪ My acknowledgements               ①        ← Heads Up + RA/doc sign-offs
  ＋ Report                                     ← hazard · incident · permit · inspection

  ── DO THE WORK ────────────────────────
  ▪ Inspections                                 ← ▸ Templates · Schedules · Approvals
  ▪ Observations                                  (nested, or tabs within Inspections)
  ▪ Incidents                         ②
  ▪ Permits                           ⑤
  ▪ Actions

  ── RECORDS & REGISTERS ────────────────
  ▪ Risk assessments                  ②        ← counts = due for review
  ▪ COSHH
  ▪ Fire Safety                       ④

  ── THE ORGANISATION ───────────────────
  ▪ Sites
  ▪ Assets                                      ← ▸ Maintenance (nested)
  ▪ Contractors
  ▪ Documents
  ▪ Briefings                                   ← renamed from "Heads Up"

  ⚙ Settings
```

**What this changes in numbers:** 20 flat rows → 16 module rows in 3 named
groups, plus a 3-row personal block. With the two groups a contractor doesn't
use collapsed, Tom's phone drawer shows 9 rows instead of 20. A Standard NHS
user, permission-gated, sees the personal block and perhaps four modules.

### The reasoning behind the contested placements
- **Permits sits in "Do the work", not "Registers"** — a permit is a live
  operational control issued and closed within a shift, not a document
  maintained for years. (The *permit type catalogue* is configuration and
  belongs inside the module, where it already is.)
- **Fire Safety sits in "Registers"** despite containing a live logbook,
  because its centre of gravity is the FRA and the statutory calendar.
- **Actions sits in "Do the work"** *and* is surfaced personally as "My
  actions" — the same module, two doors, because the practitioner managing all
  actions and the operative closing their own three are different jobs.
- **Briefings/Heads Up sits in "The organisation"** as the distribution
  channel alongside Documents. This was the panel's least confident call:
  Aisha would accept it only because "My acknowledgements" gives frontline
  staff their real door.
- **Templates, Schedules and Approvals nest under Inspections; Maintenance
  nests under Assets** — they have no independent existence and this is what
  takes the list from 20 to 16 without hiding anything.

### The four supporting recommendations
1. **Counts in the menu.** Every module already computes its needs-attention
   number; surface it on the item and aggregate it on the collapsed group
   header. This is what makes a longer menu *faster*, because you navigate to
   the red rather than by memory. Priya, Aisha and Marcus all raised it
   independently.
2. **Collapsible groups with persisted state**, defaulting open. Tom's fold-away;
   nothing is ever hidden.
3. **A "＋ Report / Start" affordance above the menu**, offering hazard,
   incident, permit and inspection. Removes a tap from the most frequent action
   in the product and serves the whole workforce.
4. **Renames**: *Heads Up → Briefings*; *Observations → Hazards & near misses*
   (or keep the word with a subtitle). Both are read by people with no training
   and thirty seconds. And fix the ambiguity properly at source: the Report flow
   should ask "was anyone harmed?" and route to Incidents or Observations, so
   the menu is never where that judgement is made.

### What the panel explicitly did **not** ask for
- **No user-customisable menu.** Priya's point: the module someone hides is the
  one that lapses. Group-collapse yes; hide no.
- **No further permission gating.** It's already correct.
- **No dropdown/mega-menu.** Sections in a sidebar, not hover menus.
- **Don't remove anything.** Every one of the twenty earns its place; only three
  are misplaced and four are misnamed or unnested.

---

# Priority

| # | Change | Effort | Impact | Asked by |
|---|--------|--------|--------|----------|
| 1 | Group the 16 modules under 3 headers; nest Templates/Schedules/Approvals under Inspections and Maintenance under Assets | Small | High — the whole complaint | All four |
| 2 | Personal block: My actions · My acknowledgements · ＋Report | Medium | High for the ~90% who aren't practitioners | Bello, Whitfield |
| 3 | Needs-attention counts on items + collapsed group headers | Medium | High — makes length stop mattering | Nair, Bello, Lindqvist |
| 4 | Collapsible groups, state persisted | Small | High on mobile | Whitfield |
| 5 | Renames (Briefings; Hazards & near misses) + route the report decision in-flow | Small | Medium — clarity for untrained users | Bello |
| 6 | Declare nav group + weight in the module catalogue rather than array order | Small | Medium — stops the next module landing wrong | Lindqvist |

---

# Implementation notes

Where this lands, for whoever picks it up:

- **One file for the structure.** `apps/web/src/components/site-sidebar.tsx`
  holds the flat `primary: NavItem[]` and renders it with a single
  `primary.map(renderItem)`. Adding a `group` field to `NavItem` and rendering
  grouped sections changes this file only — `mobile-nav.tsx` reuses
  `SiteNavItems`, so desktop and drawer stay in parity for free.
- **Nesting** wants a `children?: NavItem[]` on the parent plus an expanded
  state; the existing `isActive` already special-cases Inspections →
  Approvals/Schedules, which becomes unnecessary once they're children.
- **Group/weight in the catalogue** (Marcus's point) belongs next to
  `BRAND_MODULES` in `packages/shared/src/brand.ts`, so a module declares
  brand + permission + nav placement in one place.
- **Counts** should come from a single batched endpoint rather than each module's
  overview query, or the sidebar will fire a dozen requests per page load; most
  modules already expose an `overview`-shaped procedure to aggregate from.
- **i18n**: new keys needed for the three group headers, the personal block and
  the two renames — all 10 locales, in the same PR (the `nav.fireSafety`
  incident is the cautionary tale here).
- **Accessibility**: render groups as `<nav>` → `<h2>` + `<ul>` (or
  `role="group"` with `aria-labelledby`) so the grouping is real for screen
  readers and not just visual — that is where Aisha's tab-order concern is
  actually resolved.
- **Keep** the terminology hook (`navLabelKey`) for the Sites/Projects label and
  the existing permission gating; both are working correctly.

---

*Prepared as an independent practitioner design review of the FreeHS primary
navigation, following seven module and platform reviews. The current-state
description is verified against `main`; the recommendation is the panel's
converged proposal, not a specification — the placements the panel found
genuinely contestable are flagged as such above.*
