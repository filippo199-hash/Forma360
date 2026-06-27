/**
 * Maintenance programs moved into Assets → Settings. This route now redirects
 * there so old links/bookmarks keep working.
 */
import { redirect } from 'next/navigation';

export default async function MaintenanceRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/assets/settings?tab=programs`);
}
