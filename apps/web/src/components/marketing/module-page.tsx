import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { scenariosForBrand } from '@forma360/shared/sandbox-scenarios';
import { guidesForModule } from '../../content/guides';
import { getMarketingModule, MODULE_CATEGORIES, type MarketingModule } from '../../content/modules';
import { HERO, MARKETING_PAGES } from '../../content/site';
import { activeBrand } from '../../lib/brand';
import { MODULE_ICONS } from './module-icon';

/**
 * One marketing module page (`/product/[slug]`): hero, "how it works"
 * walk-through, capability grid, the module's distinctive behaviour, its
 * guides and the modules it works with. Everything renders from the
 * marketing catalogue (`content/modules.ts`) — this component owns layout
 * only.
 */
export function ModulePage({ module, locale }: { module: MarketingModule; locale: string }) {
  const Icon = MODULE_ICONS[module.icon];
  const category = MODULE_CATEGORIES.find((c) => c.key === module.category);
  const guides = guidesForModule(module.slug);
  const related = module.related
    .map((slug) => getMarketingModule(slug))
    .filter((m) => m !== undefined);
  const hasSandbox = scenariosForBrand(activeBrand.id).length > 0;
  const copy = MARKETING_PAGES.module;

  return (
    <article>
      {/* ── Hero ── */}
      <header className="relative overflow-hidden border-b">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-[380px] w-[720px] -translate-x-1/2 rounded-full opacity-50 blur-3xl"
          style={{
            background:
              'radial-gradient(closest-side, color-mix(in oklab, var(--color-brand) 26%, transparent), transparent)',
          }}
        />
        <div className="mx-auto max-w-4xl px-4 pb-16 pt-12 text-center sm:pt-16">
          <nav className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Link
              href={`/${locale}/product`}
              className="inline-flex items-center gap-1.5 font-medium transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              {copy.allModules}
            </Link>
            {category !== undefined ? (
              <>
                <span aria-hidden>·</span>
                <span>{category.label}</span>
              </>
            ) : null}
          </nav>
          <div className="mt-8 flex justify-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
              <Icon className="h-7 w-7" aria-hidden />
            </span>
          </div>
          <p className="mt-4 text-sm font-semibold uppercase tracking-[0.14em] text-brand">
            {module.name}
          </p>
          <h1 className="mx-auto mt-3 max-w-3xl text-balance font-display text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">
            {module.hero.title}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
            {module.hero.lead}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href={hasSandbox ? `/${locale}/try` : `/${locale}/sign-up`}
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-brand px-6 text-sm font-semibold text-brand-foreground shadow-lg shadow-brand/20 transition-transform hover:-translate-y-0.5 sm:w-auto"
            >
              {hasSandbox ? HERO.tryCta : HERO.primaryCta}
            </Link>
            {hasSandbox ? (
              <Link
                href={`/${locale}/sign-up`}
                className="inline-flex h-11 w-full items-center justify-center rounded-lg border bg-background px-6 text-sm font-semibold transition-colors hover:bg-accent sm:w-auto"
              >
                {HERO.primaryCta}
              </Link>
            ) : null}
          </div>
          {module.paidAddOn === true ? (
            <div className="mt-5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand/5 px-3 py-1 text-xs font-semibold text-brand">
                <Sparkles className="h-3 w-3" aria-hidden />
                {copy.paidBadge}
              </span>
              {copy.proNote !== null ? (
                <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
                  {copy.proNote}
                </p>
              ) : null}
            </div>
          ) : copy.freeNote !== null ? (
            <p className="mt-5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {copy.freeNote}
            </p>
          ) : null}
        </div>
      </header>

      {/* ── How it works ── */}
      <section className="mx-auto max-w-3xl px-4 py-16 sm:py-20">
        <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {copy.howItWorks}
        </h2>
        <ol className="mt-10 space-y-0">
          {module.workflow.map((step, i) => (
            <li key={step.title} className="relative flex gap-5 pb-10 last:pb-0">
              {i < module.workflow.length - 1 ? (
                <span
                  aria-hidden
                  className="absolute left-[1.18rem] top-10 h-[calc(100%-2rem)] w-px bg-border"
                />
              ) : null}
              <span className="z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-brand/30 bg-background font-display text-sm font-bold text-brand">
                {i + 1}
              </span>
              <div className="pt-1">
                <h3 className="text-base font-semibold tracking-tight">{step.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Capabilities ── */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            {copy.capabilities}
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {module.capabilities.map((capability) => (
              <div key={capability.title} className="rounded-2xl border bg-card p-6">
                <h3 className="text-[15px] font-semibold tracking-tight">{capability.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {capability.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Highlight ── */}
      <section className="mx-auto max-w-4xl px-4 py-16 sm:py-20">
        <div className="rounded-3xl border border-brand/20 bg-brand/5 p-8 sm:p-10">
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            {module.highlight.title}
          </h2>
          <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">
            {module.highlight.body}
          </p>
          <ul className="mt-6 space-y-3">
            {module.highlight.points.map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/15">
                  <Check className="h-3 w-3 text-brand" aria-hidden />
                </span>
                <span className="text-foreground/85">{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Guides ── */}
      {guides.length > 0 ? (
        <section className="border-t">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              {copy.guidesHeading}
            </h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {guides.map((guide) => (
                <Link
                  key={guide.slug}
                  href={`/${locale}/docs/${guide.slug}`}
                  className="group rounded-2xl border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg hover:shadow-brand/5"
                >
                  <h3 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight">
                    {guide.title}
                    <ArrowRight
                      className="h-3.5 w-3.5 shrink-0 text-brand opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                      aria-hidden
                    />
                  </h3>
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    {guide.summary}
                  </p>
                  <p className="mt-3 text-xs font-medium text-muted-foreground">
                    {guide.minutes} {copy.minutesLabel}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ── Related modules ── */}
      {related.length > 0 ? (
        <section className="border-t bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              {copy.relatedHeading}
            </h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((relatedModule) => {
                const RelatedIcon = MODULE_ICONS[relatedModule.icon];
                return (
                  <Link
                    key={relatedModule.slug}
                    href={`/${locale}/product/${relatedModule.slug}`}
                    className="group flex items-start gap-4 rounded-2xl border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg hover:shadow-brand/5"
                  >
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                      <RelatedIcon className="h-5 w-5" aria-hidden />
                    </span>
                    <div>
                      <h3 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight">
                        {relatedModule.name}
                        <ArrowRight
                          className="h-3.5 w-3.5 shrink-0 text-brand opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                          aria-hidden
                        />
                      </h3>
                      <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                        {relatedModule.tagline}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}
    </article>
  );
}
