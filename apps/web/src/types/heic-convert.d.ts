/**
 * heic-convert ships no types. Only the surface we use is declared —
 * the boundary is proven by the phone-media unit test, which round-trips
 * a real HEVC-encoded HEIC fixture through it.
 */
declare module 'heic-convert' {
  interface HeicConvertOptions {
    buffer: Buffer | Uint8Array;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }
  function convert(options: HeicConvertOptions): Promise<Buffer>;
  export default convert;
}
