import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { isLocalAdminPath, isLoopbackAddress } from './server/local-admin-guard.js';

export default defineConfig(({ command, mode, isPreview }) => {
  const environment = loadEnv(mode, process.cwd(), 'VITE_');
  const lanEnabled = environment.VITE_ALLOW_LAN === 'true';
  const configuredRuntime =
    process.env.VITE_GAME_RUNTIME ?? environment.VITE_GAME_RUNTIME;
  const localGameServerPort = process.env.LOCAL_GAME_SERVER_PORT ?? '8787';
  const localFirestoreMode = process.env.LOCAL_DB_QUESTION_SOURCE === 'firestore-import';
  const localDevRuntime =
    command === 'serve' && mode !== 'test' && !isPreview && !configuredRuntime
      ? { 'import.meta.env.VITE_GAME_RUNTIME': JSON.stringify('local') }
      : {};
  return {
    define: localDevRuntime,
    plugins: [
      react(),
      {
        name: 'local-admin-loopback-guard',
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            const pathname = new URL(request.url ?? '/', 'http://vite.local').pathname;
            const parts = pathname.split('/').filter(Boolean);
            const dbSensitivePath = pathname === '/api/question-inventory' || (parts[0] === 'api' && parts[1] === 'rooms');
            if (!isLoopbackAddress(request.socket.remoteAddress) && (isLocalAdminPath(pathname) || (localFirestoreMode && dbSensitivePath))) {
              response.writeHead(403, { 'content-type': 'application/json' });
              response.end(JSON.stringify({ error: 'LOCAL_ONLY_ADMIN' }));
              return;
            }
            next();
          });
        },
      },
    ],
    server: {
      host: lanEnabled ? true : 'localhost',
      proxy: { '/api': `http://127.0.0.1:${localGameServerPort}`, '/ws': { target: `ws://127.0.0.1:${localGameServerPort}`, ws: true } },
      watch: {
        // Generated authoring evidence and browser artifacts are not application inputs.
        // Ignoring them avoids full-reload churn while other work writes those directories.
        ignored: ['**/content/question-bank-v3/staging/**', '**/output/**'],
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./tests/app/setup.ts'],
      include: ['tests/app/**/*.test.tsx'],
    },
  };
});
