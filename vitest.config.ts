import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@engine/memory': resolve(__dirname, 'packages/memory/src'),
      '@engine/ecs': resolve(__dirname, 'packages/ecs/src'),
      '@engine/platform': resolve(__dirname, 'packages/platform/src'),
      '@engine/scheduler': resolve(__dirname, 'packages/scheduler/src'),
      '@engine/profiler': resolve(__dirname, 'packages/profiler/src'),
      '@engine/renderer-webgpu': resolve(__dirname, 'packages/renderer-webgpu/src'),
      '@engine/visibility': resolve(__dirname, 'packages/visibility/src'),
      '@engine/assets': resolve(__dirname, 'packages/assets/src'),
      '@engine/streaming': resolve(__dirname, 'packages/streaming/src'),
      '@engine/core': resolve(__dirname, 'packages/core-runtime/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts'],
  },
});
