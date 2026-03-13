# Forest Stress Benchmark v0

## Purpose

Define the first repeatable forest-scene benchmark contract for HorizonEngine so dense foliage work can be compared across renderer, content, and AI-assisted scene-editing changes.

This document is a v0 spec plus the first implemented runner contract for one concrete scene.

## Scope In v0

Implemented in this task:

- A minimal AI control-plane benchmark harness for repeatable preview/apply tasks.
- An initial `collectForestStressMetrics()` helper that records entity, mesh, material, and current renderer frame counters when available.
- A `forest-stress-benchmark` runner that emits one structured JSON record per run.
- A concrete scene target: `first-nature-expedition`.
- Density labels produced by parameter scaling of that scene's grass and foliage density, not by four separately authored scene files.
- A browser-accessible entrypoint at `examples/editor-demo/forest-benchmark.html` that runs all four density tiers sequentially on fresh engine instances.

Specified only in this document:

- Future metric expansion beyond the currently implemented counters.
- Comparison criteria across more advanced scalability systems.

## Selected Scene

The first concrete forest benchmark scene is:

- `first-nature-expedition`

This is the existing editor-demo forest level. The v0 runner treats it as the canonical named forest scene for early benchmark logging.

## Scene And Setup Assumptions

- Benchmark scene is an editor-hosted outdoor forest map or equivalent reproducible demo scene.
- Scene generation must be seedable or otherwise fixed so repeated runs compare like-for-like content.
- Camera path or capture viewpoints must be named and reproducible.
- Grass and tree placement settings must be logged with the run.
- Wind and shadow settings must be explicit run parameters, not implicit defaults.

## Target Metrics

Forest Stress Benchmark v0 should log at minimum:

- Scene name
- Seed or authored scene revision
- Density tier
- Visibility range preset
- Wind preset
- Shadow preset
- Entity count
- Mesh count
- Material count
- Draw count
- Submitted triangle count
- Meshlet count
- Culled object count
- Culled triangle count
- Mean frame time if available
- Notes about missing metrics

Real metrics implemented now:

- entity count
- mesh count
- material count
- renderer frame counters when available from `engine.pbrRenderer.frameStats`

Not implemented yet and therefore not logged as real metrics:

- visible entity count
- tree instance count
- grass instance count
- residency or buffer-budget metrics
- frame-time breakdown
- CPU/GPU bottleneck classification

## Density Tiers

Density tiers are labels in v0, not hard engine-enforced values yet.

- `low`: sparse showcase foliage, intended for correctness checks
- `medium`: representative playable density
- `high`: dense production-style forest target
- `extreme`: stress tier intended to surface memory, draw, and overdraw breakpoints

Every logged run must include one of these labels even if the actual density knobs remain scene-specific in v0.

Current `first-nature-expedition` implementation:

- `low`, `medium`, `high`, and `extreme` are created by scaling grass density/blades-per-cell plus foliage scatter density.
- They are reproducible because the scene seed remains fixed and only the documented density profile changes.

## Logging Requirements

Each run now emits structured JSON containing:

- benchmark name and version
- scene name
- density label
- run status
- start and end timestamps
- elapsed milliseconds
- canonical output path
- collected real metrics
- notes
- error string when a run fails

If a metric is unavailable on the active platform, the run should log `null` and keep the benchmark valid instead of failing silently.

## Browser Entry Workflow

Implemented now:

- Start the editor demo dev server.
- Open `/forest-benchmark.html`.
- The page runs `low`, `medium`, `high`, and `extreme` sequentially.
- Each density tier gets a fresh engine instance and temporary DOM host.
- Each run is surfaced as JSON in the browser console.
- The full four-record result array is exposed at `window.__HORIZON_FOREST_BENCHMARK_RESULTS__`.
- The page also offers a one-click JSON download for the combined run array.
- The same page now includes two paste areas for baseline and candidate JSON plus a `Compare Saved Runs` action that renders the structured comparison output inline.

Not implemented yet:

- automatic file persistence outside the browser download flow
- benchmark comparison UI
- historical run storage
- one-click integration from the main editor screen

## Comparing Two Saved Outputs

Implemented now:

- A lightweight comparison tool in `packages/ai/src/benchmark/forest-stress-compare.ts`
- It accepts two saved JSON arrays in the existing forest benchmark run shape
- It compares `low`, `medium`, `high`, and `extreme` deterministically in that order
- It reports only the currently real fields:
  - `elapsedMs`
  - `entityCount`
  - `meshCount`
  - `materialCount`
  - renderer frame counters when present

How users provide the two saved outputs:

- Load the two downloaded JSON bundles from `/forest-benchmark.html`
- Parse them with `parseForestStressBenchmarkRunSet(...)`
- Pass the arrays to `compareForestStressBenchmarkRunSets(...)`
- Or paste them directly into `/forest-benchmark.html` and let the page call those same helpers

Missing tiers or metrics:

- Missing tiers are preserved as structured per-tier errors
- Missing renderer counters are preserved as structured missing-metric statuses
- The comparison stays JSON-friendly even when a tier cannot be compared cleanly

## Comparison Criteria

v0 comparison is relative, not absolute.

Recommended pass/fail or comparison checks:

- `pass` if the benchmark scene loads and produces a complete metric record for the selected tier
- `compare` successive runs by draw count, triangle count, culled objects, and frame time where available
- `flag regression` when a content-equivalent run shows materially higher draw/triangle cost without an intentional visual change
- `flag regression` when a scene can no longer complete the selected density tier due to memory or buffer limits

## Relation To AI Control Plane Benchmark Harness

The control-plane benchmark harness validates that AI scene-edit tasks remain repeatable and safe.

The forest stress benchmark is the renderer/content scaling counterpart. In the near term the two connect through:

- reproducible scene setup
- structured logging
- a shared expectation that benchmark runs are replayable

## Next Implementation Step

Add a compact text summary layer above the raw comparison JSON to make regressions quicker to scan, still without turning the page into a dashboard.
