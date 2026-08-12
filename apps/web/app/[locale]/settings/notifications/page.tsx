import { setRequestLocale } from 'next-intl/server';
import { NotificationPrefs } from '../../../../src/components/settings/notification-prefs';

/**
 * Settings → Notifications. Every signed-in user manages their own
 * notification matrix here (the settings layout already gates on a
 * session); there is no admin surface — prefs are strictly personal.
 */
export default async function NotificationSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <NotificationPrefs />;
}
