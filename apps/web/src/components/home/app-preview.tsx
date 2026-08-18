import {
  AlertTriangle,
  Bell,
  ClipboardCheck,
  FileSignature,
  Flame,
  ListChecks,
  ListTodo,
  Search,
  ShieldAlert,
  Siren,
  type LucideIcon,
} from 'lucide-react';
import { activeBrand } from '../../lib/brand';

/**
 * Decorative product mock for the marketing hero: a stylised register view
 * inside a browser frame, drawn entirely in CSS so it stays crisp, themed
 * and 0 bytes of image. Everything here is aria-hidden set dressing — the
 * copy around it carries the meaning.
 */

const RAIL: ReadonlyArray<{ icon: LucideIcon; label: string; active?: boolean }> = [
  { icon: ListTodo, label: 'For me' },
  { icon: ClipboardCheck, label: 'Inspections' },
  { icon: AlertTriangle, label: 'Hazards' },
  { icon: Siren, label: 'Incidents' },
  { icon: FileSignature, label: 'Permits' },
  { icon: ListChecks, label: 'Actions', active: true },
  { icon: ShieldAlert, label: 'Risk assessments' },
  { icon: Flame, label: 'Fire safety' },
];

const STATS: ReadonlyArray<{ label: string; value: string; tone: 'brand' | 'amber' | 'ok' }> = [
  { label: 'Open', value: '24', tone: 'brand' },
  { label: 'Overdue', value: '3', tone: 'amber' },
  { label: 'Done this week', value: '41', tone: 'ok' },
];

const ROWS: ReadonlyArray<{
  title: string;
  meta: string;
  chip: string;
  tone: 'amber' | 'brand' | 'ok';
}> = [
  {
    title: 'Replace damaged rack guard — aisle 4',
    meta: 'Riverside · from inspection WW-0142',
    chip: 'Overdue',
    tone: 'amber',
  },
  {
    title: 'Re-test emergency lighting, first floor',
    meta: 'Docklands · from fire logbook',
    chip: 'Due Fri',
    tone: 'brand',
  },
  {
    title: 'Brief night shift on new LOTO procedure',
    meta: 'Riverside · from incident IN-0027',
    chip: 'In progress',
    tone: 'brand',
  },
  {
    title: 'Refit guard on bench grinder',
    meta: 'Workshop · from hazard report',
    chip: 'Done',
    tone: 'ok',
  },
];

const CHIP_TONES: Record<'amber' | 'brand' | 'ok', string> = {
  amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30',
  brand: 'bg-brand/10 text-brand border border-brand/25',
  ok: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
};

export function AppPreview() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-4xl select-none">
      {/* Soft glow behind the frame. */}
      <div
        className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] opacity-70 blur-2xl"
        style={{
          background:
            'radial-gradient(60% 60% at 50% 30%, color-mix(in oklab, var(--color-brand) 22%, transparent), transparent)',
        }}
      />

      <div className="overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-foreground/10">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b bg-muted/60 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <div className="mx-auto flex h-6 w-56 items-center justify-center gap-1.5 rounded-md border bg-background text-[10px] text-muted-foreground sm:w-72">
            {activeBrand.domain}
          </div>
          <span className="hidden h-5 w-5 items-center justify-center rounded text-muted-foreground sm:flex">
            <Bell className="h-3 w-3" />
          </span>
        </div>

        <div className="flex text-left">
          {/* Nav rail */}
          <div className="hidden w-44 shrink-0 border-r bg-background/60 p-2.5 sm:block">
            <div className="mb-2 flex items-center justify-between px-2 pt-1">
              <span className="text-[11px] font-bold tracking-tight">{activeBrand.name}</span>
              <Search className="h-3 w-3 text-muted-foreground" />
            </div>
            <ul className="space-y-0.5">
              {RAIL.map((item) => (
                <li
                  key={item.label}
                  className={
                    item.active === true
                      ? 'flex items-center gap-2 rounded-md bg-brand/10 px-2 py-1.5 text-[11px] font-semibold text-brand'
                      : 'flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground'
                  }
                >
                  <item.icon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{item.label}</span>
                  {item.label === 'Actions' ? (
                    <span className="ml-auto rounded-full bg-brand/15 px-1.5 text-[9px] font-semibold text-brand">
                      3
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          {/* Main pane */}
          <div className="min-w-0 flex-1 bg-muted/30 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-bold tracking-tight">Actions</p>
                <p className="text-[10px] text-muted-foreground">All sites · this month</p>
              </div>
              <span className="rounded-lg bg-brand px-2.5 py-1.5 text-[10px] font-semibold text-brand-foreground">
                New action
              </span>
            </div>

            {/* Stat tiles */}
            <div className="mt-3.5 grid grid-cols-3 gap-2.5">
              {STATS.map((stat) => (
                <div key={stat.label} className="rounded-xl border bg-card px-3 py-2.5">
                  <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                    {stat.label}
                  </p>
                  <p
                    className={
                      stat.tone === 'amber'
                        ? 'mt-0.5 text-lg font-bold tracking-tight text-amber-600 dark:text-amber-400'
                        : 'mt-0.5 text-lg font-bold tracking-tight'
                    }
                  >
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Register rows */}
            <div className="mt-3 overflow-hidden rounded-xl border bg-card">
              {ROWS.map((row, i) => (
                <div
                  key={row.title}
                  className={
                    i === 0
                      ? 'flex items-center gap-3 px-3.5 py-2.5'
                      : 'flex items-center gap-3 border-t px-3.5 py-2.5'
                  }
                >
                  <span
                    className={
                      row.tone === 'amber'
                        ? 'h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500'
                        : row.tone === 'ok'
                          ? 'h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500'
                          : 'h-1.5 w-1.5 shrink-0 rounded-full bg-brand'
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-semibold">{row.title}</p>
                    <p className="truncate text-[9.5px] text-muted-foreground">{row.meta}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${CHIP_TONES[row.tone]}`}
                  >
                    {row.chip}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Floating accents — hidden on small screens. */}
      <div className="absolute -left-10 top-16 hidden w-44 rounded-xl border bg-card p-3 shadow-xl lg:block">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Siren className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className="text-[10px] font-bold leading-tight">RIDDOR deadline</p>
            <p className="text-[9px] text-muted-foreground">IN-0027 · 6 days left</p>
          </div>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-2/5 rounded-full bg-amber-500" />
        </div>
      </div>
      <div className="absolute -right-8 bottom-14 hidden w-44 rounded-xl border bg-card p-3 shadow-xl lg:block">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <FileSignature className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className="text-[10px] font-bold leading-tight">Permit issued</p>
            <p className="text-[9px] text-muted-foreground">Hot work · gas tests in range</p>
          </div>
        </div>
      </div>
    </div>
  );
}
