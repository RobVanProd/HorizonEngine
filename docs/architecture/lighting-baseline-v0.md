# Lighting Baseline v0

## Objective

Define the first implementation slice that materially improves outdoor forest scene cohesion in HorizonEngine without attempting GI, reflections, or a renderer rewrite.

Reference validation scene:

- `first-nature-expedition`

This document is design-only.

## What "Better" Means For `first-nature-expedition`

For this first slice, "better" is not "more features." It means the current forest scene stops reading like separate systems stitched together.

Visual success for the reference scene means:

- the sun direction, visible sky, and ambient fill agree with each other
- tree trunks, grass, and terrain sit in the same lighting space instead of feeling separately lit
- shadows remain stable while walking the trail and looking around clearings
- forest interiors become slightly cooler and darker than open meadows without GI
- fog helps depth separation and horizon cohesion instead of acting like a disconnected overlay
- exposure stays stable enough that moving from open patch to canopy does not blow out the grass or crush the trunks

This avoids overcommitting to a giant lighting architecture by tightening the current stack instead of replacing it.

## Current Renderer State

Current useful foundations already in the repo:

- one directional light path in `packages/renderer-webgpu/src/pbr-pipeline.ts`
- one stabilized camera-following shadow map in `packages/renderer-webgpu/src/shadow-map.ts`
- image-based lighting via `packages/renderer-webgpu/src/environment.ts`
- procedural visible sky via `packages/renderer-webgpu/src/shaders/gen-cubemap.wgsl`
- ACES tone mapping already applied in `packages/renderer-webgpu/src/shaders/pbr.wgsl`
- a `SceneLighting` object already exposed through `Engine` and `createRenderSystem`
- debug views for `lit`, `normals`, `shadow`, and `lightComplexity`

Current gaps relevant to the forest scene:

- no explicit fog integration in the PBR pass
- no exposure control surface; ACES is fixed and driven only by raw scene intensity
- shadow PCF kernel assumes a hard-coded `2048` map texel size in shader code
- shadow tuning is only a bias scalar; there is no normal bias, cascade logic, or per-scene tuning surface
- the visible sky and lighting probe share sun inputs but there is no formal scene-level "lighting rig" contract
- ambient is currently a flat color plus `envIntensity`, which is workable but under-specified

## Baseline Stack v0

Lighting Baseline v0 should ship exactly this stack:

1. One directional sun light
2. One stabilized camera-following orthographic shadow map
3. One sky/ambient contribution path using the existing procedural sky + IBL probe generation
4. One height-aware distance fog model integrated into the main PBR pass
5. One explicit exposure scalar applied before existing ACES tone mapping

This is the minimum stack that can materially improve the forest scene without introducing GI, SSR, probe volumes, or a broad renderer restructure.

## Directional Light Representation

### Proposed v0 scene contract

`SceneLighting` should evolve from a loose render struct into a minimal scene-facing lighting contract:

```ts
interface SceneLighting {
  direction: [number, number, number];
  color: [number, number, number];
  intensity: number;
  ambient: [number, number, number];
  envIntensity: number;
  shadowBias?: number;
  shadowNormalBias?: number;
  debugView?: LightingDebugView;
  exposure?: number;
  fog?: {
    color: [number, number, number];
    density: number;
    heightFalloff: number;
    startDistance: number;
    maxOpacity: number;
  };
  sky?: {
    backgroundSource?: 'environment' | 'procedural';
    sunIntensity?: number;
  };
}
```

### Design intent

- `direction`, `color`, and `intensity` remain the canonical authored sun controls
- `ambient` remains as a low-frequency fallback/fill control
- `envIntensity` remains the first-slice multiplier for diffuse/specular IBL contribution
- `exposure` becomes explicit instead of being implied by hand-tuning sun and ambient values
- `fog` becomes an explicit scene-authored part of the lighting baseline rather than an eventual VFX-only system
- `shadowNormalBias` is added because forest foliage and terrain are currently the most acne-sensitive surfaces

### Reference defaults for `first-nature-expedition`

Initial implementation targets for validation, not final art lock:

