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

Integrate the concrete `first-nature-expedition` runner into a browser-accessible benchmark entrypoint so all four density labels can be executed against a fresh engine instance and their JSON logs can be collected in one pass.
