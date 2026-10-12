import { test, expect, type Page } from '@playwright/test';
import { Client, type Room } from '@colyseus/sdk';
import type { WebTool, SpaceProtocol } from '@virtual-workspace/shared';

async function enter(page: Page, name: string, avatar = 'mint') {
  await page.goto('/');
  await expect(page.locator('#identity-status')).toHaveAttribute('data-ready', 'true');
  await page.locator('#name').fill(name);
  await page.locator('#avatar').selectOption(avatar);
  await page.locator('#join').click();
  await expect(page.locator('#status')).toContainText('已进入空间');
  await expect(page.locator('#game canvas')).toBeVisible();
}
async function observe(): Promise<Room<SpaceProtocol>> {
  const response = await fetch('http://127.0.0.1:5173/api/auth/sign-in/anonymous', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const room = await new Client('http://127.0.0.1:5173', { headers: { Cookie: cookie } }).joinOrCreate<SpaceProtocol>('space', { name: 'E2EObserver', avatar: 'mint' });
  room.onMessage('chat', () => {});
  if (!room.state?.players) await new Promise<void>(resolve => room.onStateChange.once(() => resolve()));
  return room;
}

async function walkTo(page: Page, observer: Room<SpaceProtocol>, name: string, kind: 'board' | 'pomodoro') {
  const zoneId = kind === 'board' ? 'message-wall' : 'focus-corner';
  const direction = kind === 'board' ? 'd' : 'a';
  const sessionId = (await page.locator('#status').textContent())!.split(' · ').at(-1)!;
  await expect.poll(() => observer.state.players.get(sessionId)?.name).toBe(name);
  await page.bringToFront();
  await page.locator('#game canvas').scrollIntoViewIfNeeded();
  await page.locator('#game canvas').focus();
  await page.keyboard.down(direction);
  try {
    await expect.poll(() => observer.state.players.get(sessionId)?.zoneId).toBe(zoneId);
  } finally { await page.keyboard.up(direction); }
  await expect(page.locator(`#${kind}-panel`)).toBeVisible();
}

const toolCases = [
  { resourceId: 'shared-canvas', x: 560 },
  { resourceId: 'shared-drawing', x: 144 },
  { resourceId: 'lounge-screen', x: 144 },
  { resourceId: 'shared-document', x: 560 },
] as const;
const toolDirectory: WebTool[] = toolCases.map(({ resourceId }) => ({
  resourceId, url: `https://tools.example/resources/${resourceId}`,
}));

async function walkToTool(page: Page, observer: Room<SpaceProtocol>, target: typeof toolCases[number]) {
  const sessionId = (await page.locator('#status').textContent())!.split(' · ').at(-1)!;
  await expect.poll(() => observer.state.players.has(sessionId)).toBe(true);
  await page.bringToFront();
  await page.locator('#game canvas').scrollIntoViewIfNeeded();
  await page.locator('#game canvas').focus();
  const direction = target.x > 352 ? 'd' : 'a';
  await page.keyboard.down(direction);
  try {
    await expect.poll(() => Math.abs(observer.state.players.get(sessionId)!.x - target.x), { intervals: [50] }).toBeLessThan(20);
  } finally { await page.keyboard.up(direction); }
  await page.keyboard.down('w');
  try {
    await expect.poll(() => observer.state.players.get(sessionId)?.zoneId).toBe(target.resourceId);
  } finally { await page.keyboard.up('w'); }
  await expect(page.locator('#tool-panel')).toBeVisible();
}

for (const target of toolCases) {
  test(`${target.resourceId} web map entry opens its configured page in an isolated tab`, async ({ page, context }) => {
    test.setTimeout(30000);
    await page.route('**/api/tools', route => route.fulfill({ json: toolDirectory }));
    await context.route('https://tools.example/**', route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>Web tool fixture</title><p>Tool page</p>',
    }));
    await enter(page, 'E2ETool');
    const observer = await observe();
    try {
      await walkToTool(page, observer, target);
      await expect(page.locator('#tool-heading')).toHaveText('网页工具');
      const url = `https://tools.example/resources/${target.resourceId}`;
      await expect(page.locator('#tool-open')).toHaveAttribute('href', url);
      const popupReady = page.waitForEvent('popup');
      await page.locator('#tool-open').click();
      const popup = await popupReady;
      await popup.waitForLoadState('domcontentloaded');
      await expect(popup).toHaveURL(url);
      expect(await popup.evaluate(() => window.opener === null)).toBe(true);
      expect(await popup.evaluate(() => document.referrer)).toBe('');
      await expect(page.locator('#status')).toContainText('已进入空间');
      await popup.close();
      await page.bringToFront();
      await page.locator('#game canvas').focus();
      const direction = target.x > 352 ? 'a' : 'd';
      await page.keyboard.down(direction);
      try { await expect(page.locator('#tool-panel')).toBeHidden(); }
      finally { await page.keyboard.up(direction); }
      await expect(page.locator('#tool-open')).not.toHaveAttribute('href');
    } finally { if (observer.connection.isOpen) await observer.leave(); }
  });
}

