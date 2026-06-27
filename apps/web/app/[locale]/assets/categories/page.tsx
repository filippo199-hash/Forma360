/**
 * Asset categories moved into Assets → Settings. Redirect old links there.
 */
import { redirect } from 'next/navigation';

export default async function CategoriesRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/assets/settings`);
}
