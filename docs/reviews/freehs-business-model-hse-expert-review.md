# FreeHS — Freemium packaging

## What four HSE practitioners would pay for, and what they say you must never charge for

**Product:** FreeHS (freehs.software)
**Question asked of the panel:** *"FreeHS will be freemium — sign up free, use
it, upgrade for more. As buyers of safety software: where should the line sit?
What would you pay for, what would make you walk away, and what should never
be behind a paywall?"*
**Purpose:** commercial input for packaging and pricing.
**Date:** 3 August 2026

---

## Methodology & scope (read this first)

**These four are not pricing consultants, and this is not a pricing study.**
They are the people who *buy, approve, or recommend* safety software, and who
live with the consequences of how it is packaged. That is the lens: what a
buyer signs, what a buyer refuses, and — the part only practitioners can give
you — **what it is ethically and legally unsafe to put behind a paywall in a
product whose job is to keep people alive.** Specific price points are for a
pricing exercise with real win/loss data; the panel deliberately gives
structure, metric and boundaries rather than numbers.

**Commercial state of the codebase** (verified, so the recommendations are
actionable): there is no billing today. A `billing.manage` permission key is
forward-declared and unused; there is no plan or tier column on the tenant
record; there is no pricing page. The only gating mechanisms that exist are
**permissions** and the **brand module catalogue**. ADR 0010 already reserves
"entitlement defaults" as the fourth place brand/plan differences are allowed
to live — so the commercial layer is greenfield, with a declared home.

**One observation before the panel speaks.** The product is called *FreeHS*.
The name is a promise, and all four reviewers raised it unprompted: a thin free
tier under that name reads as bait-and-switch, and will be punished harder than
it would be under a neutral name. The upside is that it buys enormous goodwill
if the free tier is genuinely useful — but it means the free/paid line has to
be *principled*, not merely tight.

---

## The reviewers

| # | Reviewer | Organisation | How they actually buy |
|---|----------|--------------|------------------------|
| 1 | **Priya Nair, CMIOSH** | Precision engineering, ~800 staff, 3 sites | Budget holder; procurement, security review, annual contract. Freemium is how the product *enters*, not how it's bought |
| 2 | **Tom Whitfield, GradIOSH** | Building-services contractor, ~40 staff | Company credit card, self-serve, no procurement. **The actual freemium target** |
| 3 | **Dr. Aisha Bello, CFIOSH** | NHS trust | Public-sector procurement, DPIA, IG review, framework contracts. Free tier = departmental pilot |
| 4 | **Marcus Lindqvist, CMIOSH** | EHS consultant, ~12 client organisations | Buys for himself, recommends to clients. A distribution channel, not just a user |

---

# 1 · Tom Whitfield — the freemium buyer

> *"I'm the customer this model is for. Nobody signs off software at my
> company but me, and I decide in about twenty minutes on a wet Thursday. So
> let me tell you exactly what makes me put the card in, and what makes me
> close the tab."*

### What has to be free or the tier is a demo, not a product
A free tier that can't run a small firm's safety system is a trial with extra
steps. For me "genuinely usable" means: **all my lads can report, and I can
run the registers I'm legally required to have.** If I can create a risk
assessment but not publish it, or record an incident but not export it, I've
got a half-record — which is worse than a spreadsheet, because a half-record
looks like compliance and isn't.

### The single most important pricing decision you'll make
**Do not charge per user.** I have 40 staff. Three of them "use" the software
in the sense you mean; the other 37 report a hazard twice a year, acknowledge
a briefing, and accept a permit. If you charge me per head I will either buy 3
licences and have 37 people locked out of reporting — which is a *safety*
outcome, not just a commercial one — or I won't buy at all.

**Charge for practitioners; make reporters free and unlimited, forever.**
Anyone whose entire interaction is "report something, acknowledge something,
close the action assigned to me, accept a permit" should never appear on an
invoice. That is also in your interest: reporting volume is the flywheel. The
more free reporters, the more data, the more indispensable the paid seats
become.

### What I would actually pay for
1. **The client-facing evidence pack** — branded RAMS, my accident stats, my
   training matrix, insurance and policies as one shareable portfolio. That
   wins me work. It is the only feature on the platform with a direct line to
   revenue for a contractor, and I'd pay more for it than for anything else.
2. **Branded PDFs** — my logo on the permit and the RA that goes to the client.
3. **More practitioner seats and more sites/projects** as I grow.
4. **Bulk import** — 200 fire doors one at a time is a reason not to adopt.

