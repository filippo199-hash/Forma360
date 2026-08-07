'use client';

/**
 * "We think you'll want these fields" — the confirm step when someone
 * names a new asset category.
 *
 * Typing "Cars" and being handed an empty field builder is where asset
 * registers go wrong: people add two fields, and the register can never
 * answer the questions it exists for. So we propose a starting point and
 * ask.
 *
 * The consent rules this follows, because a suggestion that adds things
 * on your behalf is not a suggestion:
 *   - **Nothing is added until Add is pressed.** Closing, ignoring or
 *     dismissing the panel adds nothing at all.
 *   - Only the near-essential fields arrive pre-ticked; the rest are
 *     offered unticked.
 *   - Every suggestion says *why*, so ticking it is an informed choice.
 *   - Added fields land in the normal editor and stay fully editable —
 *     rename, retype, delete.
 *
 * Suggestions come from the curated library first (instant, free) and
 * from Claude only for categories the library does not know.
 */
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { SuggestedField } from '../../lib/asset-field-library';
import { Button } from '../ui/button';

export function SuggestedFieldsPanel({
  categoryName,
  suggestions,
  source,
  loading,
  onAdd,
  onDismiss,
}: {
  categoryName: string;
  suggestions: ReadonlyArray<SuggestedField>;
  /** Where these came from, so the panel can be honest about it. */
  source: 'library' | 'ai';
  loading: boolean;
  onAdd: (chosen: SuggestedField[]) => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('assets.categories.suggest');
  // Pre-ticked = the recommended ones only. Re-seeded whenever the
  // suggestion set changes, keyed by the panel's remount in the parent.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(suggestions.filter((s) => s.recommended).map((s) => s.key)),
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('thinking', { name: categoryName })}
      </div>
    );
  }

  if (suggestions.length === 0) return null;

  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const chosen = suggestions.filter((s) => checked.has(s.key));

  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {t('title', { count: suggestions.length, name: categoryName })}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {source === 'ai' ? t('subtitleAi') : t('subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('dismiss')}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ul className="space-y-1.5">
        {suggestions.map((s) => (
          <li key={s.key}>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md bg-background/60 p-2.5 text-sm hover:bg-background">
              <input
                type="checkbox"
                checked={checked.has(s.key)}
                onChange={() => toggle(s.key)}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{s.name}</span>
                  <span className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t(`types.${s.fieldType}` as never)}
                  </span>
                  {s.options !== undefined && s.options.length > 0 ? (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {s.options.join(' · ')}
                    </span>
                  ) : null}
                </span>
                {s.hint !== '' ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">{s.hint}</span>
                ) : null}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={chosen.length === 0}
          onClick={() => onAdd(chosen)}
        >
          <Check className="mr-1.5 h-3.5 w-3.5" />
          {t('addChosen', { count: chosen.length })}
        </Button>
        {/* The "no thanks, I'll add them myself" exit the brief asked for. */}
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
          {t('noThanks')}
        </Button>
        <button
          type="button"
          onClick={() =>
            setChecked(
              checked.size === suggestions.length
                ? new Set()
                : new Set(suggestions.map((s) => s.key)),
            )
          }
          className="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {checked.size === suggestions.length ? t('selectNone') : t('selectAll')}
        </button>
      </div>
    </div>
  );
}
