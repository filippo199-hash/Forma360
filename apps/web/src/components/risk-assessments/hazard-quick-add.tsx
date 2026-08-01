'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { searchHazardLibrary, type HazardTemplate } from '../../lib/hazard-library';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

/**
 * Hazard capture with library autocomplete. Typing shows matching entries
 * from the curated hazard library; picking one pre-fills the ENTIRE hazard
 * card (harm, affected groups, tiered controls, initial + residual scores)
 * so the assessor only confirms and tailors. Plain Enter still adds exactly
 * what was typed. Focusing the empty input shows the top library picks —
 * that's how new users discover the library exists.
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
  const [busy, setBusy] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addHazard = trpc.riskAssessments.addHazard.useMutation();
  const addControl = trpc.riskAssessments.addControl.useMutation();

  const matches = open ? searchHazardLibrary(q) : [];

  function close(): void {
    setOpen(false);
    setHighlight(-1);
  }

  async function createPlain(): Promise<void> {
    const name = q.trim();
    if (name.length === 0 || busy) return;
    setBusy(true);
    try {
      await addHazard.mutateAsync({
        assessmentId,
        hazard: name,
        harmDescription: '',
        affectedGroups: ['employees'],
        existingControls: '',
      });
      setQ('');
      close();
      onAdded();
    } catch {
      toast.error(t('saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function createFromTemplate(tpl: HazardTemplate): Promise<void> {
    if (busy) return;
    setBusy(true);
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
      setQ('');
      close();
      onAdded();
      toast.success(t('hazards.prefilledToast'));
    } catch {
      toast.error(t('saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <Input
          value={q}
          disabled={busy}
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
          disabled={q.trim().length === 0 || busy}
          onClick={() => void createPlain()}
        >
          {t('hazards.add')}
        </Button>
      </div>

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