### What makes me close the tab
- Per-head pricing (above).
- A storage cap that bites mid-job. Photos are the evidence; if I hit a limit
  on a Friday afternoon my incident record is incomplete.
- **Anything that holds my records hostage.** If I stop paying and my permits
  and RAs become unreadable, I can't use this for anything legally important —
  because I'd be betting my defence file on a subscription staying current.
  Read-only plus export, forever, or I'm out.
- Being charged for a mobile app. My work happens on a phone; that's not a
  premium channel, it's the product.

---

# 2 · Priya Nair — how freemium reaches an enterprise

> *"I would never *buy* on freemium — I buy after a security review, a DPIA
> and a procurement cycle. But freemium is exactly how this lands in my
> organisation: a site manager signs up on a Tuesday, it spreads, and eighteen
> months later I discover we're running our permits on it. Design for that,
> because it will happen whether you design for it or not."*

### Design the land-and-expand path deliberately
The realistic sequence is: one site signs up free → it works → two more sites
copy them → I find out. At that moment there are two possible outcomes, and
your packaging decides which:

- **Good:** there is a clean "claim this organisation" path — I can take
  administrative ownership of the existing tenants, consolidate them, keep the
  data, and convert to a contract.
- **Bad:** there's no path, so I have three shadow tenants outside IT's
  knowledge holding real safety records, and my only lever is to ban the tool.
  That is how good products get thrown out of large companies.

**Build the claim/consolidate path before you need it.** It is a commercial
feature, not an admin chore.

### What I'd pay for — and it's not the safety modules
The registers are the thing I'd expect to be free or near-free, because
they're the legal minimum. What I pay for is **being able to run a safety
function at scale**:

1. **Analytics and board reporting.** I said in the gap analysis this was a
   Blocker. Five CSV exports and a pivot table is not a management report. A
   scheduled quarterly board pack is worth more to me than any single module.
2. **Multi-site governance** — site-scoped roles, estate roll-ups,
   comparison between sites.
3. **SSO and user provisioning.** Not optional at 800 staff; this alone is a
   line item procurement understands.
4. **Retention and data governance controls.** COSHH health records run to 40
   years. Whoever can hold that lifecycle properly earns the enterprise tier.
5. **Support with an SLA**, and named onboarding.

### The line I'd hold
**Don't sell the HSE registers à la carte.** A firm that needs COSHH but not
permits is normal — but if each register is a separate line item, then the
*scope of my safety programme becomes a budget negotiation.* I have sat in the
meeting where someone says "do we really need the fire module this year". Do
not create that meeting. Bundle the registers; charge for scale and for the
management layer on top.

---

# 3 · Dr. Aisha Bello — the ethical line

> *"I'll leave the commercial mechanics to the others. My contribution is the
> one thing a safety product must get right that an invoicing product doesn't:
> there are features you are not entitled to charge for, because charging for
> them means somebody gets hurt in the accounts-payable gap."*

### The rule
**Never put a paywall between a person and their own safety.**

Concretely, the following must be in the free tier, unconditionally and
forever:

- **Recording anything.** Every incident, hazard, near miss, injury.
- **The alerts and statutory reminders attached to those records.** The
  serious-incident fan-out, the RIDDOR deadline warnings, the permit expiry
  escalation, the fire-calendar digest. If the "someone may still be in the
  confined space" escalation is a paid feature, you have built a product where
  a lapsed card contributes to a fatality. There is no version of that
  conversation that ends well — for the customer, for the injured person, or
  for you in the coroner's court.
- **The confidentiality controls.** This is my sharpest example. Sharps
  exposures and violence & aggression records default to confidential in your
  incidents module — counted for everyone, readable by almost nobody. If that
  is a Professional-tier feature, then a free-tier trust exposes the identity
  of a nurse who was assaulted. Confidentiality is not a premium; it's the
  minimum.
- **The audit trail**, and **export of your own data**.
- **Accessibility.** For public-sector buyers it's a legal duty, and a
  "premium accessibility" tier would end our conversation immediately.

### What that leaves you to sell, and it's plenty
Everything that helps a *safety function* rather than a *person at risk*:
scale, insight, integration, assurance-grade output, governance, support. The
formulation I'd use internally and externally:

> **Doing the safety work is free. Running a safety department is paid.**

That is honest, it is defensible in a tender, and — unlike most freemium lines
— it survives being read aloud at an inquest.

