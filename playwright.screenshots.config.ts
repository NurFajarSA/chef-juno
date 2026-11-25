import { defineConfig, devices } from '@playwright/test';

// Screenshot bukti (§11.2): tiap halaman, mode terang & gelap, desktop 1440 & mobile 390.
export default defineConfig({
  testDir: 'e2e/screenshots',
  testMatch: /.*\.shot\.ts$/,
  workers: 1,
  timeout: 240_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5055', actionTimeout: 15_000, navigationTimeout: 30_000 },
  projects: [
    { name: 'light-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'light' } },
    { name: 'dark-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } },
    { name: 'light-mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, colorScheme: 'light' } },
    { name: 'dark-mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, colorScheme: 'dark' } },
  ],
});
