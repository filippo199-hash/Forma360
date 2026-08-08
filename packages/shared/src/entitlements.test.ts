import { describe, expect, it } from 'vitest';

import { BRAND_IDS } from './brand';
import {
  DEFAULT_PLAN,
  ENTITLEMENT_KEYS,
  PLAN_ENTITLEMENTS,
  PLAN_IDS,
  defaultPlanForBrand,
  isEntitlementKey,
  planFromSettings,
  planHasEntitlement,
  settingsHaveEntitlement,
} from './entitlements';

describe('entitlements catalogue', () => {
  it('every plan has an entitlement list (completeness)', () => {
    for (const plan of PLAN_IDS) {
      expect(PLAN_ENTITLEMENTS[plan]).toBeDefined();
    }
  });

  it('every granted entitlement is a catalogued key', () => {
    for (const plan of PLAN_IDS) {
      for (const key of PLAN_ENTITLEMENTS[plan]) {
        expect(isEntitlementKey(key)).toBe(true);
      }
    }
  });

  it('every brand resolves to a valid default plan', () => {
    for (const brand of BRAND_IDS) {
      expect(PLAN_IDS).toContain(defaultPlanForBrand(brand));
    }
  });

  it('the default plan is free', () => {
    expect(DEFAULT_PLAN).toBe('free');
  });
});

describe('planFromSettings', () => {
  it('reads a valid plan', () => {
    expect(planFromSettings({ plan: 'paid' })).toBe('paid');
    expect(planFromSettings({ plan: 'free' })).toBe('free');
  });

  it.each([
    ['absent key', {}],
    ['null settings', null],
    ['undefined settings', undefined],
    ['non-object settings', 'paid'],
    ['unknown plan value', { plan: 'enterprise' }],
    ['non-string plan value', { plan: 42 }],
  ])('degrades to free on %s', (_label, settings) => {
    expect(planFromSettings(settings)).toBe(DEFAULT_PLAN);
  });
});

describe('entitlement checks', () => {
  it('paid grants customDashboards', () => {
    expect(planHasEntitlement('paid', 'customDashboards')).toBe(true);
    expect(settingsHaveEntitlement({ plan: 'paid' }, 'customDashboards')).toBe(true);
  });

  it('free does not grant customDashboards', () => {
    expect(planHasEntitlement('free', 'customDashboards')).toBe(false);
    expect(settingsHaveEntitlement({}, 'customDashboards')).toBe(false);
    expect(settingsHaveEntitlement({ plan: 'nonsense' }, 'customDashboards')).toBe(false);
  });

  it('isEntitlementKey rejects unknown keys', () => {
    expect(isEntitlementKey('customDashboards')).toBe(true);
    expect(isEntitlementKey('unlimitedSeats')).toBe(false);
    expect(isEntitlementKey(7)).toBe(false);
  });

  it('ENTITLEMENT_KEYS has no duplicates', () => {
    expect(new Set(ENTITLEMENT_KEYS).size).toBe(ENTITLEMENT_KEYS.length);
  });
});
