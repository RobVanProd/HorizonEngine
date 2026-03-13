import type {
  ForestStressBenchmarkRun,
  ForestStressDensityLabel,
} from './forest-stress-benchmark.js';

export interface ForestStressNumericDelta {
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
  status: 'compared' | 'missing_baseline' | 'missing_candidate' | 'missing_both';
}

export interface ForestStressRendererFrameComparison {
  drawCount: ForestStressNumericDelta;
  triangleCount: ForestStressNumericDelta;
  meshletCount: ForestStressNumericDelta;
  culledObjects: ForestStressNumericDelta;
  culledTriangles: ForestStressNumericDelta;
}

export interface ForestStressTierComparison {
  densityLabel: ForestStressDensityLabel;
  comparable: boolean;
  baselineRun: ForestStressBenchmarkRun | null;
  candidateRun: ForestStressBenchmarkRun | null;
  metrics: {
    elapsedMs: ForestStressNumericDelta;
    entityCount: ForestStressNumericDelta;
    meshCount: ForestStressNumericDelta;
    materialCount: ForestStressNumericDelta;
    rendererFrame: ForestStressRendererFrameComparison;
  };
  notes: string[];
  errors: string[];
}

export interface ForestStressBenchmarkComparison {
  benchmarkName: 'forest-stress-v0-comparison';
  comparedAt: string;
  baselineSceneName: string | null;
  candidateSceneName: string | null;
  tiers: ForestStressTierComparison[];
  notes: string[];
  errors: string[];
}

const DENSITY_ORDER: ForestStressDensityLabel[] = ['low', 'medium', 'high', 'extreme'];

export function parseForestStressBenchmarkRunSet(json: string): ForestStressBenchmarkRun[] {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Forest benchmark comparison expects a JSON array of run records.');
  }
  return parsed as ForestStressBenchmarkRun[];
}

export function compareForestStressBenchmarkRunSets(
  baselineRuns: ForestStressBenchmarkRun[],
  candidateRuns: ForestStressBenchmarkRun[],
): ForestStressBenchmarkComparison {
  const errors: string[] = [];
  const notes: string[] = [];

  const baselineSceneName = baselineRuns[0]?.sceneName ?? null;
  const candidateSceneName = candidateRuns[0]?.sceneName ?? null;

  if (baselineSceneName && candidateSceneName && baselineSceneName !== candidateSceneName) {
    notes.push(`Scene name mismatch: baseline=${baselineSceneName}, candidate=${candidateSceneName}`);
  }

  const baselineByTier = indexRunsByTier(baselineRuns, 'baseline', errors);
  const candidateByTier = indexRunsByTier(candidateRuns, 'candidate', errors);

  const tiers = DENSITY_ORDER.map((densityLabel) => {
    const baselineRun = baselineByTier.get(densityLabel) ?? null;
    const candidateRun = candidateByTier.get(densityLabel) ?? null;
    const tierNotes: string[] = [];
    const tierErrors: string[] = [];

    if (!baselineRun) tierErrors.push(`Missing baseline tier: ${densityLabel}`);
    if (!candidateRun) tierErrors.push(`Missing candidate tier: ${densityLabel}`);
    if (baselineRun?.status !== 'completed') tierNotes.push(`Baseline tier ${densityLabel} status is ${baselineRun?.status ?? 'missing'}`);
    if (candidateRun?.status !== 'completed') tierNotes.push(`Candidate tier ${densityLabel} status is ${candidateRun?.status ?? 'missing'}`);

    const baselineFrame = baselineRun?.metrics.rendererFrame ?? null;
    const candidateFrame = candidateRun?.metrics.rendererFrame ?? null;

    if (!baselineFrame || !candidateFrame) {
      tierNotes.push(`Renderer frame counters unavailable for ${densityLabel}`);
    }

    return {
      densityLabel,
      comparable: baselineRun !== null && candidateRun !== null,
      baselineRun,
      candidateRun,
      metrics: {
        elapsedMs: compareNumber(baselineRun?.elapsedMs, candidateRun?.elapsedMs),
        entityCount: compareNumber(baselineRun?.metrics.entityCount, candidateRun?.metrics.entityCount),
        meshCount: compareNumber(baselineRun?.metrics.meshCount, candidateRun?.metrics.meshCount),
        materialCount: compareNumber(baselineRun?.metrics.materialCount, candidateRun?.metrics.materialCount),
        rendererFrame: {
          drawCount: compareNumber(baselineFrame?.drawCount, candidateFrame?.drawCount),
          triangleCount: compareNumber(baselineFrame?.triangleCount, candidateFrame?.triangleCount),
          meshletCount: compareNumber(baselineFrame?.meshletCount, candidateFrame?.meshletCount),
          culledObjects: compareNumber(baselineFrame?.culledObjects, candidateFrame?.culledObjects),
          culledTriangles: compareNumber(baselineFrame?.culledTriangles, candidateFrame?.culledTriangles),
        },
      },
      notes: tierNotes,
      errors: tierErrors,
    } satisfies ForestStressTierComparison;
  });

  return {
    benchmarkName: 'forest-stress-v0-comparison',
    comparedAt: new Date().toISOString(),
    baselineSceneName,
    candidateSceneName,
    tiers,
    notes,
    errors,
  };
}

export function serializeForestStressBenchmarkComparison(
  comparison: ForestStressBenchmarkComparison,
): string {
  return JSON.stringify(comparison, null, 2);
}

function compareNumber(
  baseline: number | null | undefined,
  candidate: number | null | undefined,
): ForestStressNumericDelta {
  const resolvedBaseline = typeof baseline === 'number' ? baseline : null;
  const resolvedCandidate = typeof candidate === 'number' ? candidate : null;

  if (resolvedBaseline === null && resolvedCandidate === null) {
    return { baseline: null, candidate: null, delta: null, status: 'missing_both' };
  }
  if (resolvedBaseline === null) {
    return { baseline: null, candidate: resolvedCandidate, delta: null, status: 'missing_baseline' };
  }
  if (resolvedCandidate === null) {
    return { baseline: resolvedBaseline, candidate: null, delta: null, status: 'missing_candidate' };
  }
  return {
    baseline: resolvedBaseline,
    candidate: resolvedCandidate,
    delta: Number((resolvedCandidate - resolvedBaseline).toFixed(3)),
    status: 'compared',
  };
}

function indexRunsByTier(
  runs: ForestStressBenchmarkRun[],
  label: 'baseline' | 'candidate',
  errors: string[],
): Map<ForestStressDensityLabel, ForestStressBenchmarkRun> {
  const indexed = new Map<ForestStressDensityLabel, ForestStressBenchmarkRun>();
  for (const run of runs) {
    if (indexed.has(run.densityLabel)) {
      errors.push(`Duplicate ${label} tier: ${run.densityLabel}`);
      continue;
    }
    indexed.set(run.densityLabel, run);
  }
  return indexed;
}
