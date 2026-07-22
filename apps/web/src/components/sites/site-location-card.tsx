'use client';

import { ExternalLink, MapPin, Navigation, Pencil, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '../../lib/cn';
import { useHasPermission } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { LocationPickerMap } from './location-picker-map';

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

  // Type-ahead suggestions (Nominatim). Debounced; a pick fills lat/lng.
  const [suggestions, setSuggestions] = useState<NominatimHit[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const justSelected = useRef(false);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    // Skip the fetch immediately after picking a suggestion (query was set by us).
    if (justSelected.current) {
      justSelected.current = false;
      return;
    }
    if (q.length < 3) {
      setSuggestions([]);
      setShowSuggest(false);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&limit=5&q=${encodeURIComponent(q)}`,
            { headers: { Accept: 'application/json' }, signal: ctrl.signal },
          );
          if (!res.ok) return;
          const hits = (await res.json()) as NominatimHit[];
          setSuggestions(hits);
          setShowSuggest(true);
          setActiveIdx(-1);
        } catch {
          // aborted or network hiccup — leave the previous suggestions be
        }
      })();
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, open]);

  function selectHit(hit: NominatimHit) {
    justSelected.current = true;
    setQuery(hit.display_name);
    setLat(hit.lat);
    setLng(hit.lon);
    setSuggestions([]);
    setShowSuggest(false);
    setActiveIdx(-1);
  }

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
                <div className="relative flex-1">
                  <Input
                    id="loc-search"
                    value={query}
                    autoComplete="off"
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('locationAddressPlaceholder')}
                    onFocus={() => {
                      if (suggestions.length > 0) setShowSuggest(true);
                    }}
                    onBlur={() => {
                      // Delay so an option's onMouseDown can register first.
                      window.setTimeout(() => setShowSuggest(false), 120);
                    }}
                    onKeyDown={(e) => {
                      if (showSuggest && suggestions.length > 0) {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setActiveIdx((i) => (i + 1) % suggestions.length);
                          return;
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setActiveIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
                          return;
                        }
                        if (e.key === 'Escape') {
                          setShowSuggest(false);
                          return;
                        }
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const hit = suggestions[activeIdx];
                          if (hit !== undefined) selectHit(hit);
                          else void geocode();
                          return;
                        }
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        void geocode();
                      }
                    }}
                  />
                  {showSuggest && suggestions.length > 0 ? (
                    <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-auto rounded-md border bg-popover py-1 text-popover-foreground shadow-md">
                      {suggestions.map((hit, i) => (
                        <li key={`${hit.lat},${hit.lon},${i}`}>
                          <button
                            type="button"
                            // onMouseDown (not onClick) so the pick fires before the input blurs.
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selectHit(hit);
                            }}
                            onMouseEnter={() => setActiveIdx(i)}
                            className={cn(
                              'flex w-full items-start gap-2 px-3 py-2 text-left text-sm',
                              i === activeIdx
                                ? 'bg-accent text-accent-foreground'
                                : 'hover:bg-accent/60',
                            )}
                          >
                            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="leading-snug">{hit.display_name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <Button variant="outline" onClick={() => void geocode()} disabled={searching}>
                  <Search className="mr-1 h-4 w-4" />
                  {searching ? t('locationSearching') : t('locationSearch')}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{t('locationMapHint')}</p>
              <LocationPickerMap
                lat={previewValid ? previewLat : null}
                lng={previewValid ? previewLng : null}
                onChange={(nextLat, nextLng) => {
                  setLat(String(nextLat));
                  setLng(String(nextLng));
                }}
                className="h-64 w-full overflow-hidden rounded-md border"
              />
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
