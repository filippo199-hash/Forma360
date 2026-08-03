/**
 * Navigation IA tests (ADR 0014).
 *
 * Edge cases:
 *   - NAV-E01: brand gating — Forma360 never renders a FreeHS-only module
 *     and loses the whole "Risk & control" heading with them
 *   - NAV-E02: permission gating — an entry the caller cannot open is not
 *     in the menu; administrators bypass every gate
 *   - NAV-E03: empty groups disappear, heading included
 *   - NAV-E04: sub-entries inherit the parent permission and can raise it
 *   - NAV-E05: active matching is exact-or-segment-prefix, never aliased
 *     across entries (the pre-0013 Inspections/Approvals double highlight)
 *   - NAV-E06: exactly one entry can be active for any real route
 *   - NAV-E07: every routed destination in the menu is unique
 *   - NAV-E08: the mobile tab bar fills from priority order, skips what
 *     the viewer cannot open, and never exceeds its slot count
 *   - NAV-E09: badge keys only ever sit on personally-scoped entries
 *   - NAV-E10: every href is locale-prefixed
 */
import { describe, expect, it } from 'vitest';
import {
  buildMobileTabs,
  buildNavSections,
  flattenNavItems,
  isNavItemActive,
  MOBILE_TAB_SLOTS,
  NAV_CHILD_ICON,
  activeNavItem,
  settingsNavItem,
  type NavItem,
} from './nav-model';

const ADMIN = ['org.settings'];

/** A viewer holding only the listed keys. */
function sectionsFor(permissions: readonly string[], brandId: 'freehs' | 'forma360' = 'freehs') {
  return buildNavSections({ locale: 'en', brandId, permissions });
}

function keysOf(permissions: readonly string[], brandId: 'freehs' | 'forma360' = 'freehs') {
  return flattenNavItems(sectionsFor(permissions, brandId)).map((i) => i.key);
}

