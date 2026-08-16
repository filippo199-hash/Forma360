'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc/client';
import { formatDate } from '../../lib/format-date';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';

const TRIGGERS = [
  'scheduled',
  'incident',
  'process_change',
  'legislation_change',
  'new_equipment',
  'manual',
] as const;

export interface ReviewEntry {
  id: string;
  trigger: (typeof TRIGGERS)[number];
  outcome: 'confirmed' | 'updated';
  note: string;
  reviewedAt: Date;
}

function toDateInputValue(d: Date | null): string {
  if (d === null) return '';
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * HSE step 5 — keep the assessment alive. Shows the schedule (frequency +
 * next due), the review history, and a "record a review" dialog with the
 * trigger that prompted it. Card-less: the detail page hosts it inside
 * the tabbed Review / Distribution card.
 */
export function ReviewSection({
  assessmentId,
  reviewFrequencyMonths,
  nextReviewAt,
  lastReviewedAt,
  reviews,
  canManage,
  onChanged,
}: {
  assessmentId: string;
  reviewFrequencyMonths: number | null;
  nextReviewAt: Date | null;
  lastReviewedAt: Date | null;
  reviews: ReviewEntry[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('riskAssessments');
  const locale = useLocale();
  const [frequency, setFrequency] = useState(
    reviewFrequencyMonths === null ? '' : String(reviewFrequencyMonths),
  );
  const [nextDue, setNextDue] = useState(toDateInputValue(nextReviewAt));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [trigger, setTrigger] = useState<(typeof TRIGGERS)[number]>('scheduled');
  const [outcome, setOutcome] = useState<'confirmed' | 'updated'>('confirmed');
  const [note, setNote] = useState('');

  const update = trpc.riskAssessments.update.useMutation({
    onSuccess: () => {
      toast.success(t('review.savedToast'));
      onChanged();
    },
    onError: () => toast.error(t('saveError')),
  });
  const record = trpc.riskAssessments.recordReview.useMutation({
    onSuccess: () => {
      setDialogOpen(false);
      setNote('');
      onChanged();
    },
    onError: () => toast.error(t('saveError')),
  });

  const overdue = nextReviewAt !== null && new Date(nextReviewAt) <= new Date();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {canManage ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="order-last ml-auto"
            onClick={() => setDialogOpen(true)}
          >
            {t('review.recordButton')}
          </Button>
        ) : null}
        <div className="space-y-1">
          <Label className="text-xs">{t('review.frequencyLabel')}</Label>
          <Input
            type="number"
            min={1}
            max={60}
            className="w-28"
            value={frequency}
            disabled={!canManage}
            onChange={(e) => setFrequency(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('review.nextReviewLabel')}</Label>
          <Input
            type="date"
            className="w-44"
            value={nextDue}
            disabled={!canManage}
            onChange={(e) => setNextDue(e.target.value)}
          />
        </div>
        {canManage ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                assessmentId,
                reviewFrequencyMonths: frequency === '' ? null : Number(frequency),
                nextReviewAt: nextDue === '' ? null : new Date(`${nextDue}T00:00:00.000Z`),
              })
            }
          >
            {t('review.scheduleSave')}
          </Button>
        ) : null}
        {overdue ? (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">
            {t('reviewDue')}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {lastReviewedAt !== null
          ? t('review.lastReviewed', {
              date: formatDate(lastReviewedAt, locale),
            })
          : t('review.neverReviewed')}
      </p>

      <div>
        <p className="mb-1 text-sm font-medium">{t('review.logTitle')}</p>
        {reviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('review.logEmpty')}</p>
        ) : (
          <ul className="space-y-1.5">
            {reviews.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">{formatDate(r.reviewedAt, locale)}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {t(`review.trigger.${r.trigger}`)}
                </span>
                <span>{t(`review.outcome.${r.outcome}`)}</span>
                {r.note.length > 0 ? (
                  <span className="text-muted-foreground">— {r.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('review.dialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('review.triggerLabel')}</Label>
              <Select
                value={trigger}
                onValueChange={(v) => setTrigger(v as (typeof TRIGGERS)[number])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGERS.map((tr) => (
                    <SelectItem key={tr} value={tr}>
                      {t(`review.trigger.${tr}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t('review.outcomeLabel')}</Label>
              <Select
                value={outcome}
                onValueChange={(v) => setOutcome(v as 'confirmed' | 'updated')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirmed">{t('review.outcome.confirmed')}</SelectItem>
                  <SelectItem value="updated">{t('review.outcome.updated')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t('review.noteLabel')}</Label>
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={record.isPending}
              onClick={() => record.mutate({ assessmentId, trigger, outcome, note })}
            >
              {record.isPending ? t('review.saving') : t('review.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
