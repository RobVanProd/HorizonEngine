import { fbm2D, hash2D, valueNoise2D } from './random.js';
/** Tracks occupied cells to prevent overlapping scatter instances. */
export class OccupancyMap {
    width;
    depth;
    data;
    constructor(width, depth) {
        this.width = width;
        this.depth = depth;
        this.data = new Uint8Array(width * depth);
    }
    isOccupied(cellX, cellZ) {
        if (cellX < 0 || cellX >= this.width || cellZ < 0 || cellZ >= this.depth)
            return true;
        return this.data[cellZ * this.width + cellX] !== 0;
    }
    markOccupied(cellX, cellZ, radiusPixels) {
        const rSq = radiusPixels * radiusPixels;
        const minZ = Math.max(0, cellZ - radiusPixels);
        const maxZ = Math.min(this.depth - 1, cellZ + radiusPixels);
        const minX = Math.max(0, cellX - radiusPixels);
        const maxX = Math.min(this.width - 1, cellX + radiusPixels);
        for (let z = minZ; z <= maxZ; z++) {
            for (let x = minX; x <= maxX; x++) {
                if ((x - cellX) * (x - cellX) + (z - cellZ) * (z - cellZ) <= rSq) {
                    this.data[z * this.width + x] = 1;
                }
            }
        }
    }
}
export var BiomeId;
(function (BiomeId) {
    BiomeId[BiomeId["Plains"] = 0] = "Plains";
    BiomeId[BiomeId["Forest"] = 1] = "Forest";
    BiomeId[BiomeId["Desert"] = 2] = "Desert";
    BiomeId[BiomeId["Alpine"] = 3] = "Alpine";
    BiomeId[BiomeId["River"] = 4] = "River";
})(BiomeId || (BiomeId = {}));
export function generateHeightfield(options) {
    const width = options.width;
    const depth = options.depth;
    const cellSize = options.cellSize ?? 2;
    const originX = options.originX ?? 0;
    const originZ = options.originZ ?? 0;
    const heights = new Float32Array(width * depth);
    const moisture = new Float32Array(width * depth);
    const temperature = new Float32Array(width * depth);
    const biomeIds = new Uint8Array(width * depth);
    const baseHeight = options.baseHeight ?? 0;
    const heightScale = options.heightScale ?? 18;
    const octaves = options.octaves ?? 5;
    const terrainWidth = (width - 1) * cellSize;
    const terrainDepth = (depth - 1) * cellSize;
    const centerX = originX + terrainWidth * 0.5;
    const centerZ = originZ + terrainDepth * 0.5;
    const maxRadius = Math.max(1, Math.hypot(terrainWidth * 0.5, terrainDepth * 0.5));
    let minHeight = Infinity;
    let maxHeight = -Infinity;
    for (let z = 0; z < depth; z++) {
        for (let x = 0; x < width; x++) {
            const wx = originX + x * cellSize;
            const wz = originZ + z * cellSize;
            const radial = Math.hypot(wx - centerX, wz - centerZ) / maxRadius;
            // Domain warp: distort sampling coords for more organic, less grid-aligned hills
            const warpScale = 0.015;
            const warpAmt = 35;
            const warpX = wx + fbm2D(options.seed + 73, wx * warpScale, wz * warpScale, 3, 2, 0.5) * warpAmt;
            const warpZ = wz + fbm2D(options.seed + 131, wx * warpScale + 5, wz * warpScale, 3, 2, 0.5) * warpAmt;
            const basinMask = 1 - smoothstepRange(0.58, 1, radial);
            const edgeDrop = smoothstepRange(0.72, 1, radial);
            const macroMask = 0.82 + (fbm2D(options.seed + 503, wx * 0.008, wz * 0.008, 3, 2, 0.5) * 0.24);
            const broad = fbm2D(options.seed, warpX * 0.03, warpZ * 0.03, octaves, 2, 0.5);
            const ridge = Math.abs(fbm2D(options.seed + 97, warpX * 0.022, warpZ * 0.022, octaves, 2.1, 0.55));
            const valley = -Math.abs(fbm2D(options.seed + 281, warpX * 0.012, warpZ * 0.012, 3, 2, 0.55)) * 0.28;
            const meadow = fbm2D(options.seed + 619, wx * 0.01, wz * 0.01, 2, 2, 0.5) * 0.12;
            const detail = fbm2D(options.seed + 37, wx * 0.04, wz * 0.04, 2, 2, 0.4) * 0.05;
            let height = baseHeight + (broad * (0.66 + basinMask * 0.1)
                + ridge * 0.18
                + valley
                + meadow
                + detail) * heightScale * macroMask;
            height -= edgeDrop * heightScale * 0.32;
            if (options.roadSpline && options.roadSpline.length > 1) {
                const distance = distanceToPolyline(wx, wz, options.roadSpline);
                const widthFalloff = options.roadWidth ?? 5;
                const roadMask = 1 - smoothstepRange(widthFalloff * 0.35, widthFalloff, distance);
                height -= roadMask * heightScale * 0.11;
            }
            const idx = z * width + x;
            const m = fbm2D(options.seed + 211, wx * 0.004, wz * 0.004, 4, 2, 0.5) * 0.5 + 0.5;
            const t = 1 - clamp01((height - baseHeight + heightScale * 0.4) / (heightScale * 1.8));
            heights[idx] = height;
            moisture[idx] = clamp01(m);
            temperature[idx] = clamp01(t);
            minHeight = Math.min(minHeight, height);
            maxHeight = Math.max(maxHeight, height);
        }
    }
    // Smooth heights: blend each cell with neighbors to simulate natural settling
    const smoothed = new Float32Array(heights.length);
    smoothed.set(heights);
    for (let pass = 0; pass < 3; pass++) {
        for (let z = 0; z < depth; z++) {
            for (let x = 0; x < width; x++) {
                const idx = z * width + x;
                let sum = smoothed[idx] * 4;
                let n = 4;
                if (x > 0) {
                    sum += smoothed[idx - 1];
                    n++;
                }
                if (x < width - 1) {
                    sum += smoothed[idx + 1];
                    n++;
                }
                if (z > 0) {
                    sum += smoothed[idx - width];
                    n++;
                }
                if (z < depth - 1) {
                    sum += smoothed[idx + width];
                    n++;
                }
                if (x > 0 && z > 0) {
                    sum += smoothed[idx - width - 1] * 0.75;
                    n += 0.75;
                }
                if (x < width - 1 && z > 0) {
                    sum += smoothed[idx - width + 1] * 0.75;
                    n += 0.75;
                }
                if (x > 0 && z < depth - 1) {
                    sum += smoothed[idx + width - 1] * 0.75;
                    n += 0.75;
                }
                if (x < width - 1 && z < depth - 1) {
                    sum += smoothed[idx + width + 1] * 0.75;
                    n += 0.75;
                }
                heights[idx] = sum / n;
            }
        }
        smoothed.set(heights);
    }
    minHeight = Infinity;
    maxHeight = -Infinity;
    for (let i = 0; i < heights.length; i++) {
        const h = heights[i];
        minHeight = Math.min(minHeight, h);
        maxHeight = Math.max(maxHeight, h);
    }
    for (let z = 0; z < depth; z++) {
        for (let x = 0; x < width; x++) {
            const idx = z * width + x;
            const slope = sampleSlopeAt(heightfieldProxy(width, depth, cellSize, heights), x, z);
            biomeIds[idx] = classifyBiome(heights[idx], moisture[idx], temperature[idx], slope);
        }
    }
    return {
        width,
        depth,
        cellSize,
        originX,
        originZ,
        heights,
        moisture,
        temperature,
        biomeIds,
        minHeight,
        maxHeight,
    };
}
/** Biome colors for vertex coloring (linear RGB). */
export const BIOME_COLORS = {
    [BiomeId.River]: [0.1, 0.14, 0.13],
    [BiomeId.Plains]: [0.31, 0.44, 0.21],
    [BiomeId.Forest]: [0.18, 0.3, 0.12],
    [BiomeId.Desert]: [0.83, 0.78, 0.57],
    [BiomeId.Alpine]: [0.95, 0.95, 0.95],
};
export function buildTerrainMeshData(heightfield, options) {
    const { width, depth, cellSize, originX, originZ } = heightfield;
    const uvScale = options?.uvScale ?? 4;
    const [offU, offV] = options?.uvOffset ?? [0.37, 0.61];
    const rot = options?.uvRotation ?? 0.4;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const positions = new Float32Array(width * depth * 3);
    const normals = new Float32Array(width * depth * 3);
    const uvs = new Float32Array(width * depth * 2);
    const tangents = new Float32Array(width * depth * 4);
    for (let z = 0; z < depth; z++) {
        for (let x = 0; x < width; x++) {
            const idx = z * width + x;
            const px = originX + x * cellSize;
            const py = sampleHeight(heightfield, x, z);
            const pz = originZ + z * cellSize;
            positions[idx * 3] = px;
            positions[idx * 3 + 1] = py;
            positions[idx * 3 + 2] = pz;
            const normal = sampleNormal(heightfield, x, z);
            normals[idx * 3] = normal[0];
            normals[idx * 3 + 1] = normal[1];
            normals[idx * 3 + 2] = normal[2];
            let u = (px / (cellSize * uvScale)) + offU;
            let v = (pz / (cellSize * uvScale)) + offV;
            const uRot = u * cosR - v * sinR;
            const vRot = u * sinR + v * cosR;
            uvs[idx * 2] = uRot;
            uvs[idx * 2 + 1] = vRot;
            tangents[idx * 4] = 1;
            tangents[idx * 4 + 1] = 0;
            tangents[idx * 4 + 2] = 0;
            tangents[idx * 4 + 3] = 1;
        }
    }
    const quadCount = (width - 1) * (depth - 1);
    const indices = new Uint32Array(quadCount * 6);
    let ii = 0;
    for (let z = 0; z < depth - 1; z++) {
        for (let x = 0; x < width - 1; x++) {
            const a = z * width + x;
            const b = a + width;
            indices[ii++] = a;
            indices[ii++] = b;
            indices[ii++] = a + 1;
            indices[ii++] = a + 1;
            indices[ii++] = b;
            indices[ii++] = b + 1;
        }
    }
    return { positions, normals, uvs, tangents, indices };
}
/** Normalized height 0–1 from heightfield min/max. */
export function getNormalizedHeight(heightfield, worldY) {
    const range = heightfield.maxHeight - heightfield.minHeight;
    if (range <= 0)
        return 0;
    return clamp01((worldY - heightfield.minHeight) / range);
}
export function generateScatterInstances(heightfield, options) {
    const instances = [];
    const minScale = options.minScale ?? 0.8;
    const maxScale = options.maxScale ?? 1.4;
    const allowedBiomes = options.allowedBiomes ?? [BiomeId.Plains, BiomeId.Forest];
    const minSlope = options.minSlope ?? 0;
    const maxSlope = options.maxSlope ?? 0.55;
    const minNormH = options.minNormalizedHeight ?? 0;
    const maxNormH = options.maxNormalizedHeight ?? 1;
    const occupancy = options.occupancy;
    const occupationRadius = options.occupationRadiusPixels ?? 0;
    const noiseScale = options.noiseScale;
    const noiseThreshold = options.noiseThreshold ?? 0;
    const noiseSeed = (options.seed >>> 0) + (options.noiseSeedOffset ?? 0);
    for (let z = 0; z < heightfield.depth - 1; z++) {
        for (let x = 0; x < heightfield.width - 1; x++) {
            if (occupancy && occupationRadius > 0 && occupancy.isOccupied(x, z))
                continue;
            const idx = z * heightfield.width + x;
            const biomeId = heightfield.biomeIds[idx];
            if (!allowedBiomes.includes(biomeId))
                continue;
            const slope = sampleSlopeAt(heightfield, x, z);
            if (slope < minSlope || slope > maxSlope)
                continue;
            const cellSeed = hash2D(options.seed, x, z);
            const jitterX = (((cellSeed >>> 8) & 0xff) / 255 - 0.5) * heightfield.cellSize;
            const jitterZ = (((cellSeed >>> 16) & 0xff) / 255 - 0.5) * heightfield.cellSize;
            const worldX = heightfield.originX + x * heightfield.cellSize + jitterX;
            const worldZ = heightfield.originZ + z * heightfield.cellSize + jitterZ;
            const wx = heightfield.originX + (x + 0.5) * heightfield.cellSize;
            const wz = heightfield.originZ + (z + 0.5) * heightfield.cellSize;
            const h = sampleHeight(heightfield, x, z);
            const normH = getNormalizedHeight(heightfield, h);
            if (normH < minNormH || normH > maxNormH)
                continue;
            if (isScatterExcluded(options, worldX, worldZ))
                continue;
            if (noiseScale != null && noiseThreshold > 0) {
                const n = valueNoise2D(noiseSeed, wx * noiseScale, wz * noiseScale);
                const noise01 = n * 0.5 + 0.5;
                if (noise01 <= noiseThreshold)
                    continue;
            }
            const chance = (cellSeed & 0xffff) / 0xffff;
            if (chance > options.density)
                continue;
            const worldY = sampleHeightWorld(heightfield, worldX, worldZ);
            if (occupancy && occupationRadius > 0) {
                occupancy.markOccupied(x, z, occupationRadius);
            }
            instances.push({
                position: [worldX, worldY, worldZ],
                normal: sampleNormal(heightfield, x, z),
                scale: minScale + (((cellSeed >>> 24) & 0xff) / 255) * (maxScale - minScale),
                rotationY: ((cellSeed >>> 4) & 0xffff) / 0xffff * Math.PI * 2,
                biomeId,
            });
        }
    }
    return instances;
}
export function sampleHeight(heightfield, x, z) {
    const clampedX = Math.max(0, Math.min(heightfield.width - 1, x));
    const clampedZ = Math.max(0, Math.min(heightfield.depth - 1, z));
    return heightfield.heights[clampedZ * heightfield.width + clampedX];
}
export function sampleHeightWorld(heightfield, worldX, worldZ) {
    const fx = (worldX - heightfield.originX) / heightfield.cellSize;
    const fz = (worldZ - heightfield.originZ) / heightfield.cellSize;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(heightfield.width - 1, x0 + 1);
    const z1 = Math.min(heightfield.depth - 1, z0 + 1);
    const tx = fx - x0;
    const tz = fz - z0;
    const h00 = sampleHeight(heightfield, x0, z0);
    const h10 = sampleHeight(heightfield, x1, z0);
    const h01 = sampleHeight(heightfield, x0, z1);
    const h11 = sampleHeight(heightfield, x1, z1);
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
}
export function sampleNormal(heightfield, x, z) {
    const left = sampleHeight(heightfield, x - 1, z);
    const right = sampleHeight(heightfield, x + 1, z);
    const down = sampleHeight(heightfield, x, z - 1);
    const up = sampleHeight(heightfield, x, z + 1);
    const nx = left - right;
    const ny = heightfield.cellSize * 2;
    const nz = down - up;
    return normalize3([nx, ny, nz]);
}
export function sampleSlopeAt(heightfield, x, z) {
    const n = sampleNormal(heightfield, x, z);
    return 1 - n[1];
}
function classifyBiome(height, moisture, temperature, slope) {
    if (slope < 0.06 && moisture > 0.62 && height < 2.5)
        return BiomeId.River;
    if (height > 10 || temperature < 0.28)
        return BiomeId.Alpine;
    if (moisture < 0.22 && temperature > 0.58)
        return BiomeId.Desert;
    if (moisture > 0.48)
        return BiomeId.Forest;
    return BiomeId.Plains;
}
function heightfieldProxy(width, depth, cellSize, heights) {
    return {
        width,
        depth,
        cellSize,
        originX: 0,
        originZ: 0,
        heights,
        moisture: new Float32Array(width * depth),
        temperature: new Float32Array(width * depth),
        biomeIds: new Uint8Array(width * depth),
        minHeight: 0,
        maxHeight: 0,
    };
}
function distanceToPolyline(x, z, points) {
    let best = Infinity;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1].position;
        const b = points[i].position;
        best = Math.min(best, pointToSegmentDistance2D(x, z, a[0], a[2], b[0], b[2]));
    }
    return best;
}
function pointToSegmentDistance2D(px, pz, ax, az, bx, bz) {
    const abx = bx - ax;
    const abz = bz - az;
    const lenSq = abx * abx + abz * abz;
    if (lenSq < 1e-6)
        return Math.hypot(px - ax, pz - az);
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / lenSq));
    const qx = ax + abx * t;
    const qz = az + abz * t;
    return Math.hypot(px - qx, pz - qz);
}
function isScatterExcluded(options, worldX, worldZ) {
    const avoidSpline = options.avoidSpline;
    const avoidSplineRadius = options.avoidSplineRadius ?? 0;
    if (avoidSpline && avoidSpline.length > 1 && avoidSplineRadius > 0) {
        if (distanceToPolyline(worldX, worldZ, avoidSpline) <= avoidSplineRadius)
            return true;
    }
    for (const circle of options.avoidCircles ?? []) {
        if (Math.hypot(worldX - circle.centerX, worldZ - circle.centerZ) <= circle.radius) {
            return true;
        }
    }
    return false;
}
function normalize3(v) {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
}
function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
function smoothstepRange(min, max, value) {
    if (max <= min)
        return value >= max ? 1 : 0;
    const t = clamp01((value - min) / (max - min));
    return t * t * (3 - 2 * t);
}
function lerp(a, b, t) {
    return a + (b - a) * t;
}
//# sourceMappingURL=terrain.js.map