### What blocks a public-sector pilot regardless of tier
Data residency, a DPIA pack, retention controls, security documentation. These
cannot be "Enterprise features you unlock later", because they are what we
assess **before** the pilot starts. Whatever tier they nominally sit in, they
must be *available to evaluate* from day one or the free tier is unusable to
me — and NHS departmental pilots are one of your better routes into large
organisations.

### One more, from experience
**Never make an incident count a plan limit.** "Up to 50 incidents per year"
creates an incentive to stop recording at 49. I have watched organisations
manage their numbers for far weaker reasons than money. Any metering that
touches reporting volume is disqualifying.

---

# 4 · Marcus Lindqvist — defensibility, and the channel you're missing

> *"I recommend tools to twelve client organisations. Two questions decide
> whether I put your name forward: can a client on your cheapest tier survive
> an audit, and can I work across all my clients without twelve logins?"*

### The audit test for a free tier
A free tier is only recommendable if a client sitting on it has a **defensible
system**. That means the audit trail, the ability to complete a record (not
just start one), and export must all be in it. If a free-tier client can create
a fire risk assessment but not publish or export it, they have a half-finished
statutory document and I will steer them elsewhere.

The corollary is a warning about the classic compliance-freemium trap:
**never let the paywall sit in the middle of a compliance workflow.** Gating
"start" is fine; gating "finish" produces exactly the half-records that make a
system indefensible.

### The most defensible boundary
Price on **volume and organisational complexity**, not capability:

- how many practitioners
- how many sites/entities
- how much history and storage
- how much governance (SSO, retention, residency, audit export)
- how much *proof* (branded reports, scheduled packs, evidence bundles)

Every one of those grows with the customer's ability to pay and none of them
touches whether a hazard can be reported. It is also the boundary I can defend
to a client's finance director without embarrassment.

### The segment you haven't packaged: consultants
There are a lot of me. I manage twelve clients, I'd like one login, a
cross-client view of what's overdue, my own branding on the reports I issue,
and per-client billing I can pass through. Nobody at this price point serves
that well.

Two reasons to build it: it's high-margin, and **consultants are your
distribution into exactly the SMB segment freemium targets.** When I recommend
a platform, three or four clients adopt it. A partner tier turns your critics
into your salesforce — and I'd note that this panel's seven reviews are, in
effect, an unpaid version of what that relationship looks like.

### Two smaller warnings
- **Don't gate the API.** Every serious client integrates something; a locked
  API just means data gets re-keyed, badly.
- **Downgrade must degrade, never delete.** Statutory retention (COSHH health
  records, 40 years) means deleting a lapsed customer's safety data could put
  *them* in breach. Read-only plus export, indefinitely, and say so in the
  contract — it's a trust asset, not a cost.

---

# Consolidated recommendation

## The principle

> **Free: doing the safety work. Paid: running a safety department.**

Everything that protects a person is free. Everything that helps an
organisation *scale, analyse, prove and govern* that work is paid. All four
reviewers arrived at this independently; it is the panel's central
recommendation and it should be stated publicly, because it is a differentiator
as much as a policy.

## Proposed packaging

| | **Free** (forever) | **Professional** (per practitioner) | **Enterprise** | **Partner / Consultant** |
|---|---|---|---|---|
| **Who** | Micro firms, single sites, pilots | Growing SMBs, multi-site | Large & regulated | Consultants, multi-client |
| **Reporters** (report / acknowledge / accept / close own actions) | **Unlimited, free** | Unlimited, free | Unlimited, free | Unlimited, free |
| **Practitioners** | ~3 | Paid seats | Paid seats | Per client |
| **Sites** | 1 | Several | Unlimited + hierarchy | Per client |
| **All HSE modules & registers** (RA, COSHH, permits, fire, incidents, inspections, observations, actions) | ✅ full | ✅ | ✅ | ✅ |
| **Statutory alerts, reminders, escalations** | ✅ **never gated** | ✅ | ✅ | ✅ |
| **Confidentiality controls, audit trail, data export, mobile/offline, accessibility** | ✅ **never gated** | ✅ | ✅ | ✅ |
| Analytics dashboard & trends | Basic counts | ✅ | ✅ + custom | ✅ cross-client |
| Scheduled board / management packs | — | ✅ | ✅ | ✅ |
| Branded & client-facing output, evidence packs | — | ✅ | ✅ | ✅ own branding |
| Bulk import, API | Limited | ✅ | ✅ + rate | ✅ |
| History & attachment storage | Fair-use | Larger | Unlimited + retention engine | Per client |
| SSO / provisioning, site-scoped governance | — | — | ✅ | — |
| Data residency, DPIA pack, retention policy, audit-log export | Evaluable | Evaluable | ✅ | ✅ |
| Multi-entity roll-up / claim-and-consolidate | — | — | ✅ | ✅ |
| Support | Community | Priority | SLA + onboarding | Partner desk |

