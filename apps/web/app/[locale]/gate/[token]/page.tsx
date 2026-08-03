'use client';

import { CheckCircle2, ChevronLeft, LogIn, LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { trpc } from '../../../../src/lib/trpc/client';

type KioskVisit = {
  id: string;
  contractorName: string;
  title: string;
  status: string;
  /** PF-19: derived company compliance, shown at the kiosk. */
  complianceStatus: string;
};

export default function GateKioskPage() {
  const t = useTranslations('contractors');
  const params = useParams<{ token: string }>();
  const token = params.token ?? '';

  const { data, isLoading, error } = trpc.contractors.gate.publicByToken.useQuery(
    { token },
    { enabled: token !== '', retry: false },
  );

  const [selected, setSelected] = useState<KioskVisit | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState<'check_in' | 'check_out' | null>(null);

  const utils = trpc.useUtils();
  const checkIn = trpc.contractors.gate.selfCheckIn.useMutation({
    onSuccess: (_res, vars) => {
      setDone(vars.eventType);
      void utils.contractors.gate.publicByToken.invalidate({ token });
    },
    onError: (err) =>
      toast.error(
        err.message === 'contractor_non_compliant'
          ? t('gate.blockedNonCompliant')
          : err.message.length > 0
            ? err.message
            : t('error'),
      ),
  });

  const fields = data?.fields ?? [];

  function open(v: KioskVisit) {
    setSelected(v);
    setAnswers({});
    setDone(null);
  }

  function submit(eventType: 'check_in' | 'check_out') {
    if (selected === null) return;
    checkIn.mutate({
      token,
      visitId: selected.id,
      eventType,
      ...(Object.keys(answers).length > 0 ? { capturedFields: answers } : {}),
    });
  }

  const missingRequired =
    selected?.status === 'scheduled' &&
    fields.some((f) => f.required && (answers[f.id] ?? '').trim() === '');

  return (
    <div className="mx-auto min-h-screen w-full max-w-lg px-4 py-10">
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error !== null || data === undefined ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {t('gate.kioskInvalid')}
          </CardContent>
        </Card>
      ) : done !== null ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-600" />
            <p className="text-lg font-semibold">
              {done === 'check_in' ? t('gate.checkedInThanks') : t('gate.checkedOutThanks')}
            </p>
            <Button variant="outline" onClick={() => setSelected(null)}>
              {t('gate.backToList')}
            </Button>
          </CardContent>
        </Card>
      ) : selected !== null ? (
        <div className="space-y-5">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            {t('gate.backToList')}
          </button>
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">{selected.contractorName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{selected.title}</p>
          </header>

          {selected.status === 'scheduled' ? (
            <>
              {fields.length > 0 ? (
                <div className="space-y-4">
                  {fields.map((f) => (
                    <div key={f.id} className="space-y-1.5">
                      <Label htmlFor={`f-${f.id}`}>
                        {f.label}
                        {f.required ? <span className="text-destructive"> *</span> : null}
                      </Label>
                      {f.fieldType === 'yes_no' ? (
                        <select
                          id={`f-${f.id}`}
                          value={answers[f.id] ?? ''}
                          onChange={(e) => setAnswers((a) => ({ ...a, [f.id]: e.target.value }))}
                          className="h-11 w-full rounded-md border border-input bg-background px-3 text-base"
                        >
                          <option value="">—</option>
                          <option value="yes">{t('gate.yes')}</option>
                          <option value="no">{t('gate.no')}</option>
                        </select>
                      ) : (
                        <Input
                          id={`f-${f.id}`}
                          type={f.fieldType === 'number' ? 'number' : 'text'}
                          value={answers[f.id] ?? ''}
                          onChange={(e) => setAnswers((a) => ({ ...a, [f.id]: e.target.value }))}
                          className="h-11 text-base"
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
              {selected.complianceStatus === 'non_compliant' ? (
                /* PF-19: the kiosk has no override — direct to the office. */
                <div
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-center text-sm font-medium text-destructive"
                >
                  {t('gate.blockedNonCompliant')}
                </div>
              ) : (
                <Button
                  className="h-14 w-full text-base"
                  disabled={checkIn.isPending || missingRequired}
                  onClick={() => submit('check_in')}
                >
                  <LogIn className="mr-2 h-5 w-5" />
                  {t('gate.checkInButton')}
                </Button>
              )}
            </>
          ) : (
            <Button
              className="h-14 w-full text-base"
              disabled={checkIn.isPending}
              onClick={() => submit('check_out')}
            >
              <LogOut className="mr-2 h-5 w-5" />
              {t('gate.checkOutButton')}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">{t('gate.kioskTitle')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('gate.kioskPickVisit')}</p>
          </header>
          {data.visits.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                {t('gate.kioskNoVisits')}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {data.visits.map((v) => (
                <Card key={v.id}>
                  <CardContent className="p-0">
                    <button
                      type="button"
                      onClick={() => open(v)}
                      className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/40"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{v.contractorName}</p>
                        <p className="truncate text-sm text-muted-foreground">{v.title}</p>
                        {v.complianceStatus === 'non_compliant' ? (
                          <span className="mt-1 inline-block rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                            {t('gate.nonCompliantChip')}
                          </span>
                        ) : null}
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                          v.status === 'checked_in'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {v.status === 'checked_in'
                          ? t('gate.tapToCheckOut')
                          : t('gate.tapToCheckIn')}
                      </span>
                    </button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
