'use client';

import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FocusedPageShell } from '../../../../../src/components/focused-page-shell';
import {
  BriefingComposer,
  type BriefingDraft,
} from '../../../../../src/components/heads-up/briefing-composer';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { trpc } from '../../../../../src/lib/trpc/client';

/**
 * Full editor for an existing DRAFT briefing.
 *
 * A draft used to be a dead end: the Manage list linked to the detail page,
 * which offered only publish-or-archive — no way to change the audience,
 * the content or the attachments of something explicitly saved to finish
 * later. This page loads the draft and mounts the same composer the create
 * flow uses, saving through `headsUps.update`.
 *
 * Published/archived briefings are not editable here (their media and
 * recipient list are frozen — H-E01); they bounce to the detail page.
 */
export default function EditBriefingPage() {
  const t = useTranslations('headsUp.new');
  const params = useParams<{ locale: string; headsUpId: string }>();
  const locale = params.locale ?? 'en';
  const headsUpId = params.headsUpId ?? '';
  const router = useRouter();

  const query = trpc.headsUps.get.useQuery({ headsUpId }, { enabled: headsUpId.length === 26 });

  const status = query.data?.headsUp.status;
  useEffect(() => {
    if (status !== undefined && status !== 'draft') {
      router.replace(`/${locale}/briefings/${headsUpId}`);
    }
  }, [status, router, locale, headsUpId]);

  const backToList = () => router.push(`/${locale}/briefings`);

  let body: React.JSX.Element;
  if (query.data !== undefined && status === 'draft') {
    const { headsUp, attachments, documents } = query.data;
    // The DB column is plain text; narrow it to the composer's union with a
    // safe fallback rather than trusting the row blindly.
    const engagement = headsUp.engagementLevel;
    const draft: BriefingDraft = {
      headsUpId: headsUp.id,
      title: headsUp.title,
      description: headsUp.description,
      engagementLevel:
        engagement === 'acknowledge' || engagement === 'sign' ? engagement : 'view',
      allowComments: headsUp.allowComments,
      allowReactions: headsUp.allowReactions,
      publishAt: headsUp.publishAt !== null ? new Date(headsUp.publishAt).toISOString() : null,
      recipientSpec: headsUp.recipientSpec,
      attachments: attachments.map((a) => ({
        storageKey: a.storageKey,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
      })),
      documentIds: documents.map((d) => d.documentId),
    };
    // Key by id so navigating between drafts remounts with fresh seeds.
    body = (
      <BriefingComposer
        key={headsUp.id}
        draft={draft}
        onClose={backToList}
        onSaved={backToList}
      />
    );
  } else {
    body = (
      <div className="space-y-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <FocusedPageShell title={t('editPageTitle')} backHref={`/${locale}/briefings`} width="form">
      {body}
    </FocusedPageShell>
  );
}
