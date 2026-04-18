'use client';

import type { TemplateContent } from '@forma360/shared/template-schema';
import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { EditorShell } from '../../../../src/components/templates/editor-shell';
import { EditorProvider } from '../../../../src/components/templates/editor-context';
import { trpc } from '../../../../src/lib/trpc/client';

/**
 * Template editor entry. Loads the template + its latest version, then
 * hands off to EditorShell wrapped in an EditorProvider seeded with the
 * loaded content. A dedicated loading state keeps the shell from
 * flashing an invalid content blob before the query resolves.
 */
export default function TemplateEditorPage() {
  const params = useParams<{ locale: string; templateId: string }>();
  const templateId = params.templateId ?? '';
  const tCommon = useTranslations('common');

  const { data, isLoading, error } = trpc.templates.get.useQuery(
    { templateId },
    { enabled: templateId.length === 26 },
  );

  useEffect(() => {
    document.title = data?.template.name ?? 'Template editor';
  }, [data]);

  if (isLoading || data === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (error !== null && error !== undefined) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {tCommon('error')}
      </p>
    );
  }

  // Use the latest version (first row, since versions are DESC by number).
  const latest = data.versions[0];
  if (latest === undefined) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {tCommon('error')}
      </p>
    );
  }

  // Content is stored as jsonb and comes back typed `unknown` — the
  // backend already validated it through templateContentSchema at write
  // time, so we can trust the shape here. If a future migration breaks
  // this assumption the editor will throw at render, surfacing the
  // incident — preferable to silently eating a malformed blob.
  const content = latest.content as TemplateContent;

  return (
    <EditorProvider
      initialContent={content}
      initialName={data.template.name}
      initialDescription={data.template.description}
      initialUpdatedAt={latest.updatedAt.toISOString()}
    >
      <EditorShell templateId={templateId} />
    </EditorProvider>
  );
}
