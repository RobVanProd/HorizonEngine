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

Next milestones:

- Expand read APIs for visibility, materials, terrain regions, procedural zones, warnings, and undo state.
- Formalize write APIs around bounded worldbuilding commands and previewable transactions.
- Add semantic primitives: biome, path, clearing, campsite, landmark, encounter zone, mood profile, weather preset.
- Build a benchmark harness for atomic, scene-editing, multi-step, and debugging tasks.

### B. Lighting System

Goal: make scenes coherent, dynamic, and believable.

Current foundation:

- Sun light, PBR, IBL, fog, water shading
- Procedural visible sky
- Camera-following stabilized directional shadows

Next milestones:

- Outdoor lighting baseline polish: exposure, tone mapping, shadow tuning, fog integration.
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

Open issues and immediate gaps:

- Ground material richness and terrain blending remain weak at close range.
- Outdoor lighting still needs a more cohesive baseline and better shadow tuning.
- Foliage needs scalability policies instead of only raw density pushes.
- Scene budgets and stress benchmarks are not yet first-class engine systems.
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
