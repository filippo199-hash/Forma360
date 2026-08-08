/**
 * Plan & entitlement catalogue — ADR 0010's fourth place ("entitlement
 * defaults"), made real by the AI-dashboards module (ADR 0018).
 *
 * A tenant is on exactly one plan; a plan grants a set of entitlements.
 * The plan is stored as `tenants.settings.plan` (absent = the default,
 * free) and is read through `planFromSettings` so an unknown or corrupt
 * value degrades to free rather than throwing.
 *
 * This file is deliberately NOT a billing system. It is the switch a
 * future billing integration will flip. Nothing here knows about money,
 * invoices, or trials — only "which features does this tenant get".
 *
 * Ground rules:
 *   - Gate features on an entitlement key, never on a brand id and never
 *     on a raw `settings.plan === 'paid'` comparison scattered in code.
 *   - Per-brand plan defaults live here (`defaultPlanForBrand`) so brand
 *     differences stay in the four ADR 0010 places.
 */
import { z } from 'zod';
import type { BrandId } from './brand';

export const PLAN_IDS = ['free', 'paid'] as const;

export type PlanId = (typeof PLAN_IDS)[number];

export const planIdSchema = z.enum(PLAN_IDS);

export const DEFAULT_PLAN: PlanId = 'free';

/**
 * Every feature gated by plan. One key per feature surface; the key is
 * what `requireEntitlement` (packages/api) checks.
 */
export const ENTITLEMENT_KEYS = [
  /** AI-built custom dashboards (ADR 0018): builder chat, saved dashboards,
   *  scheduled PDF delivery, per-widget Excel export. The fixed /analytics
   *  overview is NOT gated — it stays available on every plan. */
  'customDashboards',
] as const;

export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

export function isEntitlementKey(value: unknown): value is EntitlementKey {
  return typeof value === 'string' && (ENTITLEMENT_KEYS as readonly string[]).includes(value);
}

/**
 * LAUNCH FLAG (ADR 0018): AI dashboards are free for EVERYONE until billing
 * goes live — every tenant defaults to the free plan (absent `settings.plan`
 * ⇒ free), so putting `customDashboards` in the free plan opens it to all
 * existing and new tenants through the single entitlement lever, leaving the
 * whole gate (`requireEntitlement`, nav gating, the upgrade panel) intact.
 *
 * To re-gate to paid-only later: flip this to `false`. That is the ONLY
 * change needed — the dormant PAYMENT_REQUIRED path wakes back up, the nav
 * entry disappears for free tenants, and the two launch-mode tests
 * (entitlements.test.ts, dashboards DH-E11) flip with it.
 */
export const DASHBOARDS_FREE_FOR_EVERYONE = true;

export const PLAN_ENTITLEMENTS: Record<PlanId, ReadonlyArray<EntitlementKey>> = {
  free: DASHBOARDS_FREE_FOR_EVERYONE ? ['customDashboards'] : [],
  paid: ['customDashboards'],
};

/**
 * Per-brand default plan for newly created tenants. Both brands currently
 * start free; the table exists so a future divergence is a data change in
 * ADR 0010's fourth place, not a conditional in a signup flow.
 */
export function defaultPlanForBrand(brand: BrandId): PlanId {
  const defaults: Record<BrandId, PlanId> = {
    forma360: DEFAULT_PLAN,
    freehs: DEFAULT_PLAN,
  };
  return defaults[brand];
}

/**
 * Read a tenant's plan out of its `settings` jsonb without trusting the
 * shape. Absent, unknown, or corrupt values degrade to the free plan —
 * a bad settings row must never lock a tenant out of the app.
 */
export function planFromSettings(settings: unknown): PlanId {
  if (settings !== null && typeof settings === 'object') {
    const parsed = planIdSchema.safeParse((settings as Record<string, unknown>)['plan']);
    if (parsed.success) return parsed.data;
  }
  return DEFAULT_PLAN;
}

export function planHasEntitlement(plan: PlanId, key: EntitlementKey): boolean {
  return PLAN_ENTITLEMENTS[plan].includes(key);
}

/** Convenience: entitlement check straight off a tenant `settings` jsonb. */
export function settingsHaveEntitlement(settings: unknown, key: EntitlementKey): boolean {
  return planHasEntitlement(planFromSettings(settings), key);
}
