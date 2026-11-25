import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@chefjuno/shared': shared } },
  test: {
    projects: [
      {
        resolve: { alias: { '@chefjuno/shared': shared } },
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'packages/*/src/**/*.test.ts',
            'apps/functions/test/unit/**/*.test.ts',
            'apps/daemon/test/unit/**/*.test.ts',
            'apps/web/src/app/docs/*.test.ts',
            'apps/web/src/app/core/*.test.ts',
          ],
        },
      },
      {
        resolve: { alias: { '@chefjuno/shared': shared } },
        test: {
          name: 'emulator',
          environment: 'node',
          include: ['apps/functions/test/emulator/**/*.test.ts', 'apps/daemon/test/emulator/**/*.test.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
