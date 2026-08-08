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

  it('IN-J04: every file in emails/en/ is registered, schema-valid and brand-neutral', async () => {
    // Registry-completeness (platform review PF-1, made permanent by the
    // incidents module): a template JSON that exists on disk but is not
    // in EMAIL_TEMPLATES throws "Unknown email template" at send time —
    // in production, silently, inside a worker. This walks the directory
    // so a forgotten registration fails CI instead. The loader also
    // schema-validates (all six fields required), and rendering with a
    // non-default productName must not leak the hardcoded brand.
    const { readdir } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const { defaultTemplatedTemplateLoader } = await import('./email');
    const emailsDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'i18n',
      'emails',
      'en',
    );
    const files = (await readdir(emailsDir)).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(29);
    for (const file of files) {
      const key = file.replace(/\.json$/, '');
      const tpl = await defaultTemplatedTemplateLoader(key).catch((err: unknown) => {
        throw new Error(
          `template "${key}" failed to load — register it in EMAIL_TEMPLATES: ${String(err)}`,
        );
      });
      const rendered = renderTemplatedEmail(tpl, { productName: 'FreeHS', url: 'https://x' });
      expect(rendered.subject + rendered.text, `template "${key}" leaks the brand`).not.toContain(
        'Forma360',
      );
    }
    // IN-A14: exact 1:1 both directions — a registry entry whose file was
    // deleted is as broken as an unregistered file, and a weak count
    // floor would miss it.
    const { EMAIL_TEMPLATE_KEYS } = await import('./email');
    const fileKeys = new Set(files.map((f) => f.replace(/\.json$/, '')));
    const registryKeys = new Set(EMAIL_TEMPLATE_KEYS);
    expect(
      [...registryKeys].filter((k) => !fileKeys.has(k)),
      'registered but no file',
    ).toEqual([]);
    expect(
      [...fileKeys].filter((k) => !registryKeys.has(k)),
      'file but not registered',
    ).toEqual([]);
  });
});

describe('templated attachments (ADR 0018 — scheduled dashboard PDFs)', () => {
  it('console delivery logs attachment FILENAMES only, never the bytes', async () => {
    const logger = silentLogger();
    const infoSpy = vi.spyOn(logger, 'info');
    const send = createSendTemplatedEmail({
      delivery: 'console',
      logger,
      loadTemplate: async () => template,
    });

    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    await send({
      to: 'a@b.c',
      templateKey: 'verification',
      variables: {},
      attachments: [{ filename: 'weekly-overview.pdf', content: bytes }],
    });

    const call = infoSpy.mock.calls[0];
    expect(call).toBeDefined();
    const [payload] = call as [Record<string, unknown>, string];
    // Filenames only — the log payload must not carry the bytes in any form.
    expect(payload.attachments).toEqual(['weekly-overview.pdf']);
    expect(JSON.stringify(payload)).not.toContain(JSON.stringify([...bytes]));
  });

  it('an email without attachments logs no attachments field at all', async () => {
    const logger = silentLogger();
    const infoSpy = vi.spyOn(logger, 'info');
    const send = createSendTemplatedEmail({
      delivery: 'console',
      logger,
      loadTemplate: async () => template,
    });
    await send({ to: 'a@b.c', templateKey: 'verification', variables: {} });
    const call = infoSpy.mock.calls[0];
    expect(call).toBeDefined();
    const [payload] = call as [Record<string, unknown>, string];
    expect('attachments' in payload).toBe(false);
  });

  it('toResendAttachments maps to the resend@4 shape (Buffer content)', async () => {
    const { toResendAttachments } = await import('./email');
    const asBuffer = Buffer.from('hello');
    const asBytes = new Uint8Array([1, 2, 3]);
    const mapped = toResendAttachments([
      { filename: 'a.pdf', content: asBuffer },
      { filename: 'b.pdf', content: asBytes },
    ]);
    expect(mapped[0]).toEqual({ filename: 'a.pdf', content: asBuffer });
    expect(Buffer.isBuffer(mapped[1]?.content)).toBe(true);
    expect([...(mapped[1]?.content ?? Buffer.alloc(0))]).toEqual([1, 2, 3]);
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

describe('template registry completeness (platform review PF-1)', () => {
  it('every template file in emails/en is registered and loadable', async () => {
    const { readdir } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { defaultTemplatedTemplateLoader, EMAIL_TEMPLATE_KEYS } = await import('./email');
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'i18n', 'emails', 'en');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(23);
    for (const file of files) {
      const key = file.replace(/\.json$/, '');
      // Registered…
      expect(EMAIL_TEMPLATE_KEYS, `template file ${file} is not registered`).toContain(key);
      // …and actually loads + parses through the real loader.
      const tpl = await defaultTemplatedTemplateLoader(key);
      expect(tpl.subject.length).toBeGreaterThan(0);
    }
  });

  it('the four PF-1 safety alerts resolve through the real loader', async () => {
    const { defaultTemplatedTemplateLoader } = await import('./email');
    for (const key of [
      'permit-expiry-warning',
      'permit-expiry-escalation',
      'fire-due-digest',
      'fra-intolerable-alert',
    ]) {
      const tpl = await defaultTemplatedTemplateLoader(key);
      expect(tpl.subject.length).toBeGreaterThan(0);
    }
  });
});

describe('PF-20 locale-aware template loader', () => {
  it('serves the translated template when the locale exists; falls back otherwise', async () => {
    const { defaultTemplatedTemplateLoader } = await import('./email');
    const it_ = await defaultTemplatedTemplateLoader('invite', 'it');
    expect(it_.subject).toContain('ti ha invitato');
    const pt = await defaultTemplatedTemplateLoader('invite', 'pt');
    expect(pt.subject).toContain('convidou');
    const en = await defaultTemplatedTemplateLoader('invite');
    expect((await defaultTemplatedTemplateLoader('invite', 'xx')).subject).toBe(en.subject);
    expect((await defaultTemplatedTemplateLoader('invite', 'ja')).subject).toBe(en.subject);
  });

  it('every translated template parses and keeps the EN placeholder vocabulary', async () => {
    const { readdir } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { defaultTemplatedTemplateLoader } = await import('./email');
    const emailsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'i18n', 'emails');
    const locales = (await readdir(emailsRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && d.name !== 'en')
      .map((d) => d.name);
    expect(locales.length).toBeGreaterThanOrEqual(5);
    const placeholderSet = (tpl: object): string =>
      [...JSON.stringify(tpl).matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)]
        .map((m) => m[1])
        .sort()
        .join(',');
    for (const locale of locales) {
      const files = (await readdir(join(emailsRoot, locale))).filter((f) => f.endsWith('.json'));
      expect(files.length).toBeGreaterThanOrEqual(29);
      for (const file of files) {
        const key = file.replace(/\.json$/, '');
        const translated = await defaultTemplatedTemplateLoader(key, locale);
        const english = await defaultTemplatedTemplateLoader(key);
        // A translation must never drop or invent variables.
        expect(placeholderSet(translated), `${locale}/${key} placeholders`).toBe(
          placeholderSet(english),
        );
      }
    }
  });
});
