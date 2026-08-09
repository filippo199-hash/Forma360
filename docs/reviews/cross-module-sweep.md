# FreeHS — the cross-module access-boundary sweep

**Deliverable:** `packages/api/src/routers/cross-module.audit.test.ts` — 12 tests, 6 axes, generated from the router at runtime
**Result:** 2 axes clean across all ~300 procedures · 3 axes fail on **11 parity breaks**, 6 of them previously unknown
**Date:** 9 August 2026

---

## What this is

Thirteen module audits found sixty defects, and twenty of them were **one
mistake in three costumes**:

1. a module **reading** another module's records while applying only its own
   rule — Heads-Up → Documents (×4), Assets → three modules, RAMS → Documents,
   Fire Safety → Training, COSHH → Users, Permits → Risk Assessments, Permits →
   Documents (×2);
2. a module **writing** content out past its own confidentiality boundary —
   Incidents → Actions;
3. a module not applying its own rule **to its own sub-routers** — Observations,
   Inspections, where `list` and `get` were scoped and every sibling door was
   left open.

Each was found one instance at a time by a suite hand-written for the module it
covered. Every report since the Assets audit said the same thing: this needs one
generated instrument, not a fourteenth module.

**This is that instrument.** It is generated from the router itself. tRPC
exposes each procedure's Zod input schema at
`appRouter._def.procedures[path]._def.inputs[0]._def.shape()` and its kind at
`_def.type`, so the sweep can enumerate **every procedure in the application**,
work out which ones accept a given entity's id, synthesise an input, call it as
a deliberately under-privileged actor against a record it must not reach, and
inspect the outcome. There is no list to maintain and nothing to keep in sync: a
procedure added next month is swept the day it lands.

The unifying question, stated once — **entity-level predicate parity**:

> Of every procedure that resolves a record by id, does it apply every access
> predicate the canonical read of that entity applies?

---

## Results

| Axis | What it sweeps | Verdict |
| --- | --- | --- |
| **XM-T** tenancy | Every procedure, tenant B's ids in every slot | **Clean** |
| **XM-I** incident confidentiality | Every query, whole router | **Clean** |
| **XM-D** document visibility | Every query, direct **and indirect** routes | **1 break** |
| **XM-C** contractor scope | 3 entities × every procedure accepting their id | **9 breaks** |
| **XM-S** non-id-keyed doors | Global search; readers keyed on another entity | **1 break** |
| **XM-P** public surface | Every unauthenticated procedure | Inventory produced |

**The two clean axes are a real result, not an absence of one.** Tenancy holds
across roughly three hundred procedures called with foreign ids in every slot
that accepts one — that is ADR 0002 verified mechanically rather than asserted.
Incident confidentiality holds across every query in the router, which
independently confirms the Incidents fix pass from outside the suite that
specified it. Document visibility is clean on every DIRECT route — the Heads-Up,
RAMS and COSHH fixes hold — and breaks only on the indirect one (`permits.get`,
below).

---

## The eleven findings

### XM-C — contractor-scope parity (9)

`loadContractorScope` is the mechanism that stops an external contractor portal
user seeing records their company did not author. Their portal activities grant
permissions **tenant-wide**; only the data scope constrains them. It is called
in six places in the entire codebase — `list` and `get` in each of three
routers.

**Four reads that resolve where `get` refuses:**

| Path | Entity | What escapes |
| --- | --- | --- |
| `actions.comments.list` | action | The comment body **and** `authorName`/`authorEmail` |
| `actions.activity.list` | action | The timeline, with `actorName`/`actorEmail` |
| `signatures.listSlots` | inspection | The signature sheet |
| `exports.listShareLinks` | inspection | A working, opaque, **unauthenticated** share URL |

**Five writes:**

| Path | What it does |
| --- | --- |
| `inspections.submit` | **Submits another company's inspection for approval** |
| `signatures.sign` | Signs it |
| `inspections.saveProgress` | Overwrites its answers |
| `actions.createFromIssue` | Raises an action from an observation the caller cannot open |
| `actions.comments.create` | Writes into an internal action thread |

