# Forest Stress Benchmark v0

## Purpose

Define the first repeatable forest-scene benchmark contract for HorizonEngine so dense foliage work can be compared across renderer, content, and AI-assisted scene-editing changes.

This document is a spec in v0. It does not add a full forest benchmark runner yet.

## Scope In v0

Implemented in this task:

- A minimal AI control-plane benchmark harness for repeatable preview/apply tasks.
- An initial `collectForestStressMetrics()` helper that records entity, mesh, material, and current renderer frame counters when available.

Specified only in this document:

- The full forest-scene benchmark setup.
- Density-tier content targets.
- Comparison criteria across foliage/scalability changes.

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

Future tiers may add visible-entity counts, grass/tree instance counts, buffer residency, and upload pressure once those surfaces exist as stable engine metrics.

## Density Tiers

Density tiers are labels in v0, not hard engine-enforced values yet.

- `low`: sparse showcase foliage, intended for correctness checks
- `medium`: representative playable density
- `high`: dense production-style forest target
- `extreme`: stress tier intended to surface memory, draw, and overdraw breakpoints

Every logged run must include one of these labels even if the actual density knobs remain scene-specific in v0.

## Logging Requirements

Each run should emit structured JSON or equivalent machine-readable output containing:

- benchmark name and version
- timestamp
- engine revision/commit if available
- scene/setup parameters
- collected metrics
- warnings for unavailable counters

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

Turn this spec into a concrete forest-scene runner that captures one named forest demo scene at `low`, `medium`, `high`, and `extreme` density labels using the current renderer metric surface.
