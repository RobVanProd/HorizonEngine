import { collectForestStressMetrics } from './control-plane-benchmark.js';
export async function runForestStressBenchmarkRun(options) {
    const context = await options.createContext();
    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();
    const outputPath = getForestStressBenchmarkOutputPath(options.sceneName, options.densityLabel, startedAtDate);
    const notes = [];
    const start = now();
    try {
        const setupResult = await options.setupScene(context, options.densityLabel);
        if (setupResult?.notes) {
            notes.push(...setupResult.notes);
        }
        const endedAt = new Date().toISOString();
        return {
            benchmarkName: 'forest-stress-v0',
            sceneName: options.sceneName,
            densityLabel: options.densityLabel,
            status: 'completed',
            startedAt,
            endedAt,
            elapsedMs: Number((now() - start).toFixed(3)),
            outputPath,
            metrics: collectForestStressMetrics(context.engine),
            notes,
        };
    }
    catch (error) {
        const endedAt = new Date().toISOString();
        return {
            benchmarkName: 'forest-stress-v0',
            sceneName: options.sceneName,
            densityLabel: options.densityLabel,
            status: 'failed',
            startedAt,
            endedAt,
            elapsedMs: Number((now() - start).toFixed(3)),
            outputPath,
            metrics: collectForestStressMetrics(context.engine),
            notes,
            error: error instanceof Error ? error.message : String(error),
        };
    }
    finally {
        await context.cleanup?.();
    }
}
export async function runForestStressBenchmarkMatrix(options) {
    const densityLabels = options.densityLabels ?? ['low', 'medium', 'high', 'extreme'];
    const runs = [];
    for (const densityLabel of densityLabels) {
        runs.push(await runForestStressBenchmarkRun({
            sceneName: options.sceneName,
            densityLabel,
            createContext: options.createContext,
            setupScene: options.setupScene,
        }));
    }
    return runs;
}
export function serializeForestStressBenchmarkRun(run) {
    return JSON.stringify(run, null, 2);
}
export function getForestStressBenchmarkOutputPath(sceneName, densityLabel, startedAt) {
    const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
    return `logs/benchmarks/forest-stress-v0/${sceneName}/${densityLabel}/${stamp}.json`;
}
function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