for (const scenario of [
  { name: 'unconfigured', response: { json: [] }, message: '尚未配置工具地址' },
  { name: 'unavailable', response: { status: 503 }, message: '工具入口加载失败' },
  { name: 'invalid URL', response: { json: [{ ...toolDirectory[1], url: 'javascript:alert(1)' }] }, message: '工具入口加载失败' },
]) {
  test(`${scenario.name} tool directory keeps the space usable without an active link`, async ({ page }) => {
    await page.route('**/api/tools', route => route.fulfill(scenario.response));
    await enter(page, 'E2EToolFallback');
    const observer = await observe();
    try {
      await walkToTool(page, observer, toolCases[1]);
      await expect(page.locator('#tool-status')).toContainText(scenario.message);
      await expect(page.locator('#tool-open')).toBeHidden();
      await expect(page.locator('#tool-open')).not.toHaveAttribute('href');
      await expect(page.locator('#status')).toContainText('已进入空间');
      await page.locator('#leave').click();
      await expect(page.locator('#tool-panel')).toBeHidden();
    } finally { if (observer.connection.isOpen) await observer.leave(); }
  });
}

test('map board panel publishes safe text, synchronizes browsers and keeps notes after rejoining', async ({ page, browser }, testInfo) => {
  test.setTimeout(30000);
  const bob = await browser.newPage();
  await enter(page, 'E2EBoardAlice');
  await enter(bob, 'E2EBoardBob');
  const observer = await observe();
  const note = `<b>留言 ${Date.now()}</b>`;
  try {
    await walkTo(page, observer, 'E2EBoardAlice', 'board');
    await page.locator('#board-text').fill(note);
    await page.locator('#board-post').click();
    await expect(page.locator('#feature-status')).toContainText('留言已发布');
    await expect(page.locator('#board-notes')).toContainText(note);
    await expect(page.locator('#board-notes b')).toHaveCount(0);
    await walkTo(bob, observer, 'E2EBoardBob', 'board');
    await expect(bob.locator('#board-notes')).toContainText(note);
    const bobsNote = bob.locator('#board-notes li').filter({ hasText: note });
    await expect(bobsNote.getByRole('button')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('board-mobile.png'), fullPage: true });
    await page.locator('#board-notes li').filter({ hasText: note }).getByRole('button').click();
    await expect(bob.locator('#board-notes')).not.toContainText(note);
    await page.waitForTimeout(550); // Respect the server mutation cooldown.
    await page.locator('#board-text').fill(note);
    await page.locator('#board-post').click();
    await expect(page.locator('#feature-status')).toContainText('留言已发布');
    await page.locator('#leave').click();
    await expect(page.locator('#board-panel')).toBeHidden();
    await page.locator('#join').click();
    await expect(page.locator('#status')).toContainText('已进入空间');
    await walkTo(page, observer, 'E2EBoardAlice', 'board');
    const retained = page.locator('#board-notes li').filter({ hasText: note });
    await expect(retained).toBeVisible();
    await expect(retained.getByRole('button')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('#identity-status')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#name')).toHaveValue('E2EBoardAlice');
    await page.locator('#join').click();
    await expect(page.locator('#status')).toContainText('已进入空间');
    await walkTo(page, observer, 'E2EBoardAlice', 'board');
    await page.locator('#board-notes li').filter({ hasText: note }).getByRole('button').click();
    await expect(bob.locator('#board-notes')).not.toContainText(note);
  } finally { if (observer.connection.isOpen) await observer.leave(); await bob.close(); }
});

