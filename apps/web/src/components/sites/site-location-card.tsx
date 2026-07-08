'use client';

import { ExternalLink, MapPin, Navigation, Pencil, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { useHasPermission } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

interface SiteLocationCardProps {
  siteId: string;
  latitude: number | null;
  longitude: number | null;
  locationAddress: string | null;
}

function embedUrl(lat: number, lng: number): string {
  // Google Maps keyless embed renders raster tiles reliably (the OSM
  // export/embed endpoint frequently serves blank tiles under its tile
  // usage policy). The marker sits at the q= coordinate.
  return `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`;
}

interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
}

export function SiteLocationCard({
  siteId,
  latitude,
  longitude,
  locationAddress,
}: SiteLocationCardProps) {
  const t = useTranslations('sites');
  const tCommon = useTranslations('common');
  const canManage = useHasPermission('sites.manage');
  const utils = trpc.useUtils();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(locationAddress ?? '');
  const [lat, setLat] = useState<string>(latitude !== null ? String(latitude) : '');
  const [lng, setLng] = useState<string>(longitude !== null ? String(longitude) : '');
  const [searching, setSearching] = useState(false);

  const update = trpc.sites.update.useMutation({
    onSuccess: () => {
      void utils.sites.getHub.invalidate({ id: siteId });
      toast.success(t('locationSaved'));
      setOpen(false);
    },
    onError: () => toast.error(tCommon('error')),
  });

  async function geocode() {
    if (query.trim().length === 0) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query.trim())}`,
        { headers: { Accept: 'application/json' } },
      );
      if (!res.ok) {
        toast.error(t('locationSearchError'));
        return;
      }
      const hits = (await res.json()) as NominatimHit[];
      const hit = hits[0];
      if (hit === undefined) {
        toast.error(t('locationNotFound'));
        return;
      }
      setLat(hit.lat);
      setLng(hit.lon);
    } catch {
      toast.error(t('locationSearchError'));
    } finally {
      setSearching(false);
    }
  }

  function save() {
    const latNum = Number.parseFloat(lat);
    const lngNum = Number.parseFloat(lng);
    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      toast.error(t('locationInvalid'));
      return;
    }
    update.mutate({
      id: siteId,
      latitude: latNum,
      longitude: lngNum,
      locationAddress: query.trim().length > 0 ? query.trim() : null,
    });
  }

  const hasLocation = latitude !== null && longitude !== null;
  const previewLat = Number.parseFloat(lat);
  const previewLng = Number.parseFloat(lng);
  const previewValid = !Number.isNaN(previewLat) && !Number.isNaN(previewLng);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <MapPin className="h-4 w-4 text-primary" />
            {t('locationTitle')}
          </div>
          {canManage ? (
            <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              {hasLocation ? t('locationEdit') : t('locationSet')}
            </Button>
          ) : null}
        </div>

        {hasLocation ? (
          <div className="space-y-2">
            <iframe
              title={t('locationTitle')}
              src={embedUrl(latitude, longitude)}
              className="h-64 w-full rounded-md border"
              loading="lazy"
            />
            {locationAddress !== null && locationAddress !== '' ? (
              <p className="text-sm text-muted-foreground">{locationAddress}</p>
            ) : null}
            <div className="flex flex-wrap gap-3 text-sm">
              <a
                href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('locationOpenMap')}
              </a>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Navigation className="h-3.5 w-3.5" />
                {t('locationDirections')}
              </a>
            </div>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('locationEmpty')}</p>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('locationDialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="loc-search">{t('locationAddressLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  id="loc-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('locationAddressPlaceholder')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void geocode();
                    }
                  }}
                />
                <Button variant="outline" onClick={() => void geocode()} disabled={searching}>
                  <Search className="mr-1 h-4 w-4" />
                  {searching ? t('locationSearching') : t('locationSearch')}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="loc-lat">{t('locationLat')}</Label>
                <Input id="loc-lat" value={lat} onChange={(e) => setLat(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loc-lng">{t('locationLng')}</Label>
                <Input id="loc-lng" value={lng} onChange={(e) => setLng(e.target.value)} />
              </div>
            </div>

            {previewValid ? (
              <iframe
                title={t('locationPreview')}
                src={embedUrl(previewLat, previewLng)}
                className="h-48 w-full rounded-md border"
                loading="lazy"
              />
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={save} disabled={update.isPending || !previewValid}>
              {t('locationSaveButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
