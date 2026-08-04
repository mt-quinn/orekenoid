// Minimal PNG read/write. Zero dependencies -- Node's zlib is all it takes.
//
// Rooms are authored as PNGs because that is the format a person can paint in, and
// the format both reference games use. But the generator must stay synchronous and
// testable in Node, so PNGs are compiled to a TypeScript module at build time
// rather than fetched at runtime. That means this codec runs in tooling only, never
// in the game.

import { deflateSync, inflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Write an 8-bit RGB PNG.
 *
 * `pixels` is a flat array of `0xRRGGBB` values, row-major. Filter type 0 (none)
 * throughout: these images are tiny and hand-authored, so compression ratio matters
 * far less than the file being trivially decodable by anything, including a person
 * reading a hex dump.
 */
export function encodePng(width, height, pixels) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let at = 0;
  for (let y = 0; y < height; y++) {
    raw[at++] = 0;
    for (let x = 0; x < width; x++) {
      const value = pixels[y * width + x] ?? 0;
      raw[at++] = (value >> 16) & 0xff;
      raw[at++] = (value >> 8) & 0xff;
      raw[at++] = value & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Read a PNG into `{ width, height, pixels }` with pixels as `0xRRGGBB`.
 *
 * Supports the colour types an image editor actually produces for this kind of
 * work: truecolour, truecolour+alpha, greyscale and palette, 8 bits per channel,
 * with all five filter types. Interlaced images are rejected rather than silently
 * mangled.
 */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colourType = 0;
  let palette = null;
  const idat = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.subarray(pos + 4, pos + 8).toString("ascii");
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colourType = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNGs are not supported");
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    pos += 12 + length;
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}; save as 8-bit`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  if (!channels) throw new Error(`unsupported colour type ${colourType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const bpp = channels;
  const pixels = new Array(width * height);
  let previous = Buffer.alloc(stride);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[at++];
    const line = Buffer.from(raw.subarray(at, at + stride));
    at += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = previous[i];
      const c = i >= bpp ? previous[i - bpp] : 0;
      switch (filter) {
        case 0: break;
        case 1: line[i] = (line[i] + a) & 0xff; break;
        case 2: line[i] = (line[i] + b) & 0xff; break;
        case 3: line[i] = (line[i] + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default: throw new Error(`unknown filter ${filter}`);
      }
    }
    previous = line;
    for (let x = 0; x < width; x++) {
      let r;
      let g;
      let b;
      if (colourType === 3) {
        const index = line[x] * 3;
        r = palette[index];
        g = palette[index + 1];
        b = palette[index + 2];
      } else if (colourType === 0 || colourType === 4) {
        r = g = b = line[x * channels];
      } else {
        r = line[x * channels];
        g = line[x * channels + 1];
        b = line[x * channels + 2];
      }
      pixels[y * width + x] = (r << 16) | (g << 8) | b;
    }
  }
  return { width, height, pixels };
}
