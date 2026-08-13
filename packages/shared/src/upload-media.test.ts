/**
 * Phone-aware upload policy (UM-E01..E05) — pins the two field bugs this
 * module exists for: HEIC/HEIF capture formats being refused, and
 * Android's empty/octet-stream MIME reports bypassing type checks.
 */
import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_MIME,
  PHONE_IMAGE_MIME,
  PHONE_VIDEO_MIME,
  isHeicLike,
  resolveUploadMime,
  uploadKind,
} from './upload-media';

describe('upload media policy', () => {
  it('UM-E01: every major phone capture format is in the allowlists', () => {
    for (const m of ['image/heic', 'image/heif', 'image/avif', 'image/jpeg']) {
      expect(PHONE_IMAGE_MIME).toContain(m);
    }
    for (const m of ['video/3gpp', 'video/x-matroska', 'video/quicktime', 'video/mp4']) {
      expect(PHONE_VIDEO_MIME).toContain(m);
    }
    expect(DOCUMENT_MIME).toContain('application/pdf');
  });

  it('UM-E02: a usable reported MIME wins, case-normalised', () => {
    expect(resolveUploadMime('photo.jpg', 'image/jpeg')).toBe('image/jpeg');
    expect(resolveUploadMime('anything.bin', 'IMAGE/HEIC')).toBe('image/heic');
    // The report wins even when the extension disagrees — the browser
    // knows the payload better than the name does.
    expect(resolveUploadMime('photo.heic', 'image/jpeg')).toBe('image/jpeg');
  });

  it('UM-E03: empty and octet-stream reports fall back to the extension', () => {
    expect(resolveUploadMime('20260812_101530.heic', '')).toBe('image/heic');
    expect(resolveUploadMime('20260812_101530.HEIC', 'application/octet-stream')).toBe(
      'image/heic',
    );
    expect(resolveUploadMime('clip.3gp', '')).toBe('video/3gpp');
    expect(resolveUploadMime('clip.mkv', 'application/octet-stream')).toBe('video/x-matroska');
    expect(resolveUploadMime('scan.pdf', '')).toBe('application/pdf');
  });

  it('UM-E04: unidentifiable uploads resolve to null', () => {
    expect(resolveUploadMime('malware.exe', '')).toBeNull();
    expect(resolveUploadMime('noextension', 'application/octet-stream')).toBeNull();
    expect(resolveUploadMime('archive.zip', '')).toBeNull();
    // SVG stays out of the extension map on purpose (script-carrying).
    expect(resolveUploadMime('logo.svg', '')).toBeNull();
  });

  it('UM-E05: heic detection and kind split behave', () => {
    expect(isHeicLike('image/heic')).toBe(true);
    expect(isHeicLike('image/heif')).toBe(true);
    expect(isHeicLike('image/avif')).toBe(false);
    expect(isHeicLike('image/jpeg')).toBe(false);
    expect(uploadKind('image/heic')).toBe('image');
    expect(uploadKind('video/3gpp')).toBe('video');
    expect(uploadKind('application/pdf')).toBe('other');
  });
});
