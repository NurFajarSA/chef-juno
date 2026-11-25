import { defineConfig, devices } from '@playwright/test';

// Dijalankan di dalam `firebase emulators:exec` (hosting emulator menyajikan apps/web/dist/web/browser).
export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5055', ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
});
