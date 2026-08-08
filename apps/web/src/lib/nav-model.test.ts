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
 *   - NAV-E11: training sits in the organisation group, beside Contractors
 *   - NAV-E12: training is permission- and brand-gated
 *   - NAV-E13: the in-page tab strip leads with the module and lists its
 *     (permission-filtered) children
 *   - NAV-E14: a child route activates its tab; a route deeper than any tab
 *     hides the strip (list pages only, like Inspections/Training)
 *   - NAV-E15: a module without children has no strip; child tabs honour the
 *     same permission gate as the sidebar did
 *   - NAV-E16: entitlement gating (ADR 0018) — the Dashboards entry exists
 *     only when the tenant plan grants customDashboards; no admin bypass
 */
import { describe, expect, it } from 'vitest';
import {
  buildMobileTabs,
  buildNavSections,
  flattenNavItems,
  isNavItemActive,
  MOBILE_TAB_SLOTS,
  moduleTabsForPath,
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
    expect(freehs).toContain('rams');
    expect(freehs).toContain('fireSafety');
    expect(freehs).toContain('incidents');
    expect(freehs).toContain('training');

    const forma = keysOf(ADMIN, 'forma360');
    expect(forma).not.toContain('riskAssessments');
    expect(forma).not.toContain('coshh');
    expect(forma).not.toContain('permits');
    expect(forma).not.toContain('rams');
    expect(forma).not.toContain('fireSafety');
    expect(forma).not.toContain('incidents');
    expect(forma).not.toContain('training');
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
    expect(reporter).toContain('forMe');

    // The administrator sees every entry the brand ships.
    expect(keysOf(ADMIN).length).toBeGreaterThan(reporter.length);
  });

  it('NAV-E03: a group with nothing left in it loses its heading too', () => {
    // Forma360 ships none of the brand registers, so "Records &
    // registers" disappears with them.
    expect(sectionsFor(ADMIN, 'forma360').map((s) => s.key)).not.toContain('groupRecords');
    // A viewer who can only report hazards keeps the work group (their
    // one module) and loses the organisation group entirely.
    const sections = sectionsFor(['issues.view']);
    expect(sections.map((s) => s.key)).toContain('groupDoWork');
    expect(sections.map((s) => s.key)).not.toContain('groupOrg');
    expect(sections.map((s) => s.key)).not.toContain('groupRecords');
    // The unlabelled top block survives every gate — "For me" and the
    // assistant are nobody's module.
    expect(sections.map((s) => s.key)).toContain(null);
    expect(flattenNavItems(sections).map((i) => i.key)).toContain('forMe');
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

    // RAMS: the register comes with rams.view; the method-statement
    // library needs manage and the contractor-review queue needs review.
    const packViewer = flattenNavItems(sectionsFor(['rams.view'])).find((i) => i.key === 'rams');
    expect(packViewer?.children).toBeUndefined();
    const ramsFull = flattenNavItems(sectionsFor(['rams.view', 'rams.manage', 'rams.review'])).find(
      (i) => i.key === 'rams',
    );
    expect(ramsFull?.children?.map((c) => c.key)).toEqual(['ramsLibrary', 'ramsReviews']);
  });

  it('NAV-E05: active matching is exact or segment-prefix, never cross-entry', () => {
    const items = flattenNavItems(sectionsFor(ADMIN));
    const inspections = items.find((i) => i.key === 'inspections') as NavItem;

    expect(isNavItemActive(inspections, '/en/inspections')).toBe(true);
    expect(isNavItemActive(inspections, '/en/inspections/01ABC/status')).toBe(true);
    // Approvals and Schedules now nest under Inspections, so the parent
    // must still not claim their routes as its own.
    expect(isNavItemActive(inspections, '/en/approvals')).toBe(false);
    expect(isNavItemActive(inspections, '/en/schedules')).toBe(false);

    // "For me" owns the whole /my-work trunk, so the two personal
    // sub-routes still light it up rather than nothing.
    const forMe = items.find((i) => i.key === 'forMe') as NavItem;
    expect(isNavItemActive(forMe, '/en/my-work')).toBe(true);
    expect(isNavItemActive(forMe, '/en/my-work/actions')).toBe(true);
    expect(isNavItemActive(forMe, '/en/my-work/acknowledgements')).toBe(true);

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
    expect(admin.map((t) => t.key)).toEqual(['forMe', 'issues', 'incidents', 'inspections']);
    expect(admin.length).toBe(MOBILE_TAB_SLOTS);

    // Forma360 ships no brand modules, so Incidents drops out and the
    // next core entry is promoted rather than leaving a gap.
    expect(buildMobileTabs(sectionsFor(ADMIN, 'forma360')).map((t) => t.key)).toEqual([
      'forMe',
      'issues',
      'inspections',
      'actions',
    ]);

    // A permit-only viewer falls through to the entries they can open —
    // "For me" is ungated, so it always leads.
    const permitOnly = buildMobileTabs(sectionsFor(['permits.view']));
    expect(permitOnly.map((t) => t.key)).toEqual(['forMe', 'permits', 'ai']);
    expect(permitOnly.length).toBeLessThanOrEqual(MOBILE_TAB_SLOTS);
  });

  it('NAV-E09: badges name their own queue, on items and on nested entries', () => {
    const items = flattenNavItems(sectionsFor(ADMIN));
    const badged = items.filter((i) => i.badge !== undefined);
    expect(badged.map((i) => i.key).sort()).toEqual([
      'actions',
      'fireSafety',
      'forMe',
      'incidents',
      'permits',
      'riskAssessments',
      'training',
    ]);
    // Every badge key names its own entry — no entry borrows another's
    // number, which is what would make the menu lie.
    for (const item of badged) {
      expect(item.badge).toBe(item.key === 'actions' ? 'actions' : item.key);
    }
    // Approvals kept its count when it nested under Inspections.
    const approvals = items
      .find((i) => i.key === 'inspections')
      ?.children?.find((c) => c.key === 'approvals');
    expect(approvals?.badge).toBe('approvals');
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

  it('NAV-E11: training sits with the organisation, beside Contractors (TR-A15)', () => {
    // The panel's argument, and the reason this is asserted rather than
    // argued in a comment: a reviewer asking "who is allowed to do this
    // work" wants the two competence registers — our people and their
    // people — side by side. Training is about PEOPLE, which is what
    // this group holds; it is not a document register.
    const sections = sectionsFor(ADMIN);
    const org = sections.find((s) => s.key === 'groupOrg');
    const keys = (org?.items ?? []).map((i) => i.key);
    expect(keys).toContain('training');
    expect(keys).toContain('contractors');
    expect(keys.indexOf('training')).toBe(keys.indexOf('contractors') + 1);

    // …and specifically NOT in the records group.
    const records = sections.find((s) => s.key === 'groupRecords');
    expect((records?.items ?? []).map((i) => i.key)).not.toContain('training');
  });

  it('NAV-E12: training is permission-gated and brand-gated (TR-A15)', () => {
    // A viewer without training.view never sees the entry…
    expect(keysOf(['issues.view'])).not.toContain('training');
    // …one with it does…
    expect(keysOf(['training.view'])).toContain('training');
    // …and the requirements child needs the manage key on top.
    const viewer = flattenNavItems(sectionsFor(['training.view'])).find(
      (i) => i.key === 'training',
    );
    expect(viewer?.children?.map((c) => c.key)).toEqual(['trainingMatrix']);
    const manager = flattenNavItems(sectionsFor(['training.view', 'training.manage'])).find(
      (i) => i.key === 'training',
    );
    expect(manager?.children?.map((c) => c.key)).toEqual([
      'trainingMatrix',
      'trainingRequirements',
    ]);
  });

  it('NAV-E13: the tab strip leads with the module and lists its children', () => {
    const sections = sectionsFor(ADMIN);
    const strip = moduleTabsForPath(sections, '/en/coshh');
    expect(strip?.tabs.map((t) => t.key)).toEqual(['coshh', 'coshhPointOfWork', 'coshhLev']);
    expect(strip?.tabs[0]).toMatchObject({ key: 'coshh', isParent: true, active: true });
    // Only the module tab is active on the module's own landing.
    expect(strip?.tabs.filter((t) => t.active).map((t) => t.key)).toEqual(['coshh']);
  });

  it('NAV-E14: a child route activates its tab; a deeper route hides the strip', () => {
    const sections = sectionsFor(ADMIN);
    const onChild = moduleTabsForPath(sections, '/en/coshh/point-of-work');
    expect(onChild?.tabs.filter((t) => t.active).map((t) => t.key)).toEqual(['coshhPointOfWork']);
    expect(onChild?.tabs.find((t) => t.isParent)?.active).toBe(false);
    // A detail or form route under the module is deeper than any tab — no strip.
    expect(moduleTabsForPath(sections, '/en/coshh/new')).toBeUndefined();
    expect(moduleTabsForPath(sections, '/en/coshh/01ABC')).toBeUndefined();
  });

  it('NAV-E15: modules without children have no strip; child tabs honour permission', () => {
    // Incidents has no children — nothing to tab between.
    expect(moduleTabsForPath(sectionsFor(ADMIN), '/en/incidents')).toBeUndefined();
    // A permits viewer sees the board tab but not the manage-gated types tab.
    const viewer = moduleTabsForPath(sectionsFor(['permits.view']), '/en/permits');
    expect(viewer?.tabs.map((t) => t.key)).toEqual(['permits', 'permitsBoard']);
    const manager = moduleTabsForPath(
      sectionsFor(['permits.view', 'permits.manage']),
      '/en/permits',
    );
    expect(manager?.tabs.map((t) => t.key)).toEqual(['permits', 'permitsBoard', 'permitsTypes']);
  });

  it('NAV-E16: the Dashboards entry is entitlement-gated with no admin bypass', () => {
    const base = {
      locale: 'en',
      brandId: 'freehs',
      permissions: ['org.settings', 'analytics.view'],
    } as const;
    const keysOf = (sections: ReturnType<typeof buildNavSections>): string[] =>
      flattenNavItems(sections).map((i) => i.key);

    // No entitlements passed (free plan / legacy caller): entry absent —
    // even for an administrator, because the PLAN lacks the feature.
    expect(keysOf(buildNavSections(base))).not.toContain('dashboards');
    expect(keysOf(buildNavSections({ ...base, entitlements: [] }))).not.toContain('dashboards');

    // Paid plan: present, still permission-gated on analytics.view.
    const paid = buildNavSections({ ...base, entitlements: ['customDashboards'] });
    expect(keysOf(paid)).toContain('dashboards');
    const noView = buildNavSections({
      locale: 'en',
      brandId: 'freehs',
      permissions: ['inspections.view'],
      entitlements: ['customDashboards'],
    });
    expect(keysOf(noView)).not.toContain('dashboards');
  });
});
