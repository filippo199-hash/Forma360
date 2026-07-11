'use client';

import { MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { trpc } from '../../lib/trpc/client';
import { Card, CardContent } from '../ui/card';

type PinEntity = 'observation' | 'asset' | 'media' | 'inspection' | 'note';

/**
 * "Location on plan" mini-map (#7). If the entity (observation / inspection)
 * has been pinned on a floor plan, shows the plan thumbnail with a marker at
 * the pin, linking through to the full plans view. Renders nothing when the
 * entity isn't pinned.
 */
export function EntityPlanMiniMap({
  entityType,
  entityId,
  locale,
}: {
  entityType: PinEntity;
  entityId: string;
  locale: string;
}) {
  const t = useTranslations('sites');
  const { data } = trpc.sitePlans.pinForEntity.useQuery(
    { entityType, entityId },
    { enabled: entityId !== '' },
  );
  if (data === null || data === undefined) return null;

  const isImage = data.mimeType.startsWith('image/');
  const href = `/${locale}/sites/${data.siteId}?tab=plans&plan=${data.planId}&pin=${data.pinId}`;
  const caption = data.label !== '' ? `${data.planName} · ${data.label}` : data.planName;

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <MapPin className="h-4 w-4 text-primary" />
          {t('planLocationHeading')}
        </div>
        <Link href={href} className="group block">
          {isImage ? (
            <div className="relative overflow-hidden rounded-md border bg-muted/30">
              <img
                src={`/api/files?key=${encodeURIComponent(data.storageKey)}`}
                alt={data.planName}
                className="max-h-56 w-full object-cover transition-opacity group-hover:opacity-95"
              />
              <span
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${data.x * 100}%`, top: `${data.y * 100}%` }}
              >
                <span className="block h-4 w-4 rounded-full border-2 border-white bg-primary shadow ring-2 ring-primary/40" />
              </span>
            </div>
          ) : (
            <div className="rounded-md border p-4 text-sm text-primary group-hover:underline">
              {t('planLocationOpen')}
            </div>
          )}
        </Link>
        <p className="text-xs text-muted-foreground">{caption}</p>
      </CardContent>
    </Card>
  );
}
