'use client';

/**
 * Import a PDF or Excel file and convert it into a draft template. The file is
 * sent to `/api/ai/template-import`, which runs the conversion agent (PDF via
 * Claude's native document support; Excel parsed with SheetJS then interpreted)
 * and returns a TemplateSpec; we expand it with `templates.createFromSpec` and
 * open the editor.
 */
import { FileUp, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { TemplateSpec } from '@forma360/shared/template-spec';
import { trpc } from '../../lib/trpc/client';
import { cn } from '../../lib/cn';

const ACCEPT =
  '.pdf,.xlsx,.xls,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export function ImportTemplatePanel({
  locale,
  onOpenChange,
}: {
  locale: string;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useTranslations('templates.create');
  const utils = trpc.useUtils();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const createFromSpec = trpc.templates.createFromSpec.useMutation({
    onSuccess: (result) => {
      void utils.templates.list.invalidate();
      onOpenChange(false);
      window.location.href = `/${locale}/templates/${result.templateId}`;
    },
    onError: (e) => {
      setError(e.message);
      setBusy(false);
    },
  });

  async function handleFile(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(t('importTooLarge'));
      return;
    }
    setFileName(file.name);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/ai/template-import', { method: 'POST', body: form });
      const json = (await res.json().catch(() => null)) as
        | { spec: TemplateSpec }
        | { error: string }
        | null;
      if (!res.ok || json === null || !('spec' in json)) {
        setError(json && 'error' in json ? json.error : t('importFailed'));
        setBusy(false);
        return;
      }
      createFromSpec.mutate({ spec: json.spec });
    } catch {
      setError(t('importFailed'));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
          busy ? 'opacity-60' : 'hover:border-primary hover:bg-accent/30',
        )}
      >
        {busy ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium">{t('importBusy')}</p>
            {fileName && <p className="text-xs text-muted-foreground">{fileName}</p>}
          </>
        ) : (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-foreground">
              <FileUp className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium">{t('importDrop')}</p>
            <p className="text-xs text-muted-foreground">{t('importHint')}</p>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
