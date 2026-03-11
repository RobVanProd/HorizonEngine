import { LocalTransform, Parent, World, WorldMatrix } from '@engine/ecs';
import { SplineControlPoint, SplineKind, SplinePath } from './components.js';

export interface SplinePoint {
  position: [number, number, number];
  tangentIn?: [number, number, number];
  tangentOut?: [number, number, number];
}

export interface CreateSplineOptions {
  closed?: boolean;
  width?: number;
  kind?: SplineKind;
}

export interface SplineSample {
  position: [number, number, number];
  tangent: [number, number, number];
}

export function createSplineEntities(
  world: World,
  points: SplinePoint[],
  options: CreateSplineOptions = {},
): { splineEntity: number; controlPointIds: number[] } {
  const root = world.spawn();
  root.add(SplinePath, {
    closed: options.closed ? 1 : 0,
    pointCount: points.length,
    width: options.width ?? 2,
    kind: options.kind ?? SplineKind.Generic,
  });
  root.add(LocalTransform, {
    px: 0, py: 0, pz: 0,
    rotX: 0, rotY: 0, rotZ: 0,
    scaleX: 1, scaleY: 1, scaleZ: 1,
  });
  root.add(WorldMatrix);

  const controlPointIds: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const cp = world.spawn();
    cp.add(Parent, { entity: root.id });
    cp.add(LocalTransform, {
      px: point.position[0],
      py: point.position[1],
      pz: point.position[2],
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
    });
    cp.add(WorldMatrix);
    cp.add(SplineControlPoint, {
      index: i,
      tx: point.position[0],
      ty: point.position[1],
      tz: point.position[2],
      inX: point.tangentIn?.[0] ?? point.position[0],
      inY: point.tangentIn?.[1] ?? point.position[1],
      inZ: point.tangentIn?.[2] ?? point.position[2],
      outX: point.tangentOut?.[0] ?? point.position[0],
      outY: point.tangentOut?.[1] ?? point.position[1],
      outZ: point.tangentOut?.[2] ?? point.position[2],
    });
    controlPointIds.push(cp.id);
  }

  return { splineEntity: root.id, controlPointIds };
}

export function readSplinePoints(world: World, splineEntityId: number): SplinePoint[] {
  const result: Array<{ index: number; point: SplinePoint }> = [];
  const query = world.query(SplineControlPoint, Parent);
  query.each((arch, count) => {
    const parentIds = arch.getColumn(Parent, 'entity') as Uint32Array;
    const indices = arch.getColumn(SplineControlPoint, 'index') as Uint32Array;
    const tx = arch.getColumn(SplineControlPoint, 'tx') as Float32Array;
    const ty = arch.getColumn(SplineControlPoint, 'ty') as Float32Array;
    const tz = arch.getColumn(SplineControlPoint, 'tz') as Float32Array;
    const inX = arch.getColumn(SplineControlPoint, 'inX') as Float32Array;
    const inY = arch.getColumn(SplineControlPoint, 'inY') as Float32Array;
    const inZ = arch.getColumn(SplineControlPoint, 'inZ') as Float32Array;
    const outX = arch.getColumn(SplineControlPoint, 'outX') as Float32Array;
    const outY = arch.getColumn(SplineControlPoint, 'outY') as Float32Array;
    const outZ = arch.getColumn(SplineControlPoint, 'outZ') as Float32Array;

    for (let i = 0; i < count; i++) {
      if (parentIds[i] !== splineEntityId) continue;
      result.push({
        index: indices[i]!,
        point: {
          position: [tx[i]!, ty[i]!, tz[i]!],
          tangentIn: [inX[i]!, inY[i]!, inZ[i]!],
          tangentOut: [outX[i]!, outY[i]!, outZ[i]!],
        },
      });
    }
  });

  result.sort((a, b) => a.index - b.index);
  return result.map((entry) => entry.point);
}

export function sampleSpline(points: SplinePoint[], t: number, closed = false): SplineSample {
  if (points.length === 0) {
    return { position: [0, 0, 0], tangent: [1, 0, 0] };
  }
  if (points.length === 1) {
    return { position: [...points[0]!.position], tangent: [1, 0, 0] };
  }

  const clampedT = closed ? wrap01(t) : Math.max(0, Math.min(0.999999, t));
  const segmentCount = closed ? points.length : points.length - 1;
  const scaled = clampedT * segmentCount;
  const segment = Math.min(segmentCount - 1, Math.floor(scaled));
  const localT = scaled - segment;

  const p0 = getPoint(points, segment - 1, closed);
  const p1 = getPoint(points, segment, closed);
  const p2 = getPoint(points, segment + 1, closed);
  const p3 = getPoint(points, segment + 2, closed);

  const position: [number, number, number] = [
    catmullRom(p0[0], p1[0], p2[0], p3[0], localT),
    catmullRom(p0[1], p1[1], p2[1], p3[1], localT),
    catmullRom(p0[2], p1[2], p2[2], p3[2], localT),
  ];
  const tangent = normalize3([
    catmullRomDerivative(p0[0], p1[0], p2[0], p3[0], localT),
    catmullRomDerivative(p0[1], p1[1], p2[1], p3[1], localT),
    catmullRomDerivative(p0[2], p1[2], p2[2], p3[2], localT),
  ]);
  return { position, tangent };
}

export function sampleSplinePolyline(points: SplinePoint[], segments: number, closed = false): SplineSample[] {
  const out: SplineSample[] = [];
  for (let i = 0; i <= segments; i++) {
    out.push(sampleSpline(points, i / Math.max(1, segments), closed));
  }
  return out;
}

export function estimateSplineLength(points: SplinePoint[], segments = 64, closed = false): number {
  const samples = sampleSplinePolyline(points, segments, closed);
  let length = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!.position;
    const b = samples[i]!.position;
    length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return length;
}

function getPoint(points: SplinePoint[], index: number, closed: boolean): [number, number, number] {
  const count = points.length;
  if (closed) {
    const wrapped = ((index % count) + count) % count;
    return points[wrapped]!.position;
  }
  const clamped = Math.max(0, Math.min(count - 1, index));
  return points[clamped]!.position;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function catmullRomDerivative(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  return 0.5 * (
    (-p0 + p2) +
    2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t +
    3 * (-p0 + 3 * p1 - 3 * p2 + p3) * t2
  );
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function wrap01(t: number): number {
  return ((t % 1) + 1) % 1;
}
