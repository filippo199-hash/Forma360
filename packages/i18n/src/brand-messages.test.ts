import { describe, expect, it } from 'vitest';
import { LOCALES } from './config';
import { loadBrandedMessages, mergeMessages } from './brand-messages';

describe('mergeMessages', () => {
  it('recursively merges nested objects, override winning on leaves', () => {
    const base = { a: { x: '1', y: '2' }, b: 'base' };
    const override = { a: { y: 'two' } };
    expect(mergeMessages(base, override)).toEqual({ a: { x: '1', y: 'two' }, b: 'base' });
  });

  it('replaces arrays wholesale instead of index-merging', () => {
    const base = { list: ['a', 'b', 'c'] };
    const override = { list: ['z'] };
    expect(mergeMessages(base, override)).toEqual({ list: ['z'] });
  });

  it('does not mutate the base object', () => {
    const base = { a: { x: '1' } };
    mergeMessages(base, { a: { x: '2' } });
    expect(base.a.x).toBe('1');
  });
});

describe('loadBrandedMessages', () => {
  it('returns the base bundle untouched for the default brand', async () => {
    const messages = await loadBrandedMessages('forma360', 'en');
    const auth = messages['auth'] as { signIn: { title: string } };
    expect(auth.signIn.title).toBe('Sign in to Forma360');
  });

  it('applies the FreeHS override on top of the base bundle', async () => {
    const messages = await loadBrandedMessages('freehs', 'en');
    const auth = messages['auth'] as { signIn: { title: string; emailLabel: string } };
    expect(auth.signIn.title).toBe('Sign in to FreeHS');
    // Keys the override does not touch fall through to the base bundle.
    expect(auth.signIn.emailLabel).toBe('Email');
  });

  // Sweeps all 10 full locale bundles — CPU-bound and slow under a
  // parallel turbo run, so it gets a generous explicit timeout.
  it('ships a FreeHS override for every locale with no brand leakage', async () => {
    for (const locale of LOCALES) {
      const messages = await loadBrandedMessages('freehs', locale);
      const flat = JSON.stringify(messages);
      expect(flat, `locale ${locale} still mentions Forma360`).not.toContain('Forma360');
    }
  }, 30_000);
});
