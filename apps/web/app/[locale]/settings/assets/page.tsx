'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { appConfirm } from '../../../../src/components/ui/app-confirm';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';
import { useServerErrorToast } from '../../../../src/lib/use-server-error';

export default function SettingsAssetTypesPage() {
  const t = useTranslations('assetTypes');
  const tCommon = useTranslations('common');
  const onServerError = useServerErrorToast(tCommon('error'));
  const canManage = useHasPermission('assets.manage');
  const utils = trpc.useUtils();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const { data, isLoading } = trpc.assetTypes.list.useQuery({ includeArchived: false });
  const types = data ?? [];

  const create = trpc.assetTypes.create.useMutation({
    onSuccess: () => {
      toast.success(t('createdToast'));
      setNewName('');
      setNewDesc('');
      setShowCreate(false);
      void utils.assetTypes.list.invalidate();
    },
    onError: onServerError,
  });

  const archive = trpc.assetTypes.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archivedToast'));
      void utils.assetTypes.list.invalidate();
    },
    onError: onServerError,
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t('pageTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('pageSubtitle')}</p>
        </div>
        {canManage ? (
          <Button type="button" onClick={() => setShowCreate(!showCreate)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('newButton')}
          </Button>
        ) : null}
      </header>

      {showCreate && canManage ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            <h2 className="text-base font-semibold">{t('createTitle')}</h2>
            <div className="space-y-1.5">
              <label htmlFor="type-name" className="text-sm font-medium">
                {tCommon('name')}
              </label>
              <Input
                id="type-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={200}
                placeholder={t('namePlaceholder')}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="type-desc" className="text-sm font-medium">
                {tCommon('description')}
              </label>
              <Textarea
                id="type-desc"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                maxLength={5000}
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowCreate(false);
                  setNewName('');
                  setNewDesc('');
                }}
              >
                {tCommon('cancel')}
              </Button>
              <Button
                type="button"
                disabled={create.isPending || newName.trim().length === 0}
                onClick={() => create.mutate({ name: newName.trim(), description: newDesc.trim() })}
              >
                {tCommon('create')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : types.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {t('empty')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-1.5 font-medium">{tCommon('name')}</th>
                    <th className="px-3 py-1.5 font-medium">{tCommon('description')}</th>
                    <th className="px-3 py-1.5 font-medium">{t('customFieldsCount')}</th>
                    {canManage ? <th className="px-3 py-1.5" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {types.map((tp) => (
                    <tr key={tp.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-1.5 font-medium">{tp.name}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {tp.description.length > 0 ? tp.description : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {Array.isArray(tp.customFields) ? tp.customFields.length : 0}
                      </td>
                      {canManage ? (
                        <td className="px-3 py-1.5 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              void appConfirm({
                                description: t('archiveConfirm'),
                                destructive: true,
                              }).then((ok) => {
                                if (ok) archive.mutate({ typeId: tp.id });
                              });
                            }}
                            disabled={archive.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
