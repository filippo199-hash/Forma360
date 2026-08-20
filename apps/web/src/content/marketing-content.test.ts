/**
 * Marketing-content integrity (MK-C01..C10).
 *
 * The public site renders entirely from the content catalogues in this
 * directory: the module catalogue drives /product, the guide library
 * drives /docs, and the two cross-reference each other and the brand
 * catalogue. A broken slug here is a 404 on the marketing site with no
 * compiler to catch it — so this test pins the referential integrity the
 * pages assume, for both brands.
 */
import { describe, expect, it } from 'vitest';
import { BRAND_MODULES } from '@forma360/shared/brand';
import { activeBrand } from '../lib/brand';
import { ALL_GUIDES, guides } from './guides';
import {
  ALL_MARKETING_MODULES,
  MARKETING_MODULE_SLUGS,
  marketingModulesForBrand,
  MODULE_CATEGORIES,
} from './modules';
import { DOCS_TEASER } from './site';

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe('marketing module catalogue', () => {
  it('MK-C01: slugs are unique and kebab-case', () => {
    const slugs = ALL_MARKETING_MODULES.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(KEBAB);
  });

  it('MK-C02: every module tells a complete story', () => {
    for (const module of ALL_MARKETING_MODULES) {
      expect(module.name.length).toBeGreaterThan(0);
      expect(module.tagline.length).toBeGreaterThan(0);
      expect(module.hero.title.length).toBeGreaterThan(0);
      expect(module.hero.lead.length).toBeGreaterThan(0);
      expect(module.workflow.length).toBeGreaterThanOrEqual(3);
      expect(module.capabilities.length).toBeGreaterThanOrEqual(4);
      expect(module.highlight.points.length).toBeGreaterThanOrEqual(2);
      expect(MODULE_CATEGORIES.some((c) => c.key === module.category)).toBe(true);
    }
  });

  it('MK-C03: related modules reference real slugs and never themselves', () => {
    const slugs = new Set<string>(MARKETING_MODULE_SLUGS);
    for (const module of ALL_MARKETING_MODULES) {
      expect(module.related.length).toBeGreaterThan(0);
      for (const related of module.related) {
        expect(slugs.has(related)).toBe(true);
        expect(related).not.toBe(module.slug);
      }
    }
  });

  it('MK-C11: exactly one module is the Pro add-on', () => {
    // The showcase title, hero and pricing copy all quote FREE_MODULE_COUNT
    // (modules minus Pro add-ons). A second paidAddOn flag appearing without
    // the copy being rethought would silently change every "free" number on
    // the site — surface it here instead.
    const pro = ALL_MARKETING_MODULES.filter((m) => m.paidAddOn === true);
    expect(pro.map((m) => m.slug)).toEqual(['dashboards']);
  });

  it('MK-C04: brand filtering matches the brand catalogue exactly', () => {
    // Forma360 ships no brand-only modules → the gated ones drop.
    const forma360 = marketingModulesForBrand('forma360');
    expect(forma360.every((m) => m.brandModule === undefined)).toBe(true);
    expect(forma360.length).toBe(
      ALL_MARKETING_MODULES.filter((m) => m.brandModule === undefined).length,
    );

    // FreeHS ships every brand-only module in its catalogue → nothing drops.
    const freehs = marketingModulesForBrand('freehs');
    expect(freehs.length).toBe(ALL_MARKETING_MODULES.length);
    for (const brandModule of BRAND_MODULES.freehs) {
      expect(freehs.some((m) => m.brandModule === brandModule)).toBe(true);
    }
  });
});

describe('guide library', () => {
  it('MK-C05: guide slugs are unique, kebab-case, and disjoint per area rules', () => {
    const slugs = ALL_GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(KEBAB);
  });

  it('MK-C06: every guide belongs to getting-started or a real module', () => {
    const moduleSlugs = new Set<string>(MARKETING_MODULE_SLUGS);
    for (const guide of ALL_GUIDES) {
      expect(guide.area === 'getting-started' || moduleSlugs.has(guide.area)).toBe(true);
    }
  });

  it('MK-C07: every guide has substance', () => {
    for (const guide of ALL_GUIDES) {
      expect(guide.title.length).toBeGreaterThan(0);
      expect(guide.summary.length).toBeGreaterThan(0);
      expect(guide.minutes).toBeGreaterThanOrEqual(1);
      expect(guide.minutes).toBeLessThanOrEqual(15);
      expect(guide.sections.length).toBeGreaterThanOrEqual(2);
      for (const section of guide.sections) {
        expect(section.heading.length).toBeGreaterThan(0);
        const hasBody =
          section.intro !== undefined ||
          (section.steps !== undefined && section.steps.length > 0) ||
          (section.bullets !== undefined && section.bullets.length > 0);
        expect(hasBody).toBe(true);
      }
      // Section headings anchor the in-page nav — duplicates would collide.
      const headings = guide.sections.map((s) => s.heading);
      expect(new Set(headings).size).toBe(headings.length);
    }
  });

  it('MK-C08: every module the fullest brand ships has at least one guide', () => {
    for (const module of marketingModulesForBrand('freehs')) {
      const count = ALL_GUIDES.filter((g) => g.area === module.slug).length;
      expect(count, `module ${module.slug} has no guides`).toBeGreaterThanOrEqual(1);
    }
  });

  it('MK-C09: the active-brand view never leaks unshipped or sandbox-gated guides', () => {
    const shipped = new Set(marketingModulesForBrand(activeBrand.id).map((m) => m.slug));
    for (const guide of guides()) {
      expect(guide.area === 'getting-started' || shipped.has(guide.area)).toBe(true);
      if (guide.requiresSandbox === true) {
        expect(activeBrand.offersSandbox).toBe(true);
      }
    }
  });
});

describe('homepage cross-references', () => {
  it('MK-C10: docs-teaser featured slugs exist in the guide library', () => {
    const slugs = new Set(ALL_GUIDES.map((g) => g.slug));
    for (const featured of DOCS_TEASER.featuredSlugs) {
      expect(slugs.has(featured), `featured guide ${featured} does not exist`).toBe(true);
    }
  });
});
