import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8787', '/ws': { target: 'ws://localhost:8787', ws: true } } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/app/setup.ts'],
    include: ['tests/app/**/*.test.tsx'],
  },
});
