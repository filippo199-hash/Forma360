'use client';

/**
 * Record a completion (FreeHS B7).
 *
 * Whitfield's constraint governs this form: *"Add a record in under a
 * minute, from a phone: person, card type, number, expiry, photograph.
 * If it takes longer than photographing the card and typing an expiry
 * date, I won't keep it current — and a stale matrix is worse than
 * none."* So the required set is four fields, the expiry fills itself in
 * from the requirement's validity period, and the photograph is a single
 * tap that opens the camera on a phone.
 *
 * Two review findings shaped the person picker (TR-A2), and both were
 * data-integrity bugs rather than cosmetics:
 *   - it asked the server for users with no arguments and got the default
 *     fifty, with no search — so past the fiftieth person you *had* to
 *     type a name free-text. It now searches server-side.
 *   - it then inferred `personCategory` from whether the user id was
 *     empty, filing any hand-typed employee as a **contractor with no
 *     user link** — which splits their competence across two rows in the
 *     matrix and hides the record from the expiry worker. The category is
 *     now an explicit choice, never inferred.
 */
import { Camera, Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { newId } from '@forma360/shared/id';
import { TRAINING_RECORD_SOURCES } from '@forma360/shared/training';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { trpc } from '../../lib/trpc/client';
import { useServerErrorToast } from '../../../src/lib/use-server-error';

export interface RecordPrefill {
  requirementId?: string;
  personName?: string;
  userId?: string | null;
}

/** Who the record is about. Chosen, never inferred (TR-A2). */
const PERSON_CATEGORIES = ['employee', 'contractor', 'agency'] as const;
type PersonCategory = (typeof PERSON_CATEGORIES)[number];

export function RecordDialog({
  open,
  onOpenChange,
  prefill,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: RecordPrefill | undefined;
}) {
  const t = useTranslations('training.record');
  const tErr = useTranslations('training.errors');
  const onServerError = useServerErrorToast(tErr('generic'));
  const utils = trpc.useUtils();

  const { data: requirements } = trpc.training.listRequirements.useQuery({});

  const [requirementId, setRequirementId] = useState('');
  const [linkToUser, setLinkToUser] = useState(true);
  const [userId, setUserId] = useState('');
  const [personName, setPersonName] = useState('');
  const [personCategory, setPersonCategory] = useState<PersonCategory>('employee');
  const [personSearch, setPersonSearch] = useState('');
  const [achievedAt, setAchievedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [awardingBody, setAwardingBody] = useState('');
  const [certificateNumber, setCertificateNumber] = useState('');
  const [source, setSource] = useState<(typeof TRAINING_RECORD_SOURCES)[number]>('external');
  const [notes, setNotes] = useState('');
  const [evidence, setEvidence] = useState<{ key: string; filename: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Stable staging id so the photo can be uploaded before the row exists.
  const stagingId = useRef(newId());

  // Server-side search, so the picker reaches past the first page of
  // people instead of silently stopping at the default limit.
  const { data: usersData, isFetching: searching } = trpc.users.list.useQuery(
    personSearch.trim() === '' ? { limit: 50 } : { limit: 50, search: personSearch.trim() },
  );

  useEffect(() => {
    if (!open) return;
    setRequirementId(prefill?.requirementId ?? '');
    setLinkToUser(prefill?.userId != null || prefill?.personName == null);
    setUserId(prefill?.userId ?? '');
    setPersonName(prefill?.personName ?? '');
    setPersonCategory('employee');
    setPersonSearch('');
    setAchievedAt(new Date().toISOString().slice(0, 10));
    setExpiresAt('');
    setAwardingBody('');
    setCertificateNumber('');
    setSource('external');
    setNotes('');
    setEvidence(null);
    stagingId.current = newId();
  }, [open, prefill?.requirementId, prefill?.personName, prefill?.userId]);

  const addRecord = trpc.training.addRecord.useMutation({
    onSuccess: () => {
      toast.success(t('saved'));
      void utils.training.invalidate();
      onOpenChange(false);
    },
    // The reason matters: "something went wrong" for a date the server
    // rejected teaches the user nothing (TR-A14).
    onError: onServerError,
  });

  async function uploadEvidence(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('entityId', stagingId.current);
      form.append('file', file);
      const res = await fetch('/api/upload/training-certificate', { method: 'POST', body: form });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => ({}));
        const code =
          typeof body === 'object' && body !== null && 'error' in body
            ? String((body as { error: unknown }).error)
            : String(res.status);
        toast.error(tErr('uploadFailed', { reason: code }));
        return;
      }
      const body = (await res.json()) as { storageKey: string; filename: string };
      setEvidence({ key: body.storageKey, filename: body.filename });
    } catch {
      toast.error(tErr('uploadFailed', { reason: 'network' }));
    } finally {
      setUploading(false);
    }
  }

  const selectedUser = (usersData?.users ?? []).find((u) => u.id === userId);
  const resolvedName = linkToUser ? (selectedUser?.name ?? '') : personName;
  const ready =
    requirementId !== '' &&
    resolvedName.trim() !== '' &&
    achievedAt !== '' &&
    (!linkToUser || userId !== '');

  function submit() {
    if (!ready) return;
    addRecord.mutate({
      requirementId,
      userId: linkToUser && userId !== '' ? userId : null,
      personName: resolvedName.trim(),
      // Explicit — an employee typed by hand stays an employee.
      personCategory: linkToUser ? 'employee' : personCategory,
      contractorId: null,
      achievedAt,
      // Omitting `expiresAt` lets the server derive it from the
      // requirement's validity period — the common case.
      ...(expiresAt !== '' ? { expiresAt } : {}),
      awardingBody: awardingBody.trim() === '' ? null : awardingBody.trim(),
      certificateNumber: certificateNumber.trim() === '' ? null : certificateNumber.trim(),
      evidenceKey: evidence?.key ?? null,
      evidenceFilename: evidence?.filename ?? null,
      source,
      notes: notes.trim() === '' ? null : notes.trim(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="training-requirement">{t('requirement')}</Label>
            <select
              id="training-requirement"
              value={requirementId}
              onChange={(e) => setRequirementId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">—</option>
              {(requirements ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          {/* ── Person ─────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label>{t('person')}</Label>
            <div className="flex gap-1 text-xs">
              <button
                type="button"
                onClick={() => setLinkToUser(true)}
                className={`rounded-full border px-3 py-1 font-medium transition-colors ${
                  linkToUser
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {t('personKind.user')}
              </button>
              <button
                type="button"
                onClick={() => setLinkToUser(false)}
                className={`rounded-full border px-3 py-1 font-medium transition-colors ${
                  !linkToUser
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {t('personKind.other')}
              </button>
            </div>

            {linkToUser ? (
              <>
                <Input
                  value={personSearch}
                  onChange={(e) => setPersonSearch(e.target.value)}
                  placeholder={t('searchPeople')}
                  aria-label={t('searchPeople')}
                />
                <select
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  aria-label={t('person')}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">—</option>
                  {(usersData?.users ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                {usersData?.hasMore === true ? (
                  <p className="text-[11px] text-muted-foreground">{t('narrowSearch')}</p>
                ) : null}
                {searching ? (
                  <p className="text-[11px] text-muted-foreground">{t('searching')}</p>
                ) : null}
              </>
            ) : (
              <>
                {/* Half the people on a site are not on the payroll — a
                    matrix that only covers employees does not cover the site. */}
                <Input
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                  placeholder={t('person')}
                />
                <select
                  value={personCategory}
                  onChange={(e) => setPersonCategory(e.target.value as PersonCategory)}
                  aria-label={t('personCategory')}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {PERSON_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`categories.${c}` as never)}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="training-achieved">{t('achievedAt')}</Label>
              <Input
                id="training-achieved"
                type="date"
                value={achievedAt}
                onChange={(e) => setAchievedAt(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="training-expires">{t('expiresAt')}</Label>
              <Input
                id="training-expires"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">{t('expiryAuto')}</p>
            </div>
          </div>

          {/* ── The evidence ───────────────────────────────────────── */}
          <div className="space-y-1">
            <Label>{t('evidence')}</Label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadEvidence(file);
              }}
            />
            {evidence === null ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                {t('addPhoto')}
              </Button>
            ) : (
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{evidence.filename}</span>
                <button
                  type="button"
                  onClick={() => setEvidence(null)}
                  aria-label={t('removePhoto')}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="training-body">{t('awardingBody')}</Label>
              <Input
                id="training-body"
                value={awardingBody}
                onChange={(e) => setAwardingBody(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="training-cert">{t('certificateNumber')}</Label>
              <Input
                id="training-cert"
                value={certificateNumber}
                onChange={(e) => setCertificateNumber(e.target.value)}
              />
            </div>
          </div>

          {/* Self-declared training carries a different evidential weight
              from checked training, so the record has to say which. */}
          <div className="space-y-1">
            <Label htmlFor="training-source">{t('source')}</Label>
            <select
              id="training-source"
              value={source}
              onChange={(e) =>
                setSource(e.target.value as (typeof TRAINING_RECORD_SOURCES)[number])
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {TRAINING_RECORD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(`sources.${s}` as never)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="training-notes">{t('notes')}</Label>
            <Input id="training-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={submit} disabled={!ready || addRecord.isPending || uploading}>
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
