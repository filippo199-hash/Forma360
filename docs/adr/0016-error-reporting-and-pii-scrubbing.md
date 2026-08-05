# ADR 0016 — Error reporting, and what may leave the deployment

**Status:** Accepted
**Date:** 4 August 2026
**Supersedes:** the Phase 0 note in `next.config.ts` that made the Sentry
build wrap conditional on `SENTRY_DSN`.

## Context

Sentry has been in the dependency tree and the config files since Phase 0
and has never reported a single event. Neither Railway service carried a
DSN, so `Sentry.init({ dsn: undefined })` no-opped in all three web
runtimes, `initSentry()` returned early in the worker, and the three
`captureException` calls in the BullMQ failure handler wrote to nothing.

Meanwhile the observability we *do* have is pino → Railway logs. That is
adequate for a server error someone goes looking for, and useless for
three failure classes this product actually has:

- **Client-side errors on field devices.** The briefing queue, the conduct
  state machine and the localStorage drafts run on phones in plant rooms
  with bad signal. When they break, the operative stops using the app; they
  do not file a ticket.
- **Silent render failures across ten locales.** RS-A8 is the proof: five
  action-source chips rendered as missing i18n keys in production for weeks
  and were found by a test, not a user.
- **Workers that fail after their last retry.** `permit-expiry-watch`
  escalates permits past expiry every fifteen minutes. Its failure is a
  safety matter, and today it is visible only if a human reads logs.

Turning Sentry on is therefore worth doing. The question this ADR settles
is not *whether* — it is *what is allowed to leave the deployment*, because
this application holds data where the answer is not obvious.

## Decision

### 1. The build wrap is unconditional

Sentry 8.x was not certified against Next 16 and its edge code path tripped
on `node:crypto`, which is why the wrap was gated behind `SENTRY_DSN`. That
gate had a worse property than the bug it avoided: the production build was
structurally different from every other build, so Sentry-specific breakage
could only ever be discovered in production.

Upgraded to Sentry 10.69 and verified the build passes **both** with the
wrap engaged and with no DSN present. The wrap is now unconditional.
Runtime behaviour is still governed by the DSN, which is the correct lever.

### 2. Scrubbing is an allowlist, and it is shared

`packages/shared/src/sentry-scrub.ts` is a pure function applied via
`beforeSend` and `beforeSendTransaction` in all four runtimes — browser,
Next server, Next edge, worker — built once in `sentry-options.ts`. Four
hand-written `Sentry.init` calls is four chances to forget the scrubber,
and the one that forgets is the one that leaks.

Dropped wholesale: request bodies, cookies, query strings, the raw
environment, `extra`, and console/log breadcrumb messages. Allowlisted:
six headers, six contexts, ten tag keys. Kept from `user`: the id only.

An allowlist rather than a blocklist, because a blocklist silently fails
open the first time someone adds a field — and the field that gets added
to an incident payload is exactly the field that must not travel.

The driving constraint is the incidents module. It records injuries,
hospitalisation facts, and sharps / violence-and-aggression reports that
are confidential *by design* — counted-not-readable, enforced on every read
path including search, AI and CSV export (ADR 0013). Sending a request body
to a third-party service would route around that model completely. Under
GDPR this is Article 9 special-category data; "sample the body" has no safe
formulation here.

### 3. Opaque access tokens in URLs are redacted

This one is specific to our routes and would not be caught by a generic
scrubber. `/s/<token>` grants a contractor access to an issued RAMS pack
and `/scan/<token>` is the site gate. **Those path segments are the
credential.** Captured in `request.url`, in a `Referer` header, or in a
navigation breadcrumb, anyone with access to the Sentry project could
replay them.

`redactUrl` replaces the token segment while keeping the route shape, so
you still know which surface threw. It is applied to request URLs, the
referer, and every breadcrumb URL field.

### 4. Only INTERNAL_SERVER_ERROR reaches Sentry from tRPC

This codebase's domain guards work by throwing: `rams-pack-not-issued`,
`last-admin`, `window-too-long`, an expired permit. Those are the system
functioning correctly. Reporting every non-2xx would bury genuine failures
under thousands of correctly-refused mutations and make the tool useless
within a week. The `onError` hook reports only `INTERNAL_SERVER_ERROR`, and
reports `error.cause` when tRPC has wrapped the real exception so the
Sentry title is the actual failure.

### 5. Session Replay stays off

Replay records the DOM. These screens display incident narratives, injury
descriptions and named individuals. Enabling it would need a consent flow
and a privacy-masking pass first, and neither exists. `replaysSessionSampleRate`
and `replaysOnErrorSampleRate` are pinned to 0 with a comment saying why.

### 6. One Sentry project pair per brand

ADR 0010 says brands never share secrets, databases or infrastructure. That
extends here: FreeHS and Forma360 get separate projects, and the browser
DSN (`NEXT_PUBLIC_SENTRY_DSN`) is separate from the server DSN
(`SENTRY_DSN`) so the browser bundle never carries the server project's key.

