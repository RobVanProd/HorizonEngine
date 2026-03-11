# Horizon Engine

**A WebGPU-native, TypeScript-first open-source engine for large-scale real-time 3D worlds.**

Horizon is a data-oriented game engine built for the modern web platform. It targets WebGPU as the primary rendering backend and uses TypeScript throughout — runtime, tooling, and gameplay systems alike.

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

## Prerequisites

- Node.js >= 20
- pnpm >= 9
- A browser with WebGPU support (Chrome 113+, Edge 113+, Firefox Nightly)

## Getting Started

```bash
pnpm install
pnpm check        # Type-check all packages
pnpm test          # Run tests
pnpm dev           # Start benchmark example dev server
```

## Design Principles

1. WebGPU-first, not WebGL-first
2. Data-oriented runtime over object-heavy abstraction
3. Multithreaded by design, not as an afterthought
4. Modern lighting and visibility pipelines as core systems
5. Tooling and profiling are product features, not extras
6. Phased technical proof over feature-list theater
7. Open-source core with clear subsystem boundaries

## Development Roadmap

- **Phase 0** — Foundation and feasibility *(current)*
- **Phase 1** — GPU-driven rendering prototype
- **Phase 2** — Runtime and simulation core
- **Phase 3** — Lighting and materials
- **Phase 4** — Animation and world systems
- **Phase 5** — Audio and tooling integration
- **Phase 6** — Engine vertical slice

## Internal Design Mantra

> Do not chase engine theater. Ship proof.

## License

MIT
