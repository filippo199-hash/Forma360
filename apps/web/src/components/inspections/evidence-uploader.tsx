'use client';

import { evidenceKey, getEvidenceKeys } from '@forma360/shared/inspection-eval';
import { Paperclip, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '../../lib/cn';
import { useConduct } from './conduct-context';

/**
 * Evidence capture for a question whose selected option fires a
 * `requireEvidence` trigger. The inspector must attach at least `need`
 * files (image / video / document) before the inspection can be submitted.
 * Files are stored under a reserved response-map key (`evidence:<itemId>`),
 * separate from the question's own answer.
 */
export function EvidenceUploader({
  itemId,
  need,
  readonly,
}: {
  itemId: string;
  need: number;
  readonly: boolean;
}) {
  const t = useTranslations('inspections.conduct.evidence');
  const tConduct = useTranslations('inspections.conduct');
  const { state, dispatch } = useConduct();
  const keys = getEvidenceKeys(state.responses, itemId);
  const [uploading, setUploading] = useState(false);
  const satisfied = keys.length >= need;

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('inspectionId', state.inspectionId);
      form.append('itemId', itemId);
      form.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error(`upload failed ${res.status}`);
      const body = (await res.json()) as { key: string };
      dispatch({ type: 'SET_RESPONSE', itemId: evidenceKey(itemId), value: [...keys, body.key] });
    } catch {
      toast.error(tConduct('uploadError'));
    } finally {
      setUploading(false);
    }
  }

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file !== undefined) {
      await upload(file);
      e.target.value = '';
    }
  }

  function remove(key: string) {
    dispatch({
      type: 'SET_RESPONSE',
      itemId: evidenceKey(itemId),
      value: keys.filter((k) => k !== key),
    });
  }

  return (
    <div
      className={cn(
        'mt-2 rounded-md border border-dashed p-3',
        satisfied ? 'border-border bg-muted/30' : 'border-amber-300 bg-amber-50/60',
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-medium">
        <Paperclip className="h-3.5 w-3.5" />
        <span className={satisfied ? 'text-muted-foreground' : 'text-amber-800'}>
          {t('label', { have: keys.length, need })}
        </span>
      </div>

      {!readonly ? (
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-accent">
          <input
            type="file"
            accept="image/*,video/*,application/pdf"
            onChange={onChange}
            disabled={uploading}
            className="hidden"
          />
          <span>{uploading ? tConduct('response.media.uploading') : t('add')}</span>
        </label>
      ) : null}

      {keys.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {keys.map((k) => {
            const filename = k.split('/').at(-1) ?? k;
            const underscore = filename.indexOf('_');
            const display = underscore > 0 ? filename.slice(underscore + 1) : filename;
            return (
              <li
                key={k}
                className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs"
              >
                <a
                  href={`/api/files?key=${encodeURIComponent(k)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="max-w-[12rem] truncate hover:underline"
                >
                  {display}
                </a>
                {!readonly ? (
                  <button
                    type="button"
                    onClick={() => remove(k)}
                    aria-label={t('remove')}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
