'use client';

import {
  AlertTriangle,
  ClipboardCheck,
  Image as ImageIcon,
  MapPin,
  Maximize2,
  Minus,
  Plus,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { toast } from 'sonner';
import { cn } from '../../lib/cn';
import { useHasPermission } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Sheet, SheetContent } from '../ui/sheet';
import { Skeleton } from '../ui/skeleton';

type EntityType = 'note' | 'observation' | 'asset' | 'media' | 'inspection';

const ENTITY_META: Record<EntityType, { color: string; ring: string; Icon: typeof MapPin }> = {
  note: { color: 'bg-slate-500', ring: 'ring-slate-300', Icon: MapPin },
  observation: { color: 'bg-amber-500', ring: 'ring-amber-300', Icon: AlertTriangle },
  asset: { color: 'bg-blue-500', ring: 'ring-blue-300', Icon: Wrench },
  media: { color: 'bg-purple-500', ring: 'ring-purple-300', Icon: ImageIcon },
  inspection: { color: 'bg-emerald-500', ring: 'ring-emerald-300', Icon: ClipboardCheck },
};

const FILTER_TYPES: readonly EntityType[] = ['observation', 'asset', 'inspection', 'media', 'note'];

function fileUrl(storageKey: string): string {
  return `/api/files?key=${encodeURIComponent(storageKey)}`;
}

