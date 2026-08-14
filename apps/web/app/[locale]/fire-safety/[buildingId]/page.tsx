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
import { useParams, useRouter } from 'next/navigation';
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
import { Card, CardContent } from '../../../../src/components/ui/card';
import { TooltipIconButton } from '../../../../src/components/ui/tooltip-icon-button';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { parseDoorImport } from '@forma360/shared/fire-safety';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

type Tab = 'logbook' | 'doors' | 'drills' | 'peeps' | 'marshals' | 'fras' | 'info';

const TABS: Tab[] = ['logbook', 'doors', 'drills', 'peeps', 'marshals', 'fras', 'info'];

function formatDate(d: Date | string | null | undefined, locale: string): string {
  if (d === null || d === undefined) return '—';
  return new Date(d).toLocaleDateString(locale, { dateStyle: 'medium' });
}

/** yyyy-mm-dd for `<input type="date">`, today by default. */
function dateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse a date input as UTC noon so timezones can't shift the day. */
function parseDateInput(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
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
  const params = useParams<{ locale: string; buildingId: string }>();
  const locale = params.locale ?? 'en';
  const buildingId = params.buildingId ?? '';
  const router = useRouter();
  const utils = trpc.useUtils();

  const canRecord = useHasPermission('fireSafety.record');
  const canCreate = useHasPermission('fireSafety.create');
  const canManage = useHasPermission('fireSafety.manage');
  const [tab, setTab] = useState<Tab>('logbook');

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
    onError: () => toast.error(t('saveError')),
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
    onError: () => toast.error(t('saveError')),
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
    onError: () => toast.error(t('saveError')),
  });
  const archiveDoor = trpc.fireSafety.doors.archive.useMutation({
    onSuccess: () => invalidate(),
    onError: () => toast.error(t('saveError')),
  });

  // ── Drills state ──
  const [drillDate, setDrillDate] = useState(dateInputValue(new Date()));
  const [drillMinutes, setDrillMinutes] = useState('');
  const [drillSeconds, setDrillSeconds] = useState('');
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
  const [peepName, setPeepName] = useState('');
  const [peepNeeds, setPeepNeeds] = useState('');
  const [peepPlan, setPeepPlan] = useState('');
  const [peepBuddy, setPeepBuddy] = useState('');
  const [peepEquipment, setPeepEquipment] = useState('');
  const [peepMonths, setPeepMonths] = useState('12');

  const createPeep = trpc.fireSafety.peeps.create.useMutation({
    onSuccess: () => {
      toast.success(t('peeps.addedToast'));
      setShowAddPeep(false);
      setPeepName('');
      setPeepNeeds('');
      setPeepPlan('');
      setPeepBuddy('');
      setPeepEquipment('');
      invalidate();
    },
    onError: () => toast.error(t('saveError')),
  });
  const reviewPeep = trpc.fireSafety.peeps.recordReview.useMutation({
    onSuccess: () => {
      toast.success(t('peeps.reviewedToast'));
      invalidate();
    },
    onError: () => toast.error(t('saveError')),
  });
  const endPeep = trpc.fireSafety.peeps.end.useMutation({
    onSuccess: () => invalidate(),
    onError: () => toast.error(t('saveError')),
  });

  // ── Marshals state ──
  const [showAddMarshal, setShowAddMarshal] = useState(false);
  const [marshalUserId, setMarshalUserId] = useState('');
  const [marshalRole, setMarshalRole] = useState<'marshal' | 'deputy'>('marshal');
  const [marshalArea, setMarshalArea] = useState('');
  const [marshalTrainedAt, setMarshalTrainedAt] = useState('');
  const [marshalExpiresAt, setMarshalExpiresAt] = useState('');

  const { data: tenantUsers } = trpc.users.list.useQuery(
    {},
    { enabled: showAddMarshal && canManage },
  );

  const addMarshal = trpc.fireSafety.marshals.add.useMutation({
    onSuccess: () => {
      toast.success(t('marshals.addedToast'));
      setShowAddMarshal(false);
      setMarshalUserId('');
      setMarshalArea('');
      setMarshalTrainedAt('');
      setMarshalExpiresAt('');
      invalidate();
    },
    onError: (err) =>
      toast.error(err.data?.code === 'CONFLICT' ? t('marshals.alreadyMarshal') : t('saveError')),
  });
  const endMarshal = trpc.fireSafety.marshals.end.useMutation({
    onSuccess: () => invalidate(),
    onError: () => toast.error(t('saveError')),
  });

  // ── FRA creation ──
  const createFra = trpc.fireSafety.fras.create.useMutation({
    onSuccess: (result) => router.push(`/${locale}/fire-safety/fra/${result.id}`),
    onError: () => toast.error(t('saveError')),
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
    onError: () => toast.error(t('saveError')),
  });
  const archiveBuilding = trpc.fireSafety.buildings.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archivedToast'));
      router.push(`/${locale}/fire-safety`);
    },
    onError: () => toast.error(t('saveError')),
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

  function submitDrill(): void {
    const mins = drillMinutes === '' ? 0 : Number(drillMinutes);
    const secs = drillSeconds === '' ? 0 : Number(drillSeconds);
    const total = mins * 60 + secs;
    recordDrill.mutate({
      buildingId,
      conductedAt: parseDateInput(drillDate),
      evacuationSeconds: drillMinutes === '' && drillSeconds === '' ? null : total,
      peoplePresent: drillPresent === '' ? null : Number(drillPresent),
      peopleAccountedFor: drillAccounted === '' ? null : Number(drillAccounted),
      rollComplete: drillRollComplete,
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
              if (window.confirm(t('archiveConfirm'))) {
                archiveBuilding.mutate({ buildingId });
              }
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
                                  if (window.confirm(t('doors.removeConfirm'))) {
                                    archiveDoor.mutate({ doorId: door.id });
                                  }
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
                    <th className="px-3 py-2 font-medium">{t('drills.columns.lessons')}</th>
                    <th className="w-10 px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {building.drills.map((drill) => (
                    <tr key={drill.id} className="border-b align-top last:border-b-0">
                      <td className="px-3 py-2.5">{formatDate(drill.conductedAt, locale)}</td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {drill.evacuationSeconds === null
                          ? '—'
                          : `${Math.floor(drill.evacuationSeconds / 60)}:${String(
                              drill.evacuationSeconds % 60,
                            ).padStart(2, '0')}`}
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
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{t('peeps.intro')}</p>
            {canCreate && !archived ? (
              <Button variant="outline" onClick={() => setShowAddPeep((v) => !v)}>
                {t('peeps.addButton')}
              </Button>
            ) : null}
          </div>

          {showAddPeep ? (
            <Card>
              <CardContent className="space-y-4 p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="peep-name">{t('peeps.personName')}</Label>
                    <Input
                      id="peep-name"
                      value={peepName}
                      onChange={(e) => setPeepName(e.target.value)}
                    />
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
                    <Label htmlFor="peep-buddy">{t('peeps.buddy')}</Label>
                    <Input
                      id="peep-buddy"
                      value={peepBuddy}
                      onChange={(e) => setPeepBuddy(e.target.value)}
                    />
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
                    disabled={peepName.trim() === '' || createPeep.isPending}
                    onClick={() =>
                      createPeep.mutate({
                        buildingId,
                        personName: peepName.trim(),
                        assistanceNeeds: peepNeeds,
                        planSummary: peepPlan,
                        buddyName: peepBuddy,
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
                                if (window.confirm(t('peeps.endConfirm'))) {
                                  endPeep.mutate({ peepId: peep.id });
                                }
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
                    <Label htmlFor="marshal-user">{t('marshals.user')}</Label>
                    <select
                      id="marshal-user"
                      value={marshalUserId}
                      onChange={(e) => setMarshalUserId(e.target.value)}
                      className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">{t('marshals.selectUser')}</option>
                      {(tenantUsers?.users ?? []).map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
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
                    disabled={marshalUserId === '' || addMarshal.isPending}
                    onClick={() =>
                      addMarshal.mutate({
                        buildingId,
                        userId: marshalUserId,
                        role: marshalRole,
                        area: marshalArea,
                        trainedAt:
                          marshalTrainedAt === '' ? null : parseDateInput(marshalTrainedAt),
                        trainingExpiresAt:
                          marshalExpiresAt === '' ? null : parseDateInput(marshalExpiresAt),
                        notes: '',
                      })
                    }
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
                              {marshal.userName ?? marshal.userId}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {t(`marshals.roles.${marshal.role}`)}
                            </span>
                            <TrainingStatusChip status={marshal.trainingStatus} />
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {marshal.area !== '' ? `${marshal.area} · ` : ''}
                            {marshal.trainingExpiresAt !== null
                              ? t('marshals.expires', {
                                  date: formatDate(marshal.trainingExpiresAt, locale),
                                })
                              : t('marshals.noExpiry')}
                          </p>
                        </div>
                        {canManage && !archived ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (window.confirm(t('marshals.endConfirm'))) {
                                endMarshal.mutate({ marshalId: marshal.id });
                              }
                            }}
                          >
                            {t('marshals.endButton')}
                          </Button>
                        ) : null}
                      </CardContent>
                    </Card>
                  </li>
                ))}
            </ul>
          )}
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
            <ul className="space-y-2">
              {building.fras.map((fra) => (
                <li key={fra.id}>
                  <Link href={`/${locale}/fire-safety/fra/${fra.id}`} className="block">
                    <Card className="transition-colors hover:bg-muted/40">
                      <CardContent className="flex flex-wrap items-center gap-3 p-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {fra.referenceNumber}
                            </span>
                            <span className="font-medium">{fra.title}</span>
                            <FraStatusChip status={fra.status} />
                            <RiskRatingChip rating={fra.riskRating} />
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {fra.nextReviewAt !== null
                              ? t('fra.nextReview', {
                                  date: formatDate(fra.nextReviewAt, locale),
                                })
                              : t('fra.notPublished')}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
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
