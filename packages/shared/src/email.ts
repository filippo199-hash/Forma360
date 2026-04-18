/**
 * Transactional email dispatcher.
 *
 * Routes each email to either Resend (production, staging) or pino-console
 * (development, test) based on the `EMAIL_DELIVERY` env value. The env
 * schema already refuses `EMAIL_DELIVERY=console` when NODE_ENV=production
 * (see packages/shared/src/env.ts), so this file trusts the config.
 *
 * Templates are simple JSON files at packages/i18n/emails/<locale>/<kind>.json
 * with shape { subject, preheader, greeting, body, cta, footer }. Phase 0
 * uses plain string interpolation — we'll upgrade to React Email in a later
 * phase if we need richer formatting. Locale currently hard-coded to "en"
 * until PR 8 introduces per-user locale resolution.
 */
import { Resend } from 'resend';
import { z } from 'zod';
import type { Logger } from './logger.js';

// ─── Public types ───────────────────────────────────────────────────────────

/**
 * The shape of an outgoing email. `kind` selects the template; `url` is
 * the action link the recipient clicks. Matches `AuthEmail` in
 * @forma360/auth so better-auth hooks can pass their payloads through.
 */
export interface OutgoingEmail {
  to: string;
  kind: 'verification' | 'password-reset';
  url: string;
  /** User id the email concerns — included in log context for traceability. */
  userId: string;
}

/** Delivery result. Used by tests and for tracing. */
export type DeliveryResult = { delivery: 'resend'; id: string } | { delivery: 'console' };

export type SendEmail = (email: OutgoingEmail) => Promise<DeliveryResult>;

// ─── Template resolution ────────────────────────────────────────────────────

export interface EmailTemplate {
  subject: string;
  preheader: string;
  greeting: string;
  body: string;
  cta: string;
  footer: string;
}

/**
 * Template loader. Exposed as an injectable dependency so tests can stub
 * without touching the filesystem.
 */
export type TemplateLoader = (kind: OutgoingEmail['kind']) => Promise<EmailTemplate>;

const templateSchema = z.object({
  subject: z.string().min(1),
  preheader: z.string().min(1),
  greeting: z.string().min(1),
  body: z.string().min(1),
  cta: z.string().min(1),
  footer: z.string().min(1),
});

/**
 * Default loader — reads from packages/i18n/emails/en/<kind>.json.
 * Dynamic import so the JSON files are not pulled into every bundle that
 * imports @forma360/shared/email.
 */
export const defaultTemplateLoader: TemplateLoader = async (kind) => {
  const mod = await import(`../../i18n/emails/en/${kind}.json`, {
    with: { type: 'json' },
  });
  return templateSchema.parse(mod.default);
};

/** Render a template into the subject + plaintext body that we send. */
export function renderEmail(
  template: EmailTemplate,
  url: string,
): { subject: string; text: string } {
  const text = [
    template.preheader,
    '',
    template.greeting,
    '',
    template.body,
    '',
    `${template.cta}: ${url}`,
    '',
    template.footer,
  ].join('\n');
  return { subject: template.subject, text };
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export interface EmailDeps {
  /** "resend" routes to the Resend SDK; "console" routes to the logger. */
  delivery: 'resend' | 'console';
  /** Required when delivery === "resend". */
  resendApiKey?: string;
  /** "Forma360 <noreply@forma360.com>". Required when delivery === "resend". */
  resendFrom?: string;
  logger: Logger;
  /** Override in tests; defaults to reading from packages/i18n/emails/en. */
  loadTemplate?: TemplateLoader;
}

/** Zod guard for the subset of the Resend response we rely on. */
const resendResponseSchema = z.object({
  data: z.object({ id: z.string() }).nullable(),
  error: z.object({ name: z.string().optional(), message: z.string() }).nullable(),
});

export function createSendEmail(deps: EmailDeps): SendEmail {
  const { delivery, resendApiKey, resendFrom, logger, loadTemplate = defaultTemplateLoader } = deps;

  let resend: Resend | undefined;
  if (delivery === 'resend') {
    if (resendApiKey === undefined || resendApiKey.length === 0) {
      throw new Error('EMAIL_DELIVERY=resend requires RESEND_API_KEY to be set');
    }
    if (resendFrom === undefined || resendFrom.length === 0) {
      throw new Error('EMAIL_DELIVERY=resend requires RESEND_FROM to be set');
    }
    resend = new Resend(resendApiKey);
  }

  return async function sendEmail(email): Promise<DeliveryResult> {
    const template = await loadTemplate(email.kind);
    const { subject, text } = renderEmail(template, email.url);

    if (delivery === 'console') {
      logger.info(
        {
          email_delivery: 'console',
          to: email.to,
          kind: email.kind,
          userId: email.userId,
          url: email.url,
          subject,
        },
        '[email] (console) would send',
      );
      return { delivery: 'console' };
    }

    // delivery === "resend"
    if (resend === undefined || resendFrom === undefined) {
      throw new Error('Resend client not initialised');
    }

    const raw = await resend.emails.send({
      from: resendFrom,
      to: email.to,
      subject,
      text,
    });
    const parsed = resendResponseSchema.parse(raw);
    if (parsed.error !== null) {
      logger.error(
        {
          email_delivery: 'resend',
          to: email.to,
          kind: email.kind,
          userId: email.userId,
          error: parsed.error,
        },
        '[email] resend failed',
      );
      throw new Error(`Resend failed: ${parsed.error.message}`);
    }
    if (parsed.data === null) {
      throw new Error('Resend returned neither data nor error');
    }
    logger.info(
      {
        email_delivery: 'resend',
        to: email.to,
        kind: email.kind,
        userId: email.userId,
        resendId: parsed.data.id,
      },
      '[email] sent',
    );
    return { delivery: 'resend', id: parsed.data.id };
  };
}