- `direction`: `[-0.30, -0.90, -0.22]`
- `color`: `[1.0, 0.97, 0.92]`
- `intensity`: `4.5 - 5.2`
- `ambient`: `[0.035, 0.045, 0.055]`
- `envIntensity`: `1.0 - 1.2`
- `exposure`: `0.95 - 1.1`
- fog color biased slightly cooler than direct sun fill

## Shadow Pipeline Baseline

### First shadow approach

Use the existing single orthographic directional shadow map path as the baseline. Do not add cascades in this slice.

### Why this is the correct first slice

- the engine already has a working single-map path
- the forest validation scene is relatively compact
- the major current problem is stability/tuning, not missing cascades
- a tuned single-map path is enough to improve scene credibility before wider scalability work

### Required stability and tuning upgrades

1. Replace the hard-coded shadow texel size in `pbr.wgsl` and `pbr-skinned.wgsl`
   - pass inverse shadow resolution through the light uniform
   - make PCF sampling derive from actual map size
2. Add `shadowNormalBias`
   - apply a slope-aware or normal-offset bias in the shadow lookup path
   - target foliage/terrain acne reduction without floating trunk shadows
3. Keep camera-following + texel snapping
   - current `ShadowMap` stabilization stays
4. Preserve one shadow-map resolution control
   - keep simple authoring surface: `resolution`, `frustumSize`, `near`, `far`
5. Add a shadow debug readout path
   - keep `debugView: 'shadow'`
   - expose shadow config in the scene validation workflow

### Explicitly out of scope

- cascaded shadow maps
- contact shadows
- VSM/ESM/EVSM
- virtual shadow maps

## Sky / Ambient Baseline

### First-slice approach

Use the existing procedural sky as the visible background and the existing environment pipeline as the IBL source. Tighten their coupling through one authored lighting rig rather than introducing a second sky system.

### Required behavior

- sun direction used by the visible sky and by direct lighting must match
- sky color and ambient fill must not be authored independently in contradictory ways
- `ambient` remains available as a small art-directable fill term, not the main outdoor illumination source
- `envIntensity` continues to scale the IBL term, but authored defaults should assume IBL is the primary ambient response outdoors

### Design rule

For the baseline scene:

- direct sun shapes highlights and strong form
- IBL shapes overall cohesion and shaded-side readability
- flat ambient only fills the remaining dead zones

This avoids a giant architecture commitment because it uses the existing environment pipeline and only clarifies the ownership of inputs.

## Fog Integration

### First-slice fog model

Add one cheap analytic fog term in the main PBR pass:

- distance-based exponential fog
- optional height attenuation
- mixed after direct/IBL lighting and before tone mapping

### Why this model

- cheap enough for current renderer architecture
- enough to improve horizon separation and depth layering in the forest
- integrates with the current direct + IBL stack without volumetric raymarching

### Proposed fog behavior

```ts
fogFactor = saturate((1.0 - exp(-distance * density)) * heightMask)
finalLit = mix(litColor, fogColor, fogFactor * maxOpacity)
```

Height behavior:

- denser near ground plane
- fades gently as world height rises
- avoids blanketing the full canopy in uniform gray

Forest-scene intent:

- clearer foreground trunks and grass
- softer distant tree stacks
- more believable meadow-to-horizon transition

### Explicitly out of scope

- volumetric fog volumes
- sun shafts
- shadowed volumetrics
- weather-driven volumetric cloud lighting

## Exposure / Tone Mapping

### First-slice approach

Keep the current ACES curve. Do not replace tone mapping in this slice.

Add exactly one explicit pre-ACES exposure multiplier:

```wgsl
color = color * exposure;
color = aces(color);
color = pow(color, vec3f(1.0 / 2.2));
```

### Why this is enough for v0

- the scene already tone-maps
- the immediate problem is lack of authored exposure control, not lack of a different operator
- a simple scalar is enough to make the forest scene tunable without introducing auto-exposure complexity

### Constraint for this slice

- exposure is manual, scene-authored, and stable
- histogram-based or automatic exposure is deferred

## Debug Views And Instrumentation

Required debug support for the implementation slice:

- existing `lit`
- existing `normals`
- existing `shadow`
- existing `lightComplexity`
- new `fogFactor`
- optional `iblOnly`
- optional `directOnly`

