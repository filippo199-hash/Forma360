'use client';

/**
 * Building record — the premises' whole fire-safety life on one page.
 *
 * Tabs: Logbook (the check calendar + record-a-check + recent
 * evidence), Doors (the door register with regime-derived cadences and
 * the five-point check), Drills, PEEPs, Marshals, FRAs, and Info (the
 * building information held for the fire and rescue service). The
 * logbook tab is first because it's the relentless one — the weekly
 * alarm test is the thing someone opens this page to do.
 */
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  DueStatusChip,
  DutyBadges,
  FraStatusChip,
  ResultChip,
  RiskRatingChip,
  TrainingStatusChip,
} from '../../../../src/components/fire-safety/chips';
import { LogbookTab } from '../../../../src/components/fire-safety/logbook-tab';
import { Archive, Download } from 'lucide-react';
import { Button } from '../../../../src/components/ui/button';
import { appConfirm } from '../../../../src/components/ui/app-confirm';
import { Card, CardContent } from '../../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../src/components/ui/dialog';
import { UserPicker } from '../../../../src/components/selectors/user-picker';
import { TooltipIconButton } from '../../../../src/components/ui/tooltip-icon-button';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { parseDoorImport } from '@forma360/shared/fire-safety';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';
// UK-DATES: a local toLocaleDateString(locale) helper shadowed the shared
// one and printed US-style dates ('en' resolves to en-US in ICU).
import { formatDate } from '../../../../src/lib/format-date';
import { useServerErrorToast } from '../../../../src/lib/use-server-error';

type Tab = 'logbook' | 'doors' | 'drills' | 'peeps' | 'marshals' | 'fras' | 'info';

const TABS: Tab[] = ['logbook', 'doors', 'drills', 'peeps', 'marshals', 'fras', 'info'];

/** yyyy-mm-dd for `<input type="date">`, today by default. */
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
 * routers refuse future-dated records. Never use for due/expiry dates —
 * those are legitimately in the future.
 */
function parsePerformedDateInput(value: string): Date {
  const noon = parseDateInput(value);
  const now = new Date();
  return noon.getTime() > now.getTime() ? now : noon;
}

const CHECKLIST_KEYS = [
  'gapsOk',
  'sealsOk',
  'closerOk',
  'glazingOk',
  'hingesOk',
  'signageOk',
] as const;

