import { redirect } from 'next/navigation';

/**
 * The fixed "Overview" dashboard was removed from the product — "For me"
 * (/my-work) is the landing surface and custom dashboards carry the
 * analytics surface. This route is kept only to redirect old bookmarks.
 */
export default async function AnalyticsRemoved({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/my-work`);
}
