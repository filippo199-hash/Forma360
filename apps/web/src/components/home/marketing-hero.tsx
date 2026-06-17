import Link from 'next/link';
import { FEATURES, HERO } from '../../content/site';

/**
 * Public marketing hero shown to signed-out visitors on the homepage. Gives a
 * clear, reviewable description of what Forma360 is and that it offers a
 * WhatsApp AI assistant — required context for Meta App Review and useful for
 * anyone landing on the site. All copy comes from the `site` content module.
 */
export function MarketingHero({ locale }: { locale: string }) {
  return (
    <section className="mx-auto max-w-5xl px-4 pt-12 text-center sm:pt-20">
      <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {HERO.eyebrow}
      </p>
      <h1 className="mx-auto mt-4 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
        {HERO.title}
      </h1>
      <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
        {HERO.subtitle}
      </p>
      <div className="mt-8 flex items-center justify-center gap-3">
        <Link
          href={`/${locale}/sign-up`}
          className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {HERO.primaryCta}
        </Link>
        <Link
          href={`/${locale}/contact`}
          className="inline-flex h-10 items-center rounded-md border px-5 text-sm font-medium transition-colors hover:bg-accent"
        >
          {HERO.secondaryCta}
        </Link>
      </div>

      <div className="mt-16 grid gap-6 text-left sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="rounded-lg border bg-card p-5">
            <h2 className="text-base font-semibold tracking-tight">{feature.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {feature.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
