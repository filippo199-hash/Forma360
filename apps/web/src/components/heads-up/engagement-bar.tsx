'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { SignaturePad } from '../inspections/signature-pad';
import { trpc } from '../../lib/trpc/client';

type EngagementLevel = 'view' | 'acknowledge' | 'sign';

/**
 * Sticky recipient action bar rendered at the bottom of the heads-up
 * "view" page. It surfaces exactly the verbs the engagement level asks
 * for:
 *   - view       → a passive "Viewed" confirmation (the view is stamped
 *                  by the page on load).
 *   - acknowledge → an Acknowledge button that flips to a done state.
 *   - sign       → a Sign button that opens the SignaturePad dialog.
 *
 * H-E09 (ack-before-sign) is enforced here in the UI as well as on the
 * server: when acknowledgement is required and not yet given, Sign is
 * disabled and we point the user at Acknowledge first.
 *
 * H-E03 (re-sign): if the server clears `signedAt` after it was set
 * (e.g. a newer version was published), we surface a "re-sign required"
 * hint so the recipient knows to sign again.
 */
export function EngagementBar({
  headsUpId,
  engagementLevel,
  requireAcknowledgement,
  requireSignature,
  viewedAt,
  acknowledgedAt,
  signedAt,
}: {
  headsUpId: string;
  engagementLevel: EngagementLevel;
  requireAcknowledgement: boolean;
  requireSignature: boolean;
  viewedAt: Date | string | null;
  acknowledgedAt: Date | string | null;
  signedAt: Date | string | null;
}) {
  const t = useTranslations('headsUp.inbox');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();

  const [signOpen, setSignOpen] = useState(false);

  // Track whether the recipient has previously signed so we can detect a
  // server-side revert to `null` (H-E03) and prompt for a re-sign.
  const hadSignedRef = useRef(signedAt !== null);
  const [reSignRequired, setReSignRequired] = useState(false);
  useEffect(() => {
    if (signedAt !== null) {
      hadSignedRef.current = true;
      setReSignRequired(false);
    } else if (hadSignedRef.current) {
      setReSignRequired(true);
    }
  }, [signedAt]);

  const invalidate = () => {
    void utils.headsUps.getForRecipient.invalidate({ headsUpId });
    void utils.headsUps.listForRecipient.invalidate();
  };

  const acknowledge = trpc.headsUps.markAcknowledged.useMutation({
    onSuccess: () => {
      toast.success(t('acknowledgedToast'));
      invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const sign = trpc.headsUps.sign.useMutation({
    onSuccess: () => {
      toast.success(t('signedToast'));
      setSignOpen(false);
      invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const isViewed = viewedAt !== null;
  const isAcknowledged = acknowledgedAt !== null;
  const isSigned = signedAt !== null;

  const showAcknowledge = requireAcknowledgement || engagementLevel === 'acknowledge';
  const showSign = requireSignature || engagementLevel === 'sign';
  const signBlockedByAck = showAcknowledge && !isAcknowledged;

  return (
    <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
        {/* Passive viewed confirmation */}
        {isViewed ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
            <Check className="h-4 w-4" />
            {t('viewedBadge')}
          </span>
        ) : null}

        {/* Acknowledge */}
        {showAcknowledge ? (
          isAcknowledged ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
              <Check className="h-4 w-4" />
              {t('acknowledgedBadge')}
            </span>
          ) : (
            <Button
              type="button"
              onClick={() => acknowledge.mutate({ headsUpId })}
              disabled={acknowledge.isPending}
            >
              {t('acknowledgeButton')}
            </Button>
          )
        ) : null}

        {/* Sign */}
        {showSign ? (
          <div className="flex flex-col items-end gap-1">
            {isSigned && !reSignRequired ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
                <Check className="h-4 w-4" />
                {t('signedBadge')}
              </span>
            ) : (
              <Button
                type="button"
                onClick={() => setSignOpen(true)}
                disabled={signBlockedByAck || sign.isPending}
              >
                {t('signButton')}
              </Button>
            )}
            {reSignRequired ? (
              <span className="text-xs text-destructive">{t('reSignRequired')}</span>
            ) : signBlockedByAck ? (
              <span className="text-xs text-muted-foreground">{t('needsAck')}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <Dialog open={signOpen} onOpenChange={setSignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('signButton')}</DialogTitle>
          </DialogHeader>
          <SignaturePad
            saving={sign.isPending}
            onSave={({ signatureData }) => sign.mutate({ headsUpId, signatureData })}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
