'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';

/**
 * Comment composer for an observation (issue). The backend
 * (`issues.comments.create`) and the activity feed's `commented` events
 * already exist — this wires the missing UI so users can actually discuss
 * an observation. Invalidation is delegated to `onAdded` so each surface
 * (list Sheet vs full detail page) can refresh its own queries.
 */
export function ObservationCommentComposer({
  observationId,
  onAdded,
}: {
  observationId: string;
  onAdded: () => void;
}) {
  const t = useTranslations('issues.detail.comments');
  const tCommon = useTranslations('common');
  const [body, setBody] = useState('');

  const create = trpc.issues.comments.create.useMutation({
    onSuccess: () => {
      setBody('');
      onAdded();
    },
    onError: (e) => toast.error(e.message.length > 0 ? e.message : tCommon('error')),
  });

  function submit() {
    const value = body.trim();
    if (value.length === 0 || create.isPending) return;
    create.mutate({ issueId: observationId, body: value });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-2"
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        maxLength={5000}
        placeholder={t('placeholder')}
        aria-label={t('placeholder')}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter submits, matching common chat conventions.
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={body.trim().length === 0 || create.isPending}>
          {t('addButton')}
        </Button>
      </div>
    </form>
  );
}
