import { ArrowRight, Bot, Check, CheckSquare, ClipboardCheck, ListChecks } from 'lucide-react';
import Link from 'next/link';
import { scenariosForBrand } from '@forma360/shared/sandbox-scenarios';
import { guides } from '../../content/guides';
import { modulesByCategory } from '../../content/modules';
import {
  CTA,
  DOCS_TEASER,
  GOLDEN_THREAD,
  HOW_IT_WORKS,
  MODULES_SHOWCASE,
  PRICING,
  TRUST_STRIP,
  WHATSAPP_SPOTLIGHT,
} from '../../content/site';
import { activeBrand } from '../../lib/brand';
import { MODULE_ICONS } from '../marketing/module-icon';
import { PricingCards } from '../marketing/pricing-cards';

const hasSandbox = (): boolean => scenariosForBrand(activeBrand.id).length > 0;

// ─── Trust strip ─────────────────────────────────────────────────────────────

export function TrustStrip() {
  return (
    <section className="border-b bg-muted/40">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-center text-sm font-medium text-muted-foreground">
          {TRUST_STRIP.heading}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          {TRUST_STRIP.items.map((item) => (
            <span
              key={item}
              className="rounded-full border bg-background px-4 py-1.5 text-sm font-medium text-foreground/80"
            >
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Modules showcase ────────────────────────────────────────────────────────

export function ModulesShowcase({ locale }: { locale: string }) {
  const groups = modulesByCategory();
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">
          {MODULES_SHOWCASE.eyebrow}
        </p>
        <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
          {MODULES_SHOWCASE.title}
        </h2>
        <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
          {MODULES_SHOWCASE.subtitle}
        </p>
      </div>

      <div className="mt-14 space-y-12">
        {groups.map(({ category, modules }) => (
          <div key={category.key}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-foreground/70">
                {category.label}
              </h3>
              <p className="text-sm text-muted-foreground">{category.blurb}</p>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {modules.map((module) => {
                const Icon = MODULE_ICONS[module.icon];
                return (
                  <Link
                    key={module.slug}
                    href={`/${locale}/product/${module.slug}`}
                    className="group relative rounded-2xl border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg hover:shadow-brand/5"
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
                    <h4 className="mt-4 flex items-center gap-1.5 text-base font-semibold tracking-tight">
                      {module.name}
                      <ArrowRight
                        className="h-3.5 w-3.5 text-brand opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                        aria-hidden
                      />
                    </h4>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {module.tagline}
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-12 text-center">
        <Link
          href={`/${locale}/product`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
        >
          {MODULES_SHOWCASE.viewAll}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

// ─── Golden thread (linked records) ──────────────────────────────────────────

/** Decorative linked-records vignette: finding → action → closed. */
function ThreadMock() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-sm select-none">
      <div className="absolute bottom-8 left-[1.4rem] top-8 w-px bg-gradient-to-b from-brand/60 via-brand/40 to-emerald-500/60" />
      <div className="space-y-4">
        <div className="relative rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand ring-4 ring-background">
              <ClipboardCheck className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold">Weekly warehouse walk</p>
              <p className="text-[11px] text-muted-foreground">Q14 failed — rack guard damaged</p>
            </div>
            <span className="ml-auto shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
              Flagged
            </span>
          </div>
        </div>
        <div className="relative rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand ring-4 ring-background">
              <ListChecks className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold">Replace damaged rack guard</p>
              <p className="text-[11px] text-muted-foreground">J. Patel · due 21 Aug · aisle 4</p>
            </div>
            <span className="ml-auto shrink-0 rounded-full border border-brand/25 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
              Assigned
            </span>
          </div>
        </div>
        <div className="relative rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 ring-4 ring-background dark:text-emerald-400">
              <Check className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold">Closed with photo evidence</p>
              <p className="text-[11px] text-muted-foreground">Linked back to the inspection</p>
            </div>
            <span className="ml-auto shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
              Done
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GoldenThread() {
  return (
    <section className="border-y bg-muted/30">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:py-24 lg:grid-cols-2">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">
            {GOLDEN_THREAD.eyebrow}
          </p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {GOLDEN_THREAD.title}
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
            {GOLDEN_THREAD.body}
          </p>
          <ul className="mt-6 space-y-3">
            {GOLDEN_THREAD.bullets.map((bullet) => (
              <li key={bullet} className="flex items-start gap-3 text-sm">
                <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                <span className="text-foreground/80">{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
        <ThreadMock />
      </div>
    </section>
  );
}

// ─── WhatsApp spotlight (the differentiator) ─────────────────────────────────

function ChatMockup() {
  return (
    <div className="mx-auto w-full max-w-sm overflow-hidden rounded-3xl border shadow-xl">
      {/* WhatsApp-style header */}
      <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
          <Bot className="h-5 w-5" aria-hidden />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold">{`${activeBrand.name} Assistant`}</p>
          <p className="text-[11px] text-white/70">online</p>
        </div>
      </div>
      {/* Chat body */}
      <div className="space-y-2.5 bg-[#ece5dd] px-3 py-4 dark:bg-[#0b141a]">
        {WHATSAPP_SPOTLIGHT.chat.map((turn, i) => (
          <div key={i} className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <p
              className={
                turn.role === 'user'
                  ? 'max-w-[80%] rounded-2xl rounded-br-sm bg-[#dcf8c6] px-3 py-2 text-sm text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-white'
                  : 'max-w-[80%] rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-white'
              }
            >
              {turn.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WhatsAppSpotlight() {
  return (
    <section className="border-b bg-brand/5">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:py-24 lg:grid-cols-2">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">
            {WHATSAPP_SPOTLIGHT.eyebrow}
          </p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {WHATSAPP_SPOTLIGHT.title}
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
            {WHATSAPP_SPOTLIGHT.body}
          </p>
          <ul className="mt-6 space-y-3">
            {WHATSAPP_SPOTLIGHT.bullets.map((bullet) => (
              <li key={bullet} className="flex items-start gap-3 text-sm">
                <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                <span className="text-foreground/80">{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
        <ChatMockup />
      </div>
    </section>
  );
}

// ─── How it works ────────────────────────────────────────────────────────────

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">
          {HOW_IT_WORKS.eyebrow}
        </p>
        <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
          {HOW_IT_WORKS.title}
        </h2>
      </div>
      <ol className="mt-14 grid gap-6 lg:grid-cols-3">
        {HOW_IT_WORKS.steps.map((step, i) => (
          <li key={step.title} className="relative rounded-2xl border bg-card p-7">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand font-display text-base font-bold text-brand-foreground">
              {i + 1}
            </span>
            <h3 className="mt-5 text-lg font-semibold tracking-tight">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ─── Pricing (free-plan brands only) ─────────────────────────────────────────

export function PricingSection({ locale }: { locale: string }) {
  if (PRICING === null) return null;
  return (
    <section id="pricing" className="scroll-mt-20 border-t bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">
            {PRICING.eyebrow}
          </p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {PRICING.title}
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">{PRICING.body}</p>
        </div>

        <div className="mt-14">
          <PricingCards locale={locale} />
        </div>

        <div className="mx-auto mt-10 max-w-3xl space-y-3 text-center">
          <p className="text-sm leading-relaxed text-foreground/80">{PRICING.businessModel}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{PRICING.portability}</p>
          <p className="text-xs text-muted-foreground">{PRICING.footnote}</p>
          <p>
            <Link
              href={`/${locale}/pricing`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
            >
              {PRICING.fullPricingCta}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

// ─── Docs teaser ─────────────────────────────────────────────────────────────

export function DocsTeaser({ locale }: { locale: string }) {
  const all = guides();
  const featured = DOCS_TEASER.featuredSlugs
    .map((slug) => all.find((guide) => guide.slug === slug))
    .filter((guide) => guide !== undefined)
    .slice(0, 3);
  return (
    <section className="border-t">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:py-24">
        <div className="grid items-start gap-10 lg:grid-cols-[1fr_1.5fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">
              {DOCS_TEASER.eyebrow}
            </p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {DOCS_TEASER.title}
            </h2>
            <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
              {DOCS_TEASER.body}
            </p>
            <Link
              href={`/${locale}/docs`}
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
            >
              {DOCS_TEASER.cta}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <div className="grid gap-4">
            {featured.map((guide) => (
              <Link
                key={guide.slug}
                href={`/${locale}/docs/${guide.slug}`}
                className="group flex items-start justify-between gap-4 rounded-2xl border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg hover:shadow-brand/5"
              >
                <div>
                  <h3 className="text-base font-semibold tracking-tight">{guide.title}</h3>
                  <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    {guide.summary}
                  </p>
                  <p className="mt-2.5 text-xs font-medium text-muted-foreground">
                    {guide.minutes} {DOCS_TEASER.minutesLabel}
                  </p>
                </div>
                <ArrowRight
                  className="mt-1 h-4 w-4 shrink-0 text-brand opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                  aria-hidden
                />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Final CTA band ──────────────────────────────────────────────────────────

export function CtaBand({ locale }: { locale: string }) {
  const sandbox = hasSandbox();
  return (
    <section className="bg-foreground text-background">
      <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:py-24">
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{CTA.title}</h2>
        <p className="mx-auto mt-4 max-w-xl text-pretty leading-relaxed text-background/70">
          {CTA.subtitle}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={`/${locale}/sign-up`}
            className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-brand px-7 text-sm font-semibold text-brand-foreground transition-transform hover:-translate-y-0.5 sm:w-auto"
          >
            {CTA.primary}
          </Link>
          <Link
            href={sandbox ? `/${locale}/try` : `/${locale}/contact`}
            className="inline-flex h-12 w-full items-center justify-center rounded-lg border border-background/25 px-7 text-sm font-semibold text-background transition-colors hover:bg-background/10 sm:w-auto"
          >
            {CTA.secondary}
          </Link>
        </div>
      </div>
    </section>
  );
}
