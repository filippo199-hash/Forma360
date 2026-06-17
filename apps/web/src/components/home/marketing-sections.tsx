import {
  AlertTriangle,
  BarChart3,
  Bot,
  CalendarClock,
  CheckSquare,
  ClipboardCheck,
  FileText,
  Package,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import {
  CTA,
  INDUSTRIES,
  INDUSTRIES_HEADING,
  MODULES,
  MODULES_INTRO,
  type Module,
  STATS,
  WHATSAPP_SPOTLIGHT,
} from '../../content/site';

const ICONS: Record<Module['icon'], LucideIcon> = {
  'clipboard-check': ClipboardCheck,
  'triangle-alert': AlertTriangle,
  'square-check-big': CheckSquare,
  package: Package,
  'calendar-clock': CalendarClock,
  'file-text': FileText,
  'chart-column': BarChart3,
  bot: Bot,
};

// ─── Industries strip ────────────────────────────────────────────────────────

export function IndustriesStrip() {
  return (
    <section className="border-b bg-muted/40">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-center text-sm font-medium text-muted-foreground">
          {INDUSTRIES_HEADING}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          {INDUSTRIES.map((industry) => (
            <span
              key={industry}
              className="rounded-full border bg-background px-4 py-1.5 text-sm font-medium text-foreground/80"
            >
              {industry}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Modules grid ────────────────────────────────────────────────────────────

export function Modules() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">
          {MODULES_INTRO.eyebrow}
        </p>
        <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
          {MODULES_INTRO.title}
        </h2>
        <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
          {MODULES_INTRO.subtitle}
        </p>
      </div>

      <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {MODULES.map((module) => {
          const Icon = ICONS[module.icon];
          return (
            <div key={module.title} className="group bg-card p-6 transition-colors hover:bg-accent/40">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-base font-semibold tracking-tight">{module.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {module.description}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── WhatsApp spotlight (the differentiator) ─────────────────────────────────

function ChatMockup() {
  return (
    <div className="mx-auto w-full max-w-sm overflow-hidden rounded-2xl border shadow-xl">
      {/* WhatsApp-style header */}
      <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
          <Bot className="h-5 w-5" aria-hidden />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold">Forma360 Assistant</p>
          <p className="text-[11px] text-white/70">online</p>
        </div>
      </div>
      {/* Chat body */}
      <div className="space-y-2.5 bg-[#ece5dd] px-3 py-4 dark:bg-[#0b141a]">
        {WHATSAPP_SPOTLIGHT.chat.map((turn, i) => (
          <div
            key={i}
            className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
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
    <section className="border-y bg-brand/5">
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

// ─── Stats band (brand colour) ───────────────────────────────────────────────

export function Stats() {
  return (
    <section className="bg-brand text-brand-foreground">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <div key={stat.label} className="text-center">
            <p className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {stat.value}
            </p>
            <p className="mt-2 text-sm text-brand-foreground/80">{stat.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Final CTA band ──────────────────────────────────────────────────────────

export function CtaBand({ locale }: { locale: string }) {
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
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-brand px-6 text-sm font-semibold text-brand-foreground transition-transform hover:-translate-y-0.5 sm:w-auto"
          >
            {CTA.primary}
          </Link>
          <Link
            href={`/${locale}/contact`}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-background/25 px-6 text-sm font-semibold text-background transition-colors hover:bg-background/10 sm:w-auto"
          >
            {CTA.secondary}
          </Link>
        </div>
      </div>
    </section>
  );
}