**Pricing metric: per practitioner seat, reporters free and uncapped.** The
panel was unanimous, and it is the rare case where the commercially smart
choice and the safety-correct choice are the same one.

## The "never gate" list (the panel's hard line)

1. Recording any safety event — incident, injury, hazard, near miss.
2. The alerts, reminders and escalations attached to statutory duties.
3. Confidentiality controls on sensitive records.
4. The audit trail, and export of the customer's own data.
5. Mobile use and offline capture — that's where the work is.
6. Accessibility.
7. Security and privacy posture (evaluable from day one, whatever tier it's in).

## The "never do this" list

1. **Never charge per report, per record, or cap incident counts.** It creates
   an incentive to under-report. Disqualifying.
2. **Never charge per head for the workforce** — only for practitioners.
3. **Never sell the registers à la carte** — it turns safety scope into a
   budget negotiation.
4. **Never put the paywall mid-workflow** (start free, finish paid) — it
   manufactures indefensible half-records.
5. **Never delete on downgrade.** Degrade to read-only + export, indefinitely.
6. **Never gate the API** — data gets re-keyed badly instead.

## Upgrade triggers to design for
The moment each persona reaches for a card is the moment to make the upsell
appear — and none of them is a wall:

| Persona | Trigger |
|---|---|
| Tom | A client asks for an evidence pack / branded RAMS |
| Priya | A second and third site appear; the board asks for a quarterly number |
| Aisha | The pilot ward succeeds and IT/IG need SSO, residency and retention |
| Marcus | His second client adopts it |

## One risk the panel wants recorded
The name **FreeHS** raises the free tier's expected generosity *and* lowers
willingness to pay — buyers anchor on "free" as the product's identity. The
panel's view is that this makes the principled line above more important, not
less: a generous, clearly-bounded free tier converts on *scale and proof*,
which are exactly the needs that grow with budget. A stingy free tier under
this name will be read as a bait-and-switch and will cost more in reputation
than it earns in conversions.

---

# Implementation notes

For whoever picks this up — the commercial layer is greenfield with a declared
home:

- **Entitlements belong where ADR 0010 already reserved them** ("place 4 of 4",
  alongside the brand catalogue in `packages/shared/src/brand.ts`), not as
  inline plan checks scattered through routers. The existing
  `{ enabled }`-dependency pattern every brand module already uses is the right
  shape for plan gating too — one wiring point per module.
- **`billing.manage` already exists** in the permission catalogue, unused —
  the key is reserved and needs no catalogue change.
- **The tenant record has no plan/tier column** and will need one, plus seat
  accounting. Note it already carries `retentionMonths`, which is the hook for
  the retention-policy entitlement.
- **Reporters-free requires a seat model that distinguishes them.** The natural
  definition already exists in the permission catalogue: a *reporter* holds only
  `*.view` / `*.report` / acknowledge-and-accept style keys (roughly today's
  seeded **Standard** set); a *practitioner* holds any `*.create`, `*.manage`,
  `*.issue`, `*.investigate` or `*.record` key. Seat counting can derive from
  the permission set rather than needing a new concept.
- **Gate at the entitlement layer, never in the UI only** — the platform's
  recurring lesson from seven reviews. A paid feature hidden in the client but
  reachable via the API is worse than no gate at all.
- **Downgrade path**: read-only + export must be an explicit tested state, not
  an emergent one. Worth an edge-case ID and a test alongside the entitlement
  work.
- **Build the "claim this organisation" flow** (Priya) with the entitlement
  work rather than after it — it is the enterprise conversion path and it is
  much harder to retrofit once shadow tenants exist.

---

*Prepared as an independent practitioner review of FreeHS's proposed freemium
model, following seven module, platform, gap-analysis and IA reviews. The panel
are buyers and recommenders of safety software, not pricing analysts: the
structural, metric and ethical recommendations are theirs; specific price
points should come from a pricing exercise with real win/loss data. Commercial
state-of-the-codebase claims are verified against `main`.*
