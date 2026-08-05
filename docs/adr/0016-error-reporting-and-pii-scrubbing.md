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
