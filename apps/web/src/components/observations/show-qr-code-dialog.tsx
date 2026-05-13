'use client';

/**
 * ShowQrCodeDialog — renders the QR code that links to the public
 * `/scan/{token}` landing page for an observation category. Adapted from
 * the templates QR dialog: same canvas-based renderer (so we can offer
 * download-as-PNG via `canvas.toDataURL`), same read-only URL input +
 * Copy / Download buttons.
 *
 * The URL is computed client-side from `window.location.origin` so the
 * generated QR always points at the host the admin is viewing the app
 * on — works for localhost, preview deploys, and the production custom
 * domain alike.
 */
import { QRCodeCanvas } from 'qrcode.react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';

interface ShowQrCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryName: string;
  token: string;
}

const QR_SIZE = 240;

export function ShowQrCodeDialog({
  open,
  onOpenChange,
  categoryName,
  token,
}: ShowQrCodeDialogProps) {
  const t = useTranslations('issues.qrCodes.showDialog');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState('');

  // `window` is not defined during SSR; compute the URL only when the
  // dialog is mounted in the browser.
  useEffect(() => {
    if (!open) return;
    if (typeof window === 'undefined') return;
    setUrl(`${window.location.origin}/scan/${token}`);
  }, [open, token]);

  function safeFileName(name: string): string {
    const trimmed = name
      .trim()
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/-+/g, '-');
    return trimmed.length === 0 ? 'qr-code' : trimmed;
  }

  function downloadPng() {
    const node = containerRef.current;
    if (node === null) return;
    const canvas = node.querySelector('canvas');
    if (canvas === null) return;
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${safeFileName(categoryName)}-qr.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function copyLink() {
    if (url.length === 0) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('copySuccess'));
    } catch {
      toast.error(t('copySuccess'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title', { name: categoryName })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div ref={containerRef} className="flex flex-col items-center gap-4 py-2">
          {url.length === 0 ? (
            <div
              className="rounded-md bg-muted"
              style={{ height: QR_SIZE, width: QR_SIZE }}
              aria-hidden
            />
          ) : (
            <QRCodeCanvas value={url} size={QR_SIZE} level="M" marginSize={4} />
          )}
          <Input
            readOnly
            value={url}
            className="font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
            aria-label={t('urlLabel')}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={copyLink} disabled={url.length === 0}>
            {t('copyButton')}
          </Button>
          <Button type="button" onClick={downloadPng} disabled={url.length === 0}>
            {t('downloadButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
