/**
 * Guide library — the content behind the public `/docs` pages: a
 * consultable how-to library, one guide per real task, grouped by module.
 *
 * Same convention as the rest of the marketing content (`content/site.ts`):
 * plain data in `.ts` modules, English-only by design, exempt from the
 * i18n lint rule. Brand gating rides on the marketing module catalogue —
 * a guide for a module the brand does not ship never renders, and
 * sandbox-only guides follow `activeBrand.offersSandbox` (ADR 0017).
 *
 * Accuracy rule: guides describe shipped behaviour and real navigation.
 * When a module changes, its guides change in the same PR — a guide that
 * teaches a flow that no longer exists is worse than no guide.
 */
import { activeBrand } from '../../lib/brand';
import {
  getMarketingModule,
  marketingModules,
  MODULE_CATEGORIES,
  type MarketingModule,
  type MarketingModuleSlug,
  type ModuleCategory,
} from '../modules';
import { GETTING_STARTED_GUIDES } from './getting-started';
import { ORGANISATION_GUIDES } from './organisation';
import { REGISTER_GUIDES } from './registers';
import { WORK_GUIDES } from './run-the-work';

// ─── Content model ───────────────────────────────────────────────────────────

/** Where a guide lives in the library. */
export type GuideArea = MarketingModuleSlug | 'getting-started';

export interface GuideSection {
  readonly heading: string;
  /** Short prose before the steps. */
  readonly intro?: string;
  /** Numbered steps — the heart of a how-to. */
  readonly steps?: readonly string[];
  /** Unordered points, for "what to know" rather than "what to do". */
  readonly bullets?: readonly string[];
  /** A highlighted practical tip. */
  readonly tip?: string;
  /** A neutral caveat or context note. */
  readonly note?: string;
}

export interface Guide {
  readonly slug: string;
  readonly title: string;
  readonly area: GuideArea;
  /** One-sentence promise of what the reader will be able to do. */
  readonly summary: string;
  /** Honest reading time. */
  readonly minutes: number;
  readonly sections: readonly GuideSection[];
  /** Only shown on brands that offer the try-it-now sandbox (ADR 0017). */
  readonly requiresSandbox?: true;
}

/**
 * When the library was last checked against the product, shown on every
 * guide. Bump it whenever a guides pass lands — compliance guidance with
 * no currency signal is guidance readers have to re-verify themselves.
 */
export const GUIDES_LAST_REVIEWED = '18 August 2026';

/** Copy for the getting-started group, which has no module page behind it. */
export const GETTING_STARTED_GROUP = {
  label: 'Getting started',
  blurb: 'From nothing to a working workspace — the first hour, step by step.',
} as const;

// ─── Assembly ────────────────────────────────────────────────────────────────

/** Every guide across every brand, in library order. */
export const ALL_GUIDES: readonly Guide[] = [
  ...GETTING_STARTED_GUIDES,
  ...WORK_GUIDES,
  ...REGISTER_GUIDES,
  ...ORGANISATION_GUIDES,
];

/** The guides the active brand should show, in library order. */
export function guides(): readonly Guide[] {
  const shipped = new Set(marketingModules().map((m) => m.slug));
  return ALL_GUIDES.filter((guide) => {
    if (guide.requiresSandbox === true && !activeBrand.offersSandbox) return false;
    return guide.area === 'getting-started' || shipped.has(guide.area);
  });
}

export function getGuide(slug: string): Guide | undefined {
  return guides().find((guide) => guide.slug === slug);
}

export function guidesForModule(slug: MarketingModuleSlug): readonly Guide[] {
  return guides().filter((guide) => guide.area === slug);
}

/** The previous/next guides around `slug` in library order, for footer nav. */
export function adjacentGuides(slug: string): {
  readonly previous: Guide | undefined;
  readonly next: Guide | undefined;
} {
  const all = guides();
  const index = all.findIndex((guide) => guide.slug === slug);
  return {
    previous: index > 0 ? all[index - 1] : undefined,
    next: index >= 0 && index < all.length - 1 ? all[index + 1] : undefined,
  };
}

export interface DocsModuleGroup {
  readonly module: MarketingModule;
  readonly guides: readonly Guide[];
}

export interface DocsCategoryGroup {
  readonly category: ModuleCategory;
  readonly modules: readonly DocsModuleGroup[];
}

/**
 * The library's shape for the `/docs` index: getting-started first, then
 * each module category with its modules' guides. Modules with no guides
 * and categories with no modules disappear rather than rendering empty.
 */
export function docsLibrary(): {
  readonly gettingStarted: readonly Guide[];
  readonly categories: readonly DocsCategoryGroup[];
} {
  const visible = guides();
  const gettingStarted = visible.filter((guide) => guide.area === 'getting-started');
  const categories = MODULE_CATEGORIES.map((category) => ({
    category,
    modules: marketingModules()
      .filter((module) => module.category === category.key)
      .map((module) => ({
        module,
        guides: visible.filter((guide) => guide.area === module.slug),
      }))
      .filter((group) => group.guides.length > 0),
  })).filter((group) => group.modules.length > 0);
  return { gettingStarted, categories };
}

/** The module behind a guide, when it has one (getting-started does not). */
export function moduleForGuide(guide: Guide): MarketingModule | undefined {
  return guide.area === 'getting-started' ? undefined : getMarketingModule(guide.area);
}
