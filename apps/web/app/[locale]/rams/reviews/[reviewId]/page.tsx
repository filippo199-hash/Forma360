/**
 * A contractor RAMS review search result (NR3-06).
 *
 * Reviews live on the shared list+detail workspace rather than on pages
 * of their own, and the global search result table needs one distinct
 * path per category — so this is that path: a thin redirect that lands
 * the searcher on the workspace with the review preselected (the
 * PEEP/BUG-10 precedent).
 */
import { redirect } from 'next/navigation';

export default async function RamsReviewSearchLandingPage({
  params,
}: {
  params: Promise<{ locale: string; reviewId: string }>;
}) {
  const { locale, reviewId } = await params;
  redirect(`/${locale}/rams/reviews?reviewId=${reviewId}`);
}
