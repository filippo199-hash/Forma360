/**
 * Sentry event scrubbing.
 *
 * FreeHS carries data that must never leave the deployment in an error
 * report. Two categories, and they need different treatment:
 *
 *  1. **Special-category personal data.** The incidents module records
 *     injuries, hospitalisation facts, and sharps / violence-and-aggression
 *     reports that are confidential by design — counted-not-readable, and
 *     enforced on every read path in the router. Sending a request body to
 *     a third party would route around that whole model. So no request
 *     bodies, ever, and no free-text payloads.
 *
 *  2. **Bearer-equivalent tokens in URLs.** `/s/<token>` grants a
 *     contractor access to a RAMS pack and `/scan/<token>` is the site
 *     gate. Those path segments ARE the credential. A URL captured in
 *     `request.url` or a navigation breadcrumb would let anyone with
 *     Sentry access replay them, so the token segment is redacted before
 *     the event leaves the process.
 *
 * What survives is what actually helps you fix a bug: the exception, the
 * stack, the route shape, the tRPC procedure name, the tenant id, and the
 * release. Everything else is dropped rather than sampled — an allowlist,
 * not a blocklist, because a blocklist silently fails open the first time
 * someone adds a field.
 *
 * Pure and side-effect free so it can be unit-tested without an SDK.
 */

/** Route prefixes whose next path segment is an opaque access token.
 * `/api/auth/reset-password/<token>` is the emailed password-reset link's
 * GET hop (ADR 0019) — its token stays live for 30 minutes, so a Sentry
 * event captured on that route must not carry a replayable reset. */
const TOKEN_BEARING_PREFIXES = ['/s/', '/scan/', '/api/auth/reset-password/'] as const;

/**
 * Headers worth keeping. Everything else — cookie, authorization, and any
 * bespoke auth header — is dropped.
 */
const HEADER_ALLOWLIST = new Set([
  'content-type',
  'content-length',
  'user-agent',
  'accept-language',
  'referer',
  'x-request-id',
]);

/**
 * Tag keys we deliberately set and therefore trust.
 *
 * This governs what WE send. Sentry additionally derives tags at ingest
 * from other event fields — `url` and `transaction` from the request,
 * `browser` / `os` / `runtime` from contexts — and those bypass this list
 * entirely. None of them is PII, and the derived `url` inherits our
 * redaction because it is built from the `request.url` we already
 * scrubbed. Worth knowing when reading an event: the tag set you see in
 * Sentry is a superset of this one.
 */
const TAG_ALLOWLIST = new Set([
  'tenantId',
  'procedure',
  'trpc.path',
  'trpc.type',
  'brand',
  // Ours. `runtime` is Sentry's own derived tag and cannot be overridden.
  'app_runtime',
  'runtime',
  'queue',
  'job',
  'handler',
  // ULID request id — carries no PII and is what joins a Sentry issue to
  // the pino log line for the same request.
  'x-request-id',
]);

export const REDACTED = '[redacted]';

/**
 * A structurally-typed subset of a Sentry event, so this module needs no
 * `@sentry/*` import and stays usable from the browser bundle.
 *
 * Deliberately free of index signatures: an SDK `ErrorEvent` has none, and
 * a target index signature would make it unassignable under
 * `exactOptionalPropertyTypes`. Fields we only ever drop are typed
 * `unknown` because their value is never read.
 */
