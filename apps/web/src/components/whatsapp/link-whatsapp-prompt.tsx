'use client';

/**
 * "Get this on WhatsApp" — the sidebar prompt shown to signed-in users who
 * have no phone number on file, pinned just above Settings.
 *
 * Tapping it opens a dialog with a `wa.me` deep link and the same link as a
 * QR code. Opening the link pre-types a one-time code into WhatsApp; sending
 * it hands us the number, and the webhook replies with the welcome message.
 *
 * The user never types their number and we never trust a typed one: the code
 * arriving from a handset is itself the proof. It is also what opens
 * WhatsApp's 24-hour window, without which our welcome reply would need an
 * approved message template.
 *
 * Renders nothing when the brand has no WhatsApp number configured, or once
 * the user has a number — the prompt is a task, and a finished task should
 * leave the menu rather than sit there ticked.
 */
import { QRCodeCanvas } from 'qrcode.react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { buildWhatsAppLinkUrl } from '@forma360/shared/whatsapp-link';
import { activeBrand } from '../../lib/brand';
import { trpc } from '../../lib/trpc/client';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { WhatsAppIcon } from './whatsapp-icon';

const QR_SIZE = 200;

/**
 * Published at build time so the client can build the link. Absent for brands
 * with no WhatsApp number (Forma360 today), which is what hides the prompt.
 */
const BUSINESS_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '';

export function LinkWhatsAppPrompt({ collapsed }: { collapsed: boolean }) {
  const t = useTranslations('whatsappLink');
  const [open, setOpen] = useState(false);

  // Only asked for once the number is configured — no point minting codes for
  // a brand that cannot receive them.
  const link = trpc.users.whatsappLink.useQuery(undefined, {
    enabled: BUSINESS_NUMBER !== '',
    staleTime: 5 * 60 * 1000,
  });

  if (BUSINESS_NUMBER === '') return null;
  if (link.data === undefined || link.data.hasPhone) return null;
  const code = link.data.code;
  if (code === null) return null;

  const url = buildWhatsAppLinkUrl(BUSINESS_NUMBER, code);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm',
          'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
          collapsed && 'justify-center px-0',
        )}
        {...(collapsed ? { title: t('navLabel'), 'aria-label': t('navLabel') } : {})}
      >
        <WhatsAppIcon className="h-4 w-4 shrink-0" />
        {collapsed ? null : <span className="truncate">{t('navLabel')}</span>}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('dialogTitle', { brand: activeBrand.name })}</DialogTitle>
            <DialogDescription>{t('dialogBody', { brand: activeBrand.name })}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-2">
            {/* Phone: one tap is the whole flow. */}
            <Button asChild className="w-full sm:hidden">
              <a href={url} target="_blank" rel="noreferrer">
                {t('openWhatsApp')}
              </a>
            </Button>

            {/* Desktop: the phone that will be linked is the one that scans. */}
            <div className="hidden flex-col items-center gap-3 sm:flex">
              <div className="rounded-lg bg-white p-3">
                <QRCodeCanvas value={url} size={QR_SIZE} level="M" marginSize={2} />
              </div>
              <p className="text-center text-xs text-muted-foreground">{t('scanHint')}</p>
            </div>

            <p className="text-center text-xs text-muted-foreground">{t('sendHint')}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