test('shared pomodoro starts, pauses, resumes and resets from its map panel', async ({ page, browser }, testInfo) => {
  const bob = await browser.newPage();
  await enter(page, 'E2ETimerAlice');
  const observer = await observe();
  try {
    await walkTo(page, observer, 'E2ETimerAlice', 'pomodoro');
    await page.locator('#pomodoro-mode').selectOption('break');
    await page.locator('#pomodoro-start').click();
    await expect(page.locator('#pomodoro-status')).toHaveText('休息 · 进行中');
    await expect(page.locator('#pomodoro-time')).toHaveText(/0[45]:\d{2}/);
    await expect(page.locator('#pomodoro-start')).toBeDisabled();
    await enter(bob, 'E2ETimerBob');
    await walkTo(bob, observer, 'E2ETimerBob', 'pomodoro');
    await expect(bob.locator('#pomodoro-status')).toHaveText('休息 · 进行中');
    await expect(bob.locator('#pomodoro-mode')).toHaveValue('break');
    await expect(bob.locator('#pomodoro-mode')).toBeDisabled();
    await bob.locator('#pomodoro-pause').click();
    await expect(page.locator('#pomodoro-status')).toHaveText('休息 · 已暂停');
    const paused = await bob.locator('#pomodoro-time').textContent();
    await bob.waitForTimeout(600);
    await expect(bob.locator('#pomodoro-time')).toHaveText(paused!);
    await bob.locator('#pomodoro-resume').click();
    await expect(page.locator('#pomodoro-status')).toHaveText('休息 · 进行中');
    await bob.waitForTimeout(550);
    await bob.locator('#pomodoro-reset').click();
    await expect(page.locator('#pomodoro-status')).toHaveText('休息 · 准备开始');
    await expect(bob.locator('#pomodoro-time')).toHaveText('05:00');
    await bob.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => bob.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await bob.screenshot({ path: testInfo.outputPath('pomodoro-mobile.png'), fullPage: true });
  } finally { if (observer.connection.isOpen) await observer.leave(); await bob.close(); }
});

test('two browser guests render their avatars and exchange plain-text chat through the Vite proxy', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const bob = await browser.newPage();
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
  } finally { if (observer.connection.isOpen) await observer.leave(); await bob.close(); }
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
  const directory = await request.get('/api/world');
  const registry = await directory.json() as { initialMap: string; maps: { id: string; url: string }[] };
  const entry = registry.maps.find(map => map.id === registry.initialMap)!;
  const map = await request.get(entry.url);
  expect(map.status()).toBe(200);
  expect((await map.json()).layers.some((layer: { type: string }) => layer.type === 'tilelayer')).toBe(true);
  const data = await map.json() as { tilewidth: number; tileheight: number; tilesets: { image: string }[] };
  expect([data.tilewidth, data.tileheight]).toEqual([16, 16]);
  expect((await request.get(data.tilesets[0].image)).status()).toBe(200);
});


test('binding a second browser restores the same identity, profile and note permissions', async ({ page, browser }) => {
  await enter(page, 'E2EBound', 'violet');
  const target = await browser.newPage();
  const observer = await observe();
  try {
    await walkTo(page, observer, 'E2EBound', 'board');
    const note = `跨设备 ${Date.now()}`;
    await page.locator('#board-text').fill(note);
    await page.locator('#board-post').click();
    await expect(page.locator('#feature-status')).toContainText('留言已发布');
    await page.locator('summary').click();
    await page.locator('#identity-export').click();
    await expect(page.locator('#identity-code')).toHaveValue(/.{32}/);
    const code = await page.locator('#identity-code').inputValue();
    const identity = await page.locator('#identity-status').textContent();
    await page.locator('#leave').click();
    await expect(page.locator('#status')).toContainText('已离开');
    await target.goto('/');
    await expect(target.locator('#identity-status')).toHaveAttribute('data-ready', 'true');
    await target.locator('summary').click();
    await target.locator('#identity-code').fill(code);
    await target.locator('#identity-import').click();
    await expect(target.locator('#identity-feedback')).toHaveText('已绑定同一身份');
    await expect(target.locator('#identity-status')).toHaveText(identity!);
    await expect(target.locator('#name')).toHaveValue('E2EBound');
    await expect(target.locator('#avatar')).toHaveValue('violet');
    await target.locator('#join').click();
    await expect(target.locator('#status')).toContainText('已进入空间');
    await walkTo(target, observer, 'E2EBound', 'board');
    await target.locator('#board-notes li').filter({ hasText: note }).getByRole('button').click();
    await expect(target.locator('#feature-status')).toContainText('留言已删除');
  } finally { if (observer.connection.isOpen) await observer.leave(); await target.close(); }
});


