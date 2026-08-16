/**
 * Needs-attention chips must pluralise (BUG-26).
 *
 * The module registers render `{count}` in a badge next to a label whose
 * English used to be a hardcoded plural noun phrase — producing
 * "1 checks overdue", "1 drafts in preparation", "1 effectiveness reviews
 * due" on live tenants. The fix converts every attention label to an ICU
 * plural taking `count`, and this guard pins the whole class: every key
 * under {fireSafety,coshh,permits,incidents,rams}.attention, in every
 * locale, must be an ICU plural over `count`. A locale with no
 * grammatical plural (ja/zh) still declares `{count, plural, other {…}}`
 * so placeholder parity (I18N-P02) holds.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const MESSAGES_DIR = join(REPO_ROOT, 'packages', 'i18n', 'messages');
const ATTENTION_NAMESPACES = ['fireSafety', 'coshh', 'permits', 'incidents', 'rams'] as const;

type Bundle = { [key: string]: string | Bundle };

function loadBundle(locale: string): Bundle {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf-8')) as Bundle;
}

describe('attention chip plurals (BUG-26)', () => {
  it('every *.attention key in every locale is an ICU plural over count', () => {
    const locales = readdirSync(MESSAGES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => basename(f, '.json'));
    const problems: string[] = [];
    let checked = 0;

    for (const locale of locales) {
      const bundle = loadBundle(locale);
      for (const ns of ATTENTION_NAMESPACES) {
        const module_ = bundle[ns];
        if (typeof module_ !== 'object' || module_ === null) continue;
        const attention = module_['attention'];
        if (typeof attention !== 'object' || attention === null) continue;
        for (const [key, message] of Object.entries(attention)) {
          checked += 1;
          if (typeof message !== 'string' || !/\{count,\s*plural,/.test(message)) {
            problems.push(`${locale}: ${ns}.attention.${key}`);
          }
        }
      }
    }

    // If the scan stops finding attention keys, this test proves nothing.
    expect(checked).toBeGreaterThan(100);
    expect({ nonPluralAttentionKeys: problems.sort() }).toEqual({ nonPluralAttentionKeys: [] });
  });
});
