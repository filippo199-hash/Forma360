'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Separator } from '../ui/separator';
import { GroupPicker, SitePicker } from './audience-pickers';

type AccessMode = 'everyone' | 'specific';

/**
 * Third step of the template editor. Users pick the audience that should
 * see and use the template (groups + sites) and then trigger the actual
 * publish from inside the tab.
 *
 * Audience scoping is fronted as "Everyone" vs "Specific groups & sites".
 * Behind the scenes the server creates / updates a single `[auto] …`
 * access_rule keyed to the template. Users never see the rule.
 */
export function PublishTab({
  templateId,
  onBackToBuild,
}: {
  templateId: string;
  onBackToBuild: () => void;
}) {
  const t = useTranslations('templates.editor.publishTab');
  const utils = trpc.useUtils();

  const { data: currentAccess } = trpc.templates.getAccess.useQuery({ templateId });

  const [mode, setMode] = useState<AccessMode>('everyone');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [siteIds, setSiteIds] = useState<string[]>([]);

  // Hydrate local state from server-side access config on first load.
  useEffect(() => {
    if (currentAccess === undefined) return;
    setMode(currentAccess.mode);
    setGroupIds([...currentAccess.groupIds]);
    setSiteIds([...currentAccess.siteIds]);
  }, [currentAccess]);

  const publish = trpc.templates.publish.useMutation({
    onSuccess: () => {
      toast.success(t('publishSuccess'));
      void utils.templates.get.invalidate({ templateId });
      void utils.templates.list.invalidate();
      void utils.templates.getAccess.invalidate({ templateId });
    },
    onError: (err) => {
      const message = err.message.toLowerCase();
      const isSignatureWorkflow =
        err.data?.code === 'BAD_REQUEST' &&
        (message.includes('signature') || message.includes('signatory'));
      if (isSignatureWorkflow) {
        toast.error(t('validation.signatureWorkflowEmpty'));
        return;
      }
      toast.error(t('validation.generic'));
    },
  });

  function handlePublish() {
    publish.mutate({
      templateId,
      access: { mode, groupIds, siteIds },
    });
  }

  return (
    <div className="flex-1 overflow-y-auto bg-muted/30">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
        <div>
          <h2 className="text-2xl font-bold">{t('title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('accessTitle')}</CardTitle>
            <CardDescription>{t('accessSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="sr-only">{t('accessTitle')}</legend>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent/30">
                <input
                  type="radio"
                  name="audience-mode"
                  value="everyone"
                  checked={mode === 'everyone'}
                  onChange={() => setMode('everyone')}
                  className="mt-1 h-4 w-4 cursor-pointer accent-primary"
                />
                <div>
                  <div className="font-medium">{t('everyoneLabel')}</div>
                  <div className="text-sm text-muted-foreground">{t('everyoneDescription')}</div>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent/30">
                <input
                  type="radio"
                  name="audience-mode"
                  value="specific"
                  checked={mode === 'specific'}
                  onChange={() => setMode('specific')}
                  className="mt-1 h-4 w-4 cursor-pointer accent-primary"
                />
                <div>
                  <div className="font-medium">{t('specificLabel')}</div>
                  <div className="text-sm text-muted-foreground">{t('specificDescription')}</div>
                </div>
              </label>
            </fieldset>

            {mode === 'specific' && (
              <>
                <Separator />
                <GroupPicker selected={groupIds} onChange={setGroupIds} />
                <SitePicker selected={siteIds} onChange={setSiteIds} />
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onBackToBuild}>
            {t('backToBuild')}
          </Button>
          <Button onClick={handlePublish} disabled={publish.isPending} className="min-w-[140px]">
            {publish.isPending ? t('publishing') : t('publishButton')}
          </Button>
        </div>
      </div>
    </div>
  );
}
