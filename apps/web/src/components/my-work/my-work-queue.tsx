'use client';

import {
  BadgeCheck,
  Bell,
  CheckCircle2,
  ClipboardCheck,
  Crosshair,
  FileSignature,
  GraduationCap,
  ListChecks,
  Settings2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../../lib/cn';
import { primaryReason, rankFocus, type FocusRule } from '../../lib/focus-ranking';
import { trpc } from '../../lib/trpc/client';

/**
 * "My work" (ADR 0014) — the single queue of everything waiting on the
 * signed-in user, merged across modules and sorted by how late it is.
 *
 * The dashboard answers "how is the organisation doing" and needs
 * `analytics.view`; most people who open the product every morning do not
 * hold it and were landing on a menu of registers instead of a to-do
 * list. This page is the answer to "what do I do next", and it is the
 * default landing surface for every signed-in user.
 *
 * The navigation review turned the single "My work" menu entry into two
 * personal doors — *My actions* and *My acknowledgements* — because for
 * the majority of users those two rows are the whole product. They are
 * real routes rather than query strings so each can light up on its own
 * and be linked to directly; this component backs all three.
 */

type Kind = 'action' | 'acknowledgement' | 'signature' | 'inspection' | 'approval' | 'training';

const KIND_ICON: Record<Kind, LucideIcon> = {
  training: GraduationCap,
  action: ListChecks,
  acknowledgement: Bell,
  signature: FileSignature,
  inspection: ClipboardCheck,
  approval: BadgeCheck,
};

const FILTERS: readonly (Kind | 'all')[] = [
  'all',
  'action',
  'training',
  'acknowledgement',
  'signature',
  'inspection',
  'approval',
];

/**
 * One number of the scoreboard, and a shortcut into the queue below (UI
 * review item 5). The tile row used to read as a second filter system
 * stacked on the chip row while doing nothing at all; now a tap applies
 * the matching kind filter, and the chip row remains the single visible
 * filter state. A zero renders muted so the count that needs attention is
 * the one the eye lands on — four equal-weight zeros light up nothing.
 */
function SummaryTile({
  label,
  value,
  alert = false,
  loading,
  onSelect,
}: {
  label: string;
  value: number;
  alert?: boolean;
  loading: boolean;
  onSelect: () => void;
}) {
  const zero = value === 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="rounded-lg border bg-card text-left text-card-foreground shadow-sm transition-colors hover:bg-muted/50"
    >
      <CardContent className="p-4">
        {loading ? (
          <Skeleton className="h-8 w-12" />
        ) : (
          <p
            className={cn(
              'text-3xl font-semibold tabular-nums tracking-tight',
              alert && value > 0 ? 'text-destructive' : undefined,
              zero ? 'text-muted-foreground' : undefined,
            )}
          >
            {value}
          </p>
        )}
        <p className={cn('mt-1 text-sm font-medium', zero ? 'text-muted-foreground' : undefined)}>
          {label}
        </p>
      </CardContent>
    </button>
  );
}

