import type { MetadataRoute } from 'next';
import { DEFAULT_LOCALE } from '@forma360/i18n/config';
import { scenariosForBrand } from '@forma360/shared/sandbox-scenarios';
import { guides } from '../src/content/guides';
import { PRICING } from '../src/content/site';
import { marketingModules } from '../src/content/modules';
import { activeBrand } from '../src/lib/brand';

/**
 * Sitemap for the public marketing surface: homepage, module pages, the
 * guide library and the company/legal pages. Marketing content is
 * English-only by design, so URLs are listed under the default locale
 * rather than ×10 near-duplicate translations. Token-bearing routes
 * (/s, /scan, /invite, …) are deliberately absent — they are disallowed
 * in robots.ts for the same reason.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = `${activeBrand.website}/${DEFAULT_LOCALE}`;
  const hasSandbox = scenariosForBrand(activeBrand.id).length > 0;

  const entries: MetadataRoute.Sitemap = [
    { url: `${base}`, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/product`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/docs`, changeFrequency: 'weekly', priority: 0.8 },
    ...(PRICING !== null
      ? [{ url: `${base}/pricing`, changeFrequency: 'monthly' as const, priority: 0.9 }]
      : []),
    { url: `${base}/security`, changeFrequency: 'monthly', priority: 0.5 },
    ...(hasSandbox
      ? [{ url: `${base}/try`, changeFrequency: 'monthly' as const, priority: 0.9 }]
      : []),
    { url: `${base}/sign-up`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/about`, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${base}/contact`, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${base}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/data-deletion`, changeFrequency: 'yearly', priority: 0.2 },
  ];

  for (const module of marketingModules()) {
    entries.push({
      url: `${base}/product/${module.slug}`,
      changeFrequency: 'monthly',
      priority: 0.8,
    });
  }
  for (const guide of guides()) {
    entries.push({
      url: `${base}/docs/${guide.slug}`,
      changeFrequency: 'monthly',
      priority: 0.6,
    });
  }
  return entries;
}
