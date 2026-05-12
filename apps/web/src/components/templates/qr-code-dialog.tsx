'use client';

/**
 * QrCodeDialog — renders a QR code that points at a template's URL.
 *
 * Built for the templates list page's row-actions menu. The QR is rendered
 * onto a canvas via `qrcode.react` so we can also offer a download-as-PNG
 * button (canvas.toDataURL → anchor.click). A read-only input shows the
 * underlying URL and a Copy button writes it to the clipboard.
 *
 * The dialog is presentational — it does not call any tRPC procedures.
 * The URL is built from `window.location.origin` + the locale + the
 * template id, so it works whether we're behind a custom domain or
 * localhost in dev.
 */
import { QRCodeCanvas } from 'qrcode.react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
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

interface QrCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  templateName: string;
}

const QR_SIZE = 240;

export function QrCodeDialog({ open, onOpenChange, templateId, templateName }: QrCodeDialogProps) {
  const t = useTranslations('templates.list.qrDialog');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState('');

  // `window` is not available during SSR — compute the URL once the dialog
  // is open in the browser.
  useEffect(() => {
    if (!open) return;
    if (typeof window === 'undefined') return;
    setUrl(`${window.location.origin}/${locale}/templates/${templateId}`);
  }, [open, locale, templateId]);

  function safeFileName(name: string): string {
    const trimmed = name.trim().replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-');
    return trimmed.length === 0 ? 'template' : trimmed;
  }

  function downloadPng() {
    const node = containerRef.current;
    if (node === null) return;
    const canvas = node.querySelector('canvas');
    if (canvas === null) return;
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${safeFileName(templateName)}.png`;
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
          <DialogTitle>{t('title', { name: templateName })}</DialogTitle>
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
            aria-label={t('description')}
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