The org is hosted in Sentry's **EU region** (`de.sentry.io`), which keeps
error data in-region and materially simplifies the Article 9 position.

## Consequences

**Good**

- Client-side failures on field devices become visible for the first time.
- A worker that dies after its last retry raises an issue instead of a log
  line nobody reads.
- `tenantId`, `procedure` and `x-request-id` tags make an error actionable
  in a multi-tenant app and join a Sentry issue to its pino log line.
- The `/monitoring` tunnel routes browser events through our own origin, so
  ad-blockers — common on managed corporate devices — cannot silently eat
  the client reports we most need.

**Costs, accepted**

- Scrubbed events carry less context than Sentry's defaults. Debugging from
  a stack trace and a procedure name is slower than debugging from a
  payload. That is the trade, and it is the right way round.
- ~30 kB gzipped added to the client bundle, on surfaces used over mobile
  data. Judged worth it because those are precisely the surfaces with no
  other failure signal.
- A third-party processor now holds error metadata; a DPA with Sentry is
  required, and the EU region is a precondition, not a nicety.

**Deferred**

- Source-map upload needs `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and
  `SENTRY_PROJECT` at build time. Without them the build still succeeds and
  you get minified frames.
- Alert rules and an issue-owner mapping.
- Cron monitoring for the repeatable workers — Sentry can alert on a job
  that stops running at all, which log-based alerting cannot.

---

## Addendum — 5 August 2026, after the first production event

Verified against the real wiring-check event
(`FREEHS-SERVER-1`, `94438dfb8b604a74944a12004ca85084`). The scrubbing held:
no request body, no cookies, no query string, no email, no IP, and only four
headers survived. Three things the design got wrong or under-stated:

### 1. `runtime` was the wrong tag key — fixed

Sentry derives a `runtime` tag at ingest from `contexts.runtime`
(`node v22.19.0`) and **that value wins over a custom tag of the same name**.
Our `runtime=server` was silently discarded, so filtering `runtime:server`
in Sentry would have matched nothing. Renamed to `app_runtime`. Covered by
SC-E10 so it cannot regress.

The general rule: do not name a custom tag after anything Sentry derives —
`runtime`, `url`, `transaction`, `browser`, `os`, `server_name`, `level`,
`handled`, `mechanism`.

### 2. The allowlist governs what we *send*, not the final tag set

The event carried `url`, `transaction`, `browser`, `client_os`, `os`,
`server_name`, `handled`, `level`, `mechanism` and `interface_type` — none
of which are in `TAG_ALLOWLIST`. They are materialised by Sentry at ingest
from other event fields, after `beforeSend` has run, so the allowlist never
sees them.

This is not a leak: none is PII, and the derived `url` tag is built from the
`request.url` we already redact, so a `/s/<token>` URL still arrives
redacted. But the earlier wording implied the allowlist bounded the whole
tag set, and it does not. Corrected in the source comment.

### 3. Sentry infers country-level geo from the connecting IP

The event carried `user.geo: US, United States` despite `sendDefaultPii:
false` and no `ip_address` in the payload. Geo is derived at ingest from the
connecting IP. For server events that is the Railway container and therefore
uninteresting. **For browser events it will be the end user's location.**

Not addressed in code, because it cannot be: it happens after the event
leaves us. The mitigation is a project setting — Sentry → Project Settings →
Security & Privacy → **"Prevent Storing of IP Addresses"** — which should be
enabled on `freehs-web` in particular. Recorded here so the next person
knows it is a deliberate outstanding item rather than an oversight.

### Not fixable: member project creation

`Settings → General → "Let members create projects"` is gated behind
Sentry's **Business** plan. Until forma360 upgrades, the MCP connector will
keep returning `403: Your organization has disabled this feature for
members`, and new projects must be created through the browser. Not a
settings mistake — a plan tier.

---

## Addendum 2 — 5 August 2026, source maps

Stack traces stayed minified through three attempted fixes. The first two
diagnoses were wrong and worth recording, because both were plausible.

**Wrong diagnosis 1: the maps went to the wrong project.** True but not the
cause. `SENTRY_PROJECT` was set to `freehs-web` while the unreadable frames
were `_next/server/` chunks, which land in `freehs-server`. Pointing it at
`freehs-server` moved the bundles across; the frames still did not resolve.

**Wrong diagnosis 2: a path/`urlPrefix` mismatch.** The event reported
`app:///_next/server/chunks/…` while the bundle stored `~/chunks/…`. Also
true, also not the cause — debug-ID resolution ignores paths entirely, and
the debug IDs matched.

