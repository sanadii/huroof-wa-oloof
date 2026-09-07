import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:8787', '/ws': { target: 'ws://localhost:8787', ws: true } },
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
});