**Five of these nine were previously unknown.** The two inspection reads and two
of the inspection writes were found by the Inspections audit the day before (and
are rediscovered here independently, which is the instrument validating itself).
Everything in `actions` is new — that router had never been audited — plus
`inspections.submit` and `actions.createFromIssue`, which no hand-written suite
had reached.

Verified concretely, not merely inferred. Driving the real routers:

```
GET:           refused
ACTIVITY ROWS  2  [{kind:"commented", actorName:"Ada Admin", actorEmail:"admin@northgate.test"}, …]
COMMENT ROWS   1  [{body:"Internal thread: blame discussion", authorEmail:"admin@northgate.test"}]
```

`actions.activity.list` is worth singling out: it carries **no plantable
sentinel**, so sentinel-hunting could never have found it. Only the parity
signal did.

### XM-S — parity through doors that are not keyed on the entity (1)

| Path | Severity | Finding |
| --- | --- | --- |
| `search.global` | **High** | Gates each category on the module's `.view` permission — which the portal activities grant tenant-wide — and calls `loadContractorScope` **nowhere**. A contractor portal user whose `get` is refused for an inspection, an observation and an action retrieves all three by typing their titles into search. |

This is the widest-reach finding in the sweep and the one the id-keyed axes
**structurally could not find**: XM-C enumerates procedures by the id key they
accept, and search accepts a *string*. A record you cannot open by id is not
protected if you can retrieve it by name — and search is a far wider door than
an id anyone would have to guess.

Observed directly, one portal user, three canonical reads refused:

```
CANONICAL GETS: inspections.get: refused · issues.get: refused · actions.get: refused
SEARCH "ZZPROBEOBSERVATION" -> LEAKED  observations:[{title, subtitle:"OBS-000001"}]
SEARCH "ZZPROBEACTION"      -> LEAKED  actions:[{title, subtitle:"AC-000001"}]
SEARCH "2026-08-09"         -> LEAKED  inspections:[{title, subtitle:"000001"}]
```

`assets.listLinked{Inspections,Actions,Observations}` — keyed on an asset id,
so equally invisible to XM-C — was swept in the same axis and is **clean**.

### XM-D — document visibility (1)

| Path | Severity | Finding |
| --- | --- | --- |
| `permits.get` | Medium | Projects `documents.name` for the linked method statement with **no visibility filter** (`permits.ts:1089-1097`), so any `permits.view` holder reads the name of a document restricted to a group they are not in. |

Note the asymmetry, because it is the interesting part. The **write** side was
hardened by the PW-X01 fix and now calls `isDocumentVisibleToUser` at link time
(`permits.ts:304-313`). The **read** side was not. A document linked
*legitimately* by somebody who can see it is then disclosed to everyone who
cannot — so the fix closed the door the audit knocked on and left the window.

---

## The public surface — an inventory that did not exist

XM-P enumerates every procedure that resolves with no session. There are
**thirteen**, and until this sweep ran there was no list of them anywhere:

| Procedure | Why it is public |
| --- | --- |
| `auth.signUpWithTenant` | Creates the tenant and its first user |
| `auth.getInviteDetails` / `auth.acceptInvite` | Invite landing page and its consumption |
| `auth.lookupEmailDomain` / `auth.requestToJoin` | Returning user routing; access request |
| `issues.categories.publicGetByShareToken` | QR observation form config |
| `issues.issues.createFromShareToken` | QR anonymous observation submission |
| `contractors.publicByToken` | Contractor self-service portal |
| `contractors.gate.publicByToken` / `contractors.gate.selfCheckIn` | Site gate kiosk |
| `rams.client.publicGet` / `rams.client.publicDecide` | RAMS pack served to a client |
| `health.ping` | Liveness; returns no tenant data |

