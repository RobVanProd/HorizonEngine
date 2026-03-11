import fs from 'node:fs';
import path, { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const USER_PACK_ROOT = resolve(__dirname, '../../downloaded stuff/unfinished_building_high');
const USER_PACK_ROUTE = '/__user-pack__';
const USER_PACK_VIRTUAL_MODULE = 'virtual:user-pack-manifest';

function userPackPlugin(): Plugin {
  const resolvedId = `\0${USER_PACK_VIRTUAL_MODULE}`;
  const entries = readUserPackEntries();

  return {
    name: 'horizon-user-pack',
    resolveId(id) {
      if (id === USER_PACK_VIRTUAL_MODULE) return resolvedId;
      return null;
    },
    load(id) {
      if (id !== resolvedId) return null;
      return [
        `export const userPackBaseUrl = ${JSON.stringify(entries.length > 0 ? USER_PACK_ROUTE : null)};`,
        `export const userPackEntries = ${JSON.stringify(entries)};`,
      ].join('\n');
    },
    configureServer(server) {
      if (entries.length === 0) return;
      server.middlewares.use(USER_PACK_ROUTE, (req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
        const relativePath = urlPath.replace(/^\/+/, '');
        const filePath = path.resolve(USER_PACK_ROOT, relativePath);

        if (!filePath.startsWith(USER_PACK_ROOT)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          next();
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = CONTENT_TYPES[ext];
        if (contentType) {
          res.setHeader('Content-Type', contentType);
        }
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

function readUserPackEntries(): Array<{ dir: string; file: string }> {
  if (!fs.existsSync(USER_PACK_ROOT)) return [];

  return fs.readdirSync(USER_PACK_ROOT)
    .sort((a, b) => a.localeCompare(b))
    .flatMap((dir) => {
      const absoluteDir = path.join(USER_PACK_ROOT, dir);
      if (!fs.statSync(absoluteDir).isDirectory()) return [];
      const file = fs.readdirSync(absoluteDir).find((entry) => entry.toLowerCase().endsWith('.fbx'));
      return file ? [{ dir, file }] : [];
    });
}

const CONTENT_TYPES: Record<string, string> = {
  '.fbx': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tga': 'application/octet-stream',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

export default defineConfig({
  plugins: [userPackPlugin()],
  resolve: {
    alias: {
      '@engine/memory': resolve(__dirname, '../../packages/memory/src'),
      '@engine/ecs': resolve(__dirname, '../../packages/ecs/src'),
      '@engine/platform': resolve(__dirname, '../../packages/platform/src'),
      '@engine/scheduler': resolve(__dirname, '../../packages/scheduler/src'),
      '@engine/profiler': resolve(__dirname, '../../packages/profiler/src'),
      '@engine/effects': resolve(__dirname, '../../packages/effects/src'),
      '@engine/renderer-webgpu': resolve(__dirname, '../../packages/renderer-webgpu/src'),
      '@engine/assets': resolve(__dirname, '../../packages/assets/src'),
      '@engine/animation': resolve(__dirname, '../../packages/animation/src'),
      '@engine/streaming': resolve(__dirname, '../../packages/streaming/src'),
      '@engine/world': resolve(__dirname, '../../packages/world/src'),
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
