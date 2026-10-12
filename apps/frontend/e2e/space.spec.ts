import { test, expect, type Page } from '@playwright/test';
import { Client, type Room } from '@colyseus/sdk';
import type { WebTool, SpaceProtocol } from '@virtual-workspace/shared';
import type Phaser from 'phaser';
import type { SpaceScene } from '../src/SpaceScene';

async function enter(page: Page, name: string, avatar = 'mint', prepare?: () => Promise<void>) {
  await page.goto('/');
  await expect(page.locator('#identity-status')).toHaveAttribute('data-ready', 'true');
  await prepare?.();
  await openAvatarScreen(page);
  await page.locator('#name').fill(name);
  await page.locator(`input[name="avatar-choice"][value="${avatar}"]`).check();
  await page.locator('#join').click();
  await expect(page.locator('#status')).toContainText('已进入空间');
  await expect(page.locator('#game canvas')).toBeVisible();
}

type RenderingWindow = Window & { sceneUnderTest?: SpaceScene };

test('corrected atlas renders complete directional frames at integer world zoom', async ({ page }, testInfo) => {
  await enter(page, 'E2ERender', 'mint', async () => {
    // Observe the real scene through a test-only prototype hook; no app debug API is exposed.
    await page.evaluate(async scenePath => {
      const loadedPath = performance.getEntriesByType('resource').map(entry => entry.name)
        .find(path => new URL(path).pathname === scenePath) ?? scenePath;
      const { SpaceScene } = await import(loadedPath) as { SpaceScene: typeof import('../src/SpaceScene').SpaceScene };
      const update = SpaceScene.prototype.update;
      SpaceScene.prototype.update = function (this: SpaceScene, time: number, delta: number) {
        update.call(this, time, delta);
        (window as RenderingWindow).sceneUnderTest = this;
      };
    }, '/src/SpaceScene.ts');
  });
  const sessionId = (await page.locator('#status').textContent())!.split(' · ').at(-1)!;
  const renderState = () => page.evaluate(id => {
    const scene = (window as RenderingWindow).sceneUnderTest;
    if (!scene) return;
    const sprite = scene.children.getByName(id) as Phaser.GameObjects.Sprite | null;
    if (!sprite) return;
    const zoom = scene.cameras.main.zoom;
    const bounds = sprite.getBounds();
    return {
      zoom, frame: Number(sprite.frame.name),
      origin: [sprite.originX, sprite.originY],
      worldSize: [sprite.displayWidth, sprite.displayHeight],
      screenSize: [sprite.displayWidth * zoom, sprite.displayHeight * zoom],
      groundAnchored: bounds.bottom === sprite.y,
      frames: Array.from({ length: 16 }, (_, index) => {
        const frame = sprite.texture.get(index);
        return [frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight];
      }),
    };
  }, sessionId);
  await expect.poll(async () => (await renderState())?.frame).toBe(0);
  const initial = (await renderState())!;
  expect(initial.zoom).toBe(3);
  expect(initial.origin).toEqual([0.5, 1]);
  expect(initial.worldSize).toEqual([16, 24]);
  expect(initial.screenSize).toEqual([48, 72]);
  expect(initial.groundAnchored).toBe(true);
  expect(initial.frames).toEqual(Array.from({ length: 16 }, (_, index) => [index % 4 * 16, Math.floor(index / 4) * 24, 16, 24]));
  await page.locator('#game canvas').focus();
  await page.keyboard.down('d');
  try {
    await expect.poll(async () => (await renderState())?.frame, { intervals: [10] }).toBe(8);
    await expect.poll(async () => (await renderState())?.frame, { intervals: [10] }).toBe(9);
  } finally { await page.keyboard.up('d'); }
  await expect.poll(async () => (await renderState())?.frame).toBe(8);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await renderState())?.screenSize).toEqual([48, 72]);
  await page.screenshot({ path: testInfo.outputPath('character-zoom-mobile.png'), fullPage: true });
  await page.locator('#leave').click();
});

async function openAvatarScreen(page: Page) {
  if (await page.locator('#login-screen').isVisible()) {
    await page.locator('#account').fill('e2e-guest');
    await page.locator('#password').fill('e2e-password');
    await page.locator('#login-form button[type="submit"]').click();
  }
  if (await page.locator('#world-screen').isVisible()) {
    await page.locator('#world-list [data-world="sunny-lobby"]').click();
  }
  await expect(page.locator('#avatar-screen')).toBeVisible();
}