export default function FireBuildingPage() {
  const t = useTranslations('fireSafety');
  const onServerErrorG0 = useServerErrorToast(t('saveError'));
  const params = useParams<{ locale: string; buildingId: string }>();
  const locale = params.locale ?? 'en';
  const buildingId = params.buildingId ?? '';
  const router = useRouter();
  const utils = trpc.useUtils();

  const canRecord = useHasPermission('fireSafety.record');
  const canCreate = useHasPermission('fireSafety.create');
  const canManage = useHasPermission('fireSafety.manage');
  // BUG-10: the tab is addressable so a search result can land directly on
  // it. A night carer looking for a named resident's evacuation plan must
  // arrive AT the plan, not at the building's logbook.
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(
    TABS.includes(requestedTab as Tab) ? (requestedTab as Tab) : 'logbook',
  );

  const {
    data: building,
    isLoading,
    error,
  } = trpc.fireSafety.buildings.get.useQuery({ buildingId }, { enabled: buildingId.length > 0 });

  function invalidate(): void {
    void utils.fireSafety.buildings.get.invalidate({ buildingId });
    void utils.fireSafety.buildings.list.invalidate();
    void utils.fireSafety.overview.invalidate();
    void utils.fireSafety.logbook.invalidate();
  }

  // ── Logbook state lives in <LogbookTab /> ──

  // ── Doors state ──
  const [showAddDoor, setShowAddDoor] = useState(false);
  const [doorRef, setDoorRef] = useState('');
  const [doorKind, setDoorKind] = useState<'common_parts' | 'flat_entrance' | 'other'>('other');
  const [doorFloor, setDoorFloor] = useState('');
  const [doorRating, setDoorRating] = useState('');
  const [doorSelfClosing, setDoorSelfClosing] = useState(true);
  const [inspectingDoorId, setInspectingDoorId] = useState<string | null>(null);
  const [doorOutcome, setDoorOutcome] = useState<'pass' | 'defects_found' | 'fail'>('pass');
  const [doorChecklist, setDoorChecklist] = useState<Record<string, boolean>>(
    Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, true])),
  );
  const [doorDefects, setDoorDefects] = useState('');
  const [doorRaiseAction, setDoorRaiseAction] = useState(true);
  const [historyDoorId, setHistoryDoorId] = useState<string | null>(null);

  // FS-12: a 200-door block is one paste, not 200 form submissions.
  const [showBulkDoors, setShowBulkDoors] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkDefaultKind, setBulkDefaultKind] = useState<
    'common_parts' | 'flat_entrance' | 'other'
  >('flat_entrance');
  const bulkParse = parseDoorImport(bulkText, bulkDefaultKind);
  const bulkCreateDoors = trpc.fireSafety.doors.bulkCreate.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.skipped.length > 0
          ? t('doors.bulk.doneSkipped', {
              created: result.created,
              skipped: result.skipped.length,
            })
          : t('doors.bulk.done', { created: result.created }),
      );
      setShowBulkDoors(false);
      setBulkText('');
      invalidate();
    },
    onError: onServerErrorG0,
  });

  const { data: doorHistory } = trpc.fireSafety.doors.inspections.useQuery(
    { doorId: historyDoorId ?? '' },
    { enabled: historyDoorId !== null },
  );

  const createDoor = trpc.fireSafety.doors.create.useMutation({
    onSuccess: () => {
      toast.success(t('doors.addedToast'));
      setShowAddDoor(false);
      setDoorRef('');
      setDoorFloor('');
      setDoorRating('');
      invalidate();
    },
    onError: onServerErrorG0,
  });
  const inspectDoor = trpc.fireSafety.doors.recordInspection.useMutation({
    onSuccess: () => {
      toast.success(t('doors.inspectedToast'));
      setInspectingDoorId(null);
      setDoorOutcome('pass');
      setDoorChecklist(Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, true])));
      setDoorDefects('');
      invalidate();
      if (historyDoorId !== null) {
        void utils.fireSafety.doors.inspections.invalidate({ doorId: historyDoorId });
      }
    },
    onError: onServerErrorG0,
  });
  const archiveDoor = trpc.fireSafety.doors.archive.useMutation({
    onSuccess: () => invalidate(),
    onError: onServerErrorG0,
  });

  // ── Drills state ──
  const [drillDate, setDrillDate] = useState(dateInputValue(new Date()));
  const [drillMinutes, setDrillMinutes] = useState('');
  const [drillSeconds, setDrillSeconds] = useState('');
  // BUG-07: the target the evacuation time is judged against. Null until
  // touched — the effective value prefills from the latest drill below,
  // because the target is standing per-building practice, not per-drill
  // ceremony. (Same draft-or-derived shape as `infoDraft`.)
  const [drillTargetDraft, setDrillTargetDraft] = useState<{
    minutes: string;
    seconds: string;
  } | null>(null);
  const [drillPresent, setDrillPresent] = useState('');
  const [drillAccounted, setDrillAccounted] = useState('');
  const [drillRollComplete, setDrillRollComplete] = useState(true);
  const [drillNotes, setDrillNotes] = useState('');
  const [drillLessons, setDrillLessons] = useState('');

  const recordDrill = trpc.fireSafety.drills.record.useMutation({
    onSuccess: () => {
      toast.success(t('drills.recordedToast'));
      setDrillMinutes('');
      setDrillSeconds('');
      setDrillTargetDraft(null);
      setDrillPresent('');
      setDrillAccounted('');
      setDrillNotes('');
      setDrillLessons('');
      invalidate();
    },
    onError: (err) =>
      toast.error(
        err.message === 'roll-exceeds-present' ? t('drills.rollExceedsPresent') : t('saveError'),
      ),
  });

  // ── PEEPs state ──
  const [showAddPeep, setShowAddPeep] = useState(false);
  // Person + buddy come from the user picker; free text stays legal —
  // visitors and contractors needing a PEEP have no account.
  const [peepPerson, setPeepPerson] = useState<{ userId: string | null; name: string } | null>(
    null,
  );
  const [peepNeeds, setPeepNeeds] = useState('');
  const [peepPlan, setPeepPlan] = useState('');
  const [peepBuddy, setPeepBuddy] = useState<{ userId: string | null; name: string } | null>(null);
  const [peepEquipment, setPeepEquipment] = useState('');
  const [peepMonths, setPeepMonths] = useState('12');

  const createPeep = trpc.fireSafety.peeps.create.useMutation({
    onSuccess: () => {
      toast.success(t('peeps.addedToast'));
      setShowAddPeep(false);
      setPeepPerson(null);
      setPeepNeeds('');
      setPeepPlan('');
      setPeepBuddy(null);
      setPeepEquipment('');
      invalidate();
    },
    onError: onServerErrorG0,
  });
  const reviewPeep = trpc.fireSafety.peeps.recordReview.useMutation({
    onSuccess: () => {
      toast.success(t('peeps.reviewedToast'));
      invalidate();
    },
    onError: onServerErrorG0,
  });
  const endPeep = trpc.fireSafety.peeps.end.useMutation({
    onSuccess: () => invalidate(),
    onError: onServerErrorG0,
  });

  // ── Marshals state ──
  const [showAddMarshal, setShowAddMarshal] = useState(false);
  const [marshalPick, setMarshalPick] = useState<{ userId: string | null; name: string } | null>(
    null,
  );
  const [marshalRole, setMarshalRole] = useState<'marshal' | 'deputy'>('marshal');
  const [marshalArea, setMarshalArea] = useState('');
  const [marshalTrainedAt, setMarshalTrainedAt] = useState('');
  const [marshalExpiresAt, setMarshalExpiresAt] = useState('');
  // Editing an existing marshal (role / area / training dates) in place —
  // it used to be end-and-re-add, which threw away the history row.
  const [editingMarshal, setEditingMarshal] = useState<{
    id: string;
    role: 'marshal' | 'deputy';
    area: string;
    trainedAt: string;
    trainingExpiresAt: string;
  } | null>(null);

  const addMarshal = trpc.fireSafety.marshals.add.useMutation({
    onSuccess: () => {
      toast.success(t('marshals.addedToast'));
      setShowAddMarshal(false);
      setMarshalPick(null);
      setMarshalArea('');
      setMarshalTrainedAt('');
      setMarshalExpiresAt('');
      invalidate();
    },
    onError: (err) =>
      toast.error(err.data?.code === 'CONFLICT' ? t('marshals.alreadyMarshal') : t('saveError')),
  });
  const updateMarshal = trpc.fireSafety.marshals.update.useMutation({
    onSuccess: () => {
      toast.success(t('marshals.updatedToast'));
      setEditingMarshal(null);
      invalidate();
    },
    onError: onServerErrorG0,
  });
  const endMarshal = trpc.fireSafety.marshals.end.useMutation({
    onSuccess: () => invalidate(),
    onError: onServerErrorG0,
  });

  // ── FRA creation ──
  const createFra = trpc.fireSafety.fras.create.useMutation({
    onSuccess: (result) => router.push(`/${locale}/fire-safety/fra/${result.id}`),
    onError: onServerErrorG0,
  });

  // ── Info tab state (initialised from the loaded row on first edit) ──
  const [infoDraft, setInfoDraft] = useState<Record<string, string | boolean> | null>(null);

  const updateBuilding = trpc.fireSafety.buildings.update.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.checksAdded > 0 || result.checksDeactivated > 0
          ? t('info.savedResyncToast', {
              added: result.checksAdded,
              deactivated: result.checksDeactivated,
            })
          : t('info.savedToast'),
      );
      setInfoDraft(null);
      invalidate();
    },
    onError: onServerErrorG0,
  });
  const archiveBuilding = trpc.fireSafety.buildings.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archivedToast'));
      router.push(`/${locale}/fire-safety`);
    },
    onError: onServerErrorG0,
  });

  if (isLoading) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }
  if (error !== null || building === undefined) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <p className="text-sm text-muted-foreground">{t('notFound')}</p>
        <Link className="text-sm underline" href={`/${locale}/fire-safety`}>
          {t('backToList')}
        </Link>
      </main>
    );
  }

  const archived = building.archivedAt !== null;

  // Prefill the target from the most recent drill's — the standing target.
  const latestTargetSeconds = building.drills[0]?.evacuationTargetSeconds ?? null;
  const drillTarget = drillTargetDraft ?? {
    minutes: latestTargetSeconds !== null ? String(Math.floor(latestTargetSeconds / 60)) : '',
    seconds: latestTargetSeconds !== null ? String(latestTargetSeconds % 60) : '',
  };

  /** m:ss from a seconds count — the drill table's time format. */
  function evacTime(seconds: number): string {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function submitDrill(): void {
    const mins = drillMinutes === '' ? 0 : Number(drillMinutes);
    const secs = drillSeconds === '' ? 0 : Number(drillSeconds);
    const total = mins * 60 + secs;
    const targetEmpty = drillTarget.minutes === '' && drillTarget.seconds === '';
    const targetTotal =
      (drillTarget.minutes === '' ? 0 : Number(drillTarget.minutes)) * 60 +
      (drillTarget.seconds === '' ? 0 : Number(drillTarget.seconds));
    recordDrill.mutate({
      buildingId,
      conductedAt: parsePerformedDateInput(drillDate),
      evacuationSeconds: drillMinutes === '' && drillSeconds === '' ? null : total,
      peoplePresent: drillPresent === '' ? null : Number(drillPresent),
      peopleAccountedFor: drillAccounted === '' ? null : Number(drillAccounted),
      rollComplete: drillRollComplete,
      evacuationTargetSeconds: targetEmpty ? null : targetTotal,
      notes: drillNotes,
      lessonsLearned: drillLessons,
    });
  }

  const info = infoDraft ?? {
    name: building.name,
    address: building.address,
    useDescription: building.useDescription,
    isResidential: building.isResidential,
    heightMetres: building.heightMetres === null ? '' : String(building.heightMetres),
    storeys: building.storeys === null ? '' : String(building.storeys),
    hasFireAlarm: building.hasFireAlarm,
    hasEmergencyLighting: building.hasEmergencyLighting,
    hasSprinklers: building.hasSprinklers,
    hasDampers: building.hasDampers,
    hasRisers: building.hasRisers,
    externalWallSystem: building.externalWallSystem,
    compartmentationNotes: building.compartmentationNotes,
    meansOfEscapeNotes: building.meansOfEscapeNotes,
    serviceRisersNotes: building.serviceRisersNotes,
    secureInfoBoxLocation: building.secureInfoBoxLocation,
  };
  function setInfo(key: string, value: string | boolean): void {
    setInfoDraft({ ...info, [key]: value });
  }
  function saveInfo(): void {
    updateBuilding.mutate({
      buildingId,
      name: String(info['name']),
      address: String(info['address']),
      useDescription: String(info['useDescription']),
      isResidential: Boolean(info['isResidential']),
      heightMetres: info['heightMetres'] === '' ? null : Number(info['heightMetres']),
      storeys: info['storeys'] === '' ? null : Number(info['storeys']),
      hasFireAlarm: Boolean(info['hasFireAlarm']),
      hasEmergencyLighting: Boolean(info['hasEmergencyLighting']),
      hasSprinklers: Boolean(info['hasSprinklers']),
      hasDampers: Boolean(info['hasDampers']),
      hasRisers: Boolean(info['hasRisers']),
      externalWallSystem: String(info['externalWallSystem']),
      compartmentationNotes: String(info['compartmentationNotes']),
      meansOfEscapeNotes: String(info['meansOfEscapeNotes']),
      serviceRisersNotes: String(info['serviceRisersNotes']),
      secureInfoBoxLocation: String(info['secureInfoBoxLocation']),
    });
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-1 text-sm">
        <Link className="text-muted-foreground hover:underline" href={`/${locale}/fire-safety`}>
          {t('backToList')}
        </Link>
      </div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{building.name}</h1>
            <DutyBadges duty={building.duty} />
            {archived ? <FraStatusChip status="archived" /> : null}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[building.address, building.siteName]
              .filter((v) => v !== null && v !== '')
              .join(' · ')}
          </p>
        </div>
        {canManage && !archived ? (
          <TooltipIconButton
            icon={Archive}
            label={t('archiveButton')}
            variant="destructive"
            onClick={() => {
              void appConfirm({ description: t('archiveConfirm'), destructive: true }).then(
                (ok) => {
                  if (ok) archiveBuilding.mutate({ buildingId });
                },
              );
            }}
          />
        ) : null}
      </div>

      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-300 dark:border-slate-700">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              tab === key
                ? '-mb-px border-b-2 border-[#234fe1] px-3 py-2 text-sm font-semibold text-[#234fe1]'
                : 'px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
            }
          >
            {t(`tabs.${key}` as never)}
          </button>
        ))}
      </div>

      {/* ── Logbook ─────────────────────────────────────────────────── */}
      {tab === 'logbook' ? (
        <LogbookTab
          buildingId={buildingId}
          locale={locale}
          archived={archived}
          checks={building.checks}
          recentEntries={building.recentEntries}
          onInvalidate={invalidate}
        />
      ) : null}

      {/* ── Doors ───────────────────────────────────────────────────── */}
      {tab === 'doors' ? (
        <section className="space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {building.duty.above11mResidential ? t('doors.regimeNote') : t('doors.defaultNote')}
            </p>
            {canCreate && !archived ? (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowBulkDoors((v) => !v)}>
                  {t('doors.bulk.button')}
                </Button>
                <Button variant="outline" onClick={() => setShowAddDoor((v) => !v)}>
                  {t('doors.addButton')}
                </Button>
              </div>
            ) : null}
          </div>

          {showBulkDoors ? (
            <Card>
              <CardContent className="space-y-3 p-5">
                <div>
                  <h3 className="text-sm font-semibold">{t('doors.bulk.heading')}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t('doors.bulk.intro')}</p>
                </div>
                <Textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  rows={8}
                  placeholder={t('doors.bulk.placeholder')}
                  className="font-mono text-xs"
                />
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <Label htmlFor="bulk-kind" className="text-xs">
                    {t('doors.bulk.defaultKind')}
                  </Label>
                  <select
                    id="bulk-kind"
                    value={bulkDefaultKind}
                    onChange={(e) => setBulkDefaultKind(e.target.value as never)}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                  >
                    {(['flat_entrance', 'common_parts', 'other'] as const).map((k) => (
                      <option key={k} value={k}>
                        {t(`doors.kinds.${k}`)}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-muted-foreground">
                    {t('doors.bulk.preview', { count: bulkParse.rows.length })}
                    {bulkParse.errors.length > 0
                      ? ` — ${t('doors.bulk.errors', { count: bulkParse.errors.length, lines: bulkParse.errors.map((e) => e.line).join(', ') })}`
                      : ''}
                  </span>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowBulkDoors(false)}>
                    {t('cancel')}
                  </Button>
                  <Button
                    disabled={
                      bulkParse.rows.length === 0 ||
                      bulkParse.errors.length > 0 ||
                      bulkCreateDoors.isPending
                    }
                    onClick={() =>
                      bulkCreateDoors.mutate({
                        buildingId,
                        doors: bulkParse.rows.slice(0, 500),
                      })
                    }
                  >
                    {t('doors.bulk.submit', { count: bulkParse.rows.length })}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {showAddDoor ? (
            <Card>
              <CardContent className="space-y-4 p-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="door-ref">{t('doors.ref')}</Label>
                    <Input
                      id="door-ref"
                      value={doorRef}
                      onChange={(e) => setDoorRef(e.target.value)}
                      placeholder={t('doors.refPlaceholder')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="door-kind">{t('doors.locationKind')}</Label>
                    <select
                      id="door-kind"
                      value={doorKind}
                      onChange={(e) => setDoorKind(e.target.value as never)}
                      className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {(['common_parts', 'flat_entrance', 'other'] as const).map((k) => (
                        <option key={k} value={k}>
                          {t(`doors.kinds.${k}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="door-floor">{t('doors.floor')}</Label>
                    <Input
                      id="door-floor"
                      value={doorFloor}
                      onChange={(e) => setDoorFloor(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="door-rating">{t('doors.rating')}</Label>
                    <Input
                      id="door-rating"
                      type="number"
                      min="15"
                      step="15"
                      value={doorRating}
                      onChange={(e) => setDoorRating(e.target.value)}
                      placeholder="30"
                    />
                  </div>
                  <label className="mt-6 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={doorSelfClosing}
                      onChange={(e) => setDoorSelfClosing(e.target.checked)}
                      className="h-4 w-4"
                    />
                    {t('doors.selfClosing')}
                  </label>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowAddDoor(false)}>
                    {t('cancel')}
                  </Button>
                  <Button
                    disabled={doorRef.trim() === '' || createDoor.isPending}
                    onClick={() =>
                      createDoor.mutate({
                        buildingId,
                        doorRef: doorRef.trim(),
                        locationKind: doorKind,
                        floor: doorFloor,
                        description: '',
                        ratingMinutes: doorRating === '' ? null : Number(doorRating),
                        selfClosing: doorSelfClosing,
                      })
                    }
                  >
                    {t('doors.saveDoor')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {building.doors.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('doors.empty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card text-card-foreground shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t('doors.columns.ref')}</th>
                    <th className="px-3 py-2 font-medium">{t('doors.columns.kind')}</th>
                    <th className="px-3 py-2 font-medium">{t('doors.columns.interval')}</th>
                    <th className="px-3 py-2 font-medium">{t('doors.columns.lastInspected')}</th>
                    <th className="px-3 py-2 font-medium">{t('doors.columns.nextDue')}</th>
                    <th className="px-3 py-2 font-medium">{t('doors.columns.status')}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {building.doors
                    .filter((d) => d.status === 'active')
                    .map((door) => (
                      <tr key={door.id} className="border-b last:border-b-0">
                        <td className="px-3 py-2.5">
                          <div className="font-medium">{door.doorRef}</div>
                          {door.floor !== '' ? (
                            <div className="text-xs text-muted-foreground">
                              {t('doors.floorLabel', { floor: door.floor })}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5">{t(`doors.kinds.${door.locationKind}`)}</td>
                        <td className="px-3 py-2.5 text-xs">
                          {t('doors.everyMonths', { count: door.intervalMonths })}
                        </td>
                        <td className="px-3 py-2.5">{formatDate(door.lastInspectedAt, locale)}</td>
                        <td className="px-3 py-2.5">
                          {formatDate(door.nextInspectionDueAt, locale)}
                        </td>
                        <td className="px-3 py-2.5">
                          <DueStatusChip status={door.dueStatus} />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                              onClick={() =>
                                setHistoryDoorId(historyDoorId === door.id ? null : door.id)
                              }
                            >
                              {t('doors.historyButton')}
                            </button>
                            {canRecord && !archived ? (
                              <Button
                                size="sm"
                                variant={door.dueStatus === 'overdue' ? 'default' : 'outline'}
                                onClick={() =>
                                  setInspectingDoorId(inspectingDoorId === door.id ? null : door.id)
                                }
                              >
                                {t('doors.inspectButton')}
                              </Button>
                            ) : null}
                            {canManage && !archived ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  void appConfirm({
                                    description: t('doors.removeConfirm'),
                                    destructive: true,
                                  }).then((ok) => {
                                    if (ok) archiveDoor.mutate({ doorId: door.id });
                                  });
                                }}
                              >
                                {t('doors.removeButton')}
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {inspectingDoorId !== null ? (
            <Card>
              <CardContent className="space-y-4 p-5">
                <h2 className="text-sm font-semibold">
                  {t('doors.inspectHeading', {
                    ref: building.doors.find((d) => d.id === inspectingDoorId)?.doorRef ?? '',
                  })}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="door-outcome">{t('doors.outcome')}</Label>
                    <select
                      id="door-outcome"
                      value={doorOutcome}
                      onChange={(e) => setDoorOutcome(e.target.value as never)}
                      className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {(['pass', 'defects_found', 'fail'] as const).map((r) => (
                        <option key={r} value={r}>
                          {t(`results.${r}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {CHECKLIST_KEYS.map((key) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={doorChecklist[key] ?? true}
                        onChange={(e) =>
                          setDoorChecklist({ ...doorChecklist, [key]: e.target.checked })
                        }
                        className="h-4 w-4"
                      />
                      {t(`doors.checklist.${key}` as never)}
                    </label>
                  ))}
                </div>
                {doorOutcome !== 'pass' ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="door-defects">{t('doors.defects')}</Label>
                      <Textarea
                        id="door-defects"
                        rows={2}
                        value={doorDefects}
                        onChange={(e) => setDoorDefects(e.target.value)}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={doorRaiseAction}
                        onChange={(e) => setDoorRaiseAction(e.target.checked)}
                        className="h-4 w-4"
                      />
                      {t('logbook.raiseAction')}
                    </label>
                  </>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setInspectingDoorId(null)}>
                    {t('cancel')}
                  </Button>
                  <Button
                    disabled={inspectDoor.isPending}
                    onClick={() =>
                      inspectDoor.mutate({
                        doorId: inspectingDoorId,
                        outcome: doorOutcome,
                        checklist: {
                          gapsOk: doorChecklist['gapsOk'] ?? null,
                          sealsOk: doorChecklist['sealsOk'] ?? null,
                          closerOk: doorChecklist['closerOk'] ?? null,
                          glazingOk: doorChecklist['glazingOk'] ?? null,
                          hingesOk: doorChecklist['hingesOk'] ?? null,
                          signageOk: doorChecklist['signageOk'] ?? null,
                        },
                        defectsSummary: doorDefects,
                        raiseAction: doorRaiseAction && doorOutcome !== 'pass',
                      })
                    }
                  >
                    {t('doors.saveInspection')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {historyDoorId !== null && doorHistory !== undefined ? (
            <div>
              <h2 className="mb-2 text-sm font-semibold">
                {t('doors.historyHeading', {
                  ref: building.doors.find((d) => d.id === historyDoorId)?.doorRef ?? '',
                })}
              </h2>
              {doorHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('doors.noInspections')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {doorHistory.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <ResultChip result={row.outcome} />
                      {row.defectsSummary !== '' ? <span>{row.defectsSummary}</span> : null}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {row.inspectedByName ?? ''} · {formatDate(row.inspectedAt, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ── Drills ──────────────────────────────────────────────────── */}
      {tab === 'drills' ? (
        <section className="space-y-5">
          {canRecord && !archived ? (
            <Card>
              <CardContent className="space-y-4 p-5">
                <h2 className="text-sm font-semibold">{t('drills.recordHeading')}</h2>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="drill-date">{t('drills.conductedAt')}</Label>
                    <Input
                      id="drill-date"
                      type="date"
                      value={drillDate}
                      max={dateInputValue(new Date())}
                      onChange={(e) => setDrillDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('drills.evacuationTime')}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        value={drillMinutes}
                        onChange={(e) => setDrillMinutes(e.target.value)}
                        placeholder={t('drills.minutes')}
                        aria-label={t('drills.minutes')}
                      />
                      <Input
                        type="number"
                        min="0"
                        max="59"
                        value={drillSeconds}
                        onChange={(e) => setDrillSeconds(e.target.value)}
                        placeholder={t('drills.seconds')}
                        aria-label={t('drills.seconds')}
                      />
                    </div>
                  </div>
                  {/* BUG-07: the per-building target the time is judged
                      against — over it, the save raises a follow-up action. */}
                  <div className="space-y-1.5">
                    <Label>{t('drills.target')}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        value={drillTarget.minutes}
                        onChange={(e) =>
                          setDrillTargetDraft({ ...drillTarget, minutes: e.target.value })
                        }
                        placeholder={t('drills.minutes')}
                        aria-label={t('drills.targetMinutes')}
                      />
                      <Input
                        type="number"
                        min="0"
                        max="59"
                        value={drillTarget.seconds}
                        onChange={(e) =>
                          setDrillTargetDraft({ ...drillTarget, seconds: e.target.value })
                        }
                        placeholder={t('drills.seconds')}
                        aria-label={t('drills.targetSeconds')}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">{t('drills.targetHint')}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('drills.roll')}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        value={drillPresent}
                        onChange={(e) => setDrillPresent(e.target.value)}
                        placeholder={t('drills.present')}
                        aria-label={t('drills.present')}
                      />
                      <Input
                        type="number"
                        min="0"
                        value={drillAccounted}
                        onChange={(e) => setDrillAccounted(e.target.value)}
                        placeholder={t('drills.accounted')}
                        aria-label={t('drills.accounted')}
                      />
                    </div>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={drillRollComplete}
                    onChange={(e) => setDrillRollComplete(e.target.checked)}
                    className="h-4 w-4"
                  />
                  {t('drills.rollComplete')}
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="drill-notes">{t('drills.notes')}</Label>
                    <Textarea
                      id="drill-notes"
                      rows={2}
                      value={drillNotes}
                      onChange={(e) => setDrillNotes(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="drill-lessons">{t('drills.lessons')}</Label>
                    <Textarea
                      id="drill-lessons"
                      rows={2}
                      value={drillLessons}
                      onChange={(e) => setDrillLessons(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button onClick={submitDrill} disabled={recordDrill.isPending}>
                    {t('drills.saveDrill')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {building.drills.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('drills.empty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card text-card-foreground shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t('drills.columns.date')}</th>
                    <th className="px-3 py-2 font-medium">{t('drills.columns.time')}</th>
                    <th className="px-3 py-2 font-medium">{t('drills.columns.roll')}</th>
                    <th className="px-3 py-2 font-medium">{t('drills.columns.outcome')}</th>
                    <th className="px-3 py-2 font-medium">{t('drills.columns.lessons')}</th>
                    <th className="w-10 px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {/* BUG-07: a drill that raised a follow-up action gets the
                      same red failed-state treatment doors do — a bad drill
                      must not read like a routine row. */}
                  {building.drills.map((drill) => (
                    <tr
                      key={drill.id}
                      className={
                        drill.actionId !== null
                          ? 'border-b align-top last:border-b-0 bg-red-50/60 dark:bg-red-950/20'
                          : 'border-b align-top last:border-b-0'
                      }
                    >
                      <td className="px-3 py-2.5">{formatDate(drill.conductedAt, locale)}</td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {drill.evacuationSeconds === null ? '—' : evacTime(drill.evacuationSeconds)}
                        {drill.evacuationTargetSeconds !== null ? (
                          <span className="text-xs text-muted-foreground">
                            {' / '}
                            {t('drills.targetShort', {
                              time: evacTime(drill.evacuationTargetSeconds),
                            })}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5">
                        {drill.peoplePresent === null
                          ? '—'
                          : t('drills.rollSummary', {
                              accounted: drill.peopleAccountedFor ?? 0,
                              present: drill.peoplePresent,
                            })}
                        {drill.rollComplete ? ` · ${t('drills.rollCompleteShort')}` : ''}
                      </td>
                      <td className="px-3 py-2.5">
                        {drill.actionId !== null ? (
                          <Link
                            href={`/${locale}/actions?action=${drill.actionId}`}
                            className="inline-flex items-center rounded-md border border-red-600 bg-red-600 px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-white hover:bg-red-700 dark:border-red-500 dark:bg-red-600"
                          >
                            {t('drills.followUpRaised')}
                          </Link>
                        ) : (
                          <DueStatusChip status="ok" />
                        )}
                      </td>
                      <td className="max-w-sm px-3 py-2.5 text-xs text-muted-foreground">
                        {drill.lessonsLearned || drill.notes || '—'}
                      </td>
                      <td className="w-10 px-1 py-1">
                        <TooltipIconButton
                          icon={Download}
                          label={t('drills.downloadPdf')}
                          href={`/api/exports/drill-pdf?drillId=${drill.id}`}
                          target="_blank"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* ── PEEPs ───────────────────────────────────────────────────── */}
      {tab === 'peeps' ? (
        <section className="space-y-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{t('peeps.intro')}</p>
            <div className="flex items-center gap-2">
              {/* The night pack: current PEEPs + marshal roster as one sheet. */}
              <Button variant="outline" asChild>
                <a
                  href={`/api/exports/night-pack-pdf?buildingId=${buildingId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download aria-hidden className="size-4" />
                  {t('peeps.nightPackButton')}
                </a>
              </Button>
              {canCreate && !archived ? (
                <Button variant="outline" onClick={() => setShowAddPeep((v) => !v)}>
                  {t('peeps.addButton')}
                </Button>
              ) : null}
            </div>
          </div>

          {showAddPeep ? (
            <Card>
              <CardContent className="space-y-4 p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>{t('peeps.personName')}</Label>
                    <UserPicker value={peepPerson} onChange={setPeepPerson} allowFreeText />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="peep-months">{t('peeps.reviewMonths')}</Label>
                    <Input
                      id="peep-months"
                      type="number"
                      min="1"
                      max="60"
                      value={peepMonths}
                      onChange={(e) => setPeepMonths(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="peep-needs">{t('peeps.assistanceNeeds')}</Label>
                  <Textarea
                    id="peep-needs"
                    rows={2}
                    value={peepNeeds}
                    onChange={(e) => setPeepNeeds(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="peep-plan">{t('peeps.planSummary')}</Label>
                  <Textarea
                    id="peep-plan"
                    rows={3}
                    value={peepPlan}
                    onChange={(e) => setPeepPlan(e.target.value)}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>{t('peeps.buddy')}</Label>
                    <UserPicker value={peepBuddy} onChange={setPeepBuddy} allowFreeText />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="peep-equipment">{t('peeps.equipment')}</Label>
                    <Input
                      id="peep-equipment"
                      value={peepEquipment}
                      onChange={(e) => setPeepEquipment(e.target.value)}
                      placeholder={t('peeps.equipmentPlaceholder')}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowAddPeep(false)}>
                    {t('cancel')}
                  </Button>
                  <Button
                    disabled={peepPerson === null || createPeep.isPending}
                    onClick={() =>
                      createPeep.mutate({
                        buildingId,
                        personName: peepPerson?.name.trim() ?? '',
                        ...(peepPerson?.userId != null ? { userId: peepPerson.userId } : {}),
                        assistanceNeeds: peepNeeds,
                        planSummary: peepPlan,
                        buddyName: peepBuddy?.name ?? '',
                        equipmentNeeded: peepEquipment,
                        reviewFrequencyMonths: Number(peepMonths) || 12,
                      })
                    }
                  >
                    {t('peeps.savePeep')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {building.peeps.filter((p) => p.endedAt === null).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('peeps.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {building.peeps
                .filter((p) => p.endedAt === null)
                .map((peep) => {
                  const due = new Date(peep.nextReviewAt) <= new Date();
                  return (
                    <li key={peep.id}>
                      <Card>
                        <CardContent className="flex flex-wrap items-center gap-3 p-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{peep.personName}</span>
                              {due ? <DueStatusChip status="overdue" /> : null}
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {peep.planSummary || peep.assistanceNeeds}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t('peeps.nextReview', {
                                date: formatDate(peep.nextReviewAt, locale),
                              })}
                            </p>
                          </div>
                          {canCreate && !archived ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => reviewPeep.mutate({ peepId: peep.id })}
                            >
                              {t('peeps.reviewButton')}
                            </Button>
                          ) : null}
                          {canManage && !archived ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                void appConfirm({
                                  description: t('peeps.endConfirm'),
                                  destructive: true,
                                }).then((ok) => {
                                  if (ok) endPeep.mutate({ peepId: peep.id });
                                });
                              }}
                            >
                              {t('peeps.endButton')}
                            </Button>
                          ) : null}
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
            </ul>
          )}
        </section>
      ) : null}

      {/* ── Marshals ────────────────────────────────────────────────── */}
      {tab === 'marshals' ? (
        <section className="space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{t('marshals.intro')}</p>
            {canManage && !archived ? (
              <Button variant="outline" onClick={() => setShowAddMarshal((v) => !v)}>
                {t('marshals.addButton')}
              </Button>
            ) : null}
          </div>

          {/* FS-8: cover is per-building — a lock-up substation opts out,
              a tower states the minimum it needs. */}
          <Card>
            <CardContent className="flex flex-wrap items-center gap-4 p-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={building.requiresMarshalCover}
                  disabled={!canManage || archived}
                  onChange={(e) =>
                    updateBuilding.mutate({
                      buildingId,
                      requiresMarshalCover: e.target.checked,
                    })
                  }
                  className="h-4 w-4"
                />
                {t('marshals.cover.required')}
              </label>
              {building.requiresMarshalCover ? (
                <label className="flex items-center gap-2">
                  {t('marshals.cover.target')}
                  <Input
                    type="number"
                    min="1"
                    max="50"
                    defaultValue={building.marshalTarget}
                    disabled={!canManage || archived}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (
                        Number.isInteger(v) &&
                        v >= 1 &&
                        v <= 50 &&
                        v !== building.marshalTarget
                      ) {
                        updateBuilding.mutate({ buildingId, marshalTarget: v });
                      }
                    }}
                    className="h-8 w-20"
                  />
                </label>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t('marshals.cover.notRequiredNote')}
                </span>
              )}
            </CardContent>
          </Card>

          {showAddMarshal ? (
            <Card>
              <CardContent className="space-y-4 p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>{t('marshals.user')}</Label>
                    {/* NR3-10: free text allowed, matching the PEEP and FRA
                        pickers — the day marshal is often a concierge or
                        contractor with no seat. Deliberate reversal of the
                        account-only rule; the cost is that a free-text
                        marshal can never be training-matrix backed, and the
                        register says so (unbacked / not trained). */}
                    <UserPicker
                      value={marshalPick}
                      onChange={setMarshalPick}
                      allowFreeText
                      placeholder={t('marshals.selectUser')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="marshal-role">{t('marshals.role')}</Label>
                    <select
                      id="marshal-role"
                      value={marshalRole}
                      onChange={(e) => setMarshalRole(e.target.value as never)}
                      className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="marshal">{t('marshals.roles.marshal')}</option>
                      <option value="deputy">{t('marshals.roles.deputy')}</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="marshal-area">{t('marshals.area')}</Label>
                    <Input
                      id="marshal-area"
                      value={marshalArea}
                      onChange={(e) => setMarshalArea(e.target.value)}
                      placeholder={t('marshals.areaPlaceholder')}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="marshal-trained">{t('marshals.trainedAt')}</Label>
                      <Input
                        id="marshal-trained"
                        type="date"
                        value={marshalTrainedAt}
                        onChange={(e) => setMarshalTrainedAt(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="marshal-expires">{t('marshals.expiresAt')}</Label>
                      <Input
                        id="marshal-expires"
                        type="date"
                        value={marshalExpiresAt}
                        onChange={(e) => setMarshalExpiresAt(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowAddMarshal(false)}>
                    {t('cancel')}
                  </Button>
                  <Button
                    disabled={
                      marshalPick === null || marshalPick.name.trim() === '' || addMarshal.isPending
                    }
                    onClick={() => {
                      if (marshalPick === null) return;
                      addMarshal.mutate({
                        buildingId,
                        ...(marshalPick.userId !== null
                          ? { userId: marshalPick.userId }
                          : { personName: marshalPick.name.trim() }),
                        role: marshalRole,
                        area: marshalArea,
                        trainedAt:
                          marshalTrainedAt === ''
                            ? null
                            : parsePerformedDateInput(marshalTrainedAt),
                        trainingExpiresAt:
                          marshalExpiresAt === '' ? null : parseDateInput(marshalExpiresAt),
                        notes: '',
                      });
                    }}
                  >
                    {t('marshals.saveMarshal')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {building.marshals.filter((m) => m.endedAt === null).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('marshals.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {building.marshals
                .filter((m) => m.endedAt === null)
                .map((marshal) => (
                  <li key={marshal.id}>
                    <Card>
                      <CardContent className="flex flex-wrap items-center gap-3 p-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">
                              {marshal.userName ?? marshal.userId ?? '—'}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {t(`marshals.roles.${marshal.role}`)}
                            </span>
                            <TrainingStatusChip status={marshal.trainingStatus} />
                            {/* FS-X01: a typed date with no training record
                                behind it satisfies the coverage target while
                                proving nothing. Say so where it is read. */}
                            {marshal.unbacked ? (
                              <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                                {t('marshals.unbacked')}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {marshal.area !== '' ? `${marshal.area} · ` : ''}
                            {marshal.trainingExpiresAt !== null
                              ? t('marshals.expires', {
                                  date: formatDate(marshal.trainingExpiresAt, locale),
                                })
                              : t('marshals.noExpiry')}
                            {marshal.competenceSource === 'training'
                              ? ` · ${t('marshals.fromTraining')}`
                              : ''}
                          </p>
                        </div>
                        {canManage && !archived ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setEditingMarshal({
                                  id: marshal.id,
                                  role: marshal.role === 'deputy' ? 'deputy' : 'marshal',
                                  area: marshal.area,
                                  trainedAt:
                                    marshal.trainedAt !== null
                                      ? dateInputValue(new Date(marshal.trainedAt))
                                      : '',
                                  trainingExpiresAt:
                                    marshal.trainingExpiresAt !== null
                                      ? dateInputValue(new Date(marshal.trainingExpiresAt))
                                      : '',
                                })
                              }
                            >
                              {t('marshals.editButton')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                void appConfirm({
                                  description: t('marshals.endConfirm'),
                                  destructive: true,
                                }).then((ok) => {
                                  if (ok) endMarshal.mutate({ marshalId: marshal.id });
                                });
                              }}
                            >
                              {t('marshals.endButton')}
                            </Button>
                          </>
                        ) : null}
                      </CardContent>
                    </Card>
                  </li>
                ))}
            </ul>
          )}

          <Dialog
            open={editingMarshal !== null}
            onOpenChange={(o) => {
              if (!o) setEditingMarshal(null);
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t('marshals.editTitle')}</DialogTitle>
              </DialogHeader>
              {editingMarshal !== null ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-marshal-role">{t('marshals.role')}</Label>
                    <select
                      id="edit-marshal-role"
                      value={editingMarshal.role}
                      onChange={(e) =>
                        setEditingMarshal({
                          ...editingMarshal,
                          role: e.target.value === 'deputy' ? 'deputy' : 'marshal',
                        })
                      }
                      className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="marshal">{t('marshals.roles.marshal')}</option>
                      <option value="deputy">{t('marshals.roles.deputy')}</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-marshal-area">{t('marshals.area')}</Label>
                    <Input
                      id="edit-marshal-area"
                      value={editingMarshal.area}
                      onChange={(e) =>
                        setEditingMarshal({ ...editingMarshal, area: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-marshal-trained">{t('marshals.trainedAt')}</Label>
                      <Input
                        id="edit-marshal-trained"
                        type="date"
                        value={editingMarshal.trainedAt}
                        onChange={(e) =>
                          setEditingMarshal({ ...editingMarshal, trainedAt: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-marshal-expires">{t('marshals.expiresAt')}</Label>
                      <Input
                        id="edit-marshal-expires"
                        type="date"
                        value={editingMarshal.trainingExpiresAt}
                        onChange={(e) =>
                          setEditingMarshal({
                            ...editingMarshal,
                            trainingExpiresAt: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              ) : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditingMarshal(null)}>
                  {t('cancel')}
                </Button>
                <Button
                  disabled={updateMarshal.isPending}
                  onClick={() => {
                    if (editingMarshal === null) return;
                    updateMarshal.mutate({
                      marshalId: editingMarshal.id,
                      role: editingMarshal.role,
                      area: editingMarshal.area,
                      trainedAt:
                        editingMarshal.trainedAt === ''
                          ? null
                          : parsePerformedDateInput(editingMarshal.trainedAt),
                      trainingExpiresAt:
                        editingMarshal.trainingExpiresAt === ''
                          ? null
                          : parseDateInput(editingMarshal.trainingExpiresAt),
                    });
                  }}
                >
                  {updateMarshal.isPending ? t('saving') : t('marshals.saveMarshal')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </section>
      ) : null}

      {/* ── FRAs ────────────────────────────────────────────────────── */}
      {tab === 'fras' ? (
        <section className="space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{t('fra.intro')}</p>
            {canCreate && !archived ? (
              <Button
                onClick={() =>
                  createFra.mutate({
                    title: t('fra.defaultTitle', { building: building.name }),
                    buildingId,
                  })
                }
                disabled={createFra.isPending}
              >
                {t('fra.newButton')}
              </Button>
            ) : null}
          </div>
          {building.fras.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('fra.empty')}</p>
          ) : (
            /* The inspections-register table shape: who conducted it, when
               it started, where it stands, one predictable action per row. */
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40 text-left">
                      <tr>
                        <th className="px-3 py-2 font-medium">{t('fra.table.assessment')}</th>
                        <th className="w-36 px-3 py-2 font-medium">{t('fra.table.conductedBy')}</th>
                        <th className="w-32 px-3 py-2 font-medium">{t('fra.table.started')}</th>
                        <th className="w-28 px-3 py-2 font-medium">{t('fra.table.status')}</th>
                        <th className="w-32 px-3 py-2 font-medium">{t('fra.table.review')}</th>
                        <th className="w-28 px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {building.fras.map((fra) => (
                        <tr key={fra.id} className="border-b last:border-0 hover:bg-muted/10">
                          <td className="px-3 py-3">
                            <Link
                              href={`/${locale}/fire-safety/fra/${fra.id}`}
                              className="font-medium hover:underline"
                            >
                              {fra.title}
                            </Link>
                            <span className="mt-0.5 flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground">
                                {fra.referenceNumber}
                              </span>
                              <RiskRatingChip rating={fra.riskRating} />
                            </span>
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">
                            {fra.assessorName !== '' ? fra.assessorName : '—'}
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">
                            {formatDate(fra.createdAt, locale)}
                          </td>
                          <td className="px-3 py-3">
                            <FraStatusChip status={fra.status} />
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">
                            {fra.nextReviewAt !== null
                              ? formatDate(fra.nextReviewAt, locale)
                              : t('fra.notPublished')}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <Button
                              asChild
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-primary"
                            >
                              <Link href={`/${locale}/fire-safety/fra/${fra.id}`}>
                                {fra.status === 'draft'
                                  ? t('fra.table.continue')
                                  : t('fra.table.view')}
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      ) : null}

      {/* ── Info ────────────────────────────────────────────────────── */}
      {tab === 'info' ? (
        <section className="space-y-5">
          <Card>
            <CardContent className="space-y-4 p-5">
              <h2 className="text-sm font-semibold">{t('info.profileHeading')}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="info-name">{t('create.name')}</Label>
                  <Input
                    id="info-name"
                    value={String(info['name'])}
                    onChange={(e) => setInfo('name', e.target.value)}
                    disabled={!canManage || archived}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="info-address">{t('create.address')}</Label>
                  <Input
                    id="info-address"
                    value={String(info['address'])}
                    onChange={(e) => setInfo('address', e.target.value)}
                    disabled={!canManage || archived}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="info-height">{t('create.heightMetres')}</Label>
                  <Input
                    id="info-height"
                    type="number"
                    min="1"
                    step="0.1"
                    value={String(info['heightMetres'])}
                    onChange={(e) => setInfo('heightMetres', e.target.value)}
                    disabled={!canManage || archived}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="info-storeys">{t('create.storeys')}</Label>
                  <Input
                    id="info-storeys"
                    type="number"
                    min="1"
                    step="1"
                    value={String(info['storeys'])}
                    onChange={(e) => setInfo('storeys', e.target.value)}
                    disabled={!canManage || archived}
                  />
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    'isResidential',
                    'hasFireAlarm',
                    'hasEmergencyLighting',
                    'hasSprinklers',
                    'hasDampers',
                    'hasRisers',
                  ] as const
                ).map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(info[key])}
                      onChange={(e) => setInfo(key, e.target.checked)}
                      disabled={!canManage || archived}
                      className="h-4 w-4"
                    />
                    {key === 'isResidential' ? t('create.isResidential') : t(`create.flags.${key}`)}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t('info.resyncNote')}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-5">
              <h2 className="text-sm font-semibold">{t('info.frsHeading')}</h2>
              <p className="text-xs text-muted-foreground">{t('info.frsIntro')}</p>
              <div className="space-y-1.5">
                <Label htmlFor="info-use">{t('create.useDescription')}</Label>
                <Textarea
                  id="info-use"
                  rows={2}
                  value={String(info['useDescription'])}
                  onChange={(e) => setInfo('useDescription', e.target.value)}
                  disabled={!canManage || archived}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="info-ews">{t('info.externalWallSystem')}</Label>
                <Textarea
                  id="info-ews"
                  rows={2}
                  value={String(info['externalWallSystem'])}
                  onChange={(e) => setInfo('externalWallSystem', e.target.value)}
                  disabled={!canManage || archived}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="info-compartmentation">{t('info.compartmentation')}</Label>
                <Textarea
                  id="info-compartmentation"
                  rows={2}
                  value={String(info['compartmentationNotes'])}
                  onChange={(e) => setInfo('compartmentationNotes', e.target.value)}
                  disabled={!canManage || archived}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="info-escape">{t('info.meansOfEscape')}</Label>
                <Textarea
                  id="info-escape"
                  rows={2}
                  value={String(info['meansOfEscapeNotes'])}
                  onChange={(e) => setInfo('meansOfEscapeNotes', e.target.value)}
                  disabled={!canManage || archived}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="info-risers">{t('info.serviceRisers')}</Label>
                <Textarea
                  id="info-risers"
                  rows={2}
                  value={String(info['serviceRisersNotes'])}
                  onChange={(e) => setInfo('serviceRisersNotes', e.target.value)}
                  disabled={!canManage || archived}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="info-box">{t('info.secureInfoBox')}</Label>
                <Input
                  id="info-box"
                  value={String(info['secureInfoBoxLocation'])}
                  onChange={(e) => setInfo('secureInfoBoxLocation', e.target.value)}
                  disabled={!canManage || archived}
                  placeholder={
                    building.duty.highRiseResidential ? t('info.secureInfoBoxRequired') : ''
                  }
                />
              </div>
            </CardContent>
          </Card>

          {canManage && !archived ? (
            <div className="flex justify-end">
              <Button onClick={saveInfo} disabled={infoDraft === null || updateBuilding.isPending}>
                {t('info.saveButton')}
              </Button>
            </div>
          ) : null}

          {/* Hot work runs through the Permit to Work module — ignition
              sources during construction and maintenance are controlled
              there, not duplicated here. */}
          <Card>
            <CardContent className="space-y-2 p-6">
              <h2 className="text-sm font-semibold">{t('hotWork.title')}</h2>
              <p className="text-sm text-muted-foreground">{t('hotWork.intro')}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button asChild size="sm">
                  <Link href={`/${locale}/permits/new`}>{t('hotWork.startPermit')}</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/${locale}/permits`}>{t('hotWork.register')}</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </main>
  );
}
