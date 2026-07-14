'use client';

import 'leaflet/dist/leaflet.css';
import type * as Leaflet from 'leaflet';
import { useEffect, useRef } from 'react';

interface LocationPickerMapProps {
  /** Current pin latitude, or null when unset. */
  lat: number | null;
  /** Current pin longitude, or null when unset. */
  lng: number | null;
  /** Fired when the user clicks the map or drags the pin. */
  onChange: (lat: number, lng: number) => void;
  className?: string;
}

/**
 * Interactive OpenStreetMap map (keyless, via Leaflet) that lets the user drop
 * and drag a location pin. Clicking anywhere on the map places/moves the pin;
 * the marker itself is draggable. Reports the chosen coordinates through
 * `onChange` — the parent persists them via `sites.update`.
 *
 * Leaflet touches `window`, so its JS is imported dynamically inside an effect
 * (client-only); the CSS is a static import (SSR-safe). We use a `divIcon` pin
 * to sidestep Leaflet's well-known bundler issue with its default marker image
 * assets.
 */
export function LocationPickerMap({ lat, lng, onChange, className }: LocationPickerMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markerRef = useRef<Leaflet.Marker | null>(null);
  const iconRef = useRef<Leaflet.DivIcon | null>(null);
  // Keep the latest onChange without re-running the init effect.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Set when a change originates from the map itself, so the lat/lng effect
  // doesn't pan the view back onto the point the user just clicked.
  const skipRecenterRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let map: Leaflet.Map | undefined;

    void (async () => {
      const L = await import('leaflet');
      if (cancelled || containerRef.current === null) return;

      const pinIcon = L.divIcon({
        className: 'forma360-map-pin',
        html: '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="#2563eb" stroke="#ffffff" stroke-width="1.5"><path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.6" fill="#ffffff" stroke="none"/></svg>',
        iconSize: [30, 30],
        iconAnchor: [15, 30],
      });
      iconRef.current = pinIcon;

      const hasPin = lat !== null && lng !== null;
      const startLat = lat ?? 51.505;
      const startLng = lng ?? -0.09;
      map = L.map(containerRef.current).setView([startLat, startLng], hasPin ? 15 : 4);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      function placeMarker(nextLat: number, nextLng: number): void {
        if (map === undefined) return;
        const existing = markerRef.current;
        if (existing !== null) {
          existing.setLatLng([nextLat, nextLng]);
          return;
        }
        const marker = L.marker([nextLat, nextLng], {
          draggable: true,
          ...(iconRef.current !== null ? { icon: iconRef.current } : {}),
        }).addTo(map);
        marker.on('dragend', () => {
          const p = marker.getLatLng();
          skipRecenterRef.current = true;
          onChangeRef.current(p.lat, p.lng);
        });
        markerRef.current = marker;
      }

      if (hasPin) placeMarker(startLat, startLng);

      map.on('click', (e: Leaflet.LeafletMouseEvent) => {
        placeMarker(e.latlng.lat, e.latlng.lng);
        skipRecenterRef.current = true;
        onChangeRef.current(e.latlng.lat, e.latlng.lng);
      });

      mapRef.current = map;
      // The dialog animates open; recompute size once it has settled so the
      // tiles fill the container instead of rendering into a 0×0 box.
      window.setTimeout(() => map?.invalidateSize(), 120);
    })();

    return () => {
      cancelled = true;
      if (map !== undefined) map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Init once. External lat/lng updates are handled by the effect below.
  }, []);

  // React to lat/lng set from outside the map (e.g. address search): move the
  // pin and recentre.
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || lat === null || lng === null) return;
    // The map already moved its own pin — don't pan the view back onto it.
    if (skipRecenterRef.current) {
      skipRecenterRef.current = false;
      return;
    }
    const existing = markerRef.current;
    if (existing !== null) {
      existing.setLatLng([lat, lng]);
    } else if (iconRef.current !== null) {
      void (async () => {
        const L = await import('leaflet');
        const marker = L.marker([lat, lng], {
          draggable: true,
          ...(iconRef.current !== null ? { icon: iconRef.current } : {}),
        }).addTo(map);
        marker.on('dragend', () => {
          const p = marker.getLatLng();
          skipRecenterRef.current = true;
          onChangeRef.current(p.lat, p.lng);
        });
        markerRef.current = marker;
      })();
    }
    map.setView([lat, lng], Math.max(map.getZoom(), 15));
  }, [lat, lng]);

  return <div ref={containerRef} className={className} />;
}