export function SitePlansViewer({ siteId }: { siteId: string }) {
  const t = useTranslations('sites');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('sites.manage');
  const utils = trpc.useUtils();
  const planFileRef = useRef<HTMLInputElement>(null);

  const { data: plans = [], isLoading: plansLoading } = trpc.sitePlans.listPlans.useQuery({
    siteId,
  });
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const activePlanId = selectedPlanId ?? plans[0]?.id ?? null;
  const activePlan = plans.find((p) => p.id === activePlanId) ?? null;

  const { data: pins = [] } = trpc.sitePlans.listPins.useQuery(
    { planId: activePlanId ?? '' },
    { enabled: activePlanId !== null },
  );

  const [uploading, setUploading] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [typeFilter, setTypeFilter] = useState<EntityType | null>(null);
  const [activePinId, setActivePinId] = useState<string | null>(null);

  // Pin-create dialog state
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [draftType, setDraftType] = useState<EntityType>('note');
  const [draftEntityId, setDraftEntityId] = useState<string>('');
  const [draftLabel, setDraftLabel] = useState<string>('');

  // Pan/zoom
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const panRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const createPlan = trpc.sitePlans.createPlan.useMutation();
  const archivePlan = trpc.sitePlans.archivePlan.useMutation({
    onSuccess: () => {
      void utils.sitePlans.listPlans.invalidate({ siteId });
      void utils.sites.getHub.invalidate({ id: siteId });
      setSelectedPlanId(null);
      toast.success(t('planDeletedToast'));
    },
  });
  const createPin = trpc.sitePlans.createPin.useMutation({
    onSuccess: () => {
      if (activePlanId !== null) void utils.sitePlans.listPins.invalidate({ planId: activePlanId });
      setDraft(null);
      setDraftLabel('');
      setDraftEntityId('');
      setDraftType('note');
    },
  });
  const archivePin = trpc.sitePlans.archivePin.useMutation({
    onSuccess: () => {
      if (activePlanId !== null) void utils.sitePlans.listPins.invalidate({ planId: activePlanId });
      setActivePinId(null);
    },
  });

  // Entity option lists — loaded only while the create dialog is open.
  const optsEnabled = draft !== null;
  const { data: obsList } = trpc.issues.issues.list.useQuery(
    { siteId },
    { enabled: optsEnabled && draftType === 'observation' },
  );
  const { data: assetList } = trpc.assets.list.useQuery(
    { siteId },
    { enabled: optsEnabled && draftType === 'asset' },
  );
  const { data: mediaList } = trpc.siteMedia.list.useQuery(
    { siteId },
    { enabled: optsEnabled && draftType === 'media' },
  );
  const { data: inspList } = trpc.inspections.list.useQuery(
    { siteId },
    { enabled: optsEnabled && draftType === 'inspection' },
  );

  const entityOptions: Array<{ id: string; label: string }> = useMemo(() => {
    if (draftType === 'observation')
      return (obsList?.items ?? []).map((o) => ({
        id: o.id,
        label: o.title,
      }));
    if (draftType === 'asset') return (assetList ?? []).map((a) => ({ id: a.id, label: a.name }));
    if (draftType === 'media')
      return (mediaList ?? []).map((m) => ({
        id: m.id,
        label: m.caption.length > 0 ? m.caption : m.filename,
      }));
    if (draftType === 'inspection')
      return (inspList ?? []).map((i) => ({ id: i.id, label: i.title ?? i.id }));
    return [];
  }, [draftType, obsList, assetList, mediaList, inspList]);

  const visiblePins = typeFilter === null ? pins : pins.filter((p) => p.entityType === typeFilter);
  const activePin = activePinId === null ? null : (pins.find((p) => p.id === activePinId) ?? null);

  async function handlePlanUpload(files: FileList | null) {
    const file = files?.[0];
    if (file === undefined) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set('siteId', siteId);
      form.set('file', file);
      const res = await fetch('/api/upload/site-plan', { method: 'POST', body: form });
      if (!res.ok) {
        toast.error(t('planUploadError'));
        return;
      }
      const body = (await res.json()) as { storageKey: string; filename: string; mimeType: string };
      const created = await createPlan.mutateAsync({
        siteId,
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Plan',
        storageKey: body.storageKey,
        mimeType: body.mimeType,
      });
      await utils.sitePlans.listPlans.invalidate({ siteId });
      await utils.sites.getHub.invalidate({ id: siteId });
      setSelectedPlanId(created.id);
    } finally {
      setUploading(false);
      if (planFileRef.current !== null) planFileRef.current.value = '';
    }
  }

  function onImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!addMode || imgRef.current === null) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setDraft({ x, y });
    setAddMode(false);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (addMode) return;
    panRef.current = { startX: e.clientX, startY: e.clientY, ox: tx, oy: ty };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (panRef.current === null) return;
    setTx(panRef.current.ox + (e.clientX - panRef.current.startX));
    setTy(panRef.current.oy + (e.clientY - panRef.current.startY));
  }
  function onPointerUp() {
    panRef.current = null;
  }
  function zoomBy(factor: number) {
    setScale((s) => Math.min(6, Math.max(1, s * factor)));
  }
  function resetView() {
    setScale(1);
    setTx(0);
    setTy(0);
  }

  function submitPin() {
    if (draft === null || activePlanId === null) return;
    const entityId = draftType === 'note' || draftEntityId === '' ? null : draftEntityId;
    const label =
      draftLabel.trim().length > 0
        ? draftLabel.trim()
        : (entityOptions.find((o) => o.id === draftEntityId)?.label ?? '');
    createPin.mutate({
      planId: activePlanId,
      x: draft.x,
      y: draft.y,
      entityType: draftType,
      entityId,
      label,
    });
  }

  function pinHref(pin: { entityType: string; entityId: string | null }): string | null {
    if (pin.entityId === null) return null;
    if (pin.entityType === 'observation')
      return `/${locale}/observations?observation=${pin.entityId}`;
    if (pin.entityType === 'asset') return `/${locale}/assets/${pin.entityId}`;
    if (pin.entityType === 'inspection') return `/${locale}/inspections/${pin.entityId}`;
    return null;
  }

  if (plansLoading) {
    return <Skeleton className="h-96 w-full rounded-lg" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('plansTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('plansSubtitle')}</p>
        </div>
        {canManage ? (
          <Button onClick={() => planFileRef.current?.click()} disabled={uploading}>
            <Upload className="mr-1.5 h-4 w-4" />
            {uploading ? t('planUploading') : t('planAdd')}
          </Button>
        ) : null}
        <input
          ref={planFileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => void handlePlanUpload(e.target.files)}
        />
      </div>

      {plans.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          {t('plansEmpty')}
        </div>
      ) : (
        <>
          {/* Level switcher */}
          <div className="flex flex-wrap items-center gap-1.5">
            {plans.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setSelectedPlanId(p.id);
                  resetView();
                }}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                  p.id === activePlanId
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-input text-muted-foreground hover:text-foreground',
                )}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Type filter */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTypeFilter(null)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                typeFilter === null
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input text-muted-foreground hover:text-foreground',
              )}
            >
              {t('mediaAllTags')}
            </button>
            {FILTER_TYPES.map((ty2) => (
              <button
                key={ty2}
                type="button"
                onClick={() => setTypeFilter(ty2)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                  typeFilter === ty2
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input text-muted-foreground hover:text-foreground',
                )}
              >
                <span className={cn('h-2 w-2 rounded-full', ENTITY_META[ty2].color)} />
                {t(`pinType_${ty2}` as 'pinType_note')}
              </button>
            ))}
          </div>

          {activePlan !== null && activePlan.kind === 'pdf' ? (
            <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
              <p>{t('planPdfNotice')}</p>
              <a
                href={fileUrl(activePlan.storageKey)}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-primary underline"
              >
                {t('planOpenPdf')}
              </a>
            </div>
          ) : activePlan !== null ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button
                  variant={addMode ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setAddMode((v) => !v)}
                >
                  <MapPin className="mr-1.5 h-4 w-4" />
                  {addMode ? t('planDropCancel') : t('planDropPin')}
                </Button>
                <div className="ml-auto flex items-center gap-1">
                  <Button variant="outline" size="icon" onClick={() => zoomBy(1 / 1.2)}>
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => zoomBy(1.2)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={resetView}>
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (window.confirm(t('planDeleteConfirm')))
                          archivePlan.mutate({ id: activePlan.id });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>

              <div
                className={cn(
                  'relative h-[62vh] overflow-hidden rounded-lg border bg-muted/40',
                  addMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing',
                )}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)}
              >
                <div
                  className="absolute left-0 top-0 origin-top-left"
                  style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
                >
                  <div className="relative">
                    <img
                      ref={imgRef}
                      src={fileUrl(activePlan.storageKey)}
                      alt={activePlan.name}
                      className="block max-w-none select-none"
                      draggable={false}
                      onClick={onImageClick}
                    />
                    {visiblePins.map((pin) => {
                      const meta = ENTITY_META[(pin.entityType as EntityType) ?? 'note'];
                      const Icon = meta.Icon;
                      return (
                        <button
                          key={pin.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActivePinId(pin.id);
                          }}
                          className={cn(
                            'absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-white shadow ring-2',
                            meta.color,
                            meta.ring,
                          )}
                          style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
                          title={pin.label}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('planHint')}</p>
            </div>
          ) : null}
        </>
      )}

      {/* Create-pin dialog */}
      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('planNewPin')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pin-type">{t('planPinType')}</Label>
              <select
                id="pin-type"
                value={draftType}
                onChange={(e) => {
                  setDraftType(e.target.value as EntityType);
                  setDraftEntityId('');
                }}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {(['note', 'observation', 'asset', 'inspection', 'media'] as const).map((ty3) => (
                  <option key={ty3} value={ty3}>
                    {t(`pinType_${ty3}` as 'pinType_note')}
                  </option>
                ))}
              </select>
            </div>

            {draftType !== 'note' ? (
              <div className="space-y-1.5">
                <Label htmlFor="pin-entity">{t('planPinLink')}</Label>
                <select
                  id="pin-entity"
                  value={draftEntityId}
                  onChange={(e) => setDraftEntityId(e.target.value)}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">{t('planPinLinkNone')}</option>
                  {entityOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="pin-label">{t('planPinLabel')}</Label>
              <Input
                id="pin-label"
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                placeholder={t('planPinLabelPlaceholder')}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t('mediaCompareCancel')}
            </Button>
            <Button onClick={submitPin} disabled={createPin.isPending}>
              {t('planPinSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pin detail side sheet */}
      <Sheet open={activePin !== null} onOpenChange={(o) => !o && setActivePinId(null)}>
        <SheetContent className="w-full sm:max-w-md">
          {activePin !== null ? (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-white',
                    ENTITY_META[(activePin.entityType as EntityType) ?? 'note'].color,
                  )}
                >
                  {(() => {
                    const Icon = ENTITY_META[(activePin.entityType as EntityType) ?? 'note'].Icon;
                    return <Icon className="h-4 w-4" />;
                  })()}
                </span>
                <div>
                  <div className="font-medium">
                    {activePin.label.length > 0 ? activePin.label : t('planPinUntitled')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t(
                      `pinType_${(activePin.entityType as EntityType) ?? 'note'}` as 'pinType_note',
                    )}
                  </div>
                </div>
              </div>

              {pinHref(activePin) !== null ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={pinHref(activePin) as string}>{t('planPinView')}</Link>
                </Button>
              ) : null}

              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={archivePin.isPending}
                  onClick={() => archivePin.mutate({ id: activePin.id })}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  {t('planPinDelete')}
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
