'use client';

/**
 * Bulk CSV import (FreeHS B7 — TR-A3).
 *
 * Bello said this more forcefully than anything else: *"the import
 * surface matters more to me than any screen in the module. Without it
 * the matrix is empty on day one and stays empty."* The router was built
 * and tested; it had no door, which is the same as not existing.
 *
 * Two affordances rather than one, because the two migrations differ: a
 * file picker for an LMS export, and a paste box for the spreadsheet
 * someone already has open. Both feed the same per-row validation, and
 * failures are reported **per row with a reason** rather than failing the
 * whole batch — a 2,000-row paste with three bad dates imports 1,997 and
 * names the three.
 */
import { Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Label } from '../ui/label';
import { trpc } from '../../lib/trpc/client';
import { useServerErrorToast } from '../../../src/lib/use-server-error';

/** Columns the importer understands, in the order the template writes them. */
const COLUMNS = [
  'personName',
  'userEmail',
  'requirementName',
  'achievedAt',
  'expiresAt',
  'awardingBody',
  'certificateNumber',
  'personCategory',
] as const;

interface ParsedRow {
  /** 1-based line number in the user's file, so errors name THEIR row. */
  sourceRow: number;
  personName: string;
  userEmail?: string;
  requirementName: string;
  achievedAt: string;
  expiresAt?: string;
  awardingBody?: string;
  certificateNumber?: string;
  personCategory?: string;
}

/**
 * A deliberately small CSV reader: comma-separated, optional double
 * quotes, header row required. Anything richer belongs in a library, and
 * anything richer than this is not what an LMS export looks like.
 */
export function parseCsv(text: string): {
  rows: ParsedRow[];
  /**
   * TR-B4: rows this parser could NOT use, with the reason and the line
   * number from the user's file. Previously these were dropped with a bare
   * `continue`, so a 2,000-row extract with 40 missing dates imported 1,960
   * and reported "Imported 1,960" with no failures — silent truncation,
   * the worst failure mode an importer has.
   */
  skipped: Array<{ row: number; message: string }>;
  error: string | null;
} {
  // Keep the physical line index so a blank line does not shift the
  // numbers the user is asked to go and fix.
  const physical = text.split(/\r?\n/);
  const lines: Array<{ text: string; no: number }> = [];
  physical.forEach((l, i) => {
    const t = l.trim();
    if (t !== '') lines.push({ text: t, no: i + 1 });
  });
  if (lines.length < 2) return { rows: [], skipped: [], error: 'empty' };

  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = !quoted;
      } else if (ch === ',' && !quoted) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };

  const header = splitLine(lines[0]?.text ?? '').map((h) => h.replace(/^\uFEFF/, ''));
  const index = new Map(header.map((h, i) => [h, i] as const));
  if (!index.has('personName') || !index.has('requirementName') || !index.has('achievedAt')) {
    return { rows: [], skipped: [], error: 'columns' };
  }

  const rows: ParsedRow[] = [];
  const skipped: Array<{ row: number; message: string }> = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line.text);
    const at = (col: (typeof COLUMNS)[number]): string | undefined => {
      const i = index.get(col);
      if (i === undefined) return undefined;
      const v = cells[i];
      return v === undefined || v === '' ? undefined : v;
    };
    const personName = at('personName');
    const requirementName = at('requirementName');
    const achievedAt = at('achievedAt');
    if (personName === undefined || requirementName === undefined || achievedAt === undefined) {
      const missing = [
        personName === undefined ? 'personName' : null,
        requirementName === undefined ? 'requirementName' : null,
        achievedAt === undefined ? 'achievedAt' : null,
      ]
        .filter((v): v is string => v !== null)
        .join(', ');
      skipped.push({ row: line.no, message: `missing:${missing}` });
      continue;
    }
    rows.push({
      sourceRow: line.no,
      personName,
      requirementName,
      achievedAt,
      ...(at('userEmail') !== undefined ? { userEmail: at('userEmail') as string } : {}),
      ...(at('expiresAt') !== undefined ? { expiresAt: at('expiresAt') as string } : {}),
      ...(at('awardingBody') !== undefined ? { awardingBody: at('awardingBody') as string } : {}),
      ...(at('certificateNumber') !== undefined
        ? { certificateNumber: at('certificateNumber') as string }
        : {}),
      ...(at('personCategory') !== undefined
        ? { personCategory: at('personCategory') as string }
        : {}),
    });
  }
  return { rows, skipped, error: rows.length === 0 && skipped.length === 0 ? 'empty' : null };
}

