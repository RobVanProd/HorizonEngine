import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@engine/memory': resolve(__dirname, '../../packages/memory/src'),
      '@engine/ecs': resolve(__dirname, '../../packages/ecs/src'),
      '@engine/platform': resolve(__dirname, '../../packages/platform/src'),
      '@engine/scheduler': resolve(__dirname, '../../packages/scheduler/src'),
      '@engine/profiler': resolve(__dirname, '../../packages/profiler/src'),
      '@engine/renderer-webgpu': resolve(__dirname, '../../packages/renderer-webgpu/src'),
      '@engine/assets': resolve(__dirname, '../../packages/assets/src'),
      '@engine/animation': resolve(__dirname, '../../packages/animation/src'),
      '@engine/streaming': resolve(__dirname, '../../packages/streaming/src'),
      '@engine/visibility': resolve(__dirname, '../../packages/visibility/src'),
      '@engine/core': resolve(__dirname, '../../packages/core-runtime/src'),
      '@engine/audio': resolve(__dirname, '../../packages/audio/src'),
      '@engine/ai': resolve(__dirname, '../../packages/ai/src'),
      '@engine/devtools': resolve(__dirname, '../../packages/devtools/src'),
      '@engine/editor': resolve(__dirname, '../../packages/editor/src'),
    },
  },
  server: {
    port: 5177,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
