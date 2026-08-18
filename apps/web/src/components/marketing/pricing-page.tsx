import { PRICING } from '../../content/site';
import { PricingCards } from './pricing-cards';

/**
 * The full `/pricing` page: the same two plan cards the homepage shows,
 * then the honest paragraphs (business model, portability) and the FAQ.
 * Content lives in `content/site.ts` (PRICING); this component owns
 * layout only. The route 404s on brands without a free plan.
 */
export function PricingPage({ locale }: { locale: string }) {
  if (PRICING === null) return null;
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
      <header className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">
          {PRICING.eyebrow}
        </p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">
          {PRICING.title}
        </h1>
        <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
          {PRICING.body}
        </p>
      </header>

      <div className="mt-14">
        <PricingCards locale={locale} />
      </div>

      <div className="mx-auto mt-10 max-w-3xl space-y-3 text-center">
        <p className="text-[15px] leading-relaxed text-foreground/80">{PRICING.businessModel}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{PRICING.portability}</p>
        <p className="text-xs text-muted-foreground">{PRICING.footnote}</p>
      </div>

      <section className="mx-auto mt-20 max-w-3xl">
        <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {PRICING.page.faqHeading}
        </h2>
        <div className="mt-8 space-y-4">
          {PRICING.page.faqs.map((faq) => (
            <div key={faq.q} className="rounded-2xl border bg-card p-6">
              <h3 className="text-[15px] font-semibold tracking-tight">{faq.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