export function MyWorkQueue({
  initialFilter = 'all',
  titleKey = 'title',
}: {
  initialFilter?: Kind | 'all';
  /** `myWork.*` key for the heading — the personal doors name themselves. */
  titleKey?: string;
  /** G4: the description sub-line is no longer rendered; accepted for callers. */
  subtitleKey?: string;
} = {}) {
  const t = useTranslations('myWork');
  const format = useFormatter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale;
  const [filter, setFilter] = useState<Kind | 'all'>(initialFilter);
  const [tuneOpen, setTuneOpen] = useState(false);

  // Focus belongs to the MAIN My-work door only. The personal sub-pages
  // (My actions, My acknowledgements) mount this component with an
  // initialFilter, and a cross-kind Focus block leading "My
  // acknowledgements" with action rows read as the wrong page.
  const showFocus = initialFilter === 'all';

  const counts = trpc.myWork.counts.useQuery();
  const list = trpc.myWork.list.useQuery(
    filter === 'all' ? { limit: 100 } : { limit: 100, kinds: [filter] },
  );
  // Focus ranks across EVERY kind, whatever the filter below shows.
  // When the filter is 'all' this is the same query key — one request.
  const focusList = trpc.myWork.list.useQuery({ limit: 100 }, { enabled: showFocus });
  const priorities = trpc.myWork.listPriorities.useQuery(undefined, { enabled: showFocus });

  const rows = list.data?.rows ?? [];
  const c = counts.data;

  const focusRules: FocusRule[] = (priorities.data ?? []).map((r) => ({
    id: r.id,
    ruleType: r.ruleType,
    value: r.value,
    direction: r.direction,
    note: r.note,
  }));
  const focusRanked =
    focusList.data !== undefined
      ? rankFocus(focusList.data.rows, focusRules, new Date()).slice(0, 6)
      : null;

  const fmt = (date: Date): string =>
    format.dateTime(new Date(date), { day: 'numeric', month: 'short' });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t(titleKey as never)}</h1>
      </header>

      {/* ── Focus (review round 4): the ranked head of the queue — what
          to do FIRST, across every kind, with the why on each row. The
          user teaches it in Tune; ranking is deterministic
          (focus-ranking.ts), never a model. Main door only. ── */}
      {showFocus ? (
        <section className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Crosshair className="h-4 w-4 text-primary" aria-hidden />
              {t('focus.title')}
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setTuneOpen(true)}>
              <Settings2 className="mr-1.5 h-4 w-4" aria-hidden />
              {t('focus.tune')}
            </Button>
          </div>
          {focusRanked === null ? (
            <Skeleton className="h-24 w-full" />
          ) : focusRanked.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                {t('focus.empty')}
              </CardContent>
            </Card>
          ) : (
            <ol className="divide-y rounded-lg border bg-card">
              {focusRanked.map(({ row, reasons }, index) => {
                const Icon = KIND_ICON[row.kind];
                const reason = primaryReason(reasons);
                return (
                  <li key={`${row.kind}-${row.id}`}>
                    <Link
                      href={`/${locale}${row.href}`}
                      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
                    >
                      <span className="w-5 shrink-0 text-center font-mono text-xs text-muted-foreground">
                        {index + 1}
                      </span>
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{row.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {t(`kinds.${row.kind}`)}
                          {row.dueAt !== null ? ` · ${fmt(row.dueAt)}` : ''}
                        </span>
                      </span>
                      {reason !== null ? (
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                            reason.kind === 'overdue'
                              ? 'bg-red-100 text-red-900 dark:bg-red-950/60 dark:text-red-200'
                              : reason.kind === 'dueToday'
                                ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200'
                                : reason.kind === 'boosted'
                                  ? 'bg-primary/10 text-primary'
                                  : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {reason.kind === 'boosted' && reason.note !== ''
                            ? reason.note
                            : t(`focus.reasons.${reason.kind}` as never)}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ) : null}

      <FocusTuneDialog open={tuneOpen} onOpenChange={setTuneOpen} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Overdue items are actions, and the queue already sorts latest-
            first, so both action tiles land on the action filter with the
            overdue rows on top. */}
        <SummaryTile
          label={t('tiles.overdue')}
          value={c?.myOverdueActions ?? 0}
          alert
          loading={counts.isPending}
          onSelect={() => setFilter('action')}
        />
        <SummaryTile
          label={t('tiles.actions')}
          value={c?.myOpenActions ?? 0}
          loading={counts.isPending}
          onSelect={() => setFilter('action')}
        />
        <SummaryTile
          label={t('tiles.acknowledgements')}
          value={c?.myPendingAcks ?? 0}
          loading={counts.isPending}
          onSelect={() => setFilter('acknowledgement')}
        />
        <SummaryTile
          label={t('tiles.drafts')}
          value={c?.myDraftInspections ?? 0}
          loading={counts.isPending}
          onSelect={() => setFilter('inspection')}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label={t('filterLabel')}>
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              filter === key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-muted',
            )}
          >
            {t(`kinds.${key}`)}
          </button>
        ))}
      </div>

      {list.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">{t('empty.title')}</p>
            <p className="text-sm text-muted-foreground">{t('empty.body')}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {rows.map((row) => {
            const Icon = KIND_ICON[row.kind];
            return (
              <li key={`${row.kind}-${row.id}`}>
                <Link
                  href={`/${locale}${row.href}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{row.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t(`kinds.${row.kind}`)}
                    </span>
                  </span>
                  {row.dueAt !== null ? (
                    <span
                      className={cn(
                        'shrink-0 text-xs tabular-nums',
                        row.overdue ? 'font-semibold text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {row.overdue ? t('overdueOn', { date: fmt(row.dueAt) }) : fmt(row.dueAt)}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Tune Focus (review round 4) ─────────────────────────────────────────────

/**
 * Where the user teaches Focus: "this kind of work matters more to me",
 * "sink anything mentioning X". Each entry is a stored rule the ranking
 * compiles in on every render — add, read back in your own words,
 * remove. Capped server-side at 20.
 */
function FocusTuneDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('myWork');
  const utils = trpc.useUtils();
  const priorities = trpc.myWork.listPriorities.useQuery(undefined, { enabled: open });

  const [direction, setDirection] = useState<'boost' | 'demote'>('boost');
  const [ruleType, setRuleType] = useState<'kind' | 'keyword'>('kind');
  const [kindValue, setKindValue] = useState<Kind>('action');
  const [keywordValue, setKeywordValue] = useState('');
  const [note, setNote] = useState('');

  const add = trpc.myWork.addPriority.useMutation({
    onSuccess: () => {
      setKeywordValue('');
      setNote('');
      void utils.myWork.listPriorities.invalidate();
    },
  });
  const remove = trpc.myWork.removePriority.useMutation({
    onSuccess: () => void utils.myWork.listPriorities.invalidate(),
  });

  const describeRule = (rule: {
    ruleType: 'kind' | 'keyword';
    value: string;
    direction: 'boost' | 'demote';
    note: string;
  }): string => {
    const what = rule.ruleType === 'kind' ? t(`kinds.${rule.value as Kind}`) : `“${rule.value}”`;
    return rule.direction === 'boost'
      ? t('focus.ruleBoost', { what })
      : t('focus.ruleDemote', { what });
  };

  const canAdd = !add.isPending && (ruleType === 'kind' ? true : keywordValue.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('focus.tuneTitle')}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t('focus.tuneHint')}</p>

        {priorities.data !== undefined && priorities.data.length > 0 ? (
          <ul className="space-y-1">
            {priorities.data.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate">{describeRule(rule)}</span>
                  {rule.note !== '' ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {rule.note}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  aria-label={t('focus.removeRule')}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ id: rule.id })}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('focus.noRules')}</p>
        )}

        <div className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap gap-2">
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'boost' | 'demote')}
              aria-label={t('focus.directionLabel')}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="boost">{t('focus.directionBoost')}</option>
              <option value="demote">{t('focus.directionDemote')}</option>
            </select>
            <select
              value={ruleType}
              onChange={(e) => setRuleType(e.target.value as 'kind' | 'keyword')}
              aria-label={t('focus.ruleTypeLabel')}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="kind">{t('focus.ruleTypeKind')}</option>
              <option value="keyword">{t('focus.ruleTypeKeyword')}</option>
            </select>
            {ruleType === 'kind' ? (
              <select
                value={kindValue}
                onChange={(e) => setKindValue(e.target.value as Kind)}
                aria-label={t('focus.kindLabel')}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {FILTERS.filter((k): k is Kind => k !== 'all').map((k) => (
                  <option key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={keywordValue}
                onChange={(e) => setKeywordValue(e.target.value)}
                placeholder={t('focus.keywordPlaceholder')}
                aria-label={t('focus.keywordPlaceholder')}
                className="h-9 w-40"
              />
            )}
          </div>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('focus.notePlaceholder')}
            aria-label={t('focus.notePlaceholder')}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!canAdd}
              onClick={() =>
                add.mutate({
                  ruleType,
                  value: ruleType === 'kind' ? kindValue : keywordValue.trim(),
                  direction,
                  note: note.trim(),
                })
              }
            >
              {t('focus.addRule')}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('focus.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
