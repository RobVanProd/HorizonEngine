# HorizonEngine - Phase Next

## Mission

Build HorizonEngine into a visually credible, scalable, procedurally generative, AI-operable worldbuilding engine for WebGPU.

North star:

> HorizonEngine should become the first serious WebGPU engine designed for reliable human + AI co-creation of large, believable procedural worlds.

## Phase Outcome

By the end of this phase, HorizonEngine should demonstrate:

- A playable editor-hosted world.
- Modern outdoor lighting with stable shadows, sky, fog, and exposure.
- Large-scene rendering with automatic geometric scaling and scene budgeting.
- Procedural terrain, biome, path, and scatter generation.
- Environmental VFX such as fog, wind, leaves, dust, rain, and embers.
- An AI control plane that can inspect, modify, and evaluate the scene.
- A benchmark suite proving AI can operate the engine reliably.

## Workstreams

### A. AI-Native Engine Layer

Goal: make the engine understandable, inspectable, and operable by AI through structured APIs and safe command paths.

Current foundation:

- `editor.captureViewport`
- `scene.layoutSummary`
- `engine.getSceneContext` / `engine.captureSceneContext`
- `SceneContextLoop`
- Editor-side procedural tree commands
- AI Control Plane v0 design spec in `docs/architecture/ai-control-plane-v0.md`
- AI Control Plane v0 minimal implementation: `scene.read.entities`, `scene.read.entity`, `scene.previewPlan`, `scene.applyPlan`
- Editor-backed grouped undo for v0 create, rename, and transform plans
- Control-plane Benchmark Harness v0 for repeatable preview/apply create, rename, and transform tasks
- Forest Stress Benchmark v0 spec in `docs/roadmap/forest-stress-benchmark-v0.md`
- Forest Stress Benchmark Runner v0 for the `first-nature-expedition` scene with structured JSON run output
- Browser-accessible forest benchmark entrypoint that runs all four density tiers sequentially on fresh engine instances
- Lightweight regression comparison pass for saved four-tier forest benchmark outputs
- Tiny browser-side helper on `/forest-benchmark.html` for pasted saved-run comparison

Next milestones:

- Expand read APIs to include selection and explicit capabilities reporting.
- Extend v0 write coverage from create/rename/transform to delete and tag mutations.
- Improve snapshot/diff coverage for hierarchy-aware creation and future semantic actions.
- Add semantic primitives: biome, path, clearing, campsite, landmark, encounter zone, mood profile, weather preset.
- Extend the benchmark harness beyond the current atomic create/rename/transform slice.
- Add a compact text summary layer above the raw comparison JSON to make regressions quicker to scan.

### B. Lighting System

Goal: make scenes coherent, dynamic, and believable.

Current foundation:

- Sun light, PBR, IBL, water shading, and sky groundwork
- Procedural visible sky
- Camera-following stabilized directional shadows
- Lighting Baseline v0 design spec in `docs/architecture/lighting-baseline-v0.md`
- Lighting Baseline v0 Slice 1: manual exposure, analytic fog, and resolution-aware shadow filtering in the current renderer path
- Initial `first-nature-expedition` tuning pass with lower exposure, lighter fog, and reduced shadow normal bias for forest readability validation
- Low and medium Forest Stress Benchmark reruns after the tuning pass kept entity/mesh/material/frame counters flat; only elapsed runtime moved, so the slice currently reads as no meaningful geometry-budget regression

Next milestones:

- Capture reliable viewport evidence for `first-nature-expedition` from the automated browser path and continue forest-contact shadow tuning.
- Probe or grid-based indirect lighting approximation.
- Reflection stack: SSR plus probes and roughness-aware fallback.
- Lighting debug tools: shadow visualizer, probe debug, exposure histogram.

### C. Geometry Scalability

Goal: make dense worlds feasible without manual LOD pain.

Current foundation:

- GPU-driven renderer prototype
- Grass fields and large merged foliage buffers
- Scene-context instrumentation for layout inspection

Next milestones:

- Automatic LOD generation and distance-based instance management.
- Hierarchical culling, cluster submission, and GPU visibility refinement.
- Residency tracking, streaming chunks, upload scheduling, and eviction policy.
- Foliage-specific policies for density, shadows, and impostor fallback.

### D. Procedural World Pipeline

Goal: make generated worlds structured, editable, seeded, and semantically meaningful.

Current foundation:

- Terrain, spline, scatter, seed-based foundations
- Level-definition contract in the editor demo
- Quest anchors and landmark-driven first level
- Scatter exclusions for trails and landmarks

