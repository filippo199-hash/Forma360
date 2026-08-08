'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  defaultRefinement,
  type SandboxScenario,
  type SandboxScenarioId,
} from '@forma360/shared/sandbox-scenarios';
import { buildingStepsFor, TRY_PAGE, TRY_TILES } from '../../content/try';

/**
 * The two-tap door into a try-it-now workspace (ADR 0017).
 *
 * Level 1 is a grid of jobs; picking one expands its refinement *in
 * place* rather than navigating, so going back costs nothing and the
 * whole thing reads as one decision with a follow-up rather than a
 * two-page form. The default refinement is pre-selected, so a hurried
 * visitor taps twice: tile, then Build.
 *
 * The build step is not a spinner. It quotes their choice back and
 * narrates what is being created, because those few seconds are the
 * difference between feeling dropped somewhere random and feeling
 * served. The steps are honest — they describe rows we actually write.
 *
 * Which tile is open lives in the URL (`?tile=<id>`) and the level-1
 * control is an anchor, not a button. That is not a routing preference:
 * `/try` is every visitor's first cold load and it inherits the whole
 * signed-in client runtime, so the tiles paint looking ready a few
 * hundred milliseconds before their handlers exist — and React discards,
 * without replaying, a discrete event that arrives before hydration. The
 * first click on a tile did nothing and the second worked. A link needs
 * no JavaScript to be right.
 */
