'use client';

/**
 * Fire-safety logbook tab (building record): the check calendar with
 * editable rows, a record-a-check dialog and the recent evidence list.
 *
 * Extracted from the building page monolith so the logbook overhaul
 * (editable checks, custom checks, searchable asset link with inline
 * create-asset) stays out of the other tabs' way.
 *
 * Field-usability decisions:
 *   - recording happens in a Dialog, not a form below the table — on a
 *     phone in a plant room the bottom form was off-screen;
 *   - the result choice is three large segmented buttons (pass /
 *     defect found / fail), not a select — glove-sized targets with the
 *     selected state readable at arm's length;
 *   - the offline queue path is preserved: a connectivity failure
 *     enqueues the exact payload, `clientRequestId` dedupes the retry
 *     (PF-10), and the payload carries `checkId` so custom checks
 *     replay correctly.
 */
import { Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  CHECK_FREQUENCIES,
  type CheckDisplayStatus,
  type CheckFrequency,
  type LogbookCheckType,
} from '@forma360/shared/fire-safety';
import { newId } from '@forma360/shared/id';
import { formatDate } from '../../lib/format-date';
import { enqueueOffline, isNetworkError } from '../../lib/offline-queue';
import { useHasPermission } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';
import { cn } from '../../lib/cn';
import { SearchSelect } from '../selectors/search-select';
import { SiteSelector } from '../selectors/site-selector';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { TooltipIconButton } from '../ui/tooltip-icon-button';
import { DueStatusChip, ResultChip } from './chips';

type FireCheckResult = 'pass' | 'defects_found' | 'fail';

export interface LogbookCheckRow {
  id: string;
  checkType: LogbookCheckType;
  label: string;
  frequency: CheckFrequency;
  active: boolean;
  assetId: string | null;
  lastDoneAt: Date | null;
  nextDueAt: Date;
  dueStatus: CheckDisplayStatus;
}

export interface LogbookEntryRow {
  id: string;
  checkId: string | null;
  checkType: LogbookCheckType;
  result: FireCheckResult;
  callPointRef: string;
  performedAt: Date;
  performedByName: string | null;
}

export interface LogbookTabProps {
  buildingId: string;
  locale: string;
  archived: boolean;
  checks: readonly LogbookCheckRow[];
  recentEntries: readonly LogbookEntryRow[];
  /** Refetch the building + logbook queries after a mutation. */
  onInvalidate: () => void;
}

/** yyyy-mm-dd for `<input type="date">`. */
function dateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse a date input as UTC noon so timezones can't shift the day. */
function parseDateInput(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}

/**
 * Parse a *performed-on* date input: same UTC-noon rule, clamped to now,
 * because "today at UTC noon" is a future instant all morning and the
 * router refuses future-dated entries. Never use for due dates — those
 * are legitimately in the future.
 */
function parsePerformedDateInput(value: string): Date {
  const noon = parseDateInput(value);
  const now = new Date();
  return noon.getTime() > now.getTime() ? now : noon;
}

const RESULTS: readonly FireCheckResult[] = ['pass', 'defects_found', 'fail'];

/** Selected-state palette for the big segmented result buttons. */
const RESULT_SELECTED_CLASS: Record<FireCheckResult, string> = {
  pass: 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-200',
  defects_found:
    'border-amber-600 bg-amber-50 text-amber-900 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-200',
  fail: 'border-red-600 bg-red-50 text-red-900 dark:border-red-500 dark:bg-red-950/40 dark:text-red-200',
};

