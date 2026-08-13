/**
 * Phone-media normalisation for the upload routes.
 *
 * HEIC/HEIF stills (the Samsung/iPhone camera default) cannot be shown
 * by any browser `<img>`, so accepting them raw would store photos that
 * every gallery renders as a grey tile. Uploads are therefore converted
 * to JPEG once, at ingest — one conversion instead of one per view, and
 * everything downstream (thumbnails, PDF renders, exports) keeps working
 * with no idea HEIC was ever involved.
 *
 * Conversion is best-effort: a file that claims to be HEIC but doesn't
 * decode is stored as-is. It still downloads — a technician's photo must
 * never be dropped because a converter choked (the incidents attachments
 * lesson: an original that survives beats a perfect pipeline).
 *
 * `heic-convert` is imported lazily: it boots a libheif WASM instance,
 * which no other route should pay for.
 */
import { isHeicLike } from '@forma360/shared/upload-media';
import type { Logger } from '@forma360/shared/logger';

export interface NormalisedUpload {
  bytes: Uint8Array;
  mimeType: string;
  /** Filename with the extension corrected when the payload changed. */
  filename: string;
  converted: boolean;
}

export async function normalisePhoneMedia(
  input: { bytes: Uint8Array; mimeType: string; filename: string },
  logger?: Logger,
): Promise<NormalisedUpload> {
  if (!isHeicLike(input.mimeType)) {
    return { ...input, converted: false };
  }
  try {
    const { default: convert } = await import('heic-convert');
    const out = await convert({
      buffer: Buffer.from(input.bytes),
      format: 'JPEG',
      quality: 0.85,
    });
    return {
      bytes: new Uint8Array(out),
      mimeType: 'image/jpeg',
      filename: input.filename.replace(/\.(heic|heif)$/i, '') + '.jpg',
      converted: true,
    };
  } catch (err) {
    logger?.warn(
      { err, filename: input.filename },
      '[phone-media] HEIC conversion failed — storing the original',
    );
    return { ...input, converted: false };
  }
}
