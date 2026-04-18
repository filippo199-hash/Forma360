import { describe, expect, it, vi } from 'vitest';
import { createSendEmail, type EmailTemplate, renderEmail, type TemplateLoader } from './email';
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
