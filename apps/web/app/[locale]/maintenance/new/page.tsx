'use client';

import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Textarea } from '../../../../src/components/ui/textarea';
import { trpc } from '../../../../src/lib/trpc/client';

export default function NewMaintenancePlanPage() {
  const t = useTranslations('maintenancePlans.new');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [planType, setPlanType] = useState<'time' | 'usage'>('time');
  const [intervalDays, setIntervalDays] = useState('');
  const [intervalUsage, setIntervalUsage] = useState('');
  const [usageField, setUsageField] = useState('');
  const [usageUnit, setUsageUnit] = useState('');
  const [lastServiceDate, setLastServiceDate] = useState('');
  const [notifDays, setNotifDays] = useState<number[]>([7]);
  const [notifInput, setNotifInput] = useState('');

  const create = trpc.maintenancePlans.create.useMutation({
    onSuccess: ({ planId }) => {
      toast.success(t('createdToast'));
      router.push(`/${locale}/maintenance/${planId}`);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function addNotifDay() {
    const n = parseInt(notifInput, 10);
    if (isNaN(n) || n < 0) return;
    if (!notifDays.includes(n)) setNotifDays((prev) => [...prev, n].sort((a, b) => b - a));
    setNotifInput('');
  }

  function removeNotifDay(n: number) {
    setNotifDays((prev) => prev.filter((d) => d !== n));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate({
      name: name.trim(),
      description,
      planType,
      intervalDays: planType === 'time' && intervalDays !== '' ? parseInt(intervalDays, 10) : undefined,
      intervalUsage: planType === 'usage' && intervalUsage !== '' ? parseFloat(intervalUsage) : undefined,
      usageField: planType === 'usage' ? usageField.trim() : undefined,
      usageUnit: planType === 'usage' ? usageUnit.trim() : '',
      lastServiceDate: lastServiceDate !== '' ? lastServiceDate : undefined,
      notificationDaysBefore: notifDays,
    });
  }

  const isValid =
    name.trim().length > 0 &&
    (planType === 'time'
      ? intervalDays !== '' && parseInt(intervalDays, 10) > 0
      : intervalUsage !== '' && usageField.trim().length > 0);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/maintenance`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backLink')}
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-base font-semibold">{t('basicHeading')}</h2>

            <div className="space-y-1.5">
              <Label htmlFor="plan-name">{t('fields.name')}</Label>
              <Input
                id="plan-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('fields.namePlaceholder')}
                maxLength={500}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plan-description">{t('fields.description')}</Label>
              <Textarea
                id="plan-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('fields.descriptionPlaceholder')}
                maxLength={5000}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-base font-semibold">{t('scheduleHeading')}</h2>

            {/* Plan type toggle */}
            <div className="space-y-1.5">
              <Label>{t('fields.planType')}</Label>
              <div className="grid grid-cols-2 gap-2">
                {(['time', 'usage'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setPlanType(type)}
                    className={`rounded-md border px-4 py-2.5 text-sm font-medium transition-colors ${
                      planType === type
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-muted'
                    }`}
                  >
                    {t(`fields.planTypes.${type}`)}
                  </button>
                ))}
              </div>
            </div>

            {planType === 'time' ? (
              <div className="space-y-1.5">
                <Label htmlFor="interval-days">{t('fields.intervalDays')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="interval-days"
                    type="number"
                    min="1"
                    value={intervalDays}
                    onChange={(e) => setIntervalDays(e.target.value)}
                    placeholder="30"
                    className="w-28"
                  />
                  <span className="text-sm text-muted-foreground">{t('fields.days')}</span>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="interval-usage">{t('fields.intervalUsage')}</Label>
                  <Input
                    id="interval-usage"
                    type="number"
                    min="0"
                    step="any"
                    value={intervalUsage}
                    onChange={(e) => setIntervalUsage(e.target.value)}
                    placeholder="500"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="usage-unit">{t('fields.usageUnit')}</Label>
                  <Input
                    id="usage-unit"
                    value={usageUnit}
                    onChange={(e) => setUsageUnit(e.target.value)}
                    placeholder={t('fields.usageUnitPlaceholder')}
                    maxLength={50}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="usage-field">{t('fields.usageField')}</Label>
                  <Input
                    id="usage-field"
                    value={usageField}
                    onChange={(e) => setUsageField(e.target.value)}
                    placeholder={t('fields.usageFieldPlaceholder')}
                    maxLength={200}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="last-service-date">{t('fields.lastServiceDate')}</Label>
              <Input
                id="last-service-date"
                type="date"
                value={lastServiceDate}
                onChange={(e) => setLastServiceDate(e.target.value)}
                className="w-44"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-base font-semibold">{t('notificationsHeading')}</h2>
            <p className="text-sm text-muted-foreground">{t('notificationsHint')}</p>

            <div className="flex flex-wrap gap-2">
              {notifDays.map((n) => (
                <span
                  key={n}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted px-3 py-1 text-sm"
                >
                  {t('notifDayChip', { days: n })}
                  <button
                    type="button"
                    onClick={() => removeNotifDay(n)}
                    aria-label={t('removeNotifDay')}
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                  </button>
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                max="365"
                value={notifInput}
                onChange={(e) => setNotifInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addNotifDay();
                  }
                }}
                placeholder="14"
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">{t('fields.days')}</span>
              <Button type="button" variant="outline" size="sm" onClick={addNotifDay}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('addNotifDay')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending || !isValid}>
            {create.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {t('submitButton')}
          </Button>
          <Button type="button" variant="ghost" asChild>
            <Link href={`/${locale}/maintenance`}>{tCommon('cancel')}</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
