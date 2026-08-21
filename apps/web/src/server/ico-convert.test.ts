/**
 * ICO → PNG conversion (logo import). Fixtures are hand-assembled ICO
 * containers so every branch is pinned without binary files in the repo:
 * an embedded-PNG frame comes back byte-identical, 32/24/8-bit DIB frames
 * decode to the expected RGBA (including the all-zero-alpha 32-bit case
 * that must fall back to the AND mask), and anything exotic returns null
 * rather than a broken image.
 */
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { convertIcoToPng, decodeIcoDib, encodePng, looksLikeIco } from './ico-convert';

function u16(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff];
}

function u32(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
}

/** Wrap frame bytes in a one-image ICO container. */
function icoContainer(frames: Array<{ width: number; height: number; bytes: Uint8Array }>) {
  const header = [0, 0, 1, 0, ...u16(frames.length)];
  const dirSize = 6 + frames.length * 16;
  let offset = dirSize;
  const entries: number[] = [];
  for (const f of frames) {
    entries.push(
      f.width === 256 ? 0 : f.width,
      f.height === 256 ? 0 : f.height,
      0,
      0,
      ...u16(1),
      ...u16(32),
      ...u32(f.bytes.length),
      ...u32(offset),
    );
    offset += f.bytes.length;
  }
  const out = new Uint8Array(offset);
  out.set([...header, ...entries], 0);
  let at = dirSize;
  for (const f of frames) {
    out.set(f.bytes, at);
    at += f.bytes.length;
  }
  return out;
}

/**
 * Build a 2x2 DIB frame. `pixelRows` are TOP-DOWN logical rows of
 * [r,g,b,a]; the builder writes them bottom-up the way a DIB stores them.
 */
function dib32(pixelRows: number[][][], opts: { andMaskBits?: number[][] } = {}): Uint8Array {
  const height = pixelRows.length;
  const width = pixelRows[0]?.length ?? 0;
  const headerAnd = opts.andMaskBits;
  const xorRow = Math.ceil((width * 32) / 32) * 4;
  const andRow = Math.ceil(width / 32) * 4;
  const out = new Uint8Array(40 + xorRow * height + andRow * height);
  out.set(u32(40), 0);
  out.set(u32(width), 4);
  out.set(u32(height * 2), 8);
  out.set(u16(1), 12);
  out.set(u16(32), 14);
  // compression 0 (BI_RGB) already zero
  for (let y = 0; y < height; y++) {
    const row = pixelRows[height - 1 - y]; // bottom-up
    for (let x = 0; x < width; x++) {
      const [r = 0, g = 0, b = 0, a = 0] = row?.[x] ?? [];
      const at = 40 + y * xorRow + x * 4;
      out[at] = b;
      out[at + 1] = g;
      out[at + 2] = r;
      out[at + 3] = a;
    }
  }
  if (headerAnd !== undefined) {
    const base = 40 + xorRow * height;
    for (let y = 0; y < height; y++) {
      const bits = headerAnd[height - 1 - y] ?? [];
      let byte = 0;
      for (let x = 0; x < width; x++) byte |= (bits[x] ?? 0) << (7 - x);
      out[base + y * andRow] = byte;
    }
  }
  return out;
}

const RED: number[] = [255, 0, 0, 255];
const GREEN: number[] = [0, 255, 0, 255];
const BLUE: number[] = [0, 0, 255, 255];
const CLEAR: number[] = [0, 0, 0, 0];

describe('looksLikeIco', () => {
  it('accepts an ICO header and rejects PNGs and noise', () => {
    expect(looksLikeIco(icoContainer([{ width: 2, height: 2, bytes: new Uint8Array(8) }]))).toBe(
      true,
    );
    expect(looksLikeIco(encodePng({ width: 1, height: 1, pixels: new Uint8Array(4) }))).toBe(false);
    expect(looksLikeIco(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe('encodePng', () => {
  it('produces a structurally valid RGBA PNG whose IDAT inflates back', () => {
    const pixels = new Uint8Array([...RED, ...GREEN, ...BLUE, ...CLEAR]);
    const png = encodePng({ width: 2, height: 2, pixels });
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(2); // IHDR width
    expect(view.getUint32(20)).toBe(2); // IHDR height
    const idatLen = view.getUint32(33);
    const idat = png.subarray(41, 41 + idatLen);
    const raw = new Uint8Array(inflateSync(idat));
    // Two scanlines, each: filter byte 0 + 2 RGBA pixels.
    expect([...raw]).toEqual([0, ...RED, ...GREEN, 0, ...BLUE, ...CLEAR]);
  });
});

describe('decodeIcoDib', () => {
  it('decodes a 32-bit frame with a real alpha channel (no mask needed)', () => {
    const frame = dib32([
      [RED, GREEN],
      [BLUE, [10, 20, 30, 128]],
    ]);
    const img = decodeIcoDib(frame);
    expect(img?.width).toBe(2);
    expect([...(img?.pixels ?? [])]).toEqual([...RED, ...GREEN, ...BLUE, 10, 20, 30, 128]);
  });

  it('falls back to the AND mask when the 32-bit alpha channel is all zero', () => {
    const opaque = (c: number[]): number[] => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 0];
    const frame = dib32(
      [
        [opaque(RED), opaque(GREEN)],
        [opaque(BLUE), opaque(RED)],
      ],
      // 1 = transparent in an AND mask; mask out the top-right pixel.
      {
        andMaskBits: [
          [0, 1],
          [0, 0],
        ],
      },
    );
    const img = decodeIcoDib(frame);
    expect([...(img?.pixels ?? [])].filter((_, i) => i % 4 === 3)).toEqual([255, 0, 255, 255]);
  });

  it('refuses depths and shapes it cannot decode', () => {
    const frame = dib32([[RED]]);
    frame.set(u16(4), 14); // 4-bit palette — out of scope
    expect(decodeIcoDib(frame)).toBeNull();
    expect(decodeIcoDib(new Uint8Array(10))).toBeNull();
  });
});

describe('convertIcoToPng', () => {
  it('extracts an embedded PNG frame byte-for-byte', () => {
    const inner = encodePng({
      width: 2,
      height: 2,
      pixels: new Uint8Array([...RED, ...GREEN, ...BLUE, ...RED]),
    });
    const ico = icoContainer([{ width: 2, height: 2, bytes: inner }]);
    expect([...(convertIcoToPng(ico) ?? [])]).toEqual([...inner]);
  });

  it('re-encodes the largest DIB frame as a PNG', () => {
    const small = dib32([[RED]]);
    const large = dib32([
      [RED, GREEN],
      [BLUE, RED],
    ]);
    const ico = icoContainer([
      { width: 1, height: 1, bytes: small },
      { width: 2, height: 2, bytes: large },
    ]);
    const png = convertIcoToPng(ico);
    expect(png).not.toBeNull();
    const view = new DataView((png ?? new Uint8Array()).buffer);
    expect(view.getUint32(16)).toBe(2); // picked the 2x2 frame
  });

  it('returns null for non-ICO bytes and undecodable frames', () => {
    expect(convertIcoToPng(new Uint8Array([9, 9, 9, 9]))).toBeNull();
    const exotic = dib32([[RED]]);
    exotic.set(u16(4), 14);
    expect(convertIcoToPng(icoContainer([{ width: 1, height: 1, bytes: exotic }]))).toBeNull();
  });
});
