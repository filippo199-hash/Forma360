import { ArrowRight, Compass } from 'lucide-react';
import Link from 'next/link';
import { docsLibrary, GETTING_STARTED_GROUP, type Guide } from '../../content/guides';
import { MARKETING_PAGES } from '../../content/site';
import { MODULE_ICONS } from './module-icon';

/**
 * The `/docs` library index: getting-started first, then every module's
 * guides grouped under its category — a library to consult, not a wall of
 * links. Content comes from `content/guides` (brand-filtered).
 */
export function DocsIndex({ locale }: { locale: string }) {
  const copy = MARKETING_PAGES.docs;
  const { gettingStarted, categories } = docsLibrary();
  const total =
    gettingStarted.length +
    categories.reduce((n, c) => n + c.modules.reduce((m, g) => m + g.guides.length, 0), 0);

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
        <p className="mt-3 text-sm font-medium text-muted-foreground">
          {total} {copy.guideCountSuffix}
        </p>
      </header>

      {/* ── Getting started ── */}
      {gettingStarted.length > 0 ? (
        <section className="mt-14">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-foreground/70">
              <Compass className="h-4 w-4 text-brand" aria-hidden />
              {GETTING_STARTED_GROUP.label}
            </h2>
            <p className="text-sm text-muted-foreground">{GETTING_STARTED_GROUP.blurb}</p>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {gettingStarted.map((guide, i) => (
              <Link
                key={guide.slug}
                href={`/${locale}/docs/${guide.slug}`}
                className="group rounded-2xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg hover:shadow-brand/5"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 font-display text-sm font-bold text-brand">
                  {i + 1}
                </span>
                <h3 className="mt-3.5 flex items-center gap-1.5 text-[15px] font-semibold tracking-tight">
                  {guide.title}
                  <ArrowRight
                    className="h-3.5 w-3.5 shrink-0 text-brand opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                    aria-hidden
                  />
                </h3>
                <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                  {guide.summary}
                </p>
                <p className="mt-2.5 text-xs font-medium text-muted-foreground">
                  {guide.minutes} {copy.minutesLabel}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Modules by category ── */}
      {categories.map(({ category, modules }) => (
        <section key={category.key} className="mt-14">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-foreground/70">
              {category.label}
            </h2>
            <p className="text-sm text-muted-foreground">{category.blurb}</p>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {modules.map(({ module, guides }) => {
              const Icon = MODULE_ICONS[module.icon];
              return (
                <div key={module.slug} className="rounded-2xl border bg-card p-6">
                  <Link
                    href={`/${locale}/product/${module.slug}`}
                    className="group inline-flex items-center gap-3"
                  >
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
                      <Icon className="h-4.5 w-4.5" aria-hidden />
                    </span>
                    <span className="flex items-center gap-1.5 text-base font-semibold tracking-tight group-hover:text-brand">
                      {module.name}
                      <ArrowRight
                        className="h-3.5 w-3.5 text-brand opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                        aria-hidden
                      />
                    </span>
                  </Link>
                  <ul className="mt-4 divide-y">
                    {guides.map((guide: Guide) => (
                      <li key={guide.slug}>
                        <Link
                          href={`/${locale}/docs/${guide.slug}`}
                          className="group flex items-baseline justify-between gap-4 py-2.5"
                        >
                          <span className="text-sm font-medium text-foreground/85 transition-colors group-hover:text-brand">
                            {guide.title}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {guide.minutes} {copy.minutesLabel}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
