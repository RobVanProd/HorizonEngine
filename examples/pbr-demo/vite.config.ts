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
      '@engine/streaming': resolve(__dirname, '../../packages/streaming/src'),
      '@engine/visibility': resolve(__dirname, '../../packages/visibility/src'),
      '@engine/core': resolve(__dirname, '../../packages/core-runtime/src'),
    },
  },
  server: {
    port: 5175,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
