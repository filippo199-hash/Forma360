# Marketing-site review — a simulated four-person HSE panel

> **This is a simulation, not real user research.** The four reviewers below
> are invented personas, written to stress the new freehs.software marketing
> site (`/`, `/product`, `/product/[slug]`, `/docs`, `/docs/[slug]`) from four
> different sectors and buying positions. Nobody in this document exists, no
> real company was consulted, and the scores are judgement calls, not data.
> Treat it as a structured heuristic review with named angles — useful for
> finding gaps and testing whether the messaging lands, worthless as evidence
> of demand. Where a reviewer asserts a fact about the site, it has been
> checked against the shipped source; those checks are collected in
> [Verified defects](#verified-defects-worth-fixing-regardless-of-the-personas).

**Date:** 18 August 2026 · **Build reviewed:** `75d64b9` (live on freehs.software)
**Brand:** FreeHS (17 modules, sandbox on, free plan on)

---

## The panel

| Reviewer | Organisation | Scale | Angle they bring | Would sign up today |
| --- | --- | --- | --- | --- |
| Marta Quinn | Kesteven Precision Ltd (precision engineering) | 140 staff, 2 sites | Lone HSE manager, no budget, escaping spreadsheets | **8.5 / 10** — yes, this week |
| Ade Fashola | Brackley & Vane Construction (principal contractor) | 380 direct + ~200 subcontractors, 12 live sites | Field-first: permits, RAMS, subcontractor competence | **7.5 / 10** — pilot one site |
| Fiona Strachan | Craigenlow Care Group (residential care) | 9 homes, ~600 staff, Scotland | Care sector, devolved regulation, non-technical staff, DPO scrutiny | **6 / 10** — partial adoption only |
| Rajiv Menon | Northgate Logistics Group | 2,100 staff, 34 sites (UK + 2 ROI) | Enterprise procurement, InfoSec, replacing an incumbent | **5 / 10** to buy · 8/10 on concept |

---

## 1. Marta Quinn — HSE Manager, Kesteven Precision Ltd

*I am the entire health and safety function for 140 people across two units. I
found this by googling "free risk assessment software uk" on a Thursday night.*

### First thirty seconds

The headline did its job. "Everything you need to run health & safety." then
**Free.** in blue — I read that and immediately thought *what's wrong with it*,
which I suspect is the reaction you get from everyone in my position. The pill
above it ("100% free · Unlimited users · No card") answered the second and third
questions before I asked them. It did not answer the first one, and I will come
back to that because it is the only thing standing between you and my sign-up.

The picture underneath — the actions register with three overdue — is the
first time a safety product has shown me a screen that looks like my actual
week rather than a hero shot of a man in a hard hat pointing at a tablet. Good.
I did notice it is a drawing rather than the real thing.

### What landed

- **The strip of regulations.** "HSE five-step risk assessments · RIDDOR 2013
  screening & deadlines · COSHH assessments & exposure limits". That is my job
  description. Thirty seconds in, I knew this was built by someone who has met
  a risk assessment, not by a generic forms company with a safety template.
- **"A finding becomes a fix — and stays linked."** This is the bit that made
  me keep scrolling. My genuine problem is not writing assessments, it is that
  a thing I spot on Tuesday lives in my notebook, then a spreadsheet, then an
  email, and then in nobody's head. The little diagram — inspection question
  fails → action assigned → closed with photo — is exactly the loop I lose.
- **"Try it now — no account".** I clicked it before I read the pricing. I have
  been burned by "free trial" meaning "fourteen days then a phone call from a
  salesman", and being able to look without handing over my work email is the
  reason I'm still reading.
- **The guides.** Genuinely the best part of the site. I read "Write a risk
  assessment" (7 min) and it told me to assess the activity and not the
  building, and that "the workshop" produces a poster while "using the bench
  grinder" produces controls someone can follow. That is a real opinion, held
  by someone who has done this. It made me trust the software more than any
  feature list did.

### What made me hesitate

1. **I still don't know how you eat.** The pricing section says free is free and
   names one paid add-on, and I believe the sentence, but nowhere does the site
   say *why*. One line — "we make money from X, the platform stays free because
   Y" — would do more for my confidence than the whole pricing panel. Without
   it my brain fills the gap with "they'll get bought and start charging" or
   "I'm the product".
2. **Seventeen modules is a wall, not a welcome.** I don't do permits to work.
   I don't do RAMS. Seeing them makes the product look like it's for someone
   bigger than me, which is the opposite of what you want. I want a door that
   says "lone HSE manager, manufacturing, 100–200 people — start here" and
   hands me risk assessments, accidents and actions. Everything else can wait
   until I ask for it.
3. **I cannot see the product.** The module pages are beautifully written and
   completely wordless. Before I spend an evening moving my assessments in, I
   want to see the risk assessment form. One screenshot per module page would
   have taken me from "reading" to "signing up" ten minutes earlier.
4. **Who do I ring?** If a permit — sorry, if an *assessment* won't publish at
   8am I need to know whether I'm on my own. The site says nothing about
   support. Even "support by email, we usually answer within a day, no ticket
   deflection" would be reassuring precisely because it's modest.
5. Small thing, but I noticed one of the seventeen has a "Paid add-on" badge
   directly under a heading that says all seventeen are free. It's the only
   place on the page where I felt slightly sold to.

### What I would change

| Priority | Change |
| --- | --- |
| 1 | One honest sentence about the business model, in the pricing section |
| 2 | A "start here" path by role and company size, above or instead of the 17-module grid |
| 3 | Real screenshots on module pages — the RA editor, the actions board, the mobile hazard form |
| 4 | A support-and-response-time line, however modest |
| 5 | Printable/PDF version of the guides, so the how-to can go in my folder |

**Verdict: 8.5 / 10.** I'm creating a workspace this weekend and moving the
COSHH file first because that's the one that's out of date. If the RA editor
looks like the guide describes, I'll have my whole assessment library in it
within a month. You very nearly lost me at "free" and won me back with the
documentation.

---

## 2. Ade Fashola — Head of SHEQ, Brackley & Vane Construction

*Principal contractor. 380 of ours, about 200 subcontractors on any given week,
twelve live sites. I read this on my phone in a site cabin with one bar of
signal, which is how anyone in my job reads anything.*

### The phone experience, first

The hero reads well on a phone and the type is big enough to read in daylight,
which is more than I can say for most. But **there is no menu**. Signed out, on
a phone, the top bar gives me the logo, "Sign in" and "Try it free" — and
nothing else. To get to the modules or the guides I had to thumb through the
entire homepage to the footer. On a desktop the nav has Modules, Docs and
Pricing; on the device your actual users hold, it has none of them. That is the
single most fixable thing on this site.

### What landed — and it landed hard

- **"The issue gate."** "A permit is a promise that the checks happened. The
  gate makes that promise structural rather than cultural." I stopped scrolling
  and read that section twice. Every permit system I have used is a form that
  records a decision someone already made. One that *refuses to issue* until
  the gas readings are in range and fresh, the isolation certificate exists and
  the clash is acknowledged by a named person — that is a different product
  category. If it does what that page says, it changes my risk profile.
- **External acceptors signing on glass.** Whoever wrote "naming an internal
  colleague instead is legally wrong" has stood in my shoes. Every system we've
  trialled forced my site manager to accept a permit for work he wasn't doing,
  and every auditor has pulled us on it.
- **The RAMS rule** — a pack won't issue if a high-residual hazard in a bound
  assessment is addressed by no step. I have reviewed a hundred subcontractor
  packs that would fail that test. If I can hand this to a subbie and have the
  software do the arguing, that saves me my Friday afternoons.
- **The gate kiosk answering "who is on site right now".** That's the question
  I cannot currently answer at a muster point, and I've been asked it in an
  investigation.

### What made me hesitate

1. **Offline is not on the homepage, and it should be the second thing on it.**
   My sites have no signal. I found "briefings queue offline and sync later,
   and a sync failure is surfaced loudly, never silently lost" buried in a RAMS
   guide, and the incident guide mentions drafts surviving a dropped signal.
   That is a headline feature for anyone doing construction, and right now you
   have to read three levels deep to learn it exists. If it isn't on the front
   page I assume it isn't there — that's how everyone in my sector reads these
   sites.
2. **Do my subbies count as users?** "Unlimited users" reads as your staff.
   I have 200 subcontractor operatives who need to receive a briefing and sign
   it. Somewhere between "unlimited users", "external acceptors without a seat"
   and "portal accounts scoped to what you grant" the answer is probably yes —
   but I had to assemble it from three pages, and I'd want it in writing before
   I take it to my directors.
3. **No pictures of a permit.** Same complaint as everyone, but sharper for me:
   I have to convince twelve site managers to change how they work. I cannot do
   that with prose. Show me the permit on a phone, the gas readings entry, the
   board of open permits. One screenshot per page.
4. **Nothing on CHAS, SSIP, PQQs or CDM.** Half my life is evidencing our
   systems to clients and accreditation bodies. The product clearly produces
   that evidence — the site never says the words my clients use.
5. The trust strip says "Fire Safety Order 2005", which is fine for me in
   England, but I'd want the same care taken over CDM 2015 language somewhere.

### What I would change

| Priority | Change |
| --- | --- |
| 1 | Mobile nav for signed-out visitors — Modules, Docs, Pricing |
| 2 | "Works offline on site" as a homepage claim, with the sync-failure honesty |
| 3 | Screenshots: permit on a phone, gas readings, the live board |
| 4 | A plain statement about subcontractors and seats |
| 5 | A construction page speaking CDM/CHAS/SSIP/PQQ, linking permits + RAMS + contractors + training |

**Verdict: 7.5 / 10.** I'd put one site on it next month and run permits and
RAMS in parallel with paper for a fortnight. The writing convinced me the
thinking is right; I need to see the screens before I roll it to twelve sites,
and my site managers need a menu on their phones.

---

## 3. Fiona Strachan — Compliance & Facilities Lead, Craigenlow Care Group

*Nine care homes in Scotland, around 600 staff, most of whom are not people who
enjoy software. I look after fire safety, accidents, and whatever else lands.*

### First impression

Warmer than I expected. The tone throughout is plain English, and the homepage
doesn't shout. "Free" matters enormously to me — my budget for systems is
effectively nil, and every pound spent on software is a pound not spent on the
floor — so the price genuinely changes what is possible for us.

Then I opened Fire safety, and my heart sank slightly.

### The thing that stopped me: this site is written for England

The fire module says buildings are classified against "the Fire Safety
(England) Regulations thresholds — 11 metres, 18 metres, seven storeys", and
the homepage strip cites the "Fire Safety Order 2005". None of that is my law.
I work to the Fire (Scotland) Act 2005 and the Fire Safety (Scotland)
Regulations 2006, and my inspections come from the Care Inspectorate, not CQC.

To be fair on the detail: the Fire Safety Order 2005 does cover England *and*
Wales, so my Welsh counterpart is half-served — but the 11 m / 18 m / seven-
storey thresholds you name come from the Fire Safety (England) Regulations 2022,
which are England-only. For Scotland and Northern Ireland, neither instrument
applies.

I am not saying the software can't serve me — a logbook is a logbook, a PEEP is
a PEEP, and everything else I read looked directly applicable. I'm saying that
a page claiming to be "built for UK practice" and then naming only English
instruments tells a Scottish reader, in one line, that they were not thought
about. This is a copy problem before it's a product problem, and it's the
reason I would not put fire safety on this system without asking you first.

### What landed

- **PEEPs sitting inside the building file.** Nobody puts PEEPs on a marketing
  page. We live and die by them, and mine are currently in a ring binder and a
  spreadsheet that disagree with each other.
- **"Failures stay loud."** A failed check that holds red until a pass clears
  it, with the follow-up action raised by default. Our current logbook is a
  book, and a failed weekly alarm test genuinely does scroll away. That
  paragraph describes my actual risk.
- **Confidential incident kinds.** Sharps and violence & aggression defaulting
  to confidential — counted in the numbers, readable only by those who should —
  is the first time I have seen a safety product acknowledge that half my
  incidents involve a named vulnerable person and a distressed member of staff.
  Someone with sector experience wrote that.
- **QR reporting with no login.** This is the feature I would deploy first, and
  the one most likely to survive contact with my workforce. My carers will not
  install an app or remember a password. They will scan a poster in the sluice
  room.

### What worries me

1. **WhatsApp and AI, near resident data.** I like the idea; my data protection
   officer will not. Messages about incidents involving residents travelling
   through Meta's infrastructure, and an AI reading our records to answer
   questions, will trigger a DPIA and a list of questions the site does not
   answer anywhere: who processes what, where is data hosted, which
   sub-processors, can the assistant be switched off per organisation? The
   answers may be excellent. There is no page to send my DPO to, so the
   conversation stalls before it starts.
2. **Nothing on this site speaks care.** Every example is a warehouse, a
   forklift, a rack guard, a bench grinder. I found the sector-relevance by
   reading the fire and incident pages closely; a colleague skimming would
   conclude this is industrial software. One page with a resident, a moving-
   and-handling assessment and a medication room would change that entirely.
3. **Accessibility isn't mentioned.** A good part of my staff are over fifty
   and use whatever phone they have. Does the reporting form work on a five-
   year-old Android? Is the text resizable? I'd want a line about it.
4. **No dates on the guides.** They're excellent, but compliance guidance with
   no "last reviewed" date is guidance I have to verify myself before I put it
   in front of staff.

### What I would change

| Priority | Change |
| --- | --- |
| 1 | State the devolved position — Scotland, Wales, NI — on the fire module and in the trust strip |
| 2 | A security & data-protection page my DPO can read: hosting, sub-processors, the AI/WhatsApp position, DPIA support |
| 3 | A care-sector page — residents, PEEPs, moving & handling, safeguarding-adjacent incidents |
| 4 | "Last reviewed" dates on every guide, plus a printable version for the staff room |
| 5 | A sentence on accessibility and old devices |

**Verdict: 6 / 10 today.** I would start with hazard reporting, incidents and
actions across two homes tomorrow — those are unambiguous wins and the QR
posters alone justify it. I cannot move fire safety until someone tells me
where Scotland stands, and I cannot answer my DPO with the pages that exist.
Fix those two and this becomes a 9 for us, because the sector understanding
underneath it is better than anything we have been sold.

---

## 4. Rajiv Menon — Group Head of Risk & Compliance, Northgate Logistics Group

*2,100 people, 34 sites, two of them in the Republic. We have an incumbent
system we dislike and a renewal in the spring. I read marketing sites the way I
read tenders.*

### How this reads to a buyer

Handsomely built, unusually honest in places, and not yet purchasable.

I want to be clear about the direction of my scepticism, because it isn't the
obvious one. I am not worried that free means bad. I am worried that free means
**temporary**. My fire risk assessments, RIDDOR determinations and investigation
sign-offs are statutory records with retention obligations measured in decades.
If I put them in a system that has no visible revenue and the company folds or
pivots in eighteen months, that is not a procurement embarrassment, it is a
compliance failure with my name on it. Nothing on this site addresses continuity
or exit. Per-record PDF and CSV exports are mentioned; a guarantee that I can
extract *everything* — records, evidence files, signatures, audit trail — in a
usable form, on demand, is not.

### The credibility problem in the pricing section

The heading over the module grid says **"17 connected modules. All of them
free."** In that same grid, the Analytics & dashboards tile carries a **"Paid
add-on"** badge. Further down, the plan panel lists "All 17 modules — registers,
permits, incidents, the lot" as included, and then a panel beside it describes
the add-on that isn't. The add-on has no price anywhere on the site.

I'm not scoring points. The section exists to disarm suspicion about the word
"free", and as written it manufactures exactly the suspicion it's trying to
remove — the first hard number I looked for was missing, and the first claim I
checked contradicted itself. Say "16 modules free, dashboards from £X" and you
are stronger, not weaker, because now everything else on the page inherits the
credibility of a number I can verify.

### What I rated highly

- **No fake social proof.** No invented logos, no "trusted by 10,000 teams". In
  my experience that restraint correlates with honest engineering.
- **The permissions language.** "The interface hides what you cannot do; the
  server refuses it as well" and per-viewer widget gating on dashboards. That's
  a sentence written by someone who understands that access control in the UI is
  decoration. It reads like it came from an architecture document, and that is a
  compliment.
- **The golden thread framing** is the correct enterprise argument. My problem
  at 34 sites isn't capturing findings, it's demonstrating closure. This site
  leads with closure. Good instinct.
- **The docs library.** Forty-two guides at launch is a real signal of maturity
  and materially reduces my rollout training cost.

### What blocks a purchase

1. **No security page.** I need, in one place: hosting region, encryption at
   rest and in transit, backup and RPO/RTO, sub-processor list, ISO 27001 or
   SOC 2 status (or an honest "not yet, here's our roadmap"), SSO/SAML, MFA,
   audit-log availability, and a DPA I can attach to a contract. Privacy and
   Terms exist in the footer — I read both — but they're legal documents, not a
   trust page. Without this I cannot even open a file with our InfoSec team.
2. **"Pricing" in the nav is a jump link, not a page.** I tried to send the
   pricing to my finance director. I couldn't send a link to a section that
   only exists on the homepage of a site he'll skim on a phone — where, I note,
   the nav item doesn't appear at all.
3. **No migration story.** We have four years of incidents and 900 assessments
   in the incumbent. Nothing on this site says whether I can bring them, in what
   format, or whether you'll help. At my scale this is the difference between a
   project and a fantasy.
4. **No ISO 45001 mapping.** We're certified; our auditor will ask which clauses
   the system evidences. Reading the module pages, the answer is "most of
   them" — 6.1.2 hazard identification, 8.1.2 eliminating hazards, 9.1 monitoring,
   10.2 incident and nonconformity. Say so on a page and you shorten my internal
   business case by a month.
5. **No support or availability commitment, and no status page.** For a free
   product I don't expect a 99.9% SLA. I expect you to tell me what I do get.
6. **No company page.** Who builds this? The footer has a company number, which
   I looked up — that's more than most. Put a page in front of it.

### What I would change

| Priority | Change |
| --- | --- |
| 1 | Fix the 17-modules-all-free contradiction and publish the add-on's price |
| 2 | Ship `/security` and a real `/pricing` page (linkable, phone-reachable) |
| 3 | A written data-portability and exit commitment — how I get everything out |
| 4 | ISO 45001 clause-mapping page |
| 5 | Migration and import: what you support, what you'll help with |
| 6 | SSO/SAML on the roadmap, stated publicly; a status page; a team/company page |

**Verdict: 5 / 10 as a purchase today, 8 / 10 as a product.** I would run a
two-site pilot on my own authority because it costs me nothing but time, and I
suspect the pilot would go well. I could not take this to our risk committee in
its current state — not because of anything the software does, but because four
of the six documents that committee asks for don't exist on the website.

---

## Cross-cutting synthesis

### Where all four agreed

1. **The absence of product screenshots is the site's biggest weakness.** All
   four raised it unprompted, for different reasons: Marta wants to see the form
   before investing an evening, Ade must convince twelve site managers, Fiona's
   staff need to recognise the thing they'll be asked to use, Rajiv needs to
   show a committee. Seventeen module pages of excellent prose and zero images.
   This is the highest-value fix on the list.
2. **The writing is the product's best salesperson.** Every reviewer named the
   docs or a module page's specific sentence as the moment they started
   believing. "The issue gate", "failures stay loud", "assess the activity, not
   the building". Whatever else changes, don't sand this down into feature
   bullets.
3. **"Free" needs a because.** Three of four asked how the company survives, and
   the fourth (Rajiv) escalated it into a continuity risk. One honest sentence
   plus an exit/portability commitment neutralises the whole objection.
4. **Nobody wants seventeen doors.** Every reviewer wanted a smaller, more
   specific entrance — by role, by sector, by company size. Breadth reads as
   "not for me" to a specialist and as "unfocused" to a buyer.

### Where they split — and what that tells you

| Tension | SME (Marta) | Field (Ade) | Care (Fiona) | Enterprise (Rajiv) |
| --- | --- | --- | --- | --- |
| Reaction to "free" | Delight, then suspicion | Neutral — "prove it works on site" | Delight — it changes what's possible | Suspicion — vendor viability risk |
| What they need next | A starting path | Offline + screenshots | Devolved regs + DPO answers | Security page + a price |
| Biggest blocker | None, really | Mobile nav, unseen screens | Scotland, data protection | Procurement documents |
| Where they'd start | COSHH file | One site, permits + RAMS | QR hazard reporting, 2 homes | Two-site pilot |

The pattern: **the smaller the organisation, the more the current site works.**
It is close to perfect for Marta and progressively less sufficient as scale,
regulation and procedure increase. That's a reasonable place to be for a
free-led product — but if mid-market and enterprise matter, the missing pieces
are documents, not features.

### Verified defects worth fixing regardless of the personas

These were checked against the shipped source, not imagined by a persona.

| # | Defect | Evidence | Severity |
| --- | --- | --- | --- |
| 1 | "17 connected modules. **All of them free.**" contradicts the "Paid add-on" badge on Analytics & dashboards in the same grid; the plan panel repeats "All 17 modules" as included; the add-on has no price anywhere | `src/content/site.ts` (`MODULES_SHOWCASE.title`, `HERO.subtitle`, `PRICING.included`) vs `src/content/modules.ts` (`dashboards.paidAddOn`) | **High** — the credibility of the whole pricing story |
| 2 | Signed-out visitors on phones have no navigation to Modules, Docs or Pricing — links are `hidden … md:inline-flex` and `MobileNav` renders only when signed in; footer is the only route | `src/components/site-header.tsx` | **High** |
| 3 | No product imagery anywhere on the marketing site — zero `<img>`/`next/image` in the marketing and home components | `src/components/marketing/`, `src/components/home/` | **High** |
| 4 | `/docs` has 42 guides and no search or filter | `src/components/marketing/docs-index.tsx` | Medium |
| 5 | Fire-safety copy names England-only instruments under a "Built for UK practice" claim: the 11 m/18 m/7-storey thresholds are Fire Safety (England) Regulations 2022, and the trust strip's Fire Safety Order 2005 covers England & Wales only — nothing addresses Scotland or NI | `src/content/modules.ts:625-630`, `src/content/guides/registers.ts:232-233`, `TRUST_STRIP` | Medium — reads as "not for you" in Scotland and NI |
| 6 | "Pricing" nav item points at a homepage anchor (`/#pricing`); no shareable pricing page, and the anchor is unreachable from the phone nav (see #2) | `site-header.tsx`, `site-footer.tsx` | Medium |
| 7 | Guides carry read-time but no "last reviewed" date — compliance content with no currency signal | `src/content/guides/index.ts` (`Guide` has `minutes`, no date field) | Medium |
| 8 | RIDDOR copy states "10- and 15-day deadlines" without the *without delay* duty for fatalities and specified injuries | `src/content/modules.ts:296,337` | Medium — accuracy of a regulatory claim |
| 9 | No `/security`, `/pricing`, `/faq`, company or customers page exists | `app/[locale]/` route listing | Medium |
| 10 | Offline capability is real in the product but appears only inside two guides, never on the homepage or a module hero | `src/content/guides/registers.ts`, `run-the-work.ts` | Medium — a headline feature, buried |

### Recommendations, ranked

**Quick wins — copy only, no design work**

1. Resolve the module-count contradiction. Either state "16 free + 1 paid
   add-on" honestly, or stop counting dashboards in the seventeen. Publish the
   add-on price.
2. Add one sentence on the business model to the pricing section, and one on
   data portability/exit ("your records are yours; export everything, any time").
3. Put **offline** on the homepage and on the permits/RAMS/incidents module
   heroes.
4. Say explicitly that contractors and external signers don't consume seats.
5. Add a devolved-nations line to the fire module and soften the trust strip
   ("Fire safety orders across the UK's four nations" or name all four).
6. Tighten the RIDDOR sentence to include the *without delay* duty.
7. Add a support-expectation line ("email support, typically answered within one
   working day") — modest and honest beats silent.

**Medium — a sprint each**

8. Screenshots. One per module page minimum; three on the homepage (mobile
   hazard form, permit issue, actions board). This is the single highest-value
   item on the list.
9. Mobile nav for signed-out visitors.
10. Real `/pricing` and `/security` pages, linked from the nav and footer.
11. Search on `/docs`, plus "last reviewed" dates and a print stylesheet for
    guides.
12. A "start here" chooser near the top of the homepage — by sector or by
    company size — that routes into three modules rather than seventeen.

**Strategic — worth planning, not rushing**

13. Sector pages: construction (CDM/CHAS/SSIP), care (residents/PEEPs/
    Care Inspectorate/CQC), manufacturing, logistics. Each one reuses existing
    module content and answers "is this for someone like me" in one screen.
14. ISO 45001 clause-mapping page.
15. Migration/import story from the common incumbents.
16. SSO/SAML, audit-log export, status page — the enterprise triad, published as
    roadmap even before they ship.
17. Case studies, once there are real customers to write about. Do not
    manufacture them; the panel explicitly credited the absence of fake logos.

### Suggested copy changes

| Location | Now | Suggested |
| --- | --- | --- |
| Modules heading | "17 connected modules. All of them free." | "16 modules, free forever. Plus one optional paid add-on." |
| Pricing bullet | "All 17 modules — registers, permits, incidents, the lot" | "All 16 core modules — registers, permits, incidents, the lot" |
| Pricing add-on | "AI custom dashboards" (no price) | "AI custom dashboards — £X per workspace / month. Everything else stays free whether you take it or not." |
| Pricing footnote | "No card at sign-up. No seat counting. No surprise gate three weeks in." | Keep, and add: "We fund the platform with the dashboards add-on and paid support for larger organisations. Your records stay yours — export everything, any time." |
| Hero note | "Passwordless sign-in · Web, mobile & WhatsApp · 10 languages" | "Works offline on site · Passwordless sign-in · Web, mobile & WhatsApp" |
| Trust strip | "Fire Safety Order 2005 FRAs" | "Fire risk assessments — England, Scotland, Wales & NI" |
| Incidents module | "the 10- or 15-day clock is tracked" | "fatalities and specified injuries flagged for immediate report; the 10- and 15-day clocks tracked" |

---

## What this simulation cannot tell you

- **Whether anyone wants it.** Four invented people cannot indicate demand,
  price sensitivity or conversion. Only real visitors can.
- **Whether the product delivers what the pages promise.** The panel reviewed
  marketing copy. Every claim they praised — the issue gate, failures staying
  red, confidential incident kinds — is implemented, but this exercise tested
  the *description*, not the software.
- **Anything about SEO, load performance, analytics or funnel behaviour**, none
  of which was examined here.
- **Real accessibility conformance.** Fiona raised it as a question; answering it
  requires an actual audit against WCAG 2.2 AA, not a persona's opinion.

The useful output of this exercise is the defect table and the ranked
recommendations. Treat the personas as the reasoning that produced them.
