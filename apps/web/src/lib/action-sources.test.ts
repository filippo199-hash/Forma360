import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Suffixed so the Italian bundle does not shadow vitest's `it`.
import deMessages from '@forma360/i18n/messages/de';
import enMessages from '@forma360/i18n/messages/en';
import esMessages from '@forma360/i18n/messages/es';
import frMessages from '@forma360/i18n/messages/fr';
import itMessages from '@forma360/i18n/messages/it';
import jaMessages from '@forma360/i18n/messages/ja';
import nlMessages from '@forma360/i18n/messages/nl';
import plMessages from '@forma360/i18n/messages/pl';
import ptMessages from '@forma360/i18n/messages/pt';
import zhMessages from '@forma360/i18n/messages/zh';
import { describe, expect, it } from 'vitest';

import {
  ACTION_SOURCE_TYPES,
  actionSourceLabelKey,
  actionSourceLinkKey,
  actionSourceLinkTakesReference,
  isActionSourceType,
} from './action-sources';

type Bundle = {
  actions: {
    /** The list, the board and the source filter all resolve chips here. */
    list: Record<string, unknown>;
    /** The detail card and the slide-over panel resolve sentences here. */
    detail: Record<string, unknown>;
  };
};

/** en.json is the key authority — the other nine locales mirror it. */
const messages = enMessages as unknown as Bundle;
const otherLocales: ReadonlyArray<[string, Bundle]> = (
  [
    ['de', deMessages],
    ['es', esMessages],
    ['fr', frMessages],
    ['it', itMessages],
    ['ja', jaMessages],
    ['nl', nlMessages],
    ['pl', plMessages],
    ['pt', ptMessages],
    ['zh', zhMessages],
  ] as ReadonlyArray<[string, unknown]>
).map(([locale, bundle]) => [locale, bundle as Bundle]);

/** The server-side enum, read from source so drift shows up as a failure. */
function serverSourceTypes(): ReadonlyArray<string> {
  // Vitest runs with cwd at the package root (apps/web).
  const source = readFileSync(
    resolve(process.cwd(), '../../packages/api/src/routers/actions.ts'),
    'utf8',
  );
  const block = /sourceType:\s*z\s*\.enum\(\[([^\]]*)\]\)/.exec(source);
  expect(block, 'actions router still declares a sourceType enum').not.toBeNull();
  return [...(block?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
}

describe('action source vocabulary', () => {
  it('covers exactly the source types the server can emit', () => {
    // RS-A8: RAMS shipped a `rams` sourceType on the server while the hub
    // still had ten branches — the eleventh fell through to "fire door".
    expect([...ACTION_SOURCE_TYPES].sort()).toEqual([...serverSourceTypes()].sort());
  });

  it('gives every source type a distinct chip label', () => {
    const keys = ACTION_SOURCE_TYPES.map(actionSourceLabelKey);
    expect(new Set(keys).size).toBe(ACTION_SOURCE_TYPES.length);
  });

  it('resolves every chip label key against the actions.list namespace', () => {
    for (const type of ACTION_SOURCE_TYPES) {
      expect(messages.actions.list[actionSourceLabelKey(type)], `actions.list.${type}`).toBeTypeOf(
        'string',
      );
    }
  });

  it('resolves every source-link key against the actions.detail namespace', () => {
    for (const type of ACTION_SOURCE_TYPES) {
      expect(messages.actions.detail[actionSourceLinkKey(type)], `detail.${type}`).toBeTypeOf(
        'string',
      );
    }
  });

  it('only claims a {referenceNumber} placeholder where the copy has one', () => {
    for (const type of ACTION_SOURCE_TYPES) {
      const copy = messages.actions.detail[actionSourceLinkKey(type)];
      expect(typeof copy).toBe('string');
      expect(String(copy).includes('{referenceNumber}'), `${type} placeholder expectation`).toBe(
        actionSourceLinkTakesReference(type),
      );
    }
  });

  it('labels a RAMS-sourced action as a RAMS pack, not a fire door', () => {
    expect(actionSourceLabelKey('rams')).toBe('sourceRams');
    expect(actionSourceLinkKey('rams')).toBe('sourceLinkRams');
    expect(messages.actions.list.sourceRams).toBe('RAMS pack');
    expect(messages.actions.detail.sourceLinkRams).toBe('Raised by RAMS pack {referenceNumber}');
  });

  it('falls back to standalone for a type it has never seen', () => {
    expect(isActionSourceType('quantum_flux')).toBe(false);
    expect(actionSourceLabelKey('quantum_flux')).toBe('sourceStandalone');
    expect(actionSourceLinkKey('quantum_flux')).toBe('sourceLinkStandalone');
  });

  it('keeps every locale in step on the source keys', () => {
    for (const [locale, bundle] of otherLocales) {
      for (const type of ACTION_SOURCE_TYPES) {
        expect(
          bundle.actions.list[actionSourceLabelKey(type)],
          `${locale}.actions.list.${type}`,
        ).toBeTypeOf('string');
        expect(
          bundle.actions.detail[actionSourceLinkKey(type)],
          `${locale}.detail.${type}`,
        ).toBeTypeOf('string');
      }
    }
  });
});
