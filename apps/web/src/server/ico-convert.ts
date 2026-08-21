/**
 * ICO → PNG conversion for the company-logo import (server-only).
 *
 * Some sites offer nothing but a favicon `.ico` — refusing it leaves the
 * admin with no logo at all, and "save it and convert it yourself" is not
 * an answer inside a product. An ICO is only a container: each frame is
 * either an embedded PNG (how modern favicons ship anything ≥ 48 px) or a
 * legacy BMP DIB. We pick the largest frame; a PNG frame is extracted
 * as-is, and 32/24/8-bit DIBs are decoded to RGBA and re-encoded through
 * a minimal PNG writer on `node:zlib` — no image library, no native
 * dependency. Exotic frames (1/4-bit, RLE) return null and the route
 * falls back to the explanatory refusal.
 */
import { deflateSync } from 'node:zlib';

/** ICONDIR magic: reserved 0, type 1 (icon), at least one image. */
export function looksLikeIco(bytes: Uint8Array): boolean {
  return (
    bytes.length > 6 &&
    bytes[0] === 0 &&
    bytes[1] === 0 &&
    bytes[2] === 1 &&
    bytes[3] === 0 &&
    readU16(bytes, 4) > 0
  );
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readU16(b: Uint8Array, at: number): number {
  return (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
}

function readU32(b: Uint8Array, at: number): number {
  return (
    ((b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16)) +
    (b[at + 3] ?? 0) * 0x1000000
  );
}

function readI32(b: Uint8Array, at: number): number {
  const u = readU32(b, at);
  return u > 0x7fffffff ? u - 0x100000000 : u;
}

function isPngFrame(frame: Uint8Array): boolean {
  return PNG_MAGIC.every((byte, i) => frame[i] === byte);
}

interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, row-major, top-down. */
  pixels: Uint8Array;
}

/**
 * Decode one ICO DIB frame (BITMAPINFOHEADER + pixel data + AND mask) to
 * RGBA. Supports the depths favicons actually use — 32, 24 and 8 bpp,
 * uncompressed. Returns null for anything else.
 */
export function decodeIcoDib(frame: Uint8Array): RgbaImage | null {
  if (frame.length < 40) return null;
  const headerSize = readU32(frame, 0);
  if (headerSize < 40 || headerSize > frame.length) return null;
  const width = readI32(frame, 4);
  // In an ICO the stored height covers the XOR image plus the AND mask.
  const height = readI32(frame, 8) / 2;
  const bitCount = readU16(frame, 14);
  const compression = readU32(frame, 16);
  if (compression !== 0) return null; // BI_RGB only — no RLE/bitfields
  if (width <= 0 || height <= 0 || width > 1024 || height > 1024) return null;
  if (bitCount !== 32 && bitCount !== 24 && bitCount !== 8) return null;

  const paletteAt = headerSize;
  let palette: Uint8Array | null = null;
  let dataAt = headerSize;
  if (bitCount === 8) {
    const declared = readU32(frame, 32); // biClrUsed; 0 means the full 256
    const entries = declared === 0 ? 256 : declared;
    palette = frame.subarray(paletteAt, paletteAt + entries * 4);
    dataAt = paletteAt + entries * 4;
  }

  // Rows are stored bottom-up and padded to 4 bytes.
  const xorRowBytes = Math.ceil((width * bitCount) / 32) * 4;
  const andRowBytes = Math.ceil(width / 32) * 4;
  const andAt = dataAt + xorRowBytes * height;
  if (andAt > frame.length) return null;
  const hasAndMask = andAt + andRowBytes * height <= frame.length;

  const pixels = new Uint8Array(width * height * 4);
  let sawAlpha = false;

  for (let y = 0; y < height; y++) {
    const srcRow = dataAt + (height - 1 - y) * xorRowBytes;
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      if (bitCount === 32) {
        const at = srcRow + x * 4;
        pixels[out] = frame[at + 2] ?? 0;
        pixels[out + 1] = frame[at + 1] ?? 0;
        pixels[out + 2] = frame[at] ?? 0;
        const a = frame[at + 3] ?? 0;
        pixels[out + 3] = a;
        if (a !== 0) sawAlpha = true;
      } else if (bitCount === 24) {
        const at = srcRow + x * 3;
        pixels[out] = frame[at + 2] ?? 0;
        pixels[out + 1] = frame[at + 1] ?? 0;
        pixels[out + 2] = frame[at] ?? 0;
        pixels[out + 3] = 255;
      } else {
        const idx = (frame[srcRow + x] ?? 0) * 4;
        pixels[out] = palette?.[idx + 2] ?? 0;
        pixels[out + 1] = palette?.[idx + 1] ?? 0;
        pixels[out + 2] = palette?.[idx] ?? 0;
        pixels[out + 3] = 255;
      }
    }
  }

  // The 1-bit AND mask carries transparency for 24/8-bit frames — and for
  // the many 32-bit frames whose alpha channel is entirely zero (written
  // by tools that relied on the mask alone; without this they render as a
  // fully transparent square).
  const needMask = bitCount !== 32 || !sawAlpha;
  if (needMask && hasAndMask) {
    for (let y = 0; y < height; y++) {
      const maskRow = andAt + (height - 1 - y) * andRowBytes;
      for (let x = 0; x < width; x++) {
        const bit = ((frame[maskRow + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1;
        pixels[(y * width + x) * 4 + 3] = bit === 1 ? 0 : 255;
      }
    }
  } else if (needMask) {
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  }

  return { width, height, pixels };
}

// ─── Minimal PNG writer (8-bit RGBA, no interlace) ──────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encode top-down RGBA as a valid 8-bit truecolour+alpha PNG. */
export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, pixels } = image;
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // compression 0, filter 0, interlace 0

  // Filter byte 0 (None) before each scanline.
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  const idat = new Uint8Array(deflateSync(raw));

  const parts = [
    new Uint8Array(PNG_MAGIC),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Convert an ICO to a PNG of its largest frame. Returns null when the file
 * is not an ICO or no frame is in a shape we decode — callers fall back to
 * the explanatory refusal, never a broken image.
 */
export function convertIcoToPng(bytes: Uint8Array): Uint8Array | null {
  if (!looksLikeIco(bytes)) return null;
  const count = readU16(bytes, 4);
  let best: { area: number; frame: Uint8Array } | null = null;
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    if (entry + 16 > bytes.length) break;
    const width = bytes[entry] === 0 ? 256 : (bytes[entry] ?? 0);
    const height = bytes[entry + 1] === 0 ? 256 : (bytes[entry + 1] ?? 0);
    const size = readU32(bytes, entry + 8);
    const offset = readU32(bytes, entry + 12);
    if (offset + size > bytes.length || size === 0) continue;
    const area = width * height;
    if (best === null || area > best.area) {
      best = { area, frame: bytes.subarray(offset, offset + size) };
    }
  }
  if (best === null) return null;
  if (isPngFrame(best.frame)) {
    // Already a PNG — hand the embedded file over untouched.
    return new Uint8Array(best.frame);
  }
  const decoded = decodeIcoDib(best.frame);
  if (decoded === null) return null;
  return encodePng(decoded);
}
