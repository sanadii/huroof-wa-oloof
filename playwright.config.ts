import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: 'firebase.spec.ts',
  timeout: 30_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8787', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run build && npm run start:local', url: 'http://127.0.0.1:8787/health', reuseExistingServer: false, timeout: 60_000 },
});
