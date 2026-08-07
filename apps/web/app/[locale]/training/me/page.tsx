'use client';

/**
 * "My training" (TR-A5) — the personal door.
 *
 * Nine in ten users only ever want to know when their own card expires.
 * Before this, their single entry point to the module was the gap list:
 * a named list of every colleague's competence shortfalls, which
 * `training.view` grants by default. This page is scoped to the caller
 * by the server (the `person` procedure defaults to `ctx.auth.userId`),
 * so it cannot show anyone else's.
 */
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { PersonWallet } from '../../../../src/components/training/person-wallet';
import { TrainingTabs } from '../../../../src/components/training/training-tabs';

export default function MyTrainingPage() {
  const t = useTranslations('training.person');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* TR-B11: inside the module's own navigation, not outside it. */}
      <TrainingTabs activeTab="me" locale={locale} />
      <PersonWallet heading={t('myTitle')} />
    </div>
  );
}
