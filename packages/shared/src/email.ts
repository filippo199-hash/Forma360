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
import type { Logger } from './logger';

// Email templates are statically imported into a map. A variable dynamic
// import (`import(../../i18n/emails/en/${key}.json)`) cannot be analysed by
// bundlers (Vite/Next) because the path escapes the package with `../../` —
// which broke CI's vitest transform and would break the serverless bundle.
// The template set is small + finite, so a static map is the robust choice.
import headsUpReminder from '../../i18n/emails/en/heads-up-reminder.json';
import inspectionNotify from '../../i18n/emails/en/inspection-notify.json';
import invite from '../../i18n/emails/en/invite.json';
import issueCreated from '../../i18n/emails/en/issue-created.json';
import contractorDocExpiry from '../../i18n/emails/en/contractor-doc-expiry.json';
import contractorPortalInvite from '../../i18n/emails/en/contractor-portal-invite.json';
import contractorOverstay from '../../i18n/emails/en/contractor-overstay.json';
import maintenanceReminder from '../../i18n/emails/en/maintenance-reminder.json';
import observationCriticalAlert from '../../i18n/emails/en/observation-critical-alert.json';
import observationNotification from '../../i18n/emails/en/observation-notification.json';
import otp from '../../i18n/emails/en/otp.json';
import passwordReset from '../../i18n/emails/en/password-reset.json';
import requestToJoin from '../../i18n/emails/en/request-to-join.json';
import scheduleReminder from '../../i18n/emails/en/schedule-reminder.json';
import signatureWorkflowComplete from '../../i18n/emails/en/signature-workflow-complete.json';
import signatureWorkflowRequest from '../../i18n/emails/en/signature-workflow-request.json';
import verification from '../../i18n/emails/en/verification.json';

const EMAIL_TEMPLATES: Record<string, unknown> = {
  'heads-up-reminder': headsUpReminder,
  'inspection-notify': inspectionNotify,
  invite,
  'issue-created': issueCreated,
  'maintenance-reminder': maintenanceReminder,
  'contractor-doc-expiry': contractorDocExpiry,
  'contractor-portal-invite': contractorPortalInvite,
  'contractor-overstay': contractorOverstay,
  'observation-critical-alert': observationCriticalAlert,
  'observation-notification': observationNotification,
  otp,
  'password-reset': passwordReset,
  'request-to-join': requestToJoin,
  'schedule-reminder': scheduleReminder,
  'signature-workflow-complete': signatureWorkflowComplete,
  'signature-workflow-request': signatureWorkflowRequest,
  verification,
};

// ─── Public types ───────────────────────────────────────────────────────────

/**
 * The shape of an outgoing email. `kind` selects the template; `url` is
 * the action link the recipient clicks. Matches `AuthEmail` in
 * @forma360/auth so better-auth hooks can pass their payloads through.
 */
