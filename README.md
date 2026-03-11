<p align="center">
  <img src="./horizon_logo_horizontal.svg" alt="Horizon Engine" width="640" />
</p>

# Horizon Engine

**A WebGPU-native, TypeScript-first open-source engine for large-scale real-time 3D worlds.**

Horizon is a data-oriented game engine built for the modern web platform. It targets WebGPU as the primary rendering backend and uses TypeScript throughout — runtime, tooling, and gameplay systems alike.

## Repository

- GitHub: `https://github.com/RobVanProd/HorizonEngine`

## Architecture

The engine is organized into isolated subsystem packages:

| Package | Description |
|---------|-------------|
| `@engine/memory` | SharedArrayBuffer pools, typed stores, binary schema utilities |
| `@engine/ecs` | Archetype-based Entity Component System with SoA storage |
| `@engine/platform` | Browser capability detection, WebGPU context, input abstraction |
| `@engine/scheduler` | Frame loop, phase-based scheduling, job dispatch |
| `@engine/profiler` | CPU timing, GPU profiling, metrics collection |
| `@engine/renderer-webgpu` | WebGPU device management, render pipelines, WGSL shaders |
| `@engine/core` | Engine bootstrap and subsystem orchestration |
| `@engine/audio` | Spatial audio system (WebAudio, 3D positional, ECS integration) |
| `@engine/ai` | AI integration (LLM command API, ML inference, transports) |
| `@engine/devtools` | Developer tools (perf dashboard, debug draw, entity inspector) |
| `@engine/editor` | Scene editor (viewport, hierarchy, properties, assets, gizmos) |

## Prerequisites

- Node.js >= 20
- pnpm >= 9
- A browser with WebGPU support (Chrome 113+, Edge 113+, Firefox Nightly)

## Getting Started

```bash
pnpm install
pnpm check         # Type-check all packages
pnpm test          # Run tests
pnpm dev           # Start benchmark example dev server
```

## Example Apps

```bash
pnpm dev           # Benchmark scene
pnpm dev:large     # Large-scene example
pnpm dev:pbr       # PBR materials demo
pnpm dev:anim      # Animation + audio + AI demo
pnpm dev:editor    # Scene editor / Phase 6 vertical slice
```

## Current Capabilities

- WebGPU renderer with PBR materials, image-based lighting, shadows, and environment maps
- ECS runtime with transform hierarchy, scheduler phases, and data-oriented component storage
- Asset pipeline for textures, HDR environments, and glTF scenes with animation support
- Skeletal animation and skinned rendering
- Spatial audio integrated into ECS
- AI command APIs, inference hooks, and transports for agent integration
- In-engine devtools plus a scene editor with hierarchy, properties, assets, and viewport controls

## Project Layout

```text
packages/   Engine subsystems
examples/   Runnable demos and validation apps
```

## Contributing

Contributions are welcome. See `CONTRIBUTING.md` for development workflow and expectations.

## Design Principles

1. WebGPU-first, not WebGL-first
2. Data-oriented runtime over object-heavy abstraction
3. Multithreaded by design, not as an afterthought
4. Modern lighting and visibility pipelines as core systems
5. Tooling and profiling are product features, not extras
6. Phased technical proof over feature-list theater
7. Open-source core with clear subsystem boundaries

## Development Roadmap

- **Phase 0** — Foundation and feasibility ✓
- **Phase 1** — GPU-driven rendering prototype ✓
- **Phase 2** — Runtime and simulation core ✓
- **Phase 3** — Lighting and materials ✓
- **Phase 4** — Animation and world systems ✓
- **Phase 5** — Audio, tooling, and AI integration ✓
- **Phase 6** — Scene editor and engine vertical slice *(current)*

## Internal Design Mantra

> Do not chase engine theater. Ship proof.

## License

MIT. See `LICENSE`.