export interface ScrubbableBreadcrumb {
  category?: string | undefined;
  message?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface ScrubbableEvent {
  request?:
    | {
        url?: string | undefined;
        method?: string | undefined;
        data?: unknown;
        cookies?: unknown;
        headers?: Record<string, string> | undefined;
        query_string?: unknown;
        env?: unknown;
      }
    | undefined;
  user?:
    | {
        id?: string | number | undefined;
        email?: unknown;
        ip_address?: unknown;
      }
    | undefined;
  breadcrumbs?: ScrubbableBreadcrumb[] | undefined;
  extra?: Record<string, unknown> | undefined;
  contexts?: Record<string, unknown> | undefined;
  tags?: Record<string, unknown> | undefined;
}

/**
 * Replace an opaque access token in a URL path with a placeholder, keeping
 * the route shape so you can still tell *which* surface threw.
 * `/s/abc123` → `/s/[redacted]`. Also drops any query string.
 */
export function redactUrl(url: string): string {
  if (url.length === 0) return url;
  // Split off the query/fragment first — query strings can carry tokens too.
  const [beforeHash = ''] = url.split('#');
  const [path = ''] = beforeHash.split('?');

  let redacted = path;
  for (const prefix of TOKEN_BEARING_PREFIXES) {
    const at = redacted.indexOf(prefix);
    if (at === -1) continue;
    const start = at + prefix.length;
    const rest = redacted.slice(start);
    const end = rest.indexOf('/');
    redacted =
      end === -1
        ? `${redacted.slice(0, start)}${REDACTED}`
        : `${redacted.slice(0, start)}${REDACTED}${rest.slice(end)}`;
  }
  return redacted;
}

function scrubHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (headers === undefined) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (!HEADER_ALLOWLIST.has(lower)) continue;
    out[lower] = lower === 'referer' ? redactUrl(value) : value;
  }
  return out;
}

/**
 * The whole scrub. Mutates nothing — returns a new event object. Returning
 * `null` would drop the event entirely; we never do that, because an error
 * you cannot see is worse than an error with thin context.
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const next: ScrubbableEvent = { ...event };

  if (next.request !== undefined) {
    const { url, method, headers } = next.request;
    next.request = {
      ...(url !== undefined ? { url: redactUrl(url) } : {}),
      ...(method !== undefined ? { method } : {}),
      headers: scrubHeaders(headers),
      // Bodies, cookies, query strings and the raw env are dropped whole.
      // There is no version of "sample the body" that is safe here.
    };
  }

  // Keep the user id — it is a ULID and joins to nothing outside the
  // tenant — and drop everything that identifies a person.
  if (next.user !== undefined) {
    const id = next.user.id;
    next.user = id !== undefined ? { id } : {};
  }

  if (Array.isArray(next.breadcrumbs)) {
    next.breadcrumbs = next.breadcrumbs.map((crumb) => {
      const out: Record<string, unknown> = { ...crumb };
      // Breadcrumb `data` carries fetch/xhr bodies and navigation URLs.
      const data = crumb.data;
      if (data !== undefined) {
        const cleaned: Record<string, unknown> = {};
        for (const key of ['method', 'status_code']) {
          if (key in data) cleaned[key] = data[key];
        }
        for (const key of ['url', 'from', 'to']) {
          const value = data[key];
          if (typeof value === 'string') cleaned[key] = redactUrl(value);
        }
        out.data = cleaned;
      }
      // Console/log breadcrumbs can echo arbitrary interpolated values.
      if (crumb.category === 'console' || crumb.category === 'log') {
        delete out.message;
      } else if (typeof crumb.message === 'string') {
        out.message = redactUrl(crumb.message);
      }
      return out as ScrubbableBreadcrumb;
    });
  }

  // `extra` and `contexts` are where SDK integrations and our own code park
  // arbitrary objects. Neither is worth the risk; the stack is the value.
  delete next.extra;
  if (next.contexts !== undefined) {
    const keep: Record<string, unknown> = {};
    for (const key of ['trace', 'runtime', 'os', 'device', 'app', 'culture']) {
      if (key in next.contexts) keep[key] = next.contexts[key];
    }
    next.contexts = keep;
  }

  if (next.tags !== undefined) {
    const keep: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(next.tags)) {
      if (TAG_ALLOWLIST.has(key)) keep[key] = value;
    }
    next.tags = keep;
  }

  return next as T;
}
