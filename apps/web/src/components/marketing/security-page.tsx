import { Mail, ShieldCheck } from 'lucide-react';
import { SECURITY } from '../../content/security';

/**
 * The `/security` trust page. Content lives in `content/security.ts` —
 * every claim there is grounded in shipped behaviour, and the honest
 * "what we don't have yet" section is part of the design, not filler.
 */
export function SecurityPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-14 sm:py-20">
      <header className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">
          {SECURITY.eyebrow}
        </p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">
          {SECURITY.title}
        </h1>
        <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
          {SECURITY.lead}
        </p>
      </header>

      <div className="mt-14 grid gap-4 sm:grid-cols-2">
        {SECURITY.sections.map((section) => (
          <div key={section.title} className="rounded-2xl border bg-card p-6">
            <h2 className="flex items-start gap-2.5 text-[15px] font-semibold tracking-tight">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
              {section.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{section.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
        <h2 className="text-[15px] font-semibold tracking-tight">{SECURITY.notYet.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground/80">{SECURITY.notYet.body}</p>
      </div>

      <div className="mt-8 rounded-2xl border border-brand/20 bg-brand/5 p-6">
        <h2 className="flex items-start gap-2.5 text-[15px] font-semibold tracking-tight">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
          {SECURITY.contact.title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground/80">{SECURITY.contact.body}</p>
      </div>
    </div>
  );
}
