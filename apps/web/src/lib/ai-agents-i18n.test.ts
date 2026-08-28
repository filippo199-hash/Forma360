/**
 * AI Agents i18n guard (AG-I01/I02) — the sanctioned shape for
 * variable-keyed t() lookups, which K01 structurally cannot see (the
 * FRA fire-triangle and nav.child precedents).
 *
 * AG-I01 derives every key the components look up through variables from
 * the agent CATALOGUE — tile name/line, description, knowledge hint, and
 * each setting's label + option labels — and asserts they exist in the
 * English bundle. A new agent or setting without copy fails here, not on
 * a user's screen.
 *
 * AG-I02 is full two-way parity of the whole `aiAgents` namespace across
 * all ten locales (the nav-key-parity pattern): a key added to en without
 * the other nine — or left over in one of them — fails.
 */
import { AI_AGENTS } from '@forma360/shared/ai-agents';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MESSAGES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'packages',
  'i18n',
  'messages',
);

type Tree = Record<string, unknown>;

function load(locale: string): Tree {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8')) as Tree;
}

function flatten(tree: unknown, prefix = ''): string[] {
  if (typeof tree === 'string') return [prefix];
  if (Array.isArray(tree)) return [prefix];
  if (typeof tree !== 'object' || tree === null) return [];
  return Object.entries(tree).flatMap(([k, v]) => flatten(v, prefix === '' ? k : `${prefix}.${k}`));
}

function lookup(tree: Tree, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (typeof acc !== 'object' || acc === null) return undefined;
    return (acc as Tree)[part];
  }, tree);
}

const locales = readdirSync(MESSAGES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''))
  .sort();

describe('AI agents i18n coverage', () => {
  it('AG-I01: every catalogue-derived key has English copy', () => {
    const en = load('en');
    const missing: string[] = [];
    const need = (key: string): void => {
      if (typeof lookup(en, key) !== 'string') missing.push(key);
    };
    for (const agent of AI_AGENTS) {
      need(`aiAgents.agents.${agent.id}.name`);
      need(`aiAgents.agents.${agent.id}.tile`);
      need(`aiAgents.agents.${agent.id}.description`);
      need(`aiAgents.agents.${agent.id}.knowledgeHint`);
      for (const setting of agent.settings) {
        need(`aiAgents.fields.${setting.key}.label`);
        for (const option of setting.options) {
          need(`aiAgents.fields.${setting.key}.options.${option}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('AG-I02: the aiAgents namespace is in two-way parity across all locales', () => {
    expect(locales).toContain('en');
    // The suite is meaningless if the namespace vanished.
    const enKeys = flatten(lookup(load('en'), 'aiAgents'), 'aiAgents').sort();
    expect(enKeys.length).toBeGreaterThan(50);
    for (const locale of locales) {
      const keys = flatten(lookup(load(locale), 'aiAgents'), 'aiAgents').sort();
      expect(keys, `locale ${locale} drifted from en`).toEqual(enKeys);
    }
  });
});
