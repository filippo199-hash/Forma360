'use client';

/**
 * The incident journey strip: six labelled steps showing what is done,
 * where the record is now, and what is still ahead — plus ONE "Next"
 * callout naming the single act that moves it forward, with the button
 * that performs it.
 *
 * Why it exists: a practitioner looking at a live incident could not
 * tell where in the process they were, and a red RIDDOR banner told
 * them to "record it here" with no control anywhere in sight. Both the
 * strip and the callout read from `buildIncidentJourney`, so they can
 * never disagree with each other.
 *
 * Every step and the callout are derived state — the buttons call the
 * page's existing handlers, and the server re-checks every permission.
 */
import { Check, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JourneyNext, JourneyStep } from './journey';
import { Button } from '../ui/button';

export function JourneyStepper({
  steps,
  next,
  action,
}: {
  steps: readonly JourneyStep[];
  next: JourneyNext | null;
  /**
   * The control for the next act. Null when the viewer cannot perform
   * it — the callout still SAYS what has to happen (so a reporter knows
   * what they are waiting on), it just carries no button.
   */
  action: { label: string; onClick: () => void } | null;
}) {
  const t = useTranslations('incidents.journey');

  return (
    <div className="space-y-2">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
        {steps.map((step, index) => {
          const done = step.state === 'done';
          const current = step.state === 'current';
          const alarm = step.alarm === true;
          const duty = step.duty === true;
          return (
            <li key={step.key} className="flex items-center gap-1">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                  alarm
                    ? 'bg-red-100 text-red-900 ring-1 ring-red-300 dark:bg-red-950/60 dark:text-red-200 dark:ring-red-800'
                    : duty
                      ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200'
                      : current
                        ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
                        : done
                          ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
                          : 'bg-muted text-muted-foreground'
                }`}
              >
                {done ? <Check className="h-3 w-3" aria-hidden /> : null}
                {t(`steps.${step.key}` as never)}
                {current ? <span className="sr-only">{t('youAreHere')}</span> : null}
              </span>
              {index < steps.length - 1 ? (
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>

      {next !== null ? (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 ${
            next.kind === 'submitRiddorOverdue'
              ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
              : 'bg-muted/40'
          }`}
        >
          <p className="text-sm">
            <span className="font-medium">{t('nextLabel')}: </span>
            <span
              className={
                next.kind === 'submitRiddorOverdue' ? 'text-red-900 dark:text-red-200' : ''
              }
            >
              {/* `count` is only read by the completeActions plural; the
                  other messages ignore the extra value. */}
              {t(`next.${next.kind}` as Parameters<typeof t>[0], { count: next.count ?? 0 })}
            </span>
          </p>
          {action !== null ? (
            <Button
              type="button"
              size="sm"
              variant={next.kind === 'submitRiddorOverdue' ? 'default' : 'outline'}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
