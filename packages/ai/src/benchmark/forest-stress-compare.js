const DENSITY_ORDER = ['low', 'medium', 'high', 'extreme'];
export function parseForestStressBenchmarkRunSet(json) {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) {
        throw new Error('Forest benchmark comparison expects a JSON array of run records.');
    }
    return parsed;
}
export function compareForestStressBenchmarkRunSets(baselineRuns, candidateRuns) {
    const errors = [];
    const notes = [];
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
        const tierNotes = [];
        const tierErrors = [];
        if (!baselineRun)
            tierErrors.push(`Missing baseline tier: ${densityLabel}`);
        if (!candidateRun)
            tierErrors.push(`Missing candidate tier: ${densityLabel}`);
        if (baselineRun?.status !== 'completed')
            tierNotes.push(`Baseline tier ${densityLabel} status is ${baselineRun?.status ?? 'missing'}`);
        if (candidateRun?.status !== 'completed')
            tierNotes.push(`Candidate tier ${densityLabel} status is ${candidateRun?.status ?? 'missing'}`);
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
        };
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
export function serializeForestStressBenchmarkComparison(comparison) {
    return JSON.stringify(comparison, null, 2);
}
function compareNumber(baseline, candidate) {
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
function indexRunsByTier(runs, label, errors) {
    const indexed = new Map();
    for (const run of runs) {
        if (indexed.has(run.densityLabel)) {
            errors.push(`Duplicate ${label} tier: ${run.densityLabel}`);
            continue;
        }
        indexed.set(run.densityLabel, run);
    }
    return indexed;
}