Each is now declared **by name with its reason**. A fourteenth fails CI rather
than shipping unnoticed — which is the whole value, because nobody reviews a
public procedure they do not know exists.

---

## What the instrument taught me about itself

Three times this sweep passed an axis, and all three passes were wrong. Each is
worth recording, because a generated sweep that under-reports is more dangerous
than no sweep at all — it converts an open question into a green tick.

**1. Sentinel-hunting is too weak a signal.** The first XM-C only reported
procedures whose response contained a planted string. That found two breaks.
Rewriting it to assert **resolution-despite-refusal** — `get` has just refused
this caller for this id, so any sibling that resolves is applying fewer
predicates, whatever its payload contains — took it to four, including
`actions.activity.list`, which has nothing to plant.

**2. A thin input bag is under-reporting dressed as a pass.** XM-C02 first
reported one write breach. Most mutations were being rejected by Zod before
reaching a handler, so the axis looked clean because it never got there.
Fattening the bag — and then **asserting the coverage figure**, so the sweep
fails if it cannot reach most of what it claims to test — took it from one to
five, surfacing `inspections.submit`.

**3. An id-keyed sweep cannot see a door that is not keyed on the id.**
XM-C enumerates procedures by the entity id they accept. `search.global` takes
a query string and `assets.listLinked*` takes an asset id, so neither was ever
called — and search turned out to be the widest-reach break in the whole sweep.
XM-S exists because of that gap.

**4. A document-keyed sweep cannot see a document reached through a permit.**
XM-D passed twice. The first pass was keyed only on `documentId`, so it never
called anything that merely *references* a document. Seeding a permit and a
heads-up that link the restricted document fixed that — and it *still* passed,
because my outsider actor held only `documents.view` and so `permits.get`
returned FORBIDDEN before reaching the code under test. **An axis that passes
because its actor cannot reach the code is a coverage hole wearing a green
tick.** Fixing both found `permits.get`.

**5. A naive `_def.shape()` read skips wrapped inputs.** Forty-one inputs in
this codebase are written `z.object({...}).default({...})`, whose outer node is
a ZodDefault, not a ZodObject. Those procedures carried `keys: null` and were
skipped by every axis — unswept, but counted as covered. The extraction now
unwraps ZodDefault / ZodOptional / ZodEffects / ZodUnion / ZodPipeline /
ZodIntersection, and XM-000 fails if any input shape becomes unreadable again.
Closing it did not change the verdict, which is what a correct fix to a blind
spot should do when the blind spot happened to be empty.

That third and fourth pair is the sharpest lesson available here: **the sweep built to find
the "reached through another entity" pattern initially had blind spots of
exactly that shape — twice.** The generalisation the reports converged on — entity-level
predicate parity — has to be applied to the *instrument* as rigorously as to the
code.

---

## Where this leaves the work

| | |
| --- | --- |
| Module suites | 13 modules · 329 tests · 60 defects |
| This sweep | 12 tests · 11 findings, 6 previously unknown |
| Verified fixed during the series | COSHH (5), Permits (4), Risk Assessments (3), Observations (5), Heads-Up, RAMS, Training, Contractors |

**The contractor boundary is a platform problem with a one-mechanism fix.**
`loadContractorScope` needs to be applied wherever an inspection, observation or
action is read or written — not at the two procedures per router that happen to
be called `list` and `get`. Ten of the eleven findings close together, and
`search.global` is part of that ten: it needs the same scope applied to its
three affected categories. The eleventh, `permits.get`, is a two-line
visibility filter.

**This file is now the acceptance harness for that fix.** It does not need
updating when the fix lands: it will simply go green, and it will keep watching
the ~300 procedures that already pass, plus every procedure added after today.

**The web layer remains untouched.** All 71 findings across the series are
router, worker or data. The prose reviews found their worst defects in `.tsx`
files, and neither the 329 module tests nor these 12 can reach one. That is now
the only large piece of unexamined surface left.