Minimum instrumentation:

- shadow map resolution and frustum config visible in debug logs or dev panel
- current authored exposure value visible in debug logs or scene info
- fog settings visible in scene config output

This is intentionally small. It supports later tuning without building a full lighting dashboard.

## Likely Module / File Impact

Primary implementation modules:

- `packages/core-runtime/src/engine.ts`
  - extend default `SceneLighting` state to include exposure and fog config
- `packages/renderer-webgpu/src/pbr-pipeline.ts`
  - expand light uniform packing
  - pass shadow texel size/inverse resolution
  - pass fog + exposure values
  - keep existing render order
- `packages/renderer-webgpu/src/shaders/pbr.wgsl`
  - add exposure scalar
  - add fog integration
  - remove hard-coded shadow texel size
  - add debug view branches for fog / direct / IBL if implemented in the first slice
- `packages/renderer-webgpu/src/shaders/pbr-skinned.wgsl`
  - keep light uniform layout in sync with the static path
  - apply same fog / exposure / shadow changes
- `packages/renderer-webgpu/src/shadow-map.ts`
  - expose resolution-derived texel size
  - add normal-bias support if handled on CPU-side packing or config level
- `packages/renderer-webgpu/src/environment.ts`
  - no redesign expected
  - may need a minor cleanup so sky/background sun inputs are formally documented as scene-facing lighting rig inputs
- `packages/renderer-webgpu/src/index.ts`
  - export any updated lighting/fog types
- `examples/editor-demo/src/main.ts`
  - author the reference lighting preset for `first-nature-expedition`
- `examples/editor-demo/src/forest-stress-benchmark.ts`
  - pin the same validation preset for benchmark reproducibility when needed

Likely documentation updates during implementation:

- `README.md`
- `docs/roadmap/phase-next.md`

## Implementation Slice Recommendation

After this design is approved, the next implementation task should be exactly:

### Lighting Baseline v0 - Slice 1

Implement manual exposure plus analytic fog integration for the existing PBR path, and remove the hard-coded shadow texel size from shader code while keeping the current single directional light and single shadow map architecture.

Success criteria for that implementation task:

- `SceneLighting` supports `exposure` and `fog`
- `pbr.wgsl` and `pbr-skinned.wgsl` apply exposure before ACES
- fog is visible and tunable in `first-nature-expedition`
- shadow PCF no longer assumes `2048`
- the forest scene can be tuned without touching renderer internals again

This is the right next slice because it yields immediate visual gains while staying inside the current renderer architecture.

## Validation Criteria For Later Implementation

Validation scene:

- `first-nature-expedition`

Required measurable checks:

1. Forest walk stability
   - walk from trailhead to canopy cluster to clearing
   - no obvious shadow swimming beyond minor expected single-map movement
2. Lighting cohesion
   - trunks, ground, and grass remain readable in the same frame without washed-out grass tips or black trunk faces
3. Horizon readability
   - distant tree mass separates from sky more clearly than the current no-fog baseline
4. Exposure stability
   - one authored exposure value works for the entire scene without requiring per-location retuning
5. Benchmark safety
   - `low` and `medium` Forest Stress Benchmark runs show no benchmark failure caused by the lighting changes

Suggested comparison captures:

- meadow facing sun
- under-canopy looking outward
- trail with overlapping tree shadows
- distant horizon tree line

## Out Of Scope For Lighting Baseline v0

Explicitly out of scope:

- GI
- light probes beyond current IBL assets
- reflections
- SSR
- volumetric lighting beyond minimal fog interaction
- cloud volume rendering
- auto-exposure
- a new tone mapper
- broad renderer redesign

## Why This Avoids Overcommitting Too Early

This baseline deliberately uses:

- one sun
- one shadow map
- one IBL source
- one fog function
- one exposure scalar

That is enough to make `first-nature-expedition` look materially more cohesive while preserving the current architecture direction and leaving room for later phases:

- indirect lighting
- reflections
- better shadow scalability
- atmospheric volumes

The goal of v0 is not to solve lighting for all scenes. It is to make the current forest validation scene look intentional, stable, and tunable.
