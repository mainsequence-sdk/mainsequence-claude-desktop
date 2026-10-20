import { deflateSync, inflateSync } from 'node:zlib';

/**
 * Minimal, dependency-free PNG support for agent icons: decode an 8-bit,
 * non-interlaced PNG (grey, RGB, palette, grey+alpha, RGBA), scale it down and
 * re-encode it as RGBA. Claude's native image is limited to 128 KiB of markup,
 * and Command Center icons can be far larger than the 20–32 px Claude draws.
 */
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const MAX_SIDE = 4096;

export type Rgba = { width: number; height: number; pixels: Buffer };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Decodes the default image (APNG frame zero); returns null for any PNG it does not support. */
export function decodePng(bytes: Buffer): Rgba | null {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(SIGNATURE)) return null;
  let offset = 8, width = 0, height = 0, depth = 0, color = -1, interlace = 0;
  let palette: Buffer | null = null, transparency: Buffer | null = null;
  const data: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (body.length !== length) return null;
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; color = body[9]; interlace = body[12]; }
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const channels = CHANNELS[color];
  if (!channels || depth !== 8 || interlace !== 0 || !width || !height || width > MAX_SIDE || height > MAX_SIDE || !data.length) return null;
  if (color === 3 && !palette) return null;
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(data)); } catch { return null; }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride), prior = y ? rows.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0, b = prior ? prior[x] : 0, c = prior && x >= channels ? prior[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (filter !== 0) return null;
      out[x] = value & 0xff;
    }
  }
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    let r, g, b, alpha = 255;
    if (color === 0) { r = g = b = rows[j]; }
    else if (color === 2) { r = rows[j]; g = rows[j + 1]; b = rows[j + 2]; }
    else if (color === 3) { const index = rows[j]; if (index * 3 + 2 >= palette!.length) return null; r = palette![index * 3]; g = palette![index * 3 + 1]; b = palette![index * 3 + 2]; alpha = transparency && index < transparency.length ? transparency[index] : 255; }
    else if (color === 4) { r = g = b = rows[j]; alpha = rows[j + 1]; }
    else { r = rows[j]; g = rows[j + 1]; b = rows[j + 2]; alpha = rows[j + 3]; }
    pixels[i * 4] = r; pixels[i * 4 + 1] = g; pixels[i * 4 + 2] = b; pixels[i * 4 + 3] = alpha;
  }
  return { width, height, pixels };
}

/** Scales into a square of `size` keeping the aspect ratio: nearest pixel for pixel art, an alpha-weighted box average otherwise. */
export function scaleRgba(image: Rgba, size: number, pixelated: boolean): Rgba {
  const ratio = Math.min(size / image.width, size / image.height, 1);
  const width = Math.max(1, Math.round(image.width * ratio)), height = Math.max(1, Math.round(image.height * ratio));
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const target = (y * width + x) * 4;
    if (pixelated) {
      const sx = Math.min(image.width - 1, Math.floor((x + 0.5) * image.width / width)), sy = Math.min(image.height - 1, Math.floor((y + 0.5) * image.height / height));
      image.pixels.copy(pixels, target, (sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4);
      continue;
    }
    const x0 = Math.floor(x * image.width / width), x1 = Math.max(x0 + 1, Math.floor((x + 1) * image.width / width));
    const y0 = Math.floor(y * image.height / height), y1 = Math.max(y0 + 1, Math.floor((y + 1) * image.height / height));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
      const source = (sy * image.width + sx) * 4, alpha = image.pixels[source + 3];
      r += image.pixels[source] * alpha; g += image.pixels[source + 1] * alpha; b += image.pixels[source + 2] * alpha; a += alpha; n++;
    }
    pixels[target] = a ? Math.round(r / a) : 0; pixels[target + 1] = a ? Math.round(g / a) : 0; pixels[target + 2] = a ? Math.round(b / a) : 0;
    pixels[target + 3] = Math.round(a / n);
  }
  return { width, height, pixels };
}

export function encodePng(image: Rgba): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0); header.writeUInt32BE(image.height, 4); header[8] = 8; header[9] = 6;
  const stride = image.width * 4, raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) image.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** A smaller PNG of the same image for display at icon sizes, or null when the input is not a supported PNG. */
export function shrinkPng(bytes: Buffer, size: number, pixelated: boolean): Buffer | null {
  const image = decodePng(bytes);
  if (!image) return null;
  if (image.width <= size && image.height <= size) return null;
  return encodePng(scaleRgba(image, size, pixelated));
}
