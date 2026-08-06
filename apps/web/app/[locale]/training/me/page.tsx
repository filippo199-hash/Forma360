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
import { PersonWallet } from '../../../../src/components/training/person-wallet';

export default function MyTrainingPage() {
  const t = useTranslations('training.person');
  return <PersonWallet heading={t('myTitle')} />;
}
