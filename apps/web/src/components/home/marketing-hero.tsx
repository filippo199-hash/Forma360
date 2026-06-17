import Link from 'next/link';
import { HERO } from '../../content/site';

/**
 * Public marketing hero. Clean, confident, centred — a large display
 * headline over an atmospheric teal gradient + faint grid, with staggered
 * load-in. Renders an "Open the app" CTA for signed-in visitors.
 */
export function MarketingHero({
  locale,
  isSignedIn = false,
}: {
  locale: string;
  isSignedIn?: boolean;
}) {
  return (
    <section className="relative overflow-hidden border-b">
      {/* Atmosphere: faint grid + two soft brand glows. Decorative only. */}
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

      <div className="mx-auto max-w-4xl px-4 pb-20 pt-20 text-center sm:pt-28">
        <p
          className="animate-fade-up text-sm font-semibold uppercase tracking-[0.14em] text-brand"
          style={{ animationDelay: '0ms' }}
        >
          {HERO.eyebrow}
        </p>
        <h1
          className="animate-fade-up mx-auto mt-5 max-w-3xl text-balance font-display text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl"
          style={{ animationDelay: '80ms' }}
        >
          {HERO.title}
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
            href={isSignedIn ? `/${locale}/ai` : `/${locale}/sign-up`}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-brand px-6 text-sm font-semibold text-brand-foreground shadow-sm transition-transform hover:-translate-y-0.5 sm:w-auto"
          >
            {isSignedIn ? HERO.appCta : HERO.primaryCta}
          </Link>
          <Link
            href={`/${locale}/contact`}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg border bg-background px-6 text-sm font-semibold transition-colors hover:bg-accent sm:w-auto"
          >
            {HERO.secondaryCta}
          </Link>
        </div>
        <p
          className="animate-fade-up mt-5 text-xs text-muted-foreground"
          style={{ animationDelay: '320ms' }}
        >
          {HERO.note}
        </p>
      </div>
    </section>
  );
}
