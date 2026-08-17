import { ArrowLeft, ArrowRight, Info, Lightbulb } from 'lucide-react';
import Link from 'next/link';
import { adjacentGuides, moduleForGuide, type Guide } from '../../content/guides';
import { MARKETING_PAGES } from '../../content/site';
import { MODULE_ICONS } from './module-icon';

/** Stable anchor id for a section heading. */
function anchorId(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * One guide (`/docs/[slug]`): summary, an "in this guide" jump list,
 * sections with numbered steps and callouts, and previous/next footer
 * navigation through the library. Layout only — content comes from
 * `content/guides`.
 */
export function GuidePage({ guide, locale }: { guide: Guide; locale: string }) {
  const copy = MARKETING_PAGES.docs;
  const module = moduleForGuide(guide);
  const { previous, next } = adjacentGuides(guide.slug);

  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      {/* ── Breadcrumb ── */}
      <nav className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link
          href={`/${locale}/docs`}
          className="inline-flex items-center gap-1.5 font-medium transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {copy.backToLibrary}
        </Link>
        {module !== undefined ? (
          <>
            <span aria-hidden>·</span>
            <Link
              href={`/${locale}/product/${module.slug}`}
              className="font-medium transition-colors hover:text-foreground"
            >
              {module.name}
            </Link>
          </>
        ) : null}
      </nav>

      {/* ── Header ── */}
      <header className="mt-8">
        <h1 className="text-balance font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          {guide.title}
        </h1>
        <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
          {guide.summary}
        </p>
        <p className="mt-3 text-sm font-medium text-muted-foreground">
          {guide.minutes} {copy.minutesLabel}
        </p>
      </header>

      {/* ── In this guide ── */}
      {guide.sections.length > 1 ? (
        <nav className="mt-8 rounded-2xl border bg-muted/40 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {copy.onThisPage}
          </p>
          <ol className="mt-3 space-y-1.5">
            {guide.sections.map((section, i) => (
              <li key={section.heading}>
                <a
                  href={`#${anchorId(section.heading)}`}
                  className="inline-flex items-baseline gap-2.5 text-sm font-medium text-foreground/80 transition-colors hover:text-brand"
                >
                  <span className="font-display text-xs font-bold text-brand">{i + 1}</span>
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      {/* ── Sections ── */}
      <div className="mt-10 space-y-12">
        {guide.sections.map((section) => (
          <section key={section.heading} id={anchorId(section.heading)} className="scroll-mt-20">
            <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
              {section.heading}
            </h2>
            {section.intro !== undefined ? (
              <p className="mt-3 leading-relaxed text-muted-foreground">{section.intro}</p>
            ) : null}
            {section.steps !== undefined ? (
              <ol className="mt-5 space-y-4">
                {section.steps.map((step, i) => (
                  <li key={step} className="flex gap-4">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/10 font-display text-xs font-bold text-brand">
                      {i + 1}
                    </span>
                    <p className="pt-0.5 text-[15px] leading-relaxed text-foreground/85">{step}</p>
                  </li>
                ))}
              </ol>
            ) : null}
            {section.bullets !== undefined ? (
              <ul className="mt-5 space-y-3">
                {section.bullets.map((bullet) => (
                  <li key={bullet} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                    <p className="text-[15px] leading-relaxed text-foreground/85">{bullet}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            {section.tip !== undefined ? (
              <div className="mt-5 flex gap-3 rounded-xl border border-brand/25 bg-brand/5 p-4">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                <p className="text-sm leading-relaxed text-foreground/85">
                  <span className="font-semibold text-brand">{copy.tipLabel}: </span>
                  {section.tip}
                </p>
              </div>
            ) : null}
            {section.note !== undefined ? (
              <div className="mt-5 flex gap-3 rounded-xl border bg-muted/50 p-4">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <p className="text-sm leading-relaxed text-foreground/80">
                  <span className="font-semibold">{copy.noteLabel}: </span>
                  {section.note}
                </p>
              </div>
            ) : null}
          </section>
        ))}
      </div>

      {/* ── Module link ── */}
      {module !== undefined ? (
        <ModuleCallout
          locale={locale}
          slug={module.slug}
          name={module.name}
          tagline={module.tagline}
          icon={module.icon}
        />
      ) : null}

      {/* ── Previous / next ── */}
      <nav className="mt-12 grid gap-4 border-t pt-8 sm:grid-cols-2">
        {previous !== undefined ? (
          <Link
            href={`/${locale}/docs/${previous.slug}`}
            className="group rounded-2xl border bg-card p-5 transition-all hover:border-brand/40"
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ArrowLeft className="h-3 w-3" aria-hidden />
              {copy.previous}
            </p>
            <p className="mt-1.5 text-sm font-semibold tracking-tight group-hover:text-brand">
              {previous.title}
            </p>
          </Link>
        ) : (
          <span aria-hidden />
        )}
        {next !== undefined ? (
          <Link
            href={`/${locale}/docs/${next.slug}`}
            className="group rounded-2xl border bg-card p-5 text-right transition-all hover:border-brand/40"
          >
            <p className="flex items-center justify-end gap-1.5 text-xs font-medium text-muted-foreground">
              {copy.next}
              <ArrowRight className="h-3 w-3" aria-hidden />
            </p>
            <p className="mt-1.5 text-sm font-semibold tracking-tight group-hover:text-brand">
              {next.title}
            </p>
          </Link>
        ) : null}
      </nav>
    </article>
  );
}

function ModuleCallout({
  locale,
  slug,
  name,
  tagline,
  icon,
}: {
  locale: string;
  slug: string;
  name: string;
  tagline: string;
  icon: keyof typeof MODULE_ICONS;
}) {
  const copy = MARKETING_PAGES.docs;
  const Icon = MODULE_ICONS[icon];
  return (
    <Link
      href={`/${locale}/product/${slug}`}
      className="group mt-12 flex items-start gap-4 rounded-2xl border border-brand/20 bg-brand/5 p-6 transition-all hover:border-brand/40"
    >
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span>
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-brand">
          {copy.moduleLink}
          <ArrowRight
            className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
        <span className="mt-1 block text-base font-semibold tracking-tight">{name}</span>
        <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{tagline}</span>
      </span>
    </Link>
  );
}
