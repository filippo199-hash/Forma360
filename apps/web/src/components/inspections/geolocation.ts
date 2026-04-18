/**
 * Thin Promise wrapper around `navigator.geolocation.getCurrentPosition`.
 *
 * PR 29 only uses this for plumbing — the location item is stubbed as
 * "coming soon". Keeping the helper here means the eventual wiring in a
 * later PR does not have to re-derive the error-handling + fallback
 * story. Returns null if geolocation is unavailable or the user
 * declines; never throws.
 */
export interface GeoPoint {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  capturedAt: string;
}

export async function captureGeoPoint(): Promise<GeoPoint | null> {
  if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
    return null;
  }
  return new Promise<GeoPoint | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Number.isFinite(position.coords.accuracy)
            ? position.coords.accuracy
            : null,
          capturedAt: new Date(position.timestamp).toISOString(),
        });
      },
      () => {
        resolve(null);
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  });
}
