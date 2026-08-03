/**
 * PWA web-app manifest (PF-10: "no PWA — the app can't even be installed
 * to a home screen"). Served at /manifest.webmanifest by Next's metadata
 * routes; the name follows the active brand (ADR 0010).
 */
import type { MetadataRoute } from 'next';
import { activeBrand } from '../src/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: activeBrand.name,
    short_name: activeBrand.name,
    description: 'Inspections, permits, fire safety and hazard reporting — in the field.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0d9488',
    icons: [
      { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