test('embed presentation uses a sandboxed container and clears it when leaving', async ({ page, context }) => {
  const target = toolCases[1];
  await page.route('**/api/tools', route => route.fulfill({ json: [{ ...toolDirectory[1], mode: 'embed', fallback: 'external' }] }));
  await context.route('https://tools.example/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>Embedded tool fixture</p>' }));
  await enter(page, 'E2EPresentation');
  const observer = await observe();
  try {
    await walkToTool(page, observer, target);
    const frame = page.locator('#tool-panel iframe');
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-popups');
    await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(page.frameLocator('#tool-panel iframe').getByText('Embedded tool fixture')).toBeVisible();
    await page.locator('#leave').click();
    await expect(frame).toHaveCount(0);
  } finally { if (observer.connection.isOpen) await observer.leave(); }
});


test('embed presentation provides an explicit external fallback and clears both on zone exit', async ({ page, context }) => {
  await page.route('**/api/tools', route => route.fulfill({ json: [{ ...toolDirectory[1], mode: 'embed', fallback: 'external' }] }));
  await context.route('https://tools.example/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>Web tool fallback fixture</p>' }));
  await enter(page, 'E2EWebFallback');
  const observer = await observe();
  try {
    await walkToTool(page, observer, toolCases[1]);
    const fallback = page.locator('#tool-panel').getByRole('link', { name: '打开工具', exact: true });
    await expect(fallback).toHaveAttribute('href', toolDirectory[1].url);
    await expect(page.locator('#tool-panel iframe')).toBeVisible();
    const openedPage = page.waitForEvent('popup');
    await fallback.click();
    const toolPage = await openedPage;
    await toolPage.waitForLoadState('domcontentloaded');
    await expect(toolPage).toHaveURL(toolDirectory[1].url);
    expect(await toolPage.evaluate(() => window.opener === null)).toBe(true);
    expect(await toolPage.evaluate(() => document.referrer)).toBe('');
    await toolPage.close();
    await page.bringToFront();
    await page.locator('#game canvas').focus();
    await page.keyboard.down('d');
    try { await expect(page.locator('#tool-panel')).toBeHidden(); }
    finally { await page.keyboard.up('d'); }
    await expect(page.locator('#tool-panel iframe')).toHaveCount(0);
    await expect(fallback).toHaveCount(0);
  } finally { if (observer.connection.isOpen) await observer.leave(); }
});

test('Portal switches rendered maps, loads multiple tilesets and returns to the named spawn', async ({ page }) => {
  test.setTimeout(30000);
  const errors: string[] = [];
  const assets = new Set<string>();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.ok() && response.url().includes('/api/maps/studio/assets/')) assets.add(response.url()); });
  await enter(page, 'E2ETraveler');
  const observer = await observe();
  const sessionId = (await page.locator('#status').textContent())!.split(' · ').at(-1)!;
  try {
    await expect(page.locator('#game canvas')).toHaveAttribute('data-map-id', 'workspace');
    await page.locator('#game canvas').focus();
    await page.keyboard.down('s');
    try { await expect.poll(() => observer.state.players.get(sessionId)!.y, { intervals: [50] }).toBeGreaterThan(458); }
    finally { await page.keyboard.up('s'); }
    await page.keyboard.down('d');
    try { await expect.poll(() => observer.state.players.get(sessionId)!.mapId).toBe('studio'); }
    finally { await page.keyboard.up('d'); }
    await expect(page.locator('#game canvas')).toHaveAttribute('data-map-id', 'studio');
    await expect.poll(() => assets.size).toBe(2);
    expect(observer.state.players.get(sessionId)!.x).toBe(96);
    expect(observer.state.players.get(sessionId)!.y).toBe(96);
    await page.waitForTimeout(550); // Respect the shared server interaction cooldown.
    await page.locator('#game canvas').focus();
    await page.keyboard.down('a');
    try { await expect.poll(() => observer.state.players.get(sessionId)!.mapId).toBe('workspace'); }
    finally { await page.keyboard.up('a'); }
    await expect(page.locator('#game canvas')).toHaveAttribute('data-map-id', 'workspace');
    expect(observer.state.players.get(sessionId)!.x).toBe(352);
    expect(observer.state.players.get(sessionId)!.y).toBe(384);
    await expect(page.locator('#game canvas')).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally { if (observer.connection.isOpen) await observer.leave(); }
});
