'use client';

/**
 * Share-link dialog for the inspection status page.
 *
 * Opens a modal with:
 *   - an expiration dropdown (never, 1 hour, 1 day, 1 week, 30 days)
 *   - a "Generate link" button that mints a row + copies the URL
 *   - a live list of existing links with a "Revoke" action
 *
 * The generated URL is presented read-only with a Copy button; we
 * never expose the raw token anywhere else.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { Label } from './ui/label';
import { trpc } from '../lib/trpc/client';

interface Props {
  inspectionId: string;
}

type Expiration = 'never' | '1h' | '1d' | '1w' | '30d';

const EXPIRATION_MS: Record<Exclude<Expiration, 'never'>, number> = {
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export function ShareLinkDialog({ inspectionId }: Props) {
  const t = useTranslations('inspections.exports');
  const [open, setOpen] = useState(false);
  const [expiration, setExpiration] = useState<Expiration>('never');
  const [justCopied, setJustCopied] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const list = trpc.exports.listShareLinks.useQuery(
    { inspectionId },
    { enabled: open, staleTime: 0 },
  );
  const createMut = trpc.exports.createShareLink.useMutation({
    onSuccess: () => {
      utils.exports.listShareLinks.invalidate({ inspectionId });
    },
  });
  const revokeMut = trpc.exports.revokeShareLink.useMutation({
    onSuccess: () => {
      utils.exports.listShareLinks.invalidate({ inspectionId });
    },
  });

  const handleCreate = () => {
    const payload: { inspectionId: string; expiresAt?: string } = { inspectionId };
    if (expiration !== 'never') {
      payload.expiresAt = new Date(Date.now() + EXPIRATION_MS[expiration]).toISOString();
    }
    createMut.mutate(payload);
  };

  const handleCopy = async (url: string, linkId: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setJustCopied(linkId);
      setTimeout(() => setJustCopied(null), 1500);
    } catch {
      // Clipboard unavailable — users can still select and copy the
      // text from the read-only input; nothing to do here.
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">{t('shareButton')}</Button>
      </DialogTrigger>

      <DialogContent className="w-full sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('shareDialogTitle')}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
            {t('shareDialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* ── Expiry + Generate ─────────────────────────────────────── */}
          <div className="space-y-2">
            <Label htmlFor="share-expiration">{t('expirationLabel')}</Label>
            <select
              id="share-expiration"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={expiration}
              onChange={(e) => setExpiration(e.target.value as Expiration)}
            >
              <option value="never">{t('expirationNever')}</option>
              <option value="1h">{t('expiration1h')}</option>
              <option value="1d">{t('expiration1d')}</option>
              <option value="1w">{t('expiration1w')}</option>
              <option value="30d">{t('expiration30d')}</option>
            </select>
            <Button onClick={handleCreate} disabled={createMut.isPending} className="w-full">
              {createMut.isPending ? t('generating') : t('generateLink')}
            </Button>
          </div>

          {/* ── Newly generated link ──────────────────────────────────── */}
          {createMut.data !== undefined
            ? (() => {
                const newUrl = createMut.data.url;
                return (
                  <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                    <Label htmlFor="share-url-new">{t('newLinkLabel')}</Label>
                    <div className="flex items-center gap-2">
                      <input
                        id="share-url-new"
                        readOnly
                        value={newUrl}
                        className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => handleCopy(newUrl, 'new')}
                      >
                        {justCopied === 'new' ? t('copied') : t('copy')}
                      </Button>
                    </div>
                  </div>
                );
              })()
            : null}

          {/* ── Existing links ────────────────────────────────────────── */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t('existingLinksHeading')}</h3>

            {list.isLoading ? (
              <p className="text-sm text-muted-foreground">{t('loading')}</p>
            ) : null}

            {list.data !== undefined && list.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noLinks')}</p>
            ) : null}

            {list.data?.map((link) => (
              <div key={link.linkId} className="overflow-hidden rounded-md border text-xs">
                {/* URL row */}
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-foreground">
                    {link.url}
                  </span>
                  {!link.revoked ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 px-2 text-xs"
                      onClick={() => handleCopy(link.url, link.linkId)}
                    >
                      {justCopied === link.linkId ? t('copied') : t('copy')}
                    </Button>
                  ) : null}
                </div>

                {/* Meta + actions row */}
                <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="text-muted-foreground">
                    {link.revoked
                      ? t('revokedBadge')
                      : link.expired
                        ? t('expiredBadge')
                        : link.expiresAt !== null
                          ? t('expiresAt', { time: new Date(link.expiresAt).toLocaleString() })
                          : t('neverExpires')}
                  </span>
                  {!link.revoked ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => revokeMut.mutate({ linkId: link.linkId })}
                      disabled={revokeMut.isPending}
                    >
                      {t('revoke')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
