'use client';

import { MoreHorizontal, QrCode as QrCodeIcon, RotateCw, ShieldOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CreateQrCodeSheet } from '../../../../src/components/observations/create-qr-code-sheet';
import { ShowQrCodeDialog } from '../../../../src/components/observations/show-qr-code-dialog';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../src/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../../src/components/ui/dropdown-menu';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

interface QrCodeRow {
  categoryId: string;
  categoryName: string;
  createdAt: Date;
  publicShareToken: string;
}

/**
 * QR codes admin tab. Lists every observation category that currently
 * has a `publicShareToken` and offers per-row actions for showing,
 * rotating, and revoking the token. Creation flows through a side-sheet
 * that calls `issues.categories.generateShareToken`.
 *
 * Gated by `issues.settings`. Server still enforces the permission
 * checks on every mutation — the UI gate is just to avoid showing the
 * tab body to non-admins. Unauthorised users land back on the
 * observations list with a toast.
 *
 * The displayed QR URL is built client-side from
 * `window.location.origin + /scan/{token}` so it follows the host the
 * page is being viewed on. The backend's `url` field is intentionally
 * ignored — the source-of-truth URL is the client-rendered one.
 */
export default function QrCodesPage() {
  const t = useTranslations('issues.qrCodes');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();
  const utils = trpc.useUtils();

  const canManageSettings = useHasPermission('issues.settings');
  useEffect(() => {
    if (!canManageSettings) {
      toast.error(tCommon('error'));
      router.push(`/${locale}/observations`);
    }
  }, [canManageSettings, locale, router, tCommon]);

  const { data: categories, isLoading } = trpc.issues.categories.list.useQuery(
    { includeArchived: false },
    { enabled: canManageSettings },
  );

  const rows: QrCodeRow[] = useMemo(() => {
    const list = categories ?? [];
    return list
      .filter((c) => c.publicShareToken !== null && c.archivedAt === null)
      .map((c) => ({
        categoryId: c.id,
        categoryName: c.name,
        createdAt: c.createdAt,
        // `publicShareToken` is non-null per the filter above.
        publicShareToken: c.publicShareToken ?? '',
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [categories]);

  const availableCategories = useMemo(() => {
    const list = categories ?? [];
    return list.filter((c) => c.publicShareToken === null && c.archivedAt === null);
  }, [categories]);

  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const [showDialog, setShowDialog] = useState<{ open: boolean; row: QrCodeRow | null }>({
    open: false,
    row: null,
  });
  const [rotateConfirm, setRotateConfirm] = useState<QrCodeRow | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<QrCodeRow | null>(null);

  const rotate = trpc.issues.categories.rotateShareToken.useMutation({
    onSuccess: async (result, vars) => {
      toast.success(t('toast.rotated'));
      setRotateConfirm(null);
      await utils.issues.categories.list.invalidate();
      // Re-open the show dialog with the rotated token so the admin can
      // re-download / re-print the fresh QR.
      const row = rows.find((r) => r.categoryId === vars.categoryId);
      if (row !== undefined) {
        setShowDialog({
          open: true,
          row: { ...row, publicShareToken: result.token },
        });
      }
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : t('toast.error')),
  });

  const revoke = trpc.issues.categories.revokeShareToken.useMutation({
    onSuccess: async () => {
      toast.success(t('toast.revoked'));
      setRevokeConfirm(null);
      await utils.issues.categories.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : t('toast.error')),
  });

  if (!canManageSettings) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button onClick={() => setCreateSheetOpen(true)}>
          <QrCodeIcon className="mr-2 h-4 w-4" />
          {t('createButton')}
        </Button>
      </header>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-4 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState onCreate={() => setCreateSheetOpen(true)} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">{t('columns.name')}</th>
                    <th className="px-3 py-2 font-medium">{t('columns.created')}</th>
                    <th className="px-3 py-2 font-medium">{t('columns.site')}</th>
                    <th className="px-3 py-2 font-medium">{t('columns.category')}</th>
                    <th className="px-3 py-2 text-right font-medium">
                      <span className="sr-only">{t('actions.menuLabel')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.categoryId} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setShowDialog({ open: true, row })}
                          className="flex items-center gap-2 font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                          aria-label={t('actions.show')}
                        >
                          <QrCodeIcon
                            className="h-4 w-4 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span>{row.categoryName}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatRelative(row.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">—</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
                          {row.categoryName}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              aria-label={t('actions.menuLabel')}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setShowDialog({ open: true, row })}>
                              <QrCodeIcon className="mr-2 h-4 w-4" />
                              {t('actions.show')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setRotateConfirm(row)}>
                              <RotateCw className="mr-2 h-4 w-4" />
                              {t('actions.rotate')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onSelect={() => setRevokeConfirm(row)}
                            >
                              <ShieldOff className="mr-2 h-4 w-4" />
                              {t('actions.revoke')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateQrCodeSheet
        open={createSheetOpen}
        onOpenChange={setCreateSheetOpen}
        availableCategories={availableCategories.map((c) => ({
          id: c.id,
          name: c.name,
        }))}
        onCreated={async (token, categoryId) => {
          await utils.issues.categories.list.invalidate();
          const cat = (categories ?? []).find((c) => c.id === categoryId);
          if (cat !== undefined) {
            setShowDialog({
              open: true,
              row: {
                categoryId,
                categoryName: cat.name,
                createdAt: cat.createdAt,
                publicShareToken: token,
              },
            });
          }
        }}
      />

      {showDialog.row !== null ? (
        <ShowQrCodeDialog
          open={showDialog.open}
          onOpenChange={(o) => setShowDialog((prev) => ({ ...prev, open: o }))}
          categoryName={showDialog.row.categoryName}
          token={showDialog.row.publicShareToken}
        />
      ) : null}

      <Dialog
        open={rotateConfirm !== null}
        onOpenChange={(o) => {
          if (!o) setRotateConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('rotateConfirm.title')}</DialogTitle>
            <DialogDescription>{t('rotateConfirm.body')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRotateConfirm(null)}>
              {t('rotateConfirm.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (rotateConfirm !== null) {
                  rotate.mutate({ categoryId: rotateConfirm.categoryId });
                }
              }}
              disabled={rotate.isPending}
            >
              {t('rotateConfirm.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={revokeConfirm !== null}
        onOpenChange={(o) => {
          if (!o) setRevokeConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('revokeConfirm.title')}</DialogTitle>
            <DialogDescription>{t('revokeConfirm.body')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRevokeConfirm(null)}>
              {t('revokeConfirm.cancel')}
            </Button>
            <Button
              type="button"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (revokeConfirm !== null) {
                  revoke.mutate({ categoryId: revokeConfirm.categoryId });
                }
              }}
              disabled={revoke.isPending}
            >
              {t('revokeConfirm.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations('issues.qrCodes');
  return (
    <div className="space-y-3 p-10 text-center">
      <QrCodeIcon className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-base font-semibold">{t('empty.title')}</h2>
      <p className="mx-auto max-w-md text-sm text-muted-foreground">{t('empty.body')}</p>
      <div className="pt-2">
        <Button onClick={onCreate}>
          <QrCodeIcon className="mr-2 h-4 w-4" />
          {t('createButton')}
        </Button>
      </div>
    </div>
  );
}

function formatRelative(d: Date | string): string {
  const ms = Date.now() - new Date(d).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
