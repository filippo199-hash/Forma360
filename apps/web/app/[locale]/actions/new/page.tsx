'use client';

import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

type Priority = 'low' | 'medium' | 'high' | 'critical';
const PRIORITIES: ReadonlyArray<Priority> = ['low', 'medium', 'high', 'critical'];

/**
 * Standalone action creation page. The inspection-question and
 * observation-anchored entry points use inline dialogs inside their
 * respective surfaces — this page exists for the "I just need to track
 * a task" case (matches SafetyCulture's "+ Create action" top-right).
 */
export default function NewActionPage() {
  const t = useTranslations('actions.create');
  const tPriority = useTranslations('actions.priority');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const canCreate = useHasPermission('actions.create');
  useEffect(() => {
    if (!canCreate) {
      toast.error(tCommon('error'));
      router.push(`/${locale}/actions`);
    }
  }, [canCreate, locale, router, tCommon]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'' | Priority>('');
  const [dueAt, setDueAt] = useState('');
  const [siteId, setSiteId] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [label, setLabel] = useState('');

  const { data: sites } = trpc.sites.list.useQuery();
  const { data: usersData } = trpc.users.list.useQuery({});
  const users = usersData?.users ?? [];

  const create = trpc.actions.createStandalone.useMutation({
    onSuccess: (result) => {
      toast.success(t('createdToast'));
      router.push(`/${locale}/actions/${result.actionId}`);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const canSubmit = title.trim().length > 0 && !create.isPending;

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!canSubmit) return;
    const input: {
      title: string;
      description?: string;
      priority?: Priority;
      dueAt?: string;
      assigneeUserId?: string;
      siteId?: string;
      label?: string;
    } = { title: title.trim() };
    if (description.trim().length > 0) input.description = description.trim();
    if (priority !== '') input.priority = priority;
    if (dueAt !== '') input.dueAt = new Date(dueAt).toISOString();
    if (assigneeUserId !== '') input.assigneeUserId = assigneeUserId;
    if (siteId !== '') input.siteId = siteId;
    if (label.trim().length > 0) input.label = label.trim();
    create.mutate(input);
  }

  return (
    <div className="space-y-6 px-4 py-6">
      <header>
        <Link
          href={`/${locale}/actions`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backLink')}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <Card className="max-w-2xl">
        <CardContent className="space-y-4 py-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">{t('titleLabel')}</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('titlePlaceholder')}
                maxLength={500}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">{t('descriptionLabel')}</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('descriptionPlaceholder')}
                rows={4}
                maxLength={20_000}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="priority">{t('priorityLabel')}</Label>
                <select
                  id="priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as '' | Priority)}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">{t('noPriority')}</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {tPriority(p)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dueAt">{t('dueDateLabel')}</Label>
                <Input
                  id="dueAt"
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="site">{t('siteLabel')}</Label>
                <select
                  id="site"
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">{t('siteNoneOption')}</option>
                  {(sites ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assignee">{t('assigneeLabel')}</Label>
                <select
                  id="assignee"
                  value={assigneeUserId}
                  onChange={(e) => setAssigneeUserId(e.target.value)}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="label">{t('labelLabel')}</Label>
              <Input
                id="label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t('labelPlaceholder')}
                maxLength={80}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" asChild>
                <Link href={`/${locale}/actions`}>{t('cancelButton')}</Link>
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {t('saveButton')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
