export interface SeededRandom {
  next(): number;
  range(min: number, max: number): number;
  int(maxExclusive: number): number;
}

export function createSeededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;
  const nextValue = () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next: nextValue,
    range(min, max) {
      return min + (max - min) * nextValue();
    },
    int(maxExclusive) {
      return Math.floor(nextValue() * maxExclusive);
    },
  };
}

export function hash2D(seed: number, x: number, z: number): number {
  let h = seed ^ Math.imul(x, 0x45d9f3b) ^ Math.imul(z, 0x119de1f3);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function valueNoise2D(seed: number, x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const z1 = z0 + 1;
  const tx = smoothstep(x - x0);
  const tz = smoothstep(z - z0);

  const n00 = hash2D(seed, x0, z0) / 0xffffffff;
  const n10 = hash2D(seed, x1, z0) / 0xffffffff;
  const n01 = hash2D(seed, x0, z1) / 0xffffffff;
  const n11 = hash2D(seed, x1, z1) / 0xffffffff;

  const nx0 = lerp(n00, n10, tx);
  const nx1 = lerp(n01, n11, tx);
  return lerp(nx0, nx1, tz) * 2 - 1;
}

export function fbm2D(
  seed: number,
  x: number,
  z: number,
  octaves = 5,
  lacunarity = 2,
  gain = 0.5,
): number {
  let frequency = 1;
  let amplitude = 1;
  let total = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise2D(seed + i * 1013, x * frequency, z * frequency) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return norm > 0 ? total / norm : 0;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
