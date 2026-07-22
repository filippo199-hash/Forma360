'use client';

import { CheckCircle2, ClipboardCheck, Eye, FileText, ListChecks, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { trpc } from '../../../src/lib/trpc/client';

type Activity = 'inspections' | 'observations' | 'actions' | 'documents';

const TILES: Record<Activity, { href: string; icon: typeof Eye }> = {
  inspections: { href: '/inspections', icon: ClipboardCheck },
  observations: { href: '/observations', icon: Eye },
  actions: { href: '/actions', icon: ListChecks },
  documents: { href: '/documents', icon: FileText },
};

export default function ContractorPortalPage() {
  const t = useTranslations('contractors');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.contractors.users.me.useQuery();

  const acknowledge = trpc.contractors.users.acknowledge.useMutation({
    onSuccess: () => {
      toast.success(t('portal.acknowledgedToast'));
      void utils.contractors.users.me.invalidate();
    },
    onError: () => toast.error(t('error')),
  });

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  // Not an external user (or membership revoked) — nothing to show here.
  if (data === null || data === undefined) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center text-sm text-muted-foreground">
        {t('portal.noAccess')}
      </div>
    );
  }

  const activities = data.activities.filter((a): a is Activity => a in TILES);

  // Onboarding: acknowledgement must happen before the portal opens up.
  if (data.acknowledgedAt === null) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-12">
        <Card>
          <CardContent className="space-y-5 p-6 text-center">
            <ShieldCheck className="mx-auto h-10 w-10 text-primary" />
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-tight">
                {t('portal.onboardingTitle')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('portal.onboardingIntro', { contractor: data.contractorName })}
              </p>
            </div>
            <p className="rounded-md bg-muted/50 p-3 text-left text-sm text-muted-foreground">
              {t('portal.onboardingBody')}
            </p>
            <Button
              className="w-full"
              disabled={acknowledge.isPending}
              onClick={() => acknowledge.mutate()}
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              {t('portal.acknowledgeButton')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('portal.welcome', { contractor: data.contractorName })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('portal.welcomeSubtitle')}</p>
      </header>

      {activities.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {t('portal.noActivities')}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {activities.map((a) => {
            const Icon = TILES[a].icon;
            return (
              <Link key={a} href={`/${locale}${TILES[a].href}`}>
                <Card className="h-full transition-colors hover:border-primary/50 hover:bg-muted/30">
                  <CardContent className="flex items-center gap-3 p-5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="font-medium">
                        {t(`portal.activity_${a}` as 'portal.activity_inspections')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t(`portal.activityHint_${a}` as 'portal.activityHint_inspections')}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
