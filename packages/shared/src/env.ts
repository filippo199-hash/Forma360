/**
 * Environment schema for Forma360.
 *
 * Single source of truth for every environment variable used across every
 * package. Parsed once at boot via {@link parseServerEnv} / {@link parseClientEnv};
 * missing or malformed values produce an {@link EnvValidationError} whose
 * message names every failing variable.
 *
 * Ground rules:
 *   - Never access `process.env.X` directly in application code. Import the
 *     parsed env object from `apps/web/src/env.ts` or `packages/jobs/src/env.ts`
 *     instead.
 *   - Every new variable is added here first, then to `.env.example`.
 */
import { z, type ZodError } from 'zod';

// ─── Enumerations ───────────────────────────────────────────────────────────

const nodeEnvSchema = z.enum(['development', 'test', 'production']);
const logLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const emailDeliverySchema = z.enum(['resend', 'console']);

// ─── Server-side variables ──────────────────────────────────────────────────

const serverSchemaBase = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  APP_URL: z.string().url(),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  BETTER_AUTH_SECRET: z
    .string()
    .min(
      32,
      'BETTER_AUTH_SECRET must be at least 32 characters (generate with `openssl rand -hex 32`)',
    ),
  BETTER_AUTH_URL: z.string().url(),

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_PUBLIC_URL: z.string().url(),

  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM: z.string().min(1),
  EMAIL_DELIVERY: emailDeliverySchema.default('resend'),

  /**
   * Shared secret for the internal render-token HMAC. Used by the
   * PDF render path to gate `/render/inspection/<id>` against
   * Puppeteer-only traffic. See ADR 0008. Min 32 chars — generate
   * with `openssl rand -hex 32`.
   */
  RENDER_SHARED_SECRET: z
    .string()
    .min(
      32,
      'RENDER_SHARED_SECRET must be at least 32 characters (generate with `openssl rand -hex 32`)',
    ),

  SENTRY_DSN: z.string().url().optional(),

  LOG_LEVEL: logLevelSchema.default('info'),
});

/**
 * Full server-side schema, including the prod-safety refinement that refuses
 * `EMAIL_DELIVERY=console` in production. That guard exists so a misconfigured
 * production deployment cannot silently redirect verification emails to stdout.
 */
const serverSchema = serverSchemaBase.superRefine((val, ctx) => {
  if (val.EMAIL_DELIVERY === 'console' && val.NODE_ENV === 'production') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['EMAIL_DELIVERY'],
      message:
        'EMAIL_DELIVERY=console is not permitted when NODE_ENV=production. ' +
        'Set EMAIL_DELIVERY=resend in production environments.',
    });
  }
});

export type ServerEnv = z.infer<typeof serverSchema>;

// ─── Client-side (browser-exposed) variables ────────────────────────────────

const clientSchema = z.object({
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
});

export type ClientEnv = z.infer<typeof clientSchema>;

// ─── Validation error ───────────────────────────────────────────────────────

/**
 * Thrown when {@link parseServerEnv} / {@link parseClientEnv} reject their
 * input. The message lists every failing variable with its reason so boot-time
 * failures are actionable without grepping through a stack trace.
 */
export class EnvValidationError extends Error {
  public readonly issues: ReadonlyArray<{ path: string; message: string }>;

  public constructor(scope: 'server' | 'client', zodError: ZodError) {
    const issues = zodError.errors.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
      message: issue.message,
    }));
    const lines = issues.map((i) => `  • ${i.path}: ${i.message}`);
    super(
      `Invalid ${scope} environment (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n${lines.join('\n')}`,
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

// ─── Parsers ────────────────────────────────────────────────────────────────

/**
 * Parse a candidate server env object (defaults to `process.env`) against the
 * server schema. Throws {@link EnvValidationError} on any failure.
 *
 * For tests: pass a plain object. For production boot: call with no args so
 * it parses `process.env` directly.
 */
export function parseServerEnv(input: Record<string, string | undefined> = process.env): ServerEnv {
  const result = serverSchema.safeParse(input);
  if (!result.success) {
    throw new EnvValidationError('server', result.error);
  }
  return result.data;
}

/**
 * Parse the browser-exposed subset of env vars. Additional keys in `input`
 * (server-only variables) are ignored — `process.env` in a Next build contains
 * every variable regardless of scope, so we strip server-only keys silently.
 */
export function parseClientEnv(input: Record<string, string | undefined> = process.env): ClientEnv {
  const result = clientSchema.safeParse(input);
  if (!result.success) {
    throw new EnvValidationError('client', result.error);
  }
  return result.data;
}
