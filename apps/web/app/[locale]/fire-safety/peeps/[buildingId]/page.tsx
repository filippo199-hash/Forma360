/**
 * A PEEP search result (BUG-10).
 *
 * Personal emergency evacuation plans were the one fire-safety record the
 * global search did not index, so a night carer searching a named resident
 * got nothing — the case the module exists to serve. Plans live on their
 * building's PEEPs tab rather than on a page of their own, and the search
 * result table needs one distinct path per category, so this is that path:
 * it exists to put the reader on the tab holding the plan.
 */
import { redirect } from 'next/navigation';

export default async function PeepSearchLandingPage({
  params,
}: {
  params: Promise<{ locale: string; buildingId: string }>;
}) {
  const { locale, buildingId } = await params;
  redirect(`/${locale}/fire-safety/${buildingId}?tab=peeps`);
}
