import { Check, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { PRICING, type PricingPlan } from '../../content/site';

/**
 * The Free / Pro plan cards — shared by the homepage pricing section and
 * the full /pricing page so the two can never disagree. Renders nothing
 * on brands without a free plan (PRICING is null there).
 */
export function PricingCards({ locale }: { locale: string }) {
  if (PRICING === null) return null;
  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
      <PlanCard locale={locale} plan={PRICING.free} highlight />
      <PlanCard locale={locale} plan={PRICING.pro} badge={PRICING.proBadge} />
    </div>
  );
}

function PlanCard({
  locale,
  plan,
  highlight = false,
  badge,
}: {
  locale: string;
  plan: PricingPlan;
  highlight?: boolean;
  badge?: string;
}) {
  return (
    <div
      className={
        highlight
          ? 'flex flex-col rounded-3xl border-2 border-brand/30 bg-card p-8 shadow-xl shadow-brand/5'
          : 'flex flex-col rounded-3xl border bg-card p-8'
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            {plan.name}
            {badge !== undefined ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-brand/25 bg-brand/5 px-2.5 py-0.5 text-[11px] font-semibold text-brand">
                <Sparkles className="h-3 w-3" aria-hidden />
                {badge}
              </span>
            ) : null}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{plan.blurb}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-5xl font-bold tracking-tight text-brand">{plan.price}</p>
          <p className="mt-1 max-w-[10rem] text-xs leading-snug text-muted-foreground">
            {plan.unit}
          </p>
        </div>
      </div>
      <ul className="mt-7 flex-1 space-y-3">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm">
            <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
              <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" aria-hidden />
            </span>
            <span className="text-foreground/85">{feature}</span>
          </li>
        ))}
      </ul>
      <Link
        href={plan.ctaHref === 'sign-up' ? `/${locale}/sign-up` : `/${locale}/contact`}
        className={
          highlight
            ? 'mt-8 inline-flex h-12 items-center justify-center rounded-lg bg-brand px-6 text-sm font-semibold text-brand-foreground shadow-lg shadow-brand/25 transition-transform hover:-translate-y-0.5'
            : 'mt-8 inline-flex h-12 items-center justify-center rounded-lg border bg-background px-6 text-sm font-semibold transition-colors hover:bg-accent'
        }
      >
        {plan.cta}
      </Link>
    </div>
  );
}