export interface OutgoingEmail {
  to: string;
  kind: 'verification' | 'password-reset' | 'schedule-reminder';
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
export const defaultTemplateLoader: TemplateLoader = (kind) => {
  const tpl = EMAIL_TEMPLATES[kind];
  if (tpl === undefined) {
    return Promise.reject(new Error(`Unknown email template: ${kind}`));
  }
  return Promise.resolve(templateSchema.parse(tpl));
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

// ─── Templated email (variable interpolation) ───────────────────────────────

/**
 * Newer, more flexible email-send shape used by the sign-up / invite /
 * request-to-join flow. Unlike {@link OutgoingEmail}, the caller picks
 * the template by name and passes a `variables` map for `{placeholder}`
 * substitution. The "kind" union on `OutgoingEmail` is kept for the
 * pre-existing better-auth and schedule-reminder code paths.
 */
export interface TemplatedEmail {
  to: string;
  /** Maps to packages/i18n/emails/<locale>/<templateKey>.json. */
  templateKey: string;
  /** Replacements for `{name}` placeholders in subject + body + cta. */
  variables: Record<string, string>;
}

export type SendTemplatedEmail = (email: TemplatedEmail) => Promise<DeliveryResult>;

/**
 * Template loader for the templated-email path. Loads from
 * `packages/i18n/emails/en/<key>.json` by default. The shape is the same
 * `{subject, preheader, greeting, body, cta, footer}` as `EmailTemplate`,
 * but every field is allowed to contain `{var}` placeholders that the
 * dispatcher substitutes at render time.
 */
export type TemplatedTemplateLoader = (key: string) => Promise<EmailTemplate>;

export const defaultTemplatedTemplateLoader: TemplatedTemplateLoader = (key) => {
  const tpl = EMAIL_TEMPLATES[key];
  if (tpl === undefined) {
    return Promise.reject(new Error(`Unknown email template: ${key}`));
  }
  return Promise.resolve(templateSchema.parse(tpl));
};

/**
 * Substitute every `{name}` occurrence in `input` with `vars[name]`. Unknown
 * placeholders are left as-is — that fails loudly in QA rather than silently
 * dropping content. These are plaintext emails so no HTML escaping is done.
 */
export function interpolate(input: string, vars: Record<string, string>): string {
  return input.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      const v = vars[key];
      return v ?? match;
    }
    return match;
  });
}

/**
 * Render a templated email (subject + plaintext body). Variables drive
 * the placeholder substitution; the CTA is composed as `"{cta}: {url}"`
 * when a `url`-shaped variable is present, otherwise the CTA stands alone.
 */
export function renderTemplatedEmail(
  template: EmailTemplate,
  vars: Record<string, string>,
): { subject: string; text: string } {
  const subject = interpolate(template.subject, vars);
  const url =
    vars['url'] ??
    vars['ctaUrl'] ??
    vars['inviteUrl'] ??
    vars['settingsUrl'] ??
    vars['signUrl'] ??
    vars['viewUrl'];
  const ctaText = interpolate(template.cta, vars);
  const ctaLine = url !== undefined ? `${ctaText}: ${url}` : ctaText;
  const text = [
    interpolate(template.preheader, vars),
    '',
    interpolate(template.greeting, vars),
    '',
    interpolate(template.body, vars),
    '',
    ctaLine,
    '',
    interpolate(template.footer, vars),
  ].join('\n');
  return { subject, text };
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

// ─── Templated dispatcher ──────────────────────────────────────────────────

export interface TemplatedEmailDeps {
  delivery: 'resend' | 'console';
  resendApiKey?: string;
  resendFrom?: string;
  logger: Logger;
  /** Override in tests; defaults to reading from packages/i18n/emails/en. */
  loadTemplate?: TemplatedTemplateLoader;
}

/**
 * Build a {@link SendTemplatedEmail} dispatcher. Shares the same delivery
 * routing as {@link createSendEmail} (Resend in prod, pino-console in dev)
 * but takes the more flexible `{ templateKey, variables }` shape.
 */
export function createSendTemplatedEmail(deps: TemplatedEmailDeps): SendTemplatedEmail {
  const {
    delivery,
    resendApiKey,
    resendFrom,
    logger,
    loadTemplate = defaultTemplatedTemplateLoader,
  } = deps;

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

  return async function sendTemplatedEmail(email): Promise<DeliveryResult> {
    const template = await loadTemplate(email.templateKey);
    const { subject, text } = renderTemplatedEmail(template, email.variables);

    if (delivery === 'console') {
      logger.info(
        {
          email_delivery: 'console',
          to: email.to,
          templateKey: email.templateKey,
          variables: email.variables,
          subject,
        },
        '[email] (console) would send',
      );
      return { delivery: 'console' };
    }

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
          templateKey: email.templateKey,
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
        templateKey: email.templateKey,
        resendId: parsed.data.id,
      },
      '[email] sent',
    );
    return { delivery: 'resend', id: parsed.data.id };
  };
}
