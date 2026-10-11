import { defineConfig } from '@playwright/test';
import { createWorldFixture } from './apps/frontend/e2e/world-fixture';

export default defineConfig({
  testDir: './apps/frontend/e2e',
  timeout: 15000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    viewport: { width: 1040, height: 1000 },
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173/health',
    reuseExistingServer: false,
    env: { DATABASE_PATH: ':memory:', MAP_REGISTRY_PATH: createWorldFixture() },
    timeout: 30000,
  },
});
