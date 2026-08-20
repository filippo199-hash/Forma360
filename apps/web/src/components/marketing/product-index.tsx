import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { modulesByCategory } from '../../content/modules';
import { MARKETING_PAGES, MODULES_SHOWCASE } from '../../content/site';
import { MODULE_ICONS } from './module-icon';

/** The `/product` index: every module the brand ships, grouped by category. */
export function ProductIndex({ locale }: { locale: string }) {
  const copy = MARKETING_PAGES.product;
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
      <header className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">
          {copy.eyebrow}
        </p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">
          {copy.title}
        </h1>
        <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
          {copy.subtitle}
        </p>
      </header>

      <div className="mt-14 space-y-14">
        {modulesByCategory().map(({ category, modules }) => (
          <section key={category.key}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-foreground/70">
                {category.label}
              </h2>
              <p className="text-sm text-muted-foreground">{category.blurb}</p>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {modules.map((module) => {
                const Icon = MODULE_ICONS[module.icon];
                return (
                  <Link
                    key={module.slug}
                    href={`/${locale}/product/${module.slug}`}
                    className="group rounded-2xl border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg hover:shadow-brand/5"
                  >
                    <div className="flex items-start justify-between">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10 text-brand">
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      {module.paidAddOn === true ? (
                        <span className="rounded-full border border-brand/25 bg-brand/5 px-2.5 py-0.5 text-[11px] font-semibold text-brand">
                          {MODULES_SHOWCASE.paidBadge}
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mt-4 flex items-center gap-1.5 text-base font-semibold tracking-tight">
                      {module.name}
                      <ArrowRight
                        className="h-3.5 w-3.5 text-brand opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                        aria-hidden
                      />
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {module.tagline}
                    </p>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
