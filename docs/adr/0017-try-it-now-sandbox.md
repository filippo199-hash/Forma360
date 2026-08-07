# ADR 0017 — Try-it-now sandbox workspaces

**Status:** Accepted
**Date:** 2026-08-07
**Supersedes:** nothing
**Related:** ADR 0002 (multi-tenant model), ADR 0004 (user-table tenant
extension), ADR 0010 (multi-brand, single codebase)

## Context

FreeHS acquires users self-serve. The funnel it inherited was the
industry default: land on marketing, sign up, verify an email, arrive in
an empty tenant, and be asked to build a template. Every step before the
empty tenant is a cost the visitor pays before receiving anything, and
the empty tenant is where the audience — H&S managers who already own
their process in Word and Excel — reliably gives up.

The value FreeHS delivers is not "a place to build checklists". It is a
signed, dated document that evidences a duty: a risk assessment, a
permit to work, a RIDDOR determination. That artefact is what a visitor
needs to see, and the sooner they hold one with their own judgement in
it, the sooner the product means anything.

## Decision

A visitor can obtain a **real, seeded, signed-in workspace without an
account**. Two taps on `/try` — a job, then a refinement — provision a
tenant, furnish it with realistic data, and land them inside it.

Four decisions make that safe:

### 1. A sandbox is an ordinary tenant

Not a demo mode, not a second class of principal, not a read-only
projection. `provisionSandbox` writes the same rows `signUpWithTenant`
writes: a tenant, the three seeded permission sets, an administrator
user. Every downstream guarantee — `tenantProcedure` deriving the tenant
from the session, `requirePermission`, the RESTRICT foreign keys of
ADR 0002 — holds without modification, because there is nothing new to
hold them against.

The only difference is a `settings.sandbox` marker recording what the
visitor asked for and whether they have since claimed it. The settings
envelope was designed for exactly this, so no migration is required.

The alternative — a distinct anonymous principal resolved alongside the
session in the tRPC context — was rejected. It would have put a second
code path through the single most security-sensitive function in the
codebase to save writing two rows.

### 2. The session is a genuine better-auth session

`createSandboxSession` calls better-auth's own
`internalAdapter.createSession` and then serialises the session token
into the cookie better-auth reads back. The context factory is
untouched; `getSession` resolves a sandbox visitor exactly as it
resolves anyone else.

The cookie signing is reproduced rather than delegated, because
better-auth's `setSessionCookie` requires an endpoint context that does
not exist outside one of its own routes. That is a proven boundary in
the sense CLAUDE.md means: isolated to one function, and pinned by
`sandbox-session.test.ts`, which round-trips a minted cookie through
`auth.api.getSession()`. If better-auth changes its scheme, the test
fails loudly rather than the sandbox handing out dead sessions.

### 3. The workspace lands mid-story, and the seed is written directly

Seeding writes rows directly rather than driving the module routers.
The routers enforce lifecycle — a permit begins as a draft, an incident
begins as reported — and the point of the seed is a workspace already
in motion: a permit awaiting authorisation, a risk assessment with three
hazards worked and one left to rate. Reaching those states through the
routers would mean impersonating three people in sequence. Writing the
end state is honest about what it is, still passes every schema
constraint, and runs in one transaction.

Each scenario leaves **exactly one decision open**. Completing it is
what turns seeded content into the visitor's own document, which is the
moment the whole flow exists to produce.

Seed content is deliberately not internationalised. These are database
rows — a contractor, a hazard, a permit — owned and editable by the
visitor from the moment the workspace exists, not interface copy. The
i18n rule governs the chrome around them.

### 4. The email is asked for at the artefact, and never gates the work

Everything auto-saves. The save prompt appears while the workspace is an
unclaimed sandbox and asks for an address so the visitor can *return* —
it does not hold work hostage, and it can be dismissed. `sandbox.claim`
swaps the placeholder `@sandbox.invalid` address (RFC 2606, so it can
never collide with a real inbox) for a real one and stamps `claimedAt`.

Coming back then uses the ordinary email-OTP flow every other user
already has. No second kind of magic link exists to maintain.

An address that already belongs to a user is refused as a fork, not an
error: the caller gets `email-in-use` and the UI offers to sign them
into the account they have. A work domain that already has a workspace
is surfaced alongside a successful claim so the UI can offer "ask to
join" — surfaced, not enforced, because stranding someone's work behind
a decision they did not ask to make is the failure this whole design
exists to avoid.

## Brand gating

The sandbox is a **brand capability**, expressed as `offersSandbox` on
the brand config — place 1 of the four ADR 0010 permits. Forma360 sells
through demos and onboarding calls; FreeHS sells by being tried.

`scenariosForBrand` returns an empty list for a brand that does not
offer it, and that single return value is what closes the whole feature:
`/try` 404s, `POST /api/sandbox/create` 404s, and the marketing hero
falls back to sign-up. Individual tiles are gated a second time on the
module catalogue (place 3), so a tile can never be offered by a brand
that lacks the module behind it.

## Abuse surface

Anonymous tenant creation is the most abuse-prone endpoint in the
product. Controls, in order of cheapness:

- per-IP rate limit of 5 workspaces per hour on creation, and 10 claims
  per hour (a claim ends in an outbound email);
- the tenant is created on submit, not on page load, so crawlers and
  bounces cost nothing;
- an already-signed-in caller is refused, since a second workspace would
  strand the first;
- Zod at the boundary, and a tile/refinement pair that must resolve
  against the active brand or be refused outright rather than defaulted.

## Consequences

**Good.** Time-to-first-artefact drops from an account-creation flow to
roughly a minute. The workspace is never empty. Nothing new enters the
tenant-isolation or session-resolution paths. A claimed sandbox is an
ordinary tenant that merely remembers how it started, so there is no
migration step and no second-class account to support forever.

**Costs.** Unclaimed tenants accumulate and need a TTL sweep — deferred
to a follow-up, and the reason `settings.sandbox.claimedAt` exists from
day one. Seed content is authored per scenario and will drift from the
modules unless it is maintained alongside them. Analytics must now track
two new funnel transitions (workspace → artefact, artefact → email),
and the second one is where the funnel will bleed if the seeded
scenarios are not good.

**Rejected alternatives.** A shared read-only demo tenant (no ownership,
so no reason to return). A conversational agent as the front door
(slower than two taps, and it belongs inside the workspace where it can
act). AI-generated scenarios at provisioning time (slow, occasionally
broken, and broken-on-first-impression is fatal — a curated catalogue
with a router in front is the version that survives contact).
