/**
 * Phone-media normalisation (PM-E01..E03). The fixture is a REAL
 * HEVC-encoded HEIC (what a Samsung/iPhone camera writes), so the
 * conversion path is proven against the actual codec, not a stub.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalisePhoneMedia } from './phone-media';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'sample.heic');

describe('phone-media normalisation', () => {
  it('PM-E01: a real HEIC converts to a JPEG payload, mime and filename', async () => {
    const heic = new Uint8Array(readFileSync(FIXTURE));
    const out = await normalisePhoneMedia({
      bytes: heic,
      mimeType: 'image/heic',
      filename: '20260812_101530.heic',
    });
    expect(out.converted).toBe(true);
    expect(out.mimeType).toBe('image/jpeg');
    expect(out.filename).toBe('20260812_101530.jpg');
    // JPEG magic bytes — the payload really is a JPEG now.
    expect(out.bytes[0]).toBe(0xff);
    expect(out.bytes[1]).toBe(0xd8);
  });

  it('PM-E02: non-HEIC media passes through untouched', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const out = await normalisePhoneMedia({
      bytes: png,
      mimeType: 'image/png',
      filename: 'shot.png',
    });
    expect(out.converted).toBe(false);
    expect(out.mimeType).toBe('image/png');
    expect(out.bytes).toBe(png);
  });

  it('PM-E03: an undecodable "HEIC" stores the original instead of failing', async () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    const out = await normalisePhoneMedia({
      bytes: junk,
      mimeType: 'image/heic',
      filename: 'corrupt.heic',
    });
    expect(out.converted).toBe(false);
    expect(out.mimeType).toBe('image/heic');
    expect(out.filename).toBe('corrupt.heic');
    expect(out.bytes).toBe(junk);
  });
});
