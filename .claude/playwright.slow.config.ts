import base from '../playwright.config';
import { defineConfig } from '@playwright/test';
// Local-only: same as the project config, with more time for the dev servers on a loaded machine.
export default defineConfig({ ...base, testDir: '../apps/frontend/e2e', webServer: { ...base.webServer!, timeout: 180000 } as typeof base.webServer });
