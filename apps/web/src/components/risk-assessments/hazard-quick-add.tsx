'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { searchHazardLibrary, type HazardTemplate } from '../../lib/hazard-library';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

/** Server-side Zod limit on the hazard name (`hazardInput.hazard`). */
const HAZARD_NAME_MAX = 500;

/**
 * Hazard capture with library autocomplete. Typing shows matching entries
 * from the curated hazard library; picking one pre-fills the ENTIRE hazard
 * card (harm, affected groups, tiered controls, initial + residual scores)
 * so the assessor only confirms and tailors. Plain Enter still adds exactly
 * what was typed. Focusing the empty input shows the top library picks —
 * that's how new users discover the library exists.
 *
 * NR-01 — the rapid-entry data-loss bug, and why this component must never
 * block input. The first version set `disabled={busy}` on the input while a
 * save was in flight. Disabling a focused element BLURS it, so the second
 * hazard of a fast burst was typed into nothing: no keystrokes landed, no
 * POST fired, and the assessor lost 7 of 9 hazards with no error anywhere —
 * silent loss on a legal record, network-confirmed by four testers. The
 * rules now:
 *   - the input is never disabled and never loses focus on save;
 *   - each Enter captures its text, clears the box synchronously, and fires
 *     an independent mutation — bursts run concurrently;
 *   - a failed save is NEVER silent: the exact text is put back in the box
 *     (or named in a sticky toast when the box is already busy again).
 */
export function HazardQuickAdd({
  assessmentId,
  onAdded,
}: {
  assessmentId: string;
  onAdded: () => void;
}) {
  const t = useTranslations('riskAssessments');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [inFlight, setInFlight] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addHazard = trpc.riskAssessments.addHazard.useMutation();
  const addControl = trpc.riskAssessments.addControl.useMutation();

  const matches = open ? searchHazardLibrary(q) : [];

  function close(): void {
    setOpen(false);
    setHighlight(-1);
  }

  /** A failed add must never vanish: restore the text if the box is free. */
  function surfaceFailure(name: string): void {
    let restored = false;
    setQ((current) => {
      if (current.trim().length === 0) {
        restored = true;
        return name;
      }
      return current;
    });
    // The state updater runs before the toast renders, so `restored` is
    // settled by the time the copy is chosen on the next tick.
    setTimeout(() => {
      toast.error(t(restored ? 'hazards.addFailedRestored' : 'hazards.addFailedNamed', { name }), {
        duration: 10_000,
      });
    }, 0);
  }

  async function createPlain(): Promise<void> {
    const name = q.trim();
    if (name.length === 0) return;
    // Clear synchronously so the next hazard can be typed immediately —
    // the save happens behind the keystrokes, not in front of them.
    setQ('');
    close();
    setInFlight((n) => n + 1);
    try {
      await addHazard.mutateAsync({
        assessmentId,
        hazard: name,
        harmDescription: '',
        affectedGroups: ['employees'],
        existingControls: '',
      });
      onAdded();
    } catch {
      surfaceFailure(name);
    } finally {
      setInFlight((n) => n - 1);
    }
  }

  async function createFromTemplate(tpl: HazardTemplate): Promise<void> {
    setQ('');
    close();
    setInFlight((n) => n + 1);
    try {
      const { hazardId } = await addHazard.mutateAsync({
        assessmentId,
        hazard: tpl.label,
        harmDescription: tpl.harmDescription,
        affectedGroups: [...tpl.affectedGroups],
        existingControls: tpl.existingControls,
        initialLikelihood: tpl.initial.likelihood,
        initialSeverity: tpl.initial.severity,
        residualLikelihood: tpl.residual.likelihood,
        residualSeverity: tpl.residual.severity,
      });
      for (const control of tpl.controls) {
        await addControl.mutateAsync({
          hazardId,
          description: control.description,
          tier: control.tier,
          status: 'in_place',
        });
      }
      onAdded();
      toast.success(t('hazards.prefilledToast'));
    } catch {
      surfaceFailure(tpl.label);
    } finally {
      setInFlight((n) => n - 1);
    }
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <Input
          value={q}
          // BUG-24: the server refuses names past 500 characters with a bare
          // 400 — cap the box instead of letting a paste fail after the fact.
          maxLength={HAZARD_NAME_MAX}
          placeholder={t('hazards.quickAddPlaceholder')}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setHighlight(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay so a mousedown on a suggestion wins over the blur.
            blurTimer.current = setTimeout(close, 150);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setHighlight((h) => (matches.length === 0 ? -1 : (h + 1) % matches.length));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) =>
                matches.length === 0 ? -1 : (h - 1 + matches.length) % matches.length,
              );
            } else if (e.key === 'Escape') {
              close();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const picked = highlight >= 0 ? matches[highlight] : undefined;
              if (picked !== undefined) {
                void createFromTemplate(picked);
              } else {
                void createPlain();
              }
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={q.trim().length === 0}
          onClick={() => void createPlain()}
        >
          {t('hazards.add')}
        </Button>
      </div>

      {inFlight > 0 ? (
        <p aria-live="polite" className="mt-1 text-xs text-muted-foreground">
          {t('hazards.savingCount', { count: inFlight })}
        </p>
      ) : null}

      {open && matches.length > 0 ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-background shadow-md">
          <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">
            {t('hazards.suggestionsLabel')}
          </p>
          <ul>
            {matches.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={`block w-full px-3 py-2 text-left text-sm transition-colors ${
                    i === highlight ? 'bg-accent' : 'hover:bg-accent'
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (blurTimer.current !== null) clearTimeout(blurTimer.current);
                    void createFromTemplate(m);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                >
                  <span className="block font-medium">{m.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {m.harmDescription}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
            {t('hazards.plainEnterHint')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