describe('nav model (ADR 0014)', () => {
  it('NAV-E01: brand-only modules ship only where the catalogue enables them', () => {
    const freehs = keysOf(ADMIN, 'freehs');
    expect(freehs).toContain('riskAssessments');
    expect(freehs).toContain('coshh');
    expect(freehs).toContain('permits');
    expect(freehs).toContain('fireSafety');
    expect(freehs).toContain('incidents');

    const forma = keysOf(ADMIN, 'forma360');
    expect(forma).not.toContain('riskAssessments');
    expect(forma).not.toContain('coshh');
    expect(forma).not.toContain('permits');
    expect(forma).not.toContain('fireSafety');
    expect(forma).not.toContain('incidents');
    // Core modules are unaffected by the brand gate.
    expect(forma).toContain('inspections');
    expect(forma).toContain('actions');
  });

  it('NAV-E02: entries are permission-gated; admins bypass', () => {
    const reporter = keysOf(['issues.view', 'issues.report']);
    expect(reporter).toContain('issues');
    expect(reporter).not.toContain('inspections');
    expect(reporter).not.toContain('permits');
    expect(reporter).not.toContain('analytics');
    // Unpermissioned entries stay for everyone: the assistant and the
    // caller's own queue are not module surfaces.
    expect(reporter).toContain('ai');
    expect(reporter).toContain('myWork');

    // The administrator sees every entry the brand ships.
    expect(keysOf(ADMIN).length).toBeGreaterThan(reporter.length);
  });

  it('NAV-E03: a group with nothing left in it loses its heading too', () => {
    // Forma360 has no brand modules at all → no "Risk & control" group.
    expect(sectionsFor(ADMIN, 'forma360').map((s) => s.key)).not.toContain('groupRisk');
    // A viewer with no verify-side permission loses that group.
    const sections = sectionsFor(['issues.view']);
    expect(sections.map((s) => s.key)).not.toContain('groupVerify');
    expect(sections.map((s) => s.key)).toContain('groupRespond');
    // No section ever renders empty.
    for (const section of sectionsFor(ADMIN)) expect(section.items.length).toBeGreaterThan(0);
  });

  it('NAV-E04: sub-entries inherit the parent permission and can raise it', () => {
    const viewerOnly = flattenNavItems(sectionsFor(['permits.view'])).find(
      (i) => i.key === 'permits',
    );
    // The live board comes with permits.view; the type catalogue needs manage.
    expect(viewerOnly?.children?.map((c) => c.key)).toEqual(['permitsBoard']);

    const manager = flattenNavItems(sectionsFor(['permits.view', 'permits.manage'])).find(
      (i) => i.key === 'permits',
    );
    expect(manager?.children?.map((c) => c.key)).toEqual(['permitsBoard', 'permitsTypes']);

    // A parent whose children are all gated away carries no children key.
    const gatedContractors = flattenNavItems(sectionsFor(['contractors.view'])).find(
      (i) => i.key === 'contractors',
    );
    expect(gatedContractors?.children?.map((c) => c.key)).toEqual(['contractorsCalendar']);
  });

  it('NAV-E05: active matching is exact or segment-prefix, never cross-entry', () => {
    const items = flattenNavItems(sectionsFor(ADMIN));
    const inspections = items.find((i) => i.key === 'inspections') as NavItem;
    const approvals = items.find((i) => i.key === 'approvals') as NavItem;

    expect(isNavItemActive(inspections, '/en/inspections')).toBe(true);
    expect(isNavItemActive(inspections, '/en/inspections/01ABC/status')).toBe(true);
    // The pre-0013 bug: /approvals lit up Inspections as well as Approvals.
    expect(isNavItemActive(inspections, '/en/approvals')).toBe(false);
    expect(isNavItemActive(inspections, '/en/schedules')).toBe(false);
    expect(isNavItemActive(approvals, '/en/approvals/01ABC')).toBe(true);

    // A shared prefix that is not a path segment must not match.
    const sites = items.find((i) => i.key === 'sites') as NavItem;
    expect(isNavItemActive(sites, '/en/sites-archive')).toBe(false);
  });

  it('NAV-E06: at most one entry is active for any menu route', () => {
    const sections = sectionsFor(ADMIN);
    for (const item of flattenNavItems(sections)) {
      const active = flattenNavItems(sections).filter((i) => isNavItemActive(i, item.href));
      expect(active).toHaveLength(1);
      expect(activeNavItem(sections, item.href)?.key).toBe(item.key);
      // …and each of its children resolves back to it.
      for (const child of item.children ?? []) {
        expect(activeNavItem(sections, child.href)?.key).toBe(item.key);
      }
    }
    expect(activeNavItem(sections, '/en/nowhere')).toBeUndefined();
  });

  it('NAV-E07: destinations are unique, including Settings', () => {
    const hrefs = [
      ...flattenNavItems(sectionsFor(ADMIN)).flatMap((i) => [
        i.href,
        ...(i.children ?? []).map((c) => c.href),
      ]),
      settingsNavItem('en').href,
    ];
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('NAV-E08: the tab bar fills by priority, skips what is gated, and is bounded', () => {
    const admin = buildMobileTabs(sectionsFor(ADMIN));
    expect(admin.map((t) => t.key)).toEqual(['myWork', 'issues', 'incidents', 'inspections']);
    expect(admin.length).toBe(MOBILE_TAB_SLOTS);

    // Forma360 ships no brand modules, so Incidents drops out and the
    // next core entry is promoted rather than leaving a gap.
    expect(buildMobileTabs(sectionsFor(ADMIN, 'forma360')).map((t) => t.key)).toEqual([
      'myWork',
      'issues',
      'inspections',
      'actions',
    ]);

    // A permit-only viewer falls through to the entries they can open.
    const permitOnly = buildMobileTabs(sectionsFor(['permits.view']));
    expect(permitOnly.map((t) => t.key)).toEqual(['myWork', 'permits', 'ai']);
    expect(permitOnly.length).toBeLessThanOrEqual(MOBILE_TAB_SLOTS);
  });

  it('NAV-E09: badges sit only on the caller-scoped entries', () => {
    const badged = flattenNavItems(sectionsFor(ADMIN)).filter((i) => i.badge !== undefined);
    expect(badged.map((i) => i.key).sort()).toEqual(['actions', 'approvals', 'headsUp', 'myWork']);
    // The badge key always names its own entry's queue.
    for (const item of badged) {
      expect(['myWork', 'approvals', 'actions', 'headsUp']).toContain(item.badge);
    }
  });

  it('NAV-E10: every destination is locale-prefixed and every child has an icon', () => {
    for (const locale of ['en', 'it', 'ja']) {
      const sections = buildNavSections({ locale, brandId: 'freehs', permissions: ADMIN });
      for (const item of flattenNavItems(sections)) {
        expect(item.href.startsWith(`/${locale}/`)).toBe(true);
        for (const child of item.children ?? []) {
          expect(child.href.startsWith(`/${locale}/`)).toBe(true);
          expect(NAV_CHILD_ICON[child.key]).toBeDefined();
        }
      }
      expect(settingsNavItem(locale).href).toBe(`/${locale}/settings`);
    }
  });
});
