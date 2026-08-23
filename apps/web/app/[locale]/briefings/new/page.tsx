'use client';

import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FocusedPageShell } from '../../../../src/components/focused-page-shell';
import {
  BriefingComposer,
  type BriefingPrefill,
} from '../../../../src/components/heads-up/briefing-composer';

/**
 * Full-page briefing composer — kept alive for the "Share via Heads Up"
 * deep-link flow (RA/COSHH open `/briefings/new?raId=…&title=…&description=…`; old /heads-up links redirect).
 * The list page opens the same `<BriefingComposer>` in a modal instead. Both
 * surfaces share one component; only the chrome differs.
 */
export default function NewHeadsUpPage() {
  const t = useTranslations('headsUp.new');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  // Read prefill from the URL once on mount. window.location (not
  // useSearchParams) avoids the Suspense-boundary requirement at build time.
  const [prefill, setPrefill] = useState<BriefingPrefill | undefined>(undefined);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const next: BriefingPrefill = {};
    const qTitle = sp.get('title');
    if (qTitle !== null && qTitle.length > 0) next.title = qTitle;
    const qDescription = sp.get('description');
    if (qDescription !== null && qDescription.length > 0) next.description = qDescription;
    const raId = sp.get('raId');
    if (raId !== null && raId.length > 0) next.raId = raId;
    const attKey = sp.get('attKey');
    if (attKey !== null && attKey.length > 0) next.attKey = attKey;
    const attName = sp.get('attName');
    if (attName !== null && attName.length > 0) next.attName = attName;
    const attMime = sp.get('attMime');
    if (attMime !== null && attMime.length > 0) next.attMime = attMime;
    const attSize = Number.parseInt(sp.get('attSize') ?? '', 10);
    if (Number.isFinite(attSize)) next.attSize = attSize;
    setPrefill(next);
  }, []);

  const backToList = () => router.push(`/${locale}/briefings`);

  return (
    <FocusedPageShell title={t('pageTitle')} backHref={`/${locale}/briefings`} width="form">
      <BriefingComposer prefill={prefill} onClose={backToList} onSaved={backToList} />
    </FocusedPageShell>
  );
}
