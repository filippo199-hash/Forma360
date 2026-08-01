import { describe, expect, it, vi } from 'vitest';
import {
  createSendEmail,
  createSendTemplatedEmail,
  type EmailTemplate,
  renderEmail,
  renderTemplatedEmail,
  type TemplateLoader,
} from './email';
import { createLogger } from './logger';

const template: EmailTemplate = {
  subject: 'Verify your email',
  preheader: 'Confirm your address.',
  greeting: 'Hi,',
  body: 'Welcome to Forma360.',
  cta: 'Verify email',
  footer: 'Ignore if not you.',
};

const loadTemplate: TemplateLoader = async () => template;

function silentLogger() {
  return createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });
}

describe('renderEmail', () => {
  it('interpolates the CTA with the action URL', () => {
    const rendered = renderEmail(template, 'https://example.com/verify/abc');
    expect(rendered.subject).toBe(template.subject);
    expect(rendered.text).toContain('Verify email: https://example.com/verify/abc');
    expect(rendered.text).toContain('Welcome to Forma360.');
    expect(rendered.text).toContain('Ignore if not you.');
  });
});

describe('createSendEmail — console delivery', () => {
  it('routes to the logger and does not call Resend', async () => {
    const logger = silentLogger();
    const infoSpy = vi.spyOn(logger, 'info');
    const send = createSendEmail({
      delivery: 'console',
      logger,
      loadTemplate,
    });

    const result = await send({
      to: 'alice@example.com',
      kind: 'verification',
      url: 'https://app/verify/abc',
      userId: 'usr_1',
    });

    expect(result).toEqual({ delivery: 'console' });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const call = infoSpy.mock.calls[0];
    expect(call).toBeDefined();
    const [payload] = call as [Record<string, unknown>, string];
    expect(payload.email_delivery).toBe('console');
    expect(payload.to).toBe('alice@example.com');
    expect(payload.url).toBe('https://app/verify/abc');
    expect(payload.userId).toBe('usr_1');
  });
});

describe('brand substitution — {productName} (ADR 0010)', () => {
  const branded: EmailTemplate = {
    subject: 'Verify your {productName} email',
    preheader: 'Use the code to sign in to {productName}.',
    greeting: 'Hi,',
    body: 'Welcome to {productName}.',
    cta: 'Verify email',
    footer: '{productName} will never ask you for this code.',
  };

  it('renderEmail defaults {productName} to the default brand', () => {
    const rendered = renderEmail(branded, 'https://app/verify/abc');
    expect(rendered.subject).toBe('Verify your Forma360 email');
    expect(rendered.text).toContain('Welcome to Forma360.');
    expect(rendered.text).not.toContain('{productName}');
  });

  it('renderEmail substitutes a caller-provided productName', () => {
    const rendered = renderEmail(branded, 'https://app/verify/abc', 'FreeHS');
    expect(rendered.subject).toBe('Verify your FreeHS email');
    expect(rendered.text).toContain('Welcome to FreeHS.');
    expect(rendered.text).not.toContain('Forma360');
  });

  it('renderTemplatedEmail treats productName as an ordinary variable', () => {
    const rendered = renderTemplatedEmail(branded, {
      productName: 'FreeHS',
      url: 'https://app/verify/abc',
    });
    expect(rendered.subject).toBe('Verify your FreeHS email');
    expect(rendered.text).toContain('FreeHS will never ask you for this code.');
  });

  it('createSendTemplatedEmail injects the configured productName', async () => {
    const logger = silentLogger();
    const infoSpy = vi.spyOn(logger, 'info');
    const send = createSendTemplatedEmail({
      delivery: 'console',
      logger,
      loadTemplate: async () => branded,
      productName: 'FreeHS',
    });

    await send({ to: 'a@b.c', templateKey: 'verification', variables: { url: 'https://x' } });

    const call = infoSpy.mock.calls[0];
    expect(call).toBeDefined();
    const [payload] = call as [Record<string, unknown>, string];
    expect(payload.subject).toBe('Verify your FreeHS email');
  });

  it('every shipped template renders without leftover Forma360 literals', async () => {
    // The base templates are brand-neutral: rendering with a non-default
    // productName must not leak the old hardcoded brand.
    const { defaultTemplatedTemplateLoader } = await import('./email');
    const keys = [
      'invite',
      'otp',
      'verification',
      'password-reset',
      'request-to-join',
      'schedule-reminder',
      'heads-up-reminder',
      'observation-notification',
      'observation-critical-alert',
      'maintenance-reminder',
      'contractor-doc-expiry',
    ];
    for (const key of keys) {
      const tpl = await defaultTemplatedTemplateLoader(key);
      const rendered = renderTemplatedEmail(tpl, { productName: 'FreeHS', url: 'https://x' });
      expect(rendered.subject + rendered.text).not.toContain('Forma360');
    }
  });
});

describe('createSendEmail — resend delivery', () => {
  it('throws if RESEND_API_KEY is missing', () => {
    expect(() =>
      createSendEmail({ delivery: 'resend', resendFrom: 'x@y.z', logger: silentLogger() }),
    ).toThrow(/RESEND_API_KEY/);
  });

  it('throws if RESEND_FROM is missing', () => {
    expect(() =>
      createSendEmail({
        delivery: 'resend',
        resendApiKey: 're_xxx',
        logger: silentLogger(),
      }),
    ).toThrow(/RESEND_FROM/);
  });
});
