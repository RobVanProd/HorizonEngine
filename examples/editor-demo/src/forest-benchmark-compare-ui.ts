import {
  compareForestStressBenchmarkRunSets,
  parseForestStressBenchmarkRunSet,
  serializeForestStressBenchmarkComparison,
  type ForestStressBenchmarkComparison,
} from '@engine/ai';

export interface ForestBenchmarkComparisonUiResult {
  ok: boolean;
  output: string;
  error: string | null;
  comparison: ForestStressBenchmarkComparison | null;
}

export function comparePastedForestBenchmarkJson(
  baselineJson: string,
  candidateJson: string,
): ForestBenchmarkComparisonUiResult {
  try {
    const baselineRuns = parseForestStressBenchmarkRunSet(baselineJson);
    const candidateRuns = parseForestStressBenchmarkRunSet(candidateJson);
    const comparison = compareForestStressBenchmarkRunSets(baselineRuns, candidateRuns);
    return {
      ok: true,
      output: serializeForestStressBenchmarkComparison(comparison),
      error: null,
      comparison,
    };
  } catch (error) {
    return {
      ok: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
      comparison: null,
    };
  }
}
