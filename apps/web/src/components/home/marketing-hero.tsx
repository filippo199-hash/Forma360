import Link from 'next/link';
import { scenariosForBrand } from '@forma360/shared/sandbox-scenarios';
import { HERO } from '../../content/site';
import { activeBrand } from '../../lib/brand';
import { AppPreview } from './app-preview';

/**
 * Public marketing hero. A centred display headline over an atmospheric
 * grid + brand glow, staggered load-in, and a CSS-drawn product mock
 * beneath the CTAs. Brands that ship the try-it-now sandbox lead with it
 * (trying beats reading); the headline's closing phrase carries the brand
 * colour — on free-plan brands that phrase is the price.
 */
export function MarketingHero({
  locale,
  isSignedIn = false,
}: {
  locale: string;
  isSignedIn?: boolean;
}) {
  const hasSandbox = scenariosForBrand(activeBrand.id).length > 0;
  const primaryHref = isSignedIn
    ? `/${locale}/ai`
    : hasSandbox
      ? `/${locale}/try`
      : `/${locale}/sign-up`;
  const primaryLabel = isSignedIn ? HERO.appCta : hasSandbox ? HERO.tryCta : HERO.primaryCta;
  const secondaryHref = !isSignedIn && hasSandbox ? `/${locale}/sign-up` : `/${locale}/contact`;
  const secondaryLabel = !isSignedIn && hasSandbox ? HERO.primaryCta : HERO.secondaryCta;

  return (
    <section className="relative overflow-hidden border-b">
      {/* Atmosphere: faint grid + soft brand glow. Decorative only. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            'linear-gradient(to right, color-mix(in oklab, var(--color-foreground) 6%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--color-foreground) 6%, transparent) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black, transparent 75%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-[420px] w-[820px] -translate-x-1/2 rounded-full opacity-60 blur-3xl"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in oklab, var(--color-brand) 30%, transparent), transparent)',
        }}
      />

      <div className="mx-auto max-w-5xl px-4 pt-16 text-center sm:pt-24">
        <p className="animate-fade-up" style={{ animationDelay: '0ms' }}>
          <span className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/5 px-4 py-1.5 text-xs font-semibold tracking-wide text-brand">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
            </span>
            {HERO.pill}
          </span>
        </p>
        <h1
          className="animate-fade-up mx-auto mt-6 max-w-4xl text-balance font-display text-5xl font-bold leading-[1.04] tracking-tight sm:text-6xl md:text-7xl"
          style={{ animationDelay: '80ms' }}
        >
          {HERO.titleLead} <span className="text-brand">{HERO.titleAccent}</span>
        </h1>
        <p
          className="animate-fade-up mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground"
          style={{ animationDelay: '160ms' }}
        >
          {HERO.subtitle}
        </p>
        <div
          className="animate-fade-up mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          style={{ animationDelay: '240ms' }}
        >
          <Link
            href={primaryHref}
            className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-brand px-7 text-sm font-semibold text-brand-foreground shadow-lg shadow-brand/25 transition-transform hover:-translate-y-0.5 sm:w-auto"
          >
            {primaryLabel}
          </Link>
          <Link
            href={secondaryHref}
            className="inline-flex h-12 w-full items-center justify-center rounded-lg border bg-background px-7 text-sm font-semibold transition-colors hover:bg-accent sm:w-auto"
          >
            {secondaryLabel}
          </Link>
        </div>
        <p
          className="animate-fade-up mt-5 text-xs text-muted-foreground"
          style={{ animationDelay: '320ms' }}
        >
          {HERO.note}
        </p>
      </div>

      <div
        className="animate-fade-up mx-auto max-w-6xl px-4 pb-20 pt-14 sm:pb-24"
        style={{ animationDelay: '400ms' }}
      >
        <AppPreview />
      </div>
    </section>
  );
}