**Actual cause: Turbopack emits indexed source maps.** Verified by inspecting
the build output directly. Every one of the 186 server maps is a `sections`
map whose *top-level* `sources` array is empty and which has no top-level
`sourcesContent`; the real content sits inside `sections[].map`. Sentry's
symbolicator reads the top level, finds nothing, and returns
`js_no_source: "Source code was not found"` — precisely the error on the
event. The map was present, in the right project, with a matching debug ID,
and unreadable anyway.

Building the same tree with `next build --webpack` produces 76 flat maps,
every one carrying `sourcesContent`.

### Decision: production builds use webpack

`apps/web/package.json` pins `next build --webpack`. Turbopack remains the
default for `next dev`, where source maps are served locally and the format
does not matter.

Cost: ~4 minutes of build wall-clock instead of ~3.5. Benefit: server stack
traces that name a file and a line. For an application whose worker escalates
expired permits, a stack trace nobody can read is close to no stack trace.

Revisit when Sentry's symbolicator supports indexed maps, or when Turbopack
emits flat ones — at which point deleting one flag restores the faster build.

### Also fixed: browser maps were never generated

`productionBrowserSourceMaps` was unset, so Next emitted no browser source
maps at all. The earlier upload had nothing to give the browser project even
when correctly aimed at it. Now enabled; the Sentry plugin uploads them and
deletes them from the bundle, so nothing ships to the client.

### Open decision: one project or two

One build has one `SENTRY_PROJECT`, so source maps can only be uploaded to
one project. With browser and server events split across `freehs-web` and
`freehs-server`, exactly one of them can ever have readable traces.

The split was decision 6 above, justified as "the browser bundle never
carries the server project's key". That reasoning is weak: a DSN is a
write-only ingest key, public by construction in any browser-instrumented
app, and cannot read events. What the split actually buys is quota isolation
against someone flooding the public DSN. Sentry's own Next.js documentation
uses one project per app for exactly this reason.

**Resolved: collapsed to a single project.** Decision 6 above is superseded
for FreeHS.

- `freehs-server` renamed to **`freehs`** (project id `4511859971063888`
  unchanged, so the server DSN and the uploaded map bundles survive intact).
- The project carries **two DSNs**, which is the part worth understanding.
  Sharing one key between browser and server would mean rate-limiting the
  public key also throttles server errors — so the browser gets its own:
  - `Default` — server, edge and worker (`SENTRY_DSN`). No rate limit.
  - `Browser (public, rate-limited)` — the browser bundle
    (`NEXT_PUBLIC_SENTRY_DSN`), capped at 2,000 events/hour. This is the key
    that ships publicly, so it is the one an outsider could flood; the cap
    means they can burn their own key's budget without blinding us to
    server errors.
- `SENTRY_PROJECT=freehs`, so one build's maps cover both event sources.
- Browser and server are separated by the `app_runtime` tag, not by project.

`freehs-web` is left in place, empty apart from two stale artifact bundles
from the failed upload attempts. Delete it whenever; nothing points at it.

The same shape applies to Forma360 when it launches: one project, two DSNs,
the public one rate-limited.

## Addendum 3 — 5 August 2026, two defects Sentry caught in its first hour

The point of turning Sentry on was to see production faults we otherwise
couldn't. It earned that within minutes: the first two issues after the
webpack deploy were both real, both ours, and neither was visible any other
way.

### `pino` must be externalised from the server bundle

Seven minutes after the webpack build (Addendum 2) went live, Sentry raised
`the worker thread exited` and `Cannot find module
'.next/server/chunks/lib/worker.js'` — uncaught, at every boot.

`pino` runs its transport in a worker thread through `thread-stream`, which
finds the worker with `join(__dirname, 'lib', 'worker.js')`. Turbopack never
bundled `pino`, so the switch to webpack was what exposed it: bundled,
`__dirname` resolves to the chunk directory and the worker file is one
webpack never emits. The worker died and took the web server's log output
with it, so the Railway logs had gone silent — the failure actively hid
itself, and only Sentry (a separate transport) still had a voice.

Fix: `pino` and `pino-pretty` join `pg` / `bullmq` / `ioredis` /
`puppeteer-core` in `serverExternalPackages`, and are declared in
`apps/web/package.json` so the resulting bare `require` resolves under pnpm.
`logger.test.ts` now asserts a production logger spawns no transport worker,
and `logger-externals.test.ts` scrapes the build config to require every
runtime logging package be both externalised and declared.

### `NODE_ENV` was not `production` in the web container

The same investigation turned up a second, older fault. The pretty
(worker-thread) transport only attaches when `nodeEnv !== 'production'`, so
its mere presence proved `env.NODE_ENV` was not `production` at web runtime.
That is not only a logging concern: better-auth sets its session-cookie
`Secure` attribute from the same value, so cookies on the live HTTPS site
were being issued without `Secure`. Set `NODE_ENV=production` on the web
service. (The worker hard-codes its logger to production and serves no
cookies, so it was unaffected.) Externalising `pino` fixes the crash
independently of this; the two fixes are belt and suspenders.