async function joinSavedProfile(page: Page) {
  await openAvatarScreen(page);
  await page.locator('#join').click();
  await expect(page.locator('#status')).toContainText('已进入空间');
  await expect(page.locator('#game canvas')).toBeVisible();
}
async function observe(): Promise<Room<SpaceProtocol>> {
  const endpoint = test.info().project.use.baseURL!;
  const response = await fetch(endpoint + '/api/auth/sign-in/anonymous', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const room = await new Client(endpoint, { headers: { Cookie: cookie } }).joinOrCreate<SpaceProtocol>('space', { name: 'E2EObserver', avatar: 'mint' });
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
    await joinSavedProfile(page);
    await walkTo(page, observer, 'E2EBoardAlice', 'board');
    const retained = page.locator('#board-notes li').filter({ hasText: note });
    await expect(retained).toBeVisible();
    await expect(retained.getByRole('button')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('#identity-status')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#name')).toHaveValue('E2EBoardAlice');
    await joinSavedProfile(page);
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

test('mobile seat activation renders the character and releases occupancy when walking', async ({ page }, testInfo) => {
  test.setTimeout(30000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  const spriteResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/characters/walk.png' && response.ok();
  });
  await enter(page, 'E2ESeat');
  await spriteResponse;
  const observer = await observe();
  const button = page.locator('#activate-object');
  const canvas = page.locator('#game canvas');
  const sessionId = (await page.locator('#status').textContent())!.split(' · ').at(-1)!;
  const player = () => observer.state.players.get(sessionId)!;
  const seat = () => observer.state.worldObjects.get(player().mapId)?.objects.get('lobby-seat-1');
  try {
    await expect.poll(() => player()?.name).toBe('E2ESeat');
    await expect(button).toBeDisabled();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await canvas.scrollIntoViewIfNeeded();
    await canvas.focus();
    await page.keyboard.down('d');
    try {
      await expect.poll(async () => {
        const value = player();
        return await button.isEnabled() && Math.floor(value.x / 16) === 25 && Math.floor(value.y / 16) === 24;
      }, { intervals: [10], timeout: 5000 }).toBe(true);
    } finally { await page.keyboard.up('d'); }
    await button.click();
    await expect.poll(() => player().action).toBe('sit');
    await expect.poll(() => player().x).toBe(408);
    await expect.poll(() => player().y).toBe(392);
    expect(player().facing).toBe('up');
    expect(player().motion).toBe('idle');
    expect(player().actionTargetId).toBe('lobby-seat-1');
    expect(seat()?.variant).toBe('occupied');
    expect(seat()?.occupiedBy).toBe(sessionId);
    await expect(button).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('seat-character-mobile.png'), fullPage: true });

    await page.waitForTimeout(550); // Respect the server interaction cooldown before activating again.
    await canvas.focus();
    await page.keyboard.down('d');
    try {
      await expect.poll(() => player().x, { intervals: [10] }).toBeGreaterThanOrEqual(424);
      await expect.poll(() => player().action).toBe('none');
      expect(player().actionTargetId).toBe('');
      expect(seat()?.variant).toBe('empty');
      expect(seat()?.occupiedBy).toBe('');
      await expect.poll(() => player().motion, { intervals: [10] }).toBe('walk');
    } finally { await page.keyboard.up('d'); }
    await expect.poll(() => player().motion, { intervals: [10] }).toBe('idle');
    expect(player().facing).toBe('right');

    await canvas.focus();
    await page.keyboard.down('a');
    try {
      await expect.poll(() => {
        const value = player();
        return Math.floor(value.x / 16) === 25 && Math.floor(value.y / 16) === 24;
      }, { intervals: [10] }).toBe(true);
    } finally { await page.keyboard.up('a'); }
    await expect.poll(() => player().motion, { intervals: [10] }).toBe('idle');
    await canvas.focus();
    await page.keyboard.down('e');
    try { await expect.poll(() => player().action).toBe('sit'); }
    finally { await page.keyboard.up('e'); }
    expect(player().x).toBe(408);
    expect(player().y).toBe(392);
    expect(player().facing).toBe('up');
    expect(seat()?.variant).toBe('occupied');
    expect(seat()?.occupiedBy).toBe(sessionId);
    expect(errors).toEqual([]);

    await page.locator('#leave').click();
    await expect(page.locator('#status')).toContainText('已离开');
    await expect(canvas).toHaveCount(0);
    await expect(button).toBeDisabled();
  } finally {
    if (observer.connection.isOpen) await observer.leave();
  }
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
  await expect(page.locator('#world-screen [data-world="sunny-lobby"]')).toBeEnabled();
  await joinSavedProfile(page);
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

test('mobile direction controls move the authoritative player and release on pointerup', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page, 'E2ETouchControls');
  const observer = await observe();
  const sessionId = (await page.locator('#status').textContent())!.split(' · ').at(-1)!;
  const player = () => observer.state.players.get(sessionId)!;
  let pointerDown = false;
  try {
    await expect.poll(() => player()?.name).toBe('E2ETouchControls');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const right = await page.locator('[data-move="right"]').boundingBox();
    expect(right).not.toBeNull();
    const startX = player().x;
    await page.mouse.move(right!.x + right!.width / 2, right!.y + right!.height / 2);
    await page.mouse.down();
    pointerDown = true;
    await expect.poll(() => player().motion, { intervals: [10] }).toBe('walk');
    await expect.poll(() => player().x, { intervals: [10] }).toBeGreaterThan(startX);
    expect(player().facing).toBe('right');
    await page.mouse.up();
    pointerDown = false;
    await expect.poll(() => player().motion, { intervals: [10] }).toBe('idle');

    const up = await page.locator('[data-move="up"]').boundingBox();
    expect(up).not.toBeNull();
    const startY = player().y;
    await page.mouse.move(up!.x + up!.width / 2, up!.y + up!.height / 2);
    await page.mouse.down();
    pointerDown = true;
    await expect.poll(() => player().motion, { intervals: [10] }).toBe('walk');
    await expect.poll(() => player().y, { intervals: [10] }).toBeLessThan(startY);
    expect(player().facing).toBe('up');
    await page.mouse.up();
    pointerDown = false;
    await expect.poll(() => player().motion, { intervals: [10] }).toBe('idle');

    await page.locator('#leave').click();
    await expect(page.locator('#status')).toContainText('已离开');
    await expect(page.locator('#game canvas')).toHaveCount(0);
  } finally {
    if (pointerDown) await page.mouse.up();
    if (observer.connection.isOpen) await observer.leave();
  }
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
    await page.locator('#leave').click();
    await expect(page.locator('#status')).toContainText('已离开');
    await page.locator('#world-screen [data-back="login-screen"]').click();
    await page.locator('#login-screen summary').click();
    await page.locator('#identity-export').click();
    await expect(page.locator('#identity-code')).toHaveValue(/.{32}/);
    const code = await page.locator('#identity-code').inputValue();
    const identity = await page.locator('#identity-status').textContent();

    await target.goto('/');
    await expect(target.locator('#identity-status')).toHaveAttribute('data-ready', 'true');
    await target.locator('#login-screen summary').click();
    await target.locator('#identity-code').fill(code);
    await target.locator('#identity-import').click();
    await expect(target.locator('#identity-feedback')).toHaveText('已绑定同一身份');
    await expect(target.locator('#identity-status')).toHaveText(identity!);
    await expect(target.locator('#name')).toHaveValue('E2EBound');
    await expect(target.locator('#avatar')).toHaveValue('violet');
    await joinSavedProfile(target);
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

test('Portal switches rendered maps, loads multiple tilesets and preserves the connection when returning', async ({ page }) => {
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
    try { await expect.poll(() => observer.state.players.get(sessionId)!.mapId, { intervals: [10] }).toBe('studio'); }
    finally { await page.keyboard.up('d'); }
    await expect(page.locator('#game canvas')).toHaveCount(1);
    await expect(page.locator('#game canvas')).toHaveAttribute('data-map-id', 'studio');
    await expect.poll(() => assets.size).toBe(2);
    // Held input may move again before the next patch; portal.test.ts checks exact server spawns.
    await page.waitForTimeout(550); // Respect the shared server interaction cooldown.
    await page.locator('#game canvas').focus();
    await page.keyboard.down('a');
    try { await expect.poll(() => observer.state.players.get(sessionId)!.mapId, { intervals: [10] }).toBe('workspace'); }
    finally { await page.keyboard.up('a'); }
    await expect(page.locator('#game canvas')).toHaveCount(1);
    await expect(page.locator('#game canvas')).toHaveAttribute('data-map-id', 'workspace');
    await expect(page.locator('#game canvas')).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    if (observer.connection.isOpen) await observer.leave();
  }
});
