import { test, expect, type Page } from '@playwright/test';
import { Client, type Room } from '@colyseus/sdk';
import type { SpaceRoom } from '@virtual-workspace/backend/rooms/SpaceRoom';

async function enter(page: Page, name: string, avatar = 'mint') {
  await page.goto('/');
  await page.locator('#name').fill(name);
  await page.locator('#avatar').selectOption(avatar);
  await page.locator('#join').click();
  await expect(page.locator('#status')).toContainText('已进入空间');
  await expect(page.locator('#game canvas')).toBeVisible();
}
async function observe(): Promise<Room<SpaceRoom>> {
  const room = await new Client('http://127.0.0.1:5173').joinOrCreate<SpaceRoom>('space', { name: 'E2EObserver', avatar: 'mint' });
  room.onMessage('chat', () => {});
  if (!room.state?.players) await new Promise<void>(resolve => room.onStateChange.once(() => resolve()));
  return room;
}

test('two browser guests render their avatars and exchange plain-text chat through the Vite proxy', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const bob = await context.newPage();
  bob.on('pageerror', error => errors.push(error.message));
  await enter(page, 'E2EAlice', 'amber');
  await enter(bob, 'E2EBob', 'violet');
  const observer = await observe();
  try {
    await expect.poll(() => [...observer.state.players.values()].some(player => player.name === 'E2EAlice' && player.avatar === 'amber')).toBe(true);
    await expect.poll(() => [...observer.state.players.values()].some(player => player.name === 'E2EBob' && player.avatar === 'violet')).toBe(true);
    await page.locator('#message').fill('<b>你好</b>');
    await page.locator('#send').click();
    await expect(bob.locator('#messages')).toContainText('E2EAlice：<b>你好</b>');
    await expect(bob.locator('#messages b')).toHaveCount(0);
    await expect(page.locator('#message')).toHaveValue('');
    await bob.locator('#message').fill('收到');
    await bob.locator('#send').click();
    await expect(page.locator('#messages')).toContainText('E2EBob：收到');
    expect(errors).toEqual([]);
  } finally { if (observer.connection.isOpen) await observer.leave(); }
});

test('keyboard moves the authoritative player while typing pauses movement', async ({ page }) => {
  await enter(page, 'E2EMovement');
  const observer = await observe();
  try {
    const player = [...observer.state.players.values()].find(player => player.name === 'E2EMovement')!;
    const x = player.x;
    await page.bringToFront();
    await page.locator('#message').fill('移动前发送一条消息');
    await page.locator('#send').click();
    await page.locator('#game canvas').click({ position: { x: 352, y: 384 } });
    await page.keyboard.down('d');
    await expect.poll(() => player.x).toBeGreaterThan(x);
    await page.keyboard.up('d');
    await page.locator('#message').focus();
    await page.waitForTimeout(350); // Server input expires at 250ms.
    const stopped = player.x;
    await page.keyboard.down('d');
    await page.waitForTimeout(350);
    await page.keyboard.up('d');
    expect(player.x).toBe(stopped);
  } finally { if (observer.connection.isOpen) await observer.leave(); }
});

test('leaving clears controls and canvas, and the same page can join again', async ({ page }) => {
  await enter(page, 'E2ERejoin');
  await page.locator('#leave').click();
  await expect(page.locator('#status')).toContainText('已离开');
  await expect(page.locator('#game canvas')).toHaveCount(0);
  await expect(page.locator('#message')).toBeDisabled();
  await expect(page.locator('#join')).toBeEnabled();
  await page.locator('#join').click();
  await expect(page.locator('#status')).toContainText('已进入空间');
  await expect(page.locator('#game canvas')).toHaveCount(1);
});

test('a 390px screen fits the map and forms without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page, 'E2EMobile');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const canvas = await page.locator('#game canvas').boundingBox();
  expect(canvas?.width).toBeLessThanOrEqual(390);
  expect(canvas?.width).toBeGreaterThan(100);
});

// The browser tests deliberately use the same-origin endpoint, including its WS query string.
test('health and Tiled assets are reachable through the dev server', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
  const map = await request.get('/maps/lobby.tmj');
  expect(map.status()).toBe(200);
  expect((await map.json()).layers.some((layer: { name: string }) => layer.name === 'ground')).toBe(true);
  expect((await request.get('/maps/tiles.png')).status()).toBe(200);
});
