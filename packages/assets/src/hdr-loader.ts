/**
 * Radiance HDR (.hdr / .pic) image loader.
 *
 * Decodes RGBE-encoded images (with adaptive RLE) into a linear
 * Float32Array of [R, G, B] triplets. Supports the standard
 * "#?RADIANCE" format used by tools like IBL Baker, Poly Haven, etc.
 */

export interface HDRImage {
  width: number;
  height: number;
  data: Float32Array; // RGB float32, length = width * height * 3
}

export async function loadHDR(url: string): Promise<HDRImage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch HDR: ${response.status} ${url}`);
  const buffer = await response.arrayBuffer();
  return parseHDR(buffer);
}

export function parseHDR(buffer: ArrayBuffer): HDRImage {
  const bytes = new Uint8Array(buffer);
  let pos = 0;

  function readLine(): string {
    let line = '';
    while (pos < bytes.length) {
      const ch = bytes[pos++]!;
      if (ch === 0x0a) return line;
      if (ch !== 0x0d) line += String.fromCharCode(ch);
    }
    return line;
  }

  // Header
  const magic = readLine();
  if (!magic.startsWith('#?')) throw new Error('Not a Radiance HDR file');

  let format = '';
  while (pos < bytes.length) {
    const line = readLine();
    if (line === '') break;
    if (line.startsWith('FORMAT=')) format = line.slice(7).trim();
  }
  if (format && format !== '32-bit_rle_rgbe' && format !== '32-bit_rle_xyze') {
    throw new Error(`Unsupported HDR format: ${format}`);
  }

  // Resolution line: "-Y height +X width"
  const resLine = readLine();
  const resMatch = resLine.match(/-Y\s+(\d+)\s+\+X\s+(\d+)/);
  if (!resMatch) throw new Error(`Unexpected resolution line: ${resLine}`);
  const height = parseInt(resMatch[1]!, 10);
  const width = parseInt(resMatch[2]!, 10);

  // Decode scanlines
  const rgbe = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const scanlineOffset = y * width * 4;

    if (width < 8 || width > 0x7fff) {
      // Old format — uncompressed
      for (let x = 0; x < width; x++) {
        rgbe[scanlineOffset + x * 4] = bytes[pos++]!;
        rgbe[scanlineOffset + x * 4 + 1] = bytes[pos++]!;
        rgbe[scanlineOffset + x * 4 + 2] = bytes[pos++]!;
        rgbe[scanlineOffset + x * 4 + 3] = bytes[pos++]!;
      }
      continue;
    }

    // Check for new-style RLE
    const b0 = bytes[pos++]!;
    const b1 = bytes[pos++]!;
    const b2 = bytes[pos++]!;
    const b3 = bytes[pos++]!;

    if (b0 !== 2 || b1 !== 2 || (b2 & 0x80) !== 0) {
      // Not new RLE — rewind and read uncompressed
      pos -= 4;
      for (let x = 0; x < width; x++) {
        rgbe[scanlineOffset + x * 4] = bytes[pos++]!;
        rgbe[scanlineOffset + x * 4 + 1] = bytes[pos++]!;
        rgbe[scanlineOffset + x * 4 + 2] = bytes[pos++]!;
        rgbe[scanlineOffset + x * 4 + 3] = bytes[pos++]!;
      }
      continue;
    }

    const scanWidth = (b2 << 8) | b3;
    if (scanWidth !== width) throw new Error('Scanline width mismatch');

    // Decode 4 channels separately (adaptive RLE)
    for (let ch = 0; ch < 4; ch++) {
      let x = 0;
      while (x < width) {
        const code = bytes[pos++]!;
        if (code > 128) {
          // Run
          const count = code - 128;
          const val = bytes[pos++]!;
          for (let i = 0; i < count; i++) {
            rgbe[scanlineOffset + (x + i) * 4 + ch] = val;
          }
          x += count;
        } else {
          // Literal
          for (let i = 0; i < code; i++) {
            rgbe[scanlineOffset + (x + i) * 4 + ch] = bytes[pos++]!;
          }
          x += code;
        }
      }
    }
  }

  // Convert RGBE → linear float RGB
  const data = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const r = rgbe[i * 4]!;
    const g = rgbe[i * 4 + 1]!;
    const b = rgbe[i * 4 + 2]!;
    const e = rgbe[i * 4 + 3]!;
    if (e === 0) {
      data[i * 3] = 0;
      data[i * 3 + 1] = 0;
      data[i * 3 + 2] = 0;
    } else {
      const scale = Math.pow(2, e - 128 - 8);
      data[i * 3] = r * scale;
      data[i * 3 + 1] = g * scale;
      data[i * 3 + 2] = b * scale;
    }
  }

  return { width, height, data };
}
