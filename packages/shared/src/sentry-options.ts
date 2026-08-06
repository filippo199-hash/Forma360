/**
 * Shared Sentry init options.
 *
 * Four runtimes initialise Sentry — the browser bundle, the Next server
 * runtime, the Next edge runtime and the BullMQ worker — and every one of
 * them must apply the same scrubbing. Four hand-written `Sentry.init` calls
 * is four chances to forget `beforeSend`, and the one that forgets is the
 * one that leaks. So the options are built here, once.
 *
 * Deliberately free of any `@sentry/*` import: this file is consumed by the
 * browser bundle as well as Node, and the SDK types differ per package.
 * The returned object is structurally what every `Sentry.init` accepts.
 */

import { scrubEvent, type ScrubbableEvent } from './sentry-scrub';

export interface SentryRuntimeOptions {
  dsn: string | undefined;
  /**
   * Which process this is — surfaces as the `app_runtime` tag.
   *
   * NOT `runtime`: Sentry derives its own `runtime` tag at ingest from
   * `contexts.runtime` (`node v22.19.0`), and that derived value wins. A
   * custom `runtime` tag is silently discarded, so filtering on
   * `runtime:server` in Sentry would have matched nothing.
   */
  runtime: 'browser' | 'server' | 'edge' | 'worker';
  /** Deployment environment: production / staging / development. */
  environment: string;
  /** Commit SHA, so an issue points at code. */
  release: string | undefined;
  /** Brand id (ADR 0010) — one deployment serves exactly one. */
  brand: string | undefined;
  /** Trace sampling. Errors are always captured; this is performance only. */
  tracesSampleRate: number;
}

/**
 * The environment name Sentry should group by. Railway sets
 * `RAILWAY_ENVIRONMENT_NAME`; fall back to NODE_ENV so local and CI runs
 * are never mistaken for production.
 */
export function resolveEnvironment(env: Record<string, string | undefined>): string {
  return env.SENTRY_ENVIRONMENT ?? env.RAILWAY_ENVIRONMENT_NAME ?? env.NODE_ENV ?? 'development';
}

/**
 * The release identifier. Railway exposes the deployed commit; a short SHA
 * is enough to find the code and is what the source-map upload keys on.
 */
export function resolveRelease(env: Record<string, string | undefined>): string | undefined {
  const sha = env.SENTRY_RELEASE ?? env.RAILWAY_GIT_COMMIT_SHA;
  return sha === undefined || sha.length === 0 ? undefined : sha.slice(0, 12);
}

/**
 * Build the options object passed to `Sentry.init`. Includes `beforeSend`
 * and `beforeSendTransaction` so no event of any kind escapes unscrubbed.
 */
export function buildSentryOptions(options: SentryRuntimeOptions): {
  dsn: string | undefined;
  environment: string;
  release: string | undefined;
  tracesSampleRate: number;
  sendDefaultPii: false;
  initialScope: { tags: Record<string, string> };
  // Generic so the SDK can bind its own `ErrorEvent` / `TransactionEvent`:
  // the scrubber preserves the concrete event type it was handed.
  beforeSend: <T extends ScrubbableEvent>(event: T) => T;
  beforeSendTransaction: <T extends ScrubbableEvent>(event: T) => T;
  beforeBreadcrumb: (crumb: { category?: string } | null) => { category?: string } | null;
} {
  const tags: Record<string, string> = { app_runtime: options.runtime };
  if (options.brand !== undefined) tags.brand = options.brand;

  return {
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    tracesSampleRate: options.tracesSampleRate,
    // Never attach IPs, cookies or request bodies in the first place. The
    // scrubber is the second line, not the only one.
    sendDefaultPii: false,
    initialScope: { tags },
    beforeSend: <T extends ScrubbableEvent>(event: T): T => scrubEvent(event),
    beforeSendTransaction: <T extends ScrubbableEvent>(event: T): T => scrubEvent(event),
    // Drop console breadcrumbs at source rather than emptying them later —
    // cheaper, and it keeps interpolated values out of memory entirely.
    beforeBreadcrumb: (crumb) =>
      crumb !== null && (crumb.category === 'console' || crumb.category === 'log') ? null : crumb,
  };
}
