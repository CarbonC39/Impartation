import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createWorldFixture } from './world-fixture';

test('a production backend can stop and restart without leaving the browser looking online', async ({ page }) => {
  test.setTimeout(60_000);
  const origin = 'http://127.0.0.1:2571';
  const directory = mkdtempSync(join(tmpdir(), 'impartation-restart-'));
  const registry = createWorldFixture();
  let backend: ChildProcess | undefined;
  const start = async () => {
    backend = spawn(process.execPath, ['apps/backend/build/index.js'], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      env: { ...process.env, NODE_ENV: 'production', PORT: '2571',
        DATABASE_PATH: join(directory, 'restart.sqlite'), MAP_REGISTRY_PATH: registry,
        FRONTEND_DIST_PATH: fileURLToPath(new URL('../dist/', import.meta.url)),
        IDENTITY_SECRET: 'restart-test-secret-with-more-than-thirty-two-characters',
        IDENTITY_BASE_URL: origin, IDENTITY_TRUSTED_ORIGINS: origin, REGISTRATION_MODE: 'open' },
      stdio: 'ignore',
    });
    await expect.poll(async () => {
      try { return (await page.request.get(origin + '/health', { timeout: 1000 })).ok(); }
      catch { return false; }
    }, { timeout: 10_000 }).toBe(true);
  };
  const stop = async () => {
    if (!backend || backend.exitCode !== null) return;
    const exited = once(backend, 'exit');
    backend.kill('SIGTERM');
    await exited;
    backend = undefined;
  };
  try {
    await start();
    const response = await page.request.post(origin + '/api/register', {
      headers: { Origin: origin },
      data: { username: 'restart.user', password: 'restart-test-password', displayName: 'Restart' },
    });
    expect(response.status()).toBe(200);
    await page.goto(origin);
    await page.locator('#world-list [data-world="main"]').click();
    await page.locator('#join').click(); await page.locator('#prejoin-enter').click();
    await expect(page.locator('body')).toHaveAttribute('data-connection-state', 'connected');
    await stop();
    await expect(page.locator('body')).toHaveAttribute('data-connection-state', 'disconnected');
    await expect(page.locator('#connection-message')).toContainText('服务正在停止或重启');
    await expect(page.locator('#send')).toBeDisabled();
    await page.locator('#reconnect').click();
    await expect(page.locator('#connection-message')).toContainText('重新连接失败');
    await expect(page.locator('#reconnect')).toBeEnabled();
    await start();
    await page.locator('#reconnect').click();
    await expect(page.locator('body')).toHaveAttribute('data-connection-state', 'connected');
    await expect(page.locator('#connection-notice')).toBeHidden();
    await page.locator('#message').fill('后端重启后已恢复'); await page.locator('#send').click();
    await expect(page.locator('#messages')).toContainText('后端重启后已恢复');
  } finally {
    await stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
