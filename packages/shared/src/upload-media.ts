/**
 * Phone-aware upload media policy — the single source of truth for what
 * the upload routes accept.
 *
 * Two problems this solves, learned from the field:
 *
 * 1. **Capture formats.** Samsung and iPhone cameras default to HEIC/HEIF
 *    (and increasingly AVIF); phone video arrives as 3GP, Matroska or
 *    HEVC-in-MP4/MOV. Per-route hardcoded allowlists rejected all of
 *    these with "file type not supported" — at the exact moment a worker
 *    on site tried to photograph a defect.
 *
 * 2. **Missing MIME types.** Some Android browsers and webviews report
 *    `""` or `application/octet-stream` for camera files. A pure
 *    MIME-set check rejects those too, so `resolveUploadMime` falls back
 *    to the file extension when the reported type is unusable.
 *
 * HEIC/HEIF stills cannot be rendered by any browser `<img>`, so routes
 * that accept them convert to JPEG at upload time (see
 * apps/web/src/server/phone-media.ts). Detection lives here
 * (`isHeicLike`) so route policy and conversion never disagree.
 */

/** Stills a phone camera can produce at capture time. */
export const PHONE_IMAGE_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
  'image/avif',
] as const;

/** Video containers phones record into (HEVC inside MP4/MOV included). */
export const PHONE_VIDEO_MIME = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/3gpp',
  'video/3gpp2',
  'video/x-matroska',
  'video/x-m4v',
] as const;

/** Ordinary paperwork formats the document-ish routes accept. */
export const DOCUMENT_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
] as const;

/**
 * Extension → MIME fallback for uploads whose reported type is empty or
 * `application/octet-stream`. Only formats we'd accept anyway — an
 * unknown extension still resolves to null and is refused.
 */
const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
};

/**
 * The effective MIME type of an upload: the browser's report when it is
 * usable, else the extension fallback, else null (unidentifiable).
 */
export function resolveUploadMime(filename: string, reportedType: string): string | null {
  const reported = reportedType.trim().toLowerCase();
  if (reported.length > 0 && reported !== 'application/octet-stream') {
    return reported;
  }
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXTENSION_MIME[ext] ?? null;
}

/** HEIC/HEIF stills — undisplayable in browsers, converted to JPEG on upload. */
export function isHeicLike(mime: string): boolean {
  return (
    mime === 'image/heic' ||
    mime === 'image/heif' ||
    mime === 'image/heic-sequence' ||
    mime === 'image/heif-sequence'
  );
}

/**
 * Kind-aware size cap: one number per route under-serves phone video,
 * which regularly exceeds a stills-sized cap within seconds of footage.
 */
export function uploadKind(mime: string): 'image' | 'video' | 'other' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'other';
}
