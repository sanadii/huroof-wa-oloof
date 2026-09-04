import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'firebase.spec.ts',
  timeout: 90_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5188', screenshot: 'only-on-failure' },
  webServer: { command: 'vite --host 127.0.0.1 --port 5188 --strictPort', url: 'http://127.0.0.1:5188', reuseExistingServer: false, timeout: 60_000 },
});
