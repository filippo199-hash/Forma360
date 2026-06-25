/**
 * Parse a user-supplied video link into a safe embed URL.
 *
 * Security: we NEVER put a raw user URL into an iframe `src`. Only YouTube and
 * Vimeo are accepted; we extract the video id and rebuild a known-good embed
 * URL ourselves. Anything else returns null (the caller rejects it).
 *
 * Privacy: we use youtube-nocookie.com and Vimeo's `dnt=1` (do-not-track) so
 * embedding instruction videos doesn't drop third-party tracking cookies on
 * inspectors.
 */
export interface VideoEmbed {
  provider: 'youtube' | 'vimeo';
  /** Safe iframe src, built by us — never the raw input. */
  embedUrl: string;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;

export function parseVideoEmbed(raw: string): VideoEmbed | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;

  const host = u.hostname.replace(/^www\./, '').toLowerCase();

  // ── YouTube ──────────────────────────────────────────────────────────────
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    const v = u.searchParams.get('v');
    if (v !== null && YOUTUBE_ID.test(v)) {
      return { provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${v}` };
    }
    const m = u.pathname.match(/^\/(?:embed|shorts|v)\/([A-Za-z0-9_-]{6,20})/);
    if (m?.[1] !== undefined) {
      return { provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${m[1]}` };
    }
    return null;
  }
  if (host === 'youtu.be') {
    const m = u.pathname.match(/^\/([A-Za-z0-9_-]{6,20})/);
    if (m?.[1] !== undefined) {
      return { provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${m[1]}` };
    }
    return null;
  }

  // ── Vimeo ────────────────────────────────────────────────────────────────
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = u.pathname.match(/\/(?:video\/)?(\d+)/);
    if (m?.[1] !== undefined) {
      return { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${m[1]}?dnt=1` };
    }
    return null;
  }

  return null;
}

/** True when the link is an embeddable YouTube/Vimeo URL. */
export function isEmbeddableVideoUrl(raw: string): boolean {
  return parseVideoEmbed(raw) !== null;
}
