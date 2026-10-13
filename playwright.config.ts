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
    baseURL: 'http://127.0.0.1:5174',
    headless: true,
    viewport: { width: 1040, height: 1000 },
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: {
    command: 'npm exec -- concurrently -k -n server,client "npm run dev -w @virtual-workspace/backend" "npm run dev -w @virtual-workspace/frontend -- --port 5174"',
    url: 'http://127.0.0.1:5174/health',
    reuseExistingServer: false,
    env: {
      VITE_CAMERA_ZOOM: process.env.VITE_CAMERA_ZOOM ?? '2',
      PORT: '2569', DATABASE_PATH: ':memory:', MAP_REGISTRY_PATH: createWorldFixture(),
      IDENTITY_BASE_URL: 'http://127.0.0.1:5174',
      IDENTITY_TRUSTED_ORIGINS: 'http://127.0.0.1:5174,http://127.0.0.1:2569',
    },
    timeout: 30000,
  },
});