Next milestones:

- Terrain stamps, slope/height masks, and material blending.
- Biome as a first-class config and authoring concept.
- Semantic zones: campsite, ambush, scenic overlook, safe zone, objective area.
- AI-directed world generation commands built on semantic primitives.

### E. VFX / Atmospherics

Goal: make the world feel alive and reactive.

Current foundation:

- Niagara-like effects package
- Grass wind response
- Fog and sky groundwork

Next milestones:

- Environmental ambience pack: leaves, dust, fog wisps, insects, embers.
- Weather framework: rain, wind, storm presets, cloud-volume integration.
- Gameplay VFX authoring tools and performance instrumentation.

## Current Status

Completed groundwork already in the repo:

- Dense meadow grass rendering inspired by the Three.js grass demo.
- Procedural tree generation via `@dgreenheck/ez-tree` with editor integration.
- AI-facing viewport capture and layout summaries.
- Automatic scene-context capture loop without viewport flashing.
- Larger WebGPU buffer limit bootstrap for showcase-scale foliage.
- Procedural visible sky and improved water controls.
- Quest-chain foundation for the first playable level.
- Camera-following stabilized directional shadows for forest scenes.
- AI Control Plane v0 architecture document and module plan.
- AI Control Plane v0 executable slice with structured preview/apply, validation, diffs, and editor undo integration for create/rename/transform.
- AI Control Plane Benchmark Harness v0 with repeatable preview/apply coverage for create/rename/transform and structured result logging.
- Forest Stress Benchmark v0 spec plus initial renderer/entity metric snapshot helper.
- Forest Stress Benchmark Runner v0 with concrete `first-nature-expedition` scene selection, density-tier parameterization, and per-run JSON output.
- Browser entrypoint at `examples/editor-demo/forest-benchmark.html` with four-tier sequential execution, fresh-instance orchestration, console/`window` surfacing, and downloadable JSON output.
- Saved-output comparison pass for forest benchmark JSON bundles with per-tier metric deltas and missing-tier handling.
- Browser-side pasted-JSON comparison flow on `/forest-benchmark.html` using the same saved-output comparison module.
- Lighting Baseline v0 Slice 1 with manual exposure, analytic fog, and actual shadow-resolution-derived PCF sampling.
- First forest-scene lighting validation pass with tuned authored preset values and low/medium benchmark rerun support.
- Forest benchmark comparison currently shows stable scene complexity counters across the lighting tuning pass, with runtime timing shifts only.

Open issues and immediate gaps:

- Ground material richness and terrain blending remain weak at close range.
- Outdoor lighting still needs stronger captured validation evidence and better shadow-contact tuning.
- Lighting Baseline v0 has landed and has a first forest tuning pass, but it still needs richer debug views.
- Foliage needs scalability policies instead of only raw density pushes.
- Scene budgets and stress benchmarks now have a first concrete forest runner, a browser multi-run entrypoint, a saved-output comparison pass, and a minimal in-browser compare helper, but still need richer metrics and better scan-oriented summaries.
- Clouds and atmospheric VFX are still references, not native engine features.

## Ruthless Priority Order

1. AI control plane and evaluation harness
2. Lighting baseline and scene-cohesion tools
3. Procedural terrain, path, and scatter authoring
4. LOD, culling, and streaming
5. Indirect lighting and reflections
6. VFX and weather

## Canonical Benchmarks

### Forest Stress Benchmark

This becomes one of the main scaling tests for the engine.

Current status:

- Spec documented in `docs/roadmap/forest-stress-benchmark-v0.md`
- Initial metric hook implemented through `collectForestStressMetrics()`
- Runner implemented for `first-nature-expedition`
- Density tiers are parameterized scene profiles, not separate authored variants

Measure:

- Total entity count
- Visible entity count
- Tree instance count
- Grass instance count
- Unique meshes and materials
- Estimated texture memory
- Estimated GPU buffer memory
- Draw calls
- Submitted and visible triangles
- Shadow pass cost
- Frame-time breakdown
- CPU vs GPU bottleneck guess

Test tiers:

- Low foliage density
- Medium foliage density
- High foliage density
- Extreme foliage density
- Wind on/off
- Shadows on/off
- Reduced and extended visibility ranges

## Public Demos For This Phase

- AI scene operator
- Modern forest lighting
- Dense world scalability
- Atmospheric world

## Maintenance Rule

When work in this phase lands:

- Update this file with completed groundwork and the next concrete milestones.
- Update `README.md` when a user-facing engine capability changes.
- Keep benchmark additions tied to a named scene or reproducible demo.