export function ScenarioPicker({
  locale,
  scenarios,
  initialSelected = null,
}: {
  locale: string;
  scenarios: readonly SandboxScenario[];
  /** Server-resolved from `?tile=`, so the open tile survives no-JS. */
  initialSelected?: SandboxScenarioId | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<SandboxScenarioId | null>(initialSelected);
  const [refinementId, setRefinementId] = useState<string | null>(() => {
    if (initialSelected === null) return null;
    const s = scenarios.find((x) => x.id === initialSelected);
    return s === undefined ? null : (defaultRefinement(s)?.id ?? null);
  });
  const [phase, setPhase] = useState<'choose' | 'building' | 'error'>('choose');
  const [errorMessage, setErrorMessage] = useState<string>(TRY_PAGE.errorBody);
  const [step, setStep] = useState(0);

  const scenario = scenarios.find((s) => s.id === selected) ?? null;
  const copy = selected === null ? null : TRY_TILES[selected];

  function choose(id: SandboxScenarioId): void {
    const next = scenarios.find((s) => s.id === id);
    if (next === undefined) return;
    setSelected(id);
    setRefinementId(defaultRefinement(next)?.id ?? null);
  }

  function reset(): void {
    setSelected(null);
    setRefinementId(null);
    setPhase('choose');
    setStep(0);
  }

  async function build(): Promise<void> {
    if (scenario === null || refinementId === null || copy === null) return;
    // A second click would provision a second tenant and orphan the
    // first — only the last response's cookie survives. The phase guard
    // is the real fix; `disabled` alone loses the race on a fast
    // double-click.
    if (phase === 'building') return;
    setPhase('building');
    setStep(0);

    // Advance the narration on a timer. It is capped one short of the
    // final step so the list never claims to be finished before the
    // server says it is.
    const stepCount = buildingStepsFor(copy, refinementId).length;
    const ticker = setInterval(() => {
      setStep((s) => Math.min(s + 1, stepCount - 1));
    }, 700);

    try {
      const response = await fetch('/api/sandbox/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: scenario.id, refinementId }),
      });

      if (response.status === 429) {
        clearInterval(ticker);
        setErrorMessage(TRY_PAGE.rateLimited);
        setPhase('error');
        return;
      }
      if (response.status === 409) {
        clearInterval(ticker);
        router.push(`/${locale}/ai`);
        return;
      }
      if (!response.ok) {
        clearInterval(ticker);
        setErrorMessage(TRY_PAGE.errorBody);
        setPhase('error');
        return;
      }

      const body: unknown = await response.json();
      const landingPath =
        typeof body === 'object' && body !== null && 'landingPath' in body
          ? (body as { landingPath: unknown }).landingPath
          : null;
      clearInterval(ticker);
      setStep(stepCount);

      // Hard navigation: the session cookie was just set on this
      // response, and a full load is what makes every server component
      // downstream see it.
      window.location.assign(
        typeof landingPath === 'string' ? `/${locale}${landingPath}` : `/${locale}/ai`,
      );
    } catch {
      clearInterval(ticker);
      setErrorMessage(TRY_PAGE.errorBody);
      setPhase('error');
    }
  }

  if (phase === 'building' && copy !== null) {
    return (
      <div className="mx-auto max-w-xl text-left" aria-live="polite">
        <h2 className="font-display text-2xl font-bold tracking-tight">{TRY_PAGE.buildingTitle}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {copy.label} — {copy.refinements[refinementId ?? ''] ?? ''}
        </p>
        <ul className="mt-8 space-y-3">
          {buildingStepsFor(copy, refinementId).map((text, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <li
                key={text}
                className={`flex items-center gap-3 text-sm transition-opacity ${
                  done || active ? 'opacity-100' : 'opacity-40'
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                    done
                      ? 'border-brand bg-brand text-brand-foreground'
                      : active
                        ? 'border-brand text-brand'
                        : 'border-muted-foreground/30 text-muted-foreground'
                  }`}
                >
                  {done ? '✓' : ''}
                </span>
                <span className={done ? 'text-foreground' : 'text-muted-foreground'}>{text}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-8 text-xs text-muted-foreground">{TRY_PAGE.buildingNote}</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="mx-auto max-w-md text-center">
        <h2 className="font-display text-2xl font-bold tracking-tight">{TRY_PAGE.errorTitle}</h2>
        <p className="mt-3 text-sm text-muted-foreground">{errorMessage}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-brand px-6 text-sm font-semibold text-brand-foreground"
        >
          {TRY_PAGE.errorRetry}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="grid gap-3 sm:grid-cols-2">
        {scenarios.map((s) => {
          const tile = TRY_TILES[s.id];
          const isOpen = selected === s.id;
          return (
            <div
              key={s.id}
              className={`rounded-xl border transition-colors ${
                isOpen ? 'border-brand bg-accent/40 sm:col-span-2' : 'bg-background hover:bg-accent'
              }`}
            >
              <Link
                href={isOpen ? `/${locale}/try` : `/${locale}/try?tile=${s.id}`}
                scroll={false}
                onClick={(e) => {
                  // Once hydrated, keep the in-place expand — going back
                  // must cost nothing. Pre-hydration this handler does
                  // not exist and the href does the work instead.
                  e.preventDefault();
                  if (isOpen) reset();
                  else choose(s.id);
                  window.history.replaceState(
                    null,
                    '',
                    isOpen ? `/${locale}/try` : `/${locale}/try?tile=${s.id}`,
                  );
                }}
                aria-expanded={isOpen}
                className="flex w-full flex-col items-start gap-1 p-5 text-left"
              >
                <span className="font-display text-base font-semibold tracking-tight">
                  {tile.label}
                </span>
                <span className="text-sm text-muted-foreground">{tile.blurb}</span>
              </Link>

              {isOpen && (
                <div className="border-t px-5 pb-5 pt-4">
                  <p className="text-sm font-medium">{tile.refineQuestion}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {s.refinements.map((r) => {
                      const active = refinementId === r.id;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setRefinementId(r.id)}
                          aria-pressed={active}
                          className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                            active
                              ? 'border-brand bg-brand text-brand-foreground'
                              : 'bg-background hover:bg-accent'
                          }`}
                        >
                          {tile.refinements[r.id] ?? r.id}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void build()}
                      disabled={refinementId === null || phase === 'building'}
                      className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-6 text-sm font-semibold text-brand-foreground shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                    >
                      {TRY_PAGE.continueCta}
                    </button>
                    <button
                      type="button"
                      onClick={reset}
                      className="text-sm text-muted-foreground underline underline-offset-4"
                    >
                      {TRY_PAGE.backCta}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">{TRY_PAGE.footNote}</p>
    </div>
  );
}