export function LogbookTab({
  buildingId,
  locale,
  archived,
  checks,
  recentEntries,
  onInvalidate,
}: LogbookTabProps) {
  const t = useTranslations('fireSafety');
  const tOffline = useTranslations('offline');
  const utils = trpc.useUtils();

  const canRecord = useHasPermission('fireSafety.record');
  const canManage = useHasPermission('fireSafety.manage');
  const canPickAssets = useHasPermission('assets.view');
  const canManageAssets = useHasPermission('assets.manage');

  // PF-17: link a recurring check to a maintained asset so its service
  // history joins onto the asset page.
  const assetsList = trpc.assets.list.useQuery({}, { enabled: canPickAssets });

  const [recordingCheckId, setRecordingCheckId] = useState<string | null>(null);
  const [editingCheckId, setEditingCheckId] = useState<string | null>(null);
  const [showAddCheck, setShowAddCheck] = useState(false);
  /** Check id the create-asset dialog will link the new asset to. */
  const [createAssetForCheckId, setCreateAssetForCheckId] = useState<string | null>(null);

  const recordingCheck = checks.find((c) => c.id === recordingCheckId) ?? null;
  const editingCheck = checks.find((c) => c.id === editingCheckId) ?? null;
  const checkById = new Map(checks.map((c) => [c.id, c]));

  const updateCheck = trpc.fireSafety.logbook.updateCheck.useMutation({
    onSuccess: () => onInvalidate(),
    onError: () => toast.error(t('saveError')),
  });

  function checkName(check: LogbookCheckRow): string {
    if (check.checkType === 'custom') {
      return check.label !== '' ? check.label : t('checkTypes.custom');
    }
    return t(`checkTypes.${check.checkType}` as never);
  }

  function entryName(entry: LogbookEntryRow): string {
    const check = entry.checkId !== null ? checkById.get(entry.checkId) : undefined;
    if (check !== undefined) return checkName(check);
    if (entry.checkType === 'custom') return t('checkTypes.custom');
    return t(`checkTypes.${entry.checkType}` as never);
  }

  const assetOptions = (assetsList.data ?? []).map((a) => ({
    id: a.id,
    label: a.name,
    sub: a.typeName ?? a.siteName ?? null,
  }));

  function assetSelect(check: LogbookCheckRow) {
    return (
      <SearchSelect
        className="mt-1 max-w-[220px]"
        value={check.assetId}
        onChange={(next) => {
          updateCheck.mutate(
            { checkId: check.id, assetId: next },
            { onSuccess: () => toast.success(t('logbook.assetLinkedToast')) },
          );
        }}
        options={assetOptions}
        placeholder={t('logbook.noLinkedAsset')}
        {...(canManageAssets
          ? {
              footerActionLabel: t('logbook.createAssetAction'),
              onFooterAction: () => setCreateAssetForCheckId(check.id),
            }
          : {})}
      />
    );
  }

  return (
    <section className="space-y-5">
      {canManage && !archived ? (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setShowAddCheck(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            {t('logbook.addCheck')}
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border bg-card text-card-foreground shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">{t('logbook.columns.check')}</th>
              <th className="px-3 py-2 font-medium">{t('logbook.columns.frequency')}</th>
              <th className="px-3 py-2 font-medium">{t('logbook.columns.lastDone')}</th>
              <th className="px-3 py-2 font-medium">{t('logbook.columns.nextDue')}</th>
              <th className="px-3 py-2 font-medium">{t('logbook.columns.status')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {checks
              .filter((c) => c.active)
              .map((check) => (
                <tr key={check.id} className="border-b align-top last:border-b-0">
                  <td className="px-3 py-2.5 font-medium">
                    {checkName(check)}
                    {canManage && canPickAssets ? (
                      assetSelect(check)
                    ) : check.assetId !== null ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t('logbook.linkedAssetLine', {
                          name:
                            (assetsList.data ?? []).find((a) => a.id === check.assetId)?.name ??
                            check.assetId,
                        })}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5">{t(`frequencies.${check.frequency}` as never)}</td>
                  <td className="px-3 py-2.5">{formatDate(check.lastDoneAt, locale)}</td>
                  <td className="px-3 py-2.5">{formatDate(check.nextDueAt, locale)}</td>
                  <td className="px-3 py-2.5">
                    <DueStatusChip status={check.dueStatus} />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {canManage && !archived ? (
                        <TooltipIconButton
                          icon={Pencil}
                          label={t('logbook.editCheck')}
                          onClick={() => setEditingCheckId(check.id)}
                        />
                      ) : null}
                      {canRecord && !archived ? (
                        <Button
                          size="sm"
                          variant={check.dueStatus === 'overdue' ? 'default' : 'outline'}
                          onClick={() => setRecordingCheckId(check.id)}
                        >
                          {t('logbook.recordButton')}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {recordingCheck !== null ? (
        <RecordEntryDialog
          key={recordingCheck.id}
          buildingId={buildingId}
          check={recordingCheck}
          checkTitle={checkName(recordingCheck)}
          onClose={() => setRecordingCheckId(null)}
          onInvalidate={onInvalidate}
          t={t}
          tOffline={tOffline}
        />
      ) : null}

      {editingCheck !== null ? (
        <EditCheckDialog
          key={editingCheck.id}
          check={editingCheck}
          checkTitle={checkName(editingCheck)}
          assetOptions={assetOptions}
          canPickAssets={canPickAssets}
          canManageAssets={canManageAssets}
          onCreateAsset={() => setCreateAssetForCheckId(editingCheck.id)}
          onClose={() => setEditingCheckId(null)}
          onInvalidate={onInvalidate}
          t={t}
        />
      ) : null}

      {showAddCheck ? (
        <AddCheckDialog
          buildingId={buildingId}
          assetOptions={assetOptions}
          canPickAssets={canPickAssets}
          onClose={() => setShowAddCheck(false)}
          onInvalidate={onInvalidate}
          t={t}
        />
      ) : null}

      {createAssetForCheckId !== null ? (
        <CreateAssetDialog
          checkId={createAssetForCheckId}
          onClose={() => setCreateAssetForCheckId(null)}
          onLinked={() => {
            void utils.assets.list.invalidate();
            onInvalidate();
          }}
          t={t}
        />
      ) : null}

      <div>
        <h2 className="mb-2 text-sm font-semibold">{t('logbook.recentHeading')}</h2>
        {recentEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('logbook.noEntries')}</p>
        ) : (
          <ul className="space-y-1.5">
            {recentEntries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
              >
                <ResultChip result={entry.result} />
                <span className="font-medium">{entryName(entry)}</span>
                {entry.callPointRef !== '' ? (
                  <span className="text-xs text-muted-foreground">{entry.callPointRef}</span>
                ) : null}
                <span className="ml-auto text-xs text-muted-foreground">
                  {entry.performedByName ?? ''} · {formatDate(entry.performedAt, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

type Translator = ReturnType<typeof useTranslations>;

interface AssetOption {
  id: string;
  label: string;
  sub: string | null;
}

// ─── Record dialog ──────────────────────────────────────────────────────────

function RecordEntryDialog({
  buildingId,
  check,
  checkTitle,
  onClose,
  onInvalidate,
  t,
  tOffline,
}: {
  buildingId: string;
  check: LogbookCheckRow;
  checkTitle: string;
  onClose: () => void;
  onInvalidate: () => void;
  t: Translator;
  tOffline: Translator;
}) {
  const [result, setResult] = useState<FireCheckResult>('pass');
  const [date, setDate] = useState(dateInputValue(new Date()));
  const [callPoint, setCallPoint] = useState('');
  const [notes, setNotes] = useState('');
  const [defects, setDefects] = useState('');
  const [raiseAction, setRaiseAction] = useState(true);

  const recordEntry = trpc.fireSafety.logbook.recordEntry.useMutation({
    onSuccess: () => {
      toast.success(t('logbook.recordedToast'));
      onClose();
      onInvalidate();
    },
    // PF-10: a plant-room alarm test must survive a dead spot — connectivity
    // failures queue the exact payload (clientRequestId dedupes the retry).
    onError: (err, variables) => {
      if (isNetworkError(err)) {
        enqueueOffline('fire-log-entry', variables as unknown as Record<string, unknown>);
        toast.success(tOffline('queuedToast'));
        onClose();
        return;
      }
      toast.error(t('saveError'));
    },
  });

  function submit(): void {
    recordEntry.mutate({
      buildingId,
      checkId: check.id,
      result,
      performedAt: parsePerformedDateInput(date),
      callPointRef: callPoint,
      notes,
      defectsSummary: defects,
      raiseAction: raiseAction && result !== 'pass',
      clientRequestId: newId(),
    });
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('logbook.recordHeading', { check: checkTitle })}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className="text-sm font-medium">{t('logbook.resultPrompt')}</span>
            <div className="grid grid-cols-3 gap-2">
              {RESULTS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setResult(r)}
                  aria-pressed={result === r}
                  className={cn(
                    'rounded-lg border-2 px-2 py-4 text-center text-sm font-semibold transition-colors',
                    result === r
                      ? RESULT_SELECTED_CLASS[r]
                      : 'border-input bg-background text-muted-foreground hover:bg-accent/40',
                  )}
                >
                  {t(`results.${r}` as never)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="entry-date">{t('logbook.performedAt')}</Label>
              <Input
                id="entry-date"
                type="date"
                value={date}
                max={dateInputValue(new Date())}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            {check.checkType === 'alarm_test' ? (
              <div className="space-y-1.5">
                <Label htmlFor="entry-callpoint">{t('logbook.callPoint')}</Label>
                <Input
                  id="entry-callpoint"
                  value={callPoint}
                  onChange={(e) => setCallPoint(e.target.value)}
                  placeholder={t('logbook.callPointPlaceholder')}
                />
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="entry-notes">{t('logbook.notes')}</Label>
            <Textarea
              id="entry-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {result !== 'pass' ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="entry-defects">{t('logbook.defects')}</Label>
                <Textarea
                  id="entry-defects"
                  rows={2}
                  value={defects}
                  onChange={(e) => setDefects(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={raiseAction}
                  onChange={(e) => setRaiseAction(e.target.checked)}
                  className="h-4 w-4"
                />
                {t('logbook.raiseAction')}
              </label>
            </>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={submit} disabled={recordEntry.isPending}>
            {t('logbook.saveEntry')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit dialog ────────────────────────────────────────────────────────────

function EditCheckDialog({
  check,
  checkTitle,
  assetOptions,
  canPickAssets,
  canManageAssets,
  onCreateAsset,
  onClose,
  onInvalidate,
  t,
}: {
  check: LogbookCheckRow;
  checkTitle: string;
  assetOptions: readonly AssetOption[];
  canPickAssets: boolean;
  canManageAssets: boolean;
  onCreateAsset: () => void;
  onClose: () => void;
  onInvalidate: () => void;
  t: Translator;
}) {
  const [frequency, setFrequency] = useState<CheckFrequency>(check.frequency);
  const initialDue = dateInputValue(check.nextDueAt);
  const [nextDue, setNextDue] = useState(initialDue);
  const [label, setLabel] = useState(check.label);
  const [assetId, setAssetId] = useState<string | null>(check.assetId);

  const updateCheck = trpc.fireSafety.logbook.updateCheck.useMutation({
    onSuccess: () => {
      toast.success(t('logbook.checkUpdatedToast'));
      onClose();
      onInvalidate();
    },
    onError: () => toast.error(t('saveError')),
  });
  const removeCheck = trpc.fireSafety.logbook.removeCheck.useMutation({
    onSuccess: () => {
      toast.success(t('logbook.removedToast'));
      onClose();
      onInvalidate();
    },
    onError: () => toast.error(t('saveError')),
  });

  function save(): void {
    const isCustom = check.checkType === 'custom';
    updateCheck.mutate({
      checkId: check.id,
      // Only send what changed: an explicit nextDueAt always wins on the
      // server, so sending the unchanged value would defeat the
      // frequency-change rebase.
      ...(frequency !== check.frequency ? { frequency } : {}),
      ...(nextDue !== initialDue ? { nextDueAt: parseDateInput(nextDue) } : {}),
      ...(isCustom && label.trim() !== '' && label !== check.label ? { label: label.trim() } : {}),
      ...(assetId !== check.assetId ? { assetId } : {}),
    });
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('logbook.editCheckHeading', { check: checkTitle })}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {check.checkType === 'custom' ? (
            <div className="space-y-1.5">
              <Label htmlFor="edit-check-label">{t('logbook.checkLabel')}</Label>
              <Input
                id="edit-check-label"
                value={label}
                maxLength={200}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-check-frequency">{t('logbook.columns.frequency')}</Label>
              <select
                id="edit-check-frequency"
                value={frequency}
                onChange={(e) => {
                  const next = CHECK_FREQUENCIES.find((f) => f === e.target.value);
                  if (next !== undefined) setFrequency(next);
                }}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {CHECK_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {t(`frequencies.${f}` as never)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-check-due">{t('logbook.columns.nextDue')}</Label>
              <Input
                id="edit-check-due"
                type="date"
                value={nextDue}
                onChange={(e) => setNextDue(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('logbook.nextDueHint')}</p>
            </div>
          </div>

          {canPickAssets ? (
            <SearchSelect
              label={t('logbook.linkedAsset')}
              value={assetId}
              onChange={setAssetId}
              options={assetOptions}
              placeholder={t('logbook.noLinkedAsset')}
              {...(canManageAssets
                ? {
                    footerActionLabel: t('logbook.createAssetAction'),
                    onFooterAction: onCreateAsset,
                  }
                : {})}
            />
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="destructive"
            disabled={removeCheck.isPending}
            onClick={() => {
              if (window.confirm(t('logbook.removeConfirm'))) {
                removeCheck.mutate({ checkId: check.id });
              }
            }}
          >
            {t('logbook.removeCheck')}
          </Button>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button onClick={save} disabled={updateCheck.isPending}>
              {t('logbook.saveCheck')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add-custom-check dialog ────────────────────────────────────────────────

function AddCheckDialog({
  buildingId,
  assetOptions,
  canPickAssets,
  onClose,
  onInvalidate,
  t,
}: {
  buildingId: string;
  assetOptions: readonly AssetOption[];
  canPickAssets: boolean;
  onClose: () => void;
  onInvalidate: () => void;
  t: Translator;
}) {
  const [label, setLabel] = useState('');
  const [frequency, setFrequency] = useState<CheckFrequency>('monthly');
  const [firstDue, setFirstDue] = useState('');
  const [assetId, setAssetId] = useState<string | null>(null);

  const addCustomCheck = trpc.fireSafety.logbook.addCustomCheck.useMutation({
    onSuccess: () => {
      toast.success(t('logbook.checkAddedToast'));
      onClose();
      onInvalidate();
    },
    onError: () => toast.error(t('saveError')),
  });

  function submit(): void {
    if (label.trim() === '') return;
    addCustomCheck.mutate({
      buildingId,
      label: label.trim(),
      frequency,
      ...(firstDue !== '' ? { firstDueAt: parseDateInput(firstDue) } : {}),
      ...(assetId !== null ? { assetId } : {}),
    });
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('logbook.addCheckHeading')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="add-check-label">{t('logbook.checkLabel')}</Label>
            <Input
              id="add-check-label"
              value={label}
              maxLength={200}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('logbook.checkLabelPlaceholder')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="add-check-frequency">{t('logbook.columns.frequency')}</Label>
              <select
                id="add-check-frequency"
                value={frequency}
                onChange={(e) => {
                  const next = CHECK_FREQUENCIES.find((f) => f === e.target.value);
                  if (next !== undefined) setFrequency(next);
                }}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {CHECK_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {t(`frequencies.${f}` as never)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-check-due">{t('logbook.firstDue')}</Label>
              <Input
                id="add-check-due"
                type="date"
                value={firstDue}
                onChange={(e) => setFirstDue(e.target.value)}
              />
            </div>
          </div>

          {canPickAssets ? (
            <SearchSelect
              label={t('logbook.linkedAsset')}
              value={assetId}
              onChange={setAssetId}
              options={assetOptions}
              placeholder={t('logbook.noLinkedAsset')}
            />
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={submit} disabled={label.trim() === '' || addCustomCheck.isPending}>
            {t('logbook.addCheck')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create-asset dialog (from the asset link) ──────────────────────────────

function CreateAssetDialog({
  checkId,
  onClose,
  onLinked,
  t,
}: {
  checkId: string;
  onClose: () => void;
  /** Runs after the asset is created AND linked to the check. */
  onLinked: () => void;
  t: Translator;
}) {
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState('');
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [description, setDescription] = useState('');

  const assetTypes = trpc.assetTypes.list.useQuery({});
  const createAsset = trpc.assets.create.useMutation();
  const updateCheck = trpc.fireSafety.logbook.updateCheck.useMutation();

  const pending = createAsset.isPending || updateCheck.isPending;

  async function submit(): Promise<void> {
    if (name.trim() === '') return;
    try {
      const siteId = siteIds[0];
      const created = await createAsset.mutateAsync({
        name: name.trim(),
        description,
        ...(typeId !== '' ? { typeId } : {}),
        ...(siteId !== undefined ? { siteId } : {}),
      });
      await updateCheck.mutateAsync({ checkId, assetId: created.assetId });
      toast.success(t('logbook.assetCreatedToast'));
      onClose();
      onLinked();
    } catch {
      toast.error(t('saveError'));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('logbook.createAssetHeading')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="create-asset-name">{t('logbook.assetName')}</Label>
            <Input
              id="create-asset-name"
              value={name}
              maxLength={500}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="create-asset-type">{t('logbook.assetType')}</Label>
              <select
                id="create-asset-type"
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">{t('logbook.noAssetType')}</option>
                {(assetTypes.data ?? []).map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </div>
            <SiteSelector value={siteIds} onChange={setSiteIds} multiple={false} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-asset-description">{t('logbook.assetDescription')}</Label>
            <Textarea
              id="create-asset-description"
              rows={2}
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={name.trim() === '' || pending}>
            {t('logbook.createAssetSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