/** Collapse repeated identical failures to one line with a count. */
export function groupErrors(
  errors: ReadonlyArray<{ row: number; message: string }>,
): Array<{ message: string; count: number; rows: number[] }> {
  const byMessage = new Map<string, number[]>();
  for (const e of errors) {
    byMessage.set(e.message, [...(byMessage.get(e.message) ?? []), e.row]);
  }
  return [...byMessage.entries()]
    .map(([message, rows]) => ({ message, count: rows.length, rows: rows.sort((a, b) => a - b) }))
    .sort((a, b) => b.count - a.count);
}

export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('training.import');
  const tErr = useTranslations('training.errors');
  const onServerError = useServerErrorToast(tErr('generic'));
  const utils = trpc.useUtils();
  const [text, setText] = useState('');
  const [result, setResult] = useState<{
    imported: number;
    wouldImport: number;
    failed: number;
    errors: Array<{ row: number; message: string }>;
    matchedToUsers: number;
    nameOnly: number;
    skippedDuplicates: number;
    dryRun: boolean;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = trpc.training.importRecords.useMutation({
    onSuccess: (res) => {
      setResult(res);
      void utils.training.invalidate();
      if (res.dryRun) toast.success(t('dryRunDone', { count: res.wouldImport }));
      else if (res.imported > 0) toast.success(t('imported', { count: res.imported }));
      if (res.failed > 0) toast.error(t('failed', { count: res.failed }));
    },
    onError: onServerError,
  });

  function submit(dryRun: boolean) {
    const { rows, skipped, error } = parseCsv(text);
    if (error === 'columns') {
      toast.error(t('badColumns'));
      return;
    }
    if (rows.length === 0 && skipped.length === 0) {
      toast.error(t('noRows'));
      return;
    }
    // Unparseable rows travel WITH the request so they are reported as
    // failures rather than disappearing between the two halves (TR-B4).
    run.mutate({ rows, skipped, dryRun });
  }

  function downloadTemplate() {
    const blob = new Blob([`${COLUMNS.join(',')}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'training-import-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setText('');
          setResult(null);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('help')}</p>

          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setText(await file.text());
              }}
            />
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('chooseFile')}
            </Button>
            <Button type="button" variant="ghost" onClick={downloadTemplate}>
              {t('template')}
            </Button>
          </div>

          <div className="space-y-1">
            <Label htmlFor="training-import-text">{t('paste')}</Label>
            <textarea
              id="training-import-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              spellCheck={false}
              className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
              placeholder={COLUMNS.join(',')}
            />
          </div>

          {/* Per-row failures, named. A batch that fails whole teaches
              people not to try again. */}
          {result !== null ? (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <p className="font-medium">
                {result.dryRun
                  ? t('dryRunDone', { count: result.wouldImport })
                  : t('imported', { count: result.imported })}
              </p>
              {/* The pre-import summary Bello asked for: how many rows will
                  land on an account, and how many become name-only people. */}
              <p className="text-xs text-muted-foreground">
                {t('matchSummary', {
                  matched: result.matchedToUsers,
                  nameOnly: result.nameOnly,
                })}
              </p>
              {result.skippedDuplicates > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('duplicatesSkipped', { count: result.skippedDuplicates })}
                </p>
              ) : null}
              {result.failed > 0 ? (
                <>
                  <p className="text-destructive">{t('failed', { count: result.failed })}</p>
                  <ul className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-xs text-muted-foreground">
                    {/* One unknown course name in a 2,000-row extract used to
                        print 2,000 identical lines into a small scroll box. */}
                    {groupErrors(result.errors).map((g) => (
                      <li key={g.message}>
                        {g.count === 1
                          ? `${t('rowLabel', { row: g.rows[0] ?? 0 })}: ${g.message}`
                          : t('errorGroup', {
                              message: g.message,
                              count: g.count,
                              first: g.rows[0] ?? 0,
                            })}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('close')}
          </Button>
          {/* Dry run first: an append-only store makes a bad import
              expensive to undo, one voided row at a time (TR-B6). */}
          <Button
            variant="outline"
            onClick={() => submit(true)}
            disabled={text.trim() === '' || run.isPending}
          >
            {t('dryRun')}
          </Button>
          <Button onClick={() => submit(false)} disabled={text.trim() === '' || run.isPending}>
            {t('run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
