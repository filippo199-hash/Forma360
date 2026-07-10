import { redirect } from 'next/navigation';

/**
 * Sites are no longer a people-grouping concept managed in Settings — a
 * site/project's team + access now lives on the site itself (the "Team &
 * access" tab). This route redirects any old bookmark to the operational
 * Sites & Projects module so nothing 404s.
 */
export default async function SettingsSitesRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/sites`);
}
