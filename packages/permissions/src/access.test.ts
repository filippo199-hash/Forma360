import { describe, expect, it } from 'vitest';
import { resolveAccessRule, type AccessRuleShape } from './access';

function rule(overrides: Partial<AccessRuleShape> = {}): AccessRuleShape {
  return {
    id: 'rule-1',
    groupIds: [],
    siteIds: [],
    invalidatedAt: null,
    ...overrides,
  };
}

describe('resolveAccessRule', () => {
  it('empty groups + empty sites = access granted to everyone', () => {
    const r = rule();
    expect(resolveAccessRule(r, { groupIds: ['g-a'], siteIds: ['s-x'] })).toBe(true);
    expect(resolveAccessRule(r, { groupIds: [], siteIds: [] })).toBe(true);
  });

  it('group match requires the user to be in ANY of the listed groups', () => {
    const r = rule({ groupIds: ['g-a', 'g-b'] });
    expect(resolveAccessRule(r, { groupIds: ['g-a'], siteIds: ['s-x'] })).toBe(true);
    expect(resolveAccessRule(r, { groupIds: ['g-c'], siteIds: ['s-x'] })).toBe(false);
  });

  it('site match requires the user to be in ANY of the listed sites', () => {
    const r = rule({ siteIds: ['s-x', 's-y'] });
    expect(resolveAccessRule(r, { groupIds: [], siteIds: ['s-y'] })).toBe(true);
    expect(resolveAccessRule(r, { groupIds: [], siteIds: ['s-z'] })).toBe(false);
  });

  it('group AND site — both must match', () => {
    const r = rule({ groupIds: ['auditors'], siteIds: ['manchester'] });
    expect(resolveAccessRule(r, { groupIds: ['auditors'], siteIds: ['manchester'] })).toBe(true);
    expect(resolveAccessRule(r, { groupIds: ['auditors'], siteIds: ['london'] })).toBe(false);
    expect(resolveAccessRule(r, { groupIds: ['ops'], siteIds: ['manchester'] })).toBe(false);
  });

  it('invalidated rule resolves to NO access (most restrictive — G-E06)', () => {
    const r = rule({
      groupIds: ['auditors'],
      siteIds: ['manchester'],
      invalidatedAt: new Date(),
    });
    // Even a user who would otherwise match gets denied.
    expect(resolveAccessRule(r, { groupIds: ['auditors'], siteIds: ['manchester'] })).toBe(false);
  });

  it('invalidated rule with empty constraints still resolves to NO access', () => {
    const r = rule({ invalidatedAt: new Date() });
    expect(resolveAccessRule(r, { groupIds: [], siteIds: [] })).toBe(false);
  });

  it('user with overlapping memberships is OK — ANY membership suffices', () => {
    const r = rule({ groupIds: ['g-a'], siteIds: ['s-x'] });
    expect(resolveAccessRule(r, { groupIds: ['g-a', 'g-b'], siteIds: ['s-x', 's-y'] })).toBe(true);
  });
});
