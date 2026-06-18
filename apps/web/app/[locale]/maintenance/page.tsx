'use client';

import { Plus, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../src/components/ui/dialog';
import { Input } from '../../../src/components/ui/input';
import { Label } from '../../../src/components/ui/label';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { Textarea } from '../../../src/components/ui/textarea';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';

export default function MaintenanceProgramsPage() {
  const t = useTranslations('maintenancePrograms');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();
  const canManage = useHasPermission('assets.maintenance.manage');

  const { data: listData, isLoading } = trpc.maintenancePrograms.list.useQuery();
  const programs = listData?.programs ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const { data: templatesData } = trpc.maintenancePrograms.templates.useQuery(undefined, {
    enabled: templateOpen,
  });
  const templates = templatesData?.templates ?? [];

  const create = trpc.maintenancePrograms.create.useMutation({
    onSuccess: (res) => {
      toast.success(t('createdToast'));
      setCreateOpen(false);
      setNewName('');
      setNewDescription('');
      router.push(`/${locale}/maintenance/program/${res.programId}`);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const createFromTemplate = trpc.maintenancePrograms.createFromTemplate.useMutation({
    onSuccess: (res) => {
      toast.success(t('createdToast'));
      setTemplateOpen(false);
      router.push(`/${locale}/maintenance/program/${res.programId}`);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canManage ? (
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setTemplateOpen(true)}>
              <Sparkles className="mr-1.5 h-4 w-4" />
              {t('startFromTemplate')}
            </Button>
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t('newProgram')}
            </Button>
          </div>
        ) : null}
      </header>

      {/* New program dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('newProgram')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="program-name">{t('fields.name')}</Label>
              <Input
                id="program-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('fields.namePlaceholder')}
                maxLength={500}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="program-description">{t('fields.description')}</Label>
              <Textarea
                id="program-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder={t('fields.descriptionPlaceholder')}
                maxLength={2000}
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                {tCommon('cancel')}
              </Button>
              <Button
                type="button"
                disabled={create.isPending || newName.trim().length === 0}
                onClick={() =>
                  create.mutate({ name: newName.trim(), description: newDescription.trim() })
                }
              >
                {tCommon('create')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Start from template dialog */}
      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('startFromTemplate')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            {templates.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('noTemplates')}</p>
            ) : (
              templates.map((tpl) => (
                <div
                  key={tpl.key}
                  className="flex items-start justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{tpl.name}</p>
                    {tpl.description.length > 0 ? (
                      <p className="mt-0.5 text-sm text-muted-foreground">{tpl.description}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('triggerCount', { count: tpl.triggers.length })}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={createFromTemplate.isPending}
                    onClick={() => createFromTemplate.mutate({ templateKey: tpl.key })}
                  >
                    {t('useTemplate')}
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : programs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p className="mb-3">{t('empty')}</p>
            {canManage ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                {t('newProgram')}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {programs.map((program) => (
            <Link
              key={program.id}
              href={`/${locale}/maintenance/program/${program.id}`}
              className="block"
            >
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="p-4">
                  <p className="font-medium leading-tight">{program.name}</p>
                  {program.description.length > 0 ? (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {program.description}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('triggersAndAssets', {
                      triggers: program.triggerCount,
                      assets: program.assetCount,
                    })}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
