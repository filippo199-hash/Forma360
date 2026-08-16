'use client';

import { AlertTriangle, Boxes, HardHat, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { contractorErrorMessage } from '../../lib/contractor-errors';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { appConfirm } from '../ui/app-confirm';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Skeleton } from '../ui/skeleton';

/** Shared skeleton shown while a link list is loading. */
function LinkListSkeleton() {
  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-4 w-4 shrink-0 rounded" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Shared error card so a failed load isn't mistaken for an empty list. */
function LinkListError({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm text-destructive">
        <AlertTriangle className="h-5 w-5" />
        {message}
      </CardContent>
    </Card>
  );
}

/** "Serviced assets" section for a contractor's detail page. */
export function ContractorAssetsSection({
  contractorId,
  canManage,
}: {
  contractorId: string;
  canManage: boolean;
}) {
  const t = useTranslations('contractors');
  const utils = trpc.useUtils();
  const linksQ = trpc.contractors.assets.listForContractor.useQuery({ contractorId });
  const assetsQ = trpc.assets.list.useQuery(undefined, { retry: false });

  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState('');
  const [note, setNote] = useState('');

  const refresh = () =>
    void utils.contractors.assets.listForContractor.invalidate({ contractorId });
  const onErr = (err: { message: string }) => toast.error(contractorErrorMessage(err.message, t));

  const link = trpc.contractors.assets.link.useMutation({
    onSuccess: () => {
      toast.success(t('assets.linkedToast'));
      refresh();
      setOpen(false);
      setAssetId('');
      setNote('');
    },
    onError: onErr,
  });
  const unlink = trpc.contractors.assets.unlink.useMutation({
    onSuccess: refresh,
    onError: onErr,
  });

  const links = linksQ.data ?? [];
  const linkedIds = useMemo(() => new Set(links.map((l) => l.assetId)), [links]);
  const available = (assetsQ.data?.assets ?? []).filter(
    (a) => a.archivedAt === null && !linkedIds.has(a.id),
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t('assets.heading')}</h2>
          <p className="text-sm text-muted-foreground">{t('assets.contractorSubtitle')}</p>
        </div>
        {canManage ? (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('assets.linkAsset')}
          </Button>
        ) : null}
      </div>

      {linksQ.isLoading ? (
        <LinkListSkeleton />
      ) : linksQ.error ? (
        <LinkListError message={t('error')} />
      ) : links.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <Boxes className="h-5 w-5" />
            {t('assets.noAssets')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {links.map((l) => {
                const detail = [l.typeName, l.siteName, l.note].filter(Boolean).join(' · ');
                return (
                  <li key={l.linkId} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <Boxes className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium" title={l.name}>
                        {l.name}
                      </p>
                      <p
                        className="truncate text-xs text-muted-foreground"
                        title={detail || undefined}
                      >
                        {detail || '—'}
                      </p>
                    </div>
                    {canManage ? (
                      <button
                        type="button"
                        aria-label={t('assets.unlink')}
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          void appConfirm({
                            description: t('assets.unlinkConfirm'),
                            destructive: true,
                          }).then((ok) => {
                            if (ok) unlink.mutate({ id: l.linkId });
                          });
                        }}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('assets.linkAsset')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ca-asset">{t('assets.assetLabel')}</Label>
              <select
                id="ca-asset"
                value={assetId}
                onChange={(e) => setAssetId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t('assets.selectAsset')}</option>
                {available.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ca-note">{t('assets.noteLabel')}</Label>
              <Input
                id="ca-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                placeholder={t('assets.notePlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={link.isPending || assetId === ''}
              onClick={() =>
                link.mutate({
                  contractorId,
                  assetId,
                  ...(note.trim() !== '' ? { note: note.trim() } : {}),
                })
              }
            >
              {t('assets.linkAsset')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** "Contractors" section for an asset's detail page. */
export function AssetContractorsSection({
  assetId,
  canManage,
}: {
  assetId: string;
  canManage: boolean;
}) {
  const t = useTranslations('contractors');
  const utils = trpc.useUtils();
  const linksQ = trpc.contractors.assets.listForAsset.useQuery({ assetId });
  const contractorsQ = trpc.contractors.list.useQuery({ limit: 200 }, { retry: false });

  const [open, setOpen] = useState(false);
  const [contractorId, setContractorId] = useState('');
  const [note, setNote] = useState('');

  const refresh = () => void utils.contractors.assets.listForAsset.invalidate({ assetId });
  const onErr = (err: { message: string }) => toast.error(contractorErrorMessage(err.message, t));

  const link = trpc.contractors.assets.link.useMutation({
    onSuccess: () => {
      toast.success(t('assets.linkedToast'));
      refresh();
      setOpen(false);
      setContractorId('');
      setNote('');
    },
    onError: onErr,
  });
  const unlink = trpc.contractors.assets.unlink.useMutation({ onSuccess: refresh, onError: onErr });

  const links = linksQ.data ?? [];
  const linkedIds = useMemo(() => new Set(links.map((l) => l.contractorId)), [links]);
  const available = (contractorsQ.data?.contractors ?? []).filter((c) => !linkedIds.has(c.id));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t('assets.assetHeading')}</h2>
          <p className="text-sm text-muted-foreground">{t('assets.assetSubtitle')}</p>
        </div>
        {canManage ? (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('assets.linkContractor')}
          </Button>
        ) : null}
      </div>

      {linksQ.isLoading ? (
        <LinkListSkeleton />
      ) : linksQ.error ? (
        <LinkListError message={t('error')} />
      ) : links.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <HardHat className="h-5 w-5" />
            {t('assets.noContractors')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {links.map((l) => {
                const detail = [l.category, l.note].filter(Boolean).join(' · ');
                return (
                  <li key={l.linkId} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <HardHat className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium" title={l.name}>
                        {l.name}
                      </p>
                      <p
                        className="truncate text-xs text-muted-foreground"
                        title={detail || undefined}
                      >
                        {detail || '—'}
                      </p>
                    </div>
                    {canManage ? (
                      <button
                        type="button"
                        aria-label={t('assets.unlink')}
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          void appConfirm({
                            description: t('assets.unlinkConfirm'),
                            destructive: true,
                          }).then((ok) => {
                            if (ok) unlink.mutate({ id: l.linkId });
                          });
                        }}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('assets.linkContractor')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ac-contractor">{t('assets.contractorLabel')}</Label>
              <select
                id="ac-contractor"
                value={contractorId}
                onChange={(e) => setContractorId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t('assets.selectContractor')}</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac-note">{t('assets.noteLabel')}</Label>
              <Input
                id="ac-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                placeholder={t('assets.notePlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={link.isPending || contractorId === ''}
              onClick={() =>
                link.mutate({
                  contractorId,
                  assetId,
                  ...(note.trim() !== '' ? { note: note.trim() } : {}),
                })
              }
            >
              {t('assets.linkContractor')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
