import { test, expect, type Page } from '@playwright/test';
import { Client, type Room } from '@colyseus/sdk';
import { DEFAULT_APPEARANCE, type WebTool, type SpaceProtocol } from '@virtual-workspace/shared';
import type Phaser from 'phaser';
import type { SpaceScene } from '../src/SpaceScene';
import { avatars } from '../src/characters';

async function enter(page: Page, name: string, outfit = 'mint', prepare?: () => Promise<void>) {
  await page.goto('/');
  await expect(page.locator('#identity-status')).toHaveAttribute('data-ready', 'true');
  await prepare?.();
  await openAvatarScreen(page);
  await page.locator('#name').fill(name);
  if (outfit === 'amber') {
    await page.locator('[data-appearance-category="hair"]').click();
    await page.locator('#appearance-choices select').selectOption('hair2');
  } else if (outfit === 'violet') {
    await page.locator('[data-appearance-category="top"]').click();
    await page.locator('#appearance-choices select').selectOption('shirt');
  }
  await page.locator('#join').click();
  await expect(page.locator('#status')).toContainText('已进入空间');
  await expect(page.locator('#game canvas')).toBeVisible();
}

type RenderingWindow = Window & { sceneUnderTest?: SpaceScene };

async function captureRenderedScene(page: Page) {
  // Observe the real scene without adding a production debug API.
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
}

test('character atlas uses configured camera zoom and seat anchors have no default furniture', async ({ page }, testInfo) => {
  const seatVisualRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/objects/seat.svg') seatVisualRequests.push(request.url());
  });
  await enter(page, 'E2ERender', 'mint', () => captureRenderedScene(page));
  const sessionId = (await page.locator('#status').textContent())!.split(' · ').at(-1)!;
  const renderState = () => page.evaluate(id => {
    const scene = (window as RenderingWindow).sceneUnderTest;
    if (!scene) return;
    const sprite = scene.children.getByName(id) as Phaser.GameObjects.Sprite | null;
    if (!sprite) return;
    const zoom = scene.cameras.main.zoom;
    const bounds = sprite.getBounds();
    const frame = sprite.frame;
    const source = sprite.texture.getSourceImage();
    if (!(source instanceof HTMLImageElement || source instanceof HTMLCanvasElement)) return;
    const canvas = document.createElement('canvas');
    canvas.width = frame.cutWidth; canvas.height = frame.cutHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(source, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight,
      0, 0, frame.cutWidth, frame.cutHeight);
    const pixels = context.getImageData(0, 0, frame.cutWidth, frame.cutHeight).data;
    let visibleBottom = 0;
    for (let y = 0; y < frame.cutHeight; y++) for (let x = 0; x < frame.cutWidth; x++) {
      if (pixels[(y * frame.cutWidth + x) * 4 + 3]) visibleBottom = y + 1;
    }
    return {
      zoom, frame: Number(sprite.frame.name),
      objectImages: scene.children.list.filter(child => child.type === 'Image').length,
      origin: [sprite.originX, sprite.originY],
      groundAnchor: [sprite.displayOriginX, sprite.displayOriginY],
      worldSize: [sprite.displayWidth, sprite.displayHeight],
      screenSize: [sprite.displayWidth * zoom, sprite.displayHeight * zoom],
      visibleFootOffset: bounds.top + visibleBottom - sprite.y,
      frames: Array.from({ length: 16 }, (_, index) => {
        const frame = sprite.texture.get(index);
        return [frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight];
      }),
    };
  }, sessionId);
  await expect.poll(async () => (await renderState())?.frame).toBe(0);
  const initial = (await renderState())!;
  const avatar = avatars.mint;
  const cameraZoom = Number(process.env.VITE_CAMERA_ZOOM ?? 2);
  expect(initial.zoom).toBe(cameraZoom);
  expect(initial.objectImages).toBe(0);
  expect(seatVisualRequests).toEqual([]);
  expect(initial.origin).toEqual([avatar.groundAnchor.x / avatar.frameWidth, avatar.groundAnchor.y / avatar.frameHeight]);
  expect(initial.groundAnchor).toEqual([avatar.groundAnchor.x, avatar.groundAnchor.y]);
  expect(initial.worldSize).toEqual([avatar.frameWidth, avatar.frameHeight]);
  expect(initial.screenSize).toEqual([avatar.frameWidth * cameraZoom, avatar.frameHeight * cameraZoom]);
  // The current idle art's visible feet, rather than its transparent frame edge, meet the ground.
  expect(initial.visibleFootOffset).toBeCloseTo(0);
  expect(initial.frames).toEqual(Array.from({ length: 16 }, (_, index) => [index % 4 * avatar.frameWidth,
    Math.floor(index / 4) * avatar.frameHeight, avatar.frameWidth, avatar.frameHeight]));
  await page.locator('#game canvas').focus();
  await page.keyboard.down('d');
  try {
    await expect.poll(async () => (await renderState())?.frame, { intervals: [10] }).toBe(8);
    await expect.poll(async () => (await renderState())?.frame, { intervals: [10] }).toBe(9);
  } finally { await page.keyboard.up('d'); }
  await expect.poll(async () => (await renderState())?.frame).toBe(8);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await renderState())?.screenSize).toEqual([avatar.frameWidth * cameraZoom, avatar.frameHeight * cameraZoom]);
  await page.screenshot({ path: testInfo.outputPath('character-zoom-mobile.png'), fullPage: true });
  await page.locator('#leave').click();
});

test('in-place static and animated sit use distinct action columns and movement cancels them', async ({ page }) => {
  // Synthetic test pixels exercise all eight rows while the supplied artwork is walk-only.
  const sheet = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 192;
    const context = canvas.getContext('2d')!;
    for (let row = 0; row < 8; row++) for (let column = 0; column < 4; column++) {
      context.fillStyle = `hsl(${row * 40 + column * 10}, 70%, 65%)`;
      context.fillRect(column * 16 + 2, row * 24 + 1, 12, 22);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.route('**/characters/walk.png', route => route.fulfill({
    contentType: 'image/png', body: Buffer.from(sheet, 'base64'),
  }));
  await enter(page, 'E2EActions', 'mint', () => captureRenderedScene(page));
  const sessionId = (await page.locator('#status').textContent())!.split(' · ').at(-1)!;
  const observer = await observe();
  const player = () => observer.state.players.get(sessionId)!;
  const frame = () => page.evaluate(id => {
    const scene = (window as RenderingWindow).sceneUnderTest;
    const sprite = scene?.children.getByName(id) as Phaser.GameObjects.Sprite | undefined;
    return sprite && Number(sprite.frame.name);
  }, sessionId);
  try {
    await expect.poll(() => player()?.name).toBe('E2EActions');
    const position = { x: player().x, y: player().y };
    await page.locator('#action-list [data-action="sit"]').click();
    await expect.poll(() => player().action).toBe('sit');
    expect(player().actionAnimated).toBe(false);
    expect(player().actionTargetId).toBe('');
    expect(player().motion).toBe('idle');
    expect({ x: player().x, y: player().y }).toEqual(position);
    await expect.poll(frame).toBe(16);
    await page.waitForTimeout(550); // A static pose stays fixed beyond a full animation cycle and the request cooldown.
    expect(await frame()).toBe(16);
    await page.locator('#action-animated').check();
    await page.keyboard.down('e');
    try { await expect.poll(() => player().actionAnimated).toBe(true); }
    finally { await page.keyboard.up('e'); }
    await expect.poll(frame, { intervals: [10] }).toBe(17);
    const frames = new Set<number>();
    await expect.poll(async () => {
      const value = await frame();
      if (value !== undefined) frames.add(value);
      return frames.has(17) && frames.has(18) && frames.has(19);
    }, { intervals: [10] }).toBe(true);
    expect([...frames].every(value => value >= 17 && value <= 19)).toBe(true);
    expect({ x: player().x, y: player().y }).toEqual(position);
    await page.locator('#game canvas').focus();
    await page.keyboard.down('d');
    try {
      await expect.poll(() => player().action).toBe('none');
      expect(player().actionAnimated).toBe(false);
      expect(player().actionTargetId).toBe('');
      await expect.poll(() => player().motion).toBe('walk');
    } finally { await page.keyboard.up('d'); }
    await expect.poll(() => player().motion).toBe('idle');
    await expect.poll(frame).toBe(8);
    await page.locator('#leave').click();
  } finally { if (observer.connection.isOpen) await observer.leave(); }
});

async function openAvatarScreen(page: Page) {
  if (await page.locator('#login-screen').isVisible()) {
    await page.locator('#start').click();
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
  const room = await new Client(endpoint, { headers: { Cookie: cookie } }).joinOrCreate<SpaceProtocol>('space',
    { name: 'E2EObserver', avatar: 'mint', appearance: DEFAULT_APPEARANCE });
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
  await expect(page.locator('#tool-hint')).toBeVisible();
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
      await expect(page.locator('#tool-open')).toHaveText('打开网页工具 ↗');
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
      try { await expect(page.locator('#tool-hint')).toBeHidden(); }
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
      await expect(page.locator('#tool-hint')).toBeHidden();
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
  const button = page.locator('#action-list [data-action="sit"]');
  const canvas = page.locator('#game canvas');
  const sessionId = (await page.locator('#status').textContent())!.split(' · ').at(-1)!;
  const player = () => observer.state.players.get(sessionId)!;
  const seat = () => observer.state.worldObjects.get(player().mapId)?.objects.get('lobby-seat-1');
  try {
    await expect.poll(() => player()?.name).toBe('E2ESeat');
    await expect(button).toBeEnabled();
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
    expect(player().actionAnimated).toBe(false);
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
      expect(player().actionAnimated).toBe(false);
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
  await enter(page, 'E2EAlice', 'amber', () => captureRenderedScene(page));
  await enter(bob, 'E2EBob', 'violet');
  const observer = await observe();
  try {
    await expect.poll(() => [...observer.state.players.values()].some(player => player.name === 'E2EAlice' &&
      JSON.parse(player.appearance).hair.assetId === 'hair2')).toBe(true);
    await expect.poll(() => [...observer.state.players.values()].some(player => player.name === 'E2EBob' &&
      JSON.parse(player.appearance).top.assetId === 'shirt')).toBe(true);
    await page.locator('#message').fill('<b>你好</b>');
    await page.locator('#send').click();
    await expect(bob.locator('#messages')).toContainText('E2EAlice：<b>你好</b>');
    await expect(bob.locator('#messages b')).toHaveCount(0);
    await expect(page.locator('#message')).toHaveValue('');
    await bob.locator('#message').fill('收到');
    await bob.locator('#send').click();
    await expect(page.locator('#messages')).toContainText('E2EBob：收到');
    // Speech bubbles render above the speaker as plain Phaser text.
    await expect.poll(() => page.evaluate(() => (window as RenderingWindow).sceneUnderTest?.children.list
      .some(child => child instanceof Object && 'text' in child && child.text === '收到'))).toBe(true);
    await page.locator('#chat-toggle').click();
    await expect(page.locator('#chat-body')).toBeHidden();
    await expect(page.locator('#chat-toggle')).toHaveAttribute('aria-expanded', 'false');
    await bob.waitForTimeout(550); // Server chat cooldown.
    await bob.locator('#message').fill('折叠时');
    await bob.locator('#send').click();
    await expect(page.locator('#chat-unread')).toHaveText('1');
    await page.locator('#chat-toggle').click();
    await expect(page.locator('#chat-body')).toBeVisible();
    await expect(page.locator('#chat-unread')).toBeHidden();
    await expect(page.locator('#messages')).toContainText('E2EBob：折叠时');
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
    await expect.poll(async () => (await target.evaluate(async () =>
      (await (await fetch('/api/me')).json()).appearance.top.assetId)) as string).toBe('shirt');
    await joinSavedProfile(target);
    await walkTo(target, observer, 'E2EBound', 'board');
    await target.locator('#board-notes li').filter({ hasText: note }).getByRole('button').click();
    await expect(target.locator('#feature-status')).toContainText('留言已删除');
  } finally { if (observer.connection.isOpen) await observer.leave(); await target.close(); }
});


test('embed presentation uses a sandboxed container and clears it when leaving', async ({ page, context }) => {
  const target = toolCases[1];
  await page.route('**/api/tools', route => route.fulfill({ json: [{ ...toolDirectory[1], mode: 'embed' }] }));
  await context.route('https://tools.example/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>Embedded tool fixture</p>' }));
  await enter(page, 'E2EPresentation');
  const observer = await observe();
  try {
    await walkToTool(page, observer, target);
    const frame = page.locator('#tool-window iframe');
    await expect(frame).toHaveCount(0);
    await page.locator('#tool-open').click();
    await expect(frame).toBeVisible();
    await expect(page.locator('#tool-open')).toBeHidden();
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-popups');
    await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(page.frameLocator('#tool-window iframe').getByText('Embedded tool fixture')).toBeVisible();
    // The TV frame opens centered and can be dragged by its title bar.
    const windowBox = async () => (await page.locator('#tool-window').boundingBox())!;
    const viewport = page.viewportSize()!;
    const opened = await windowBox();
    expect(Math.abs(opened.x + opened.width / 2 - viewport.width / 2)).toBeLessThan(2);
    const bar = (await page.locator('#tool-heading').boundingBox())!;
    await page.mouse.move(bar.x + 10, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + 70, bar.y + bar.height / 2 + 40, { steps: 4 });
    await page.mouse.up();
    const moved = await windowBox();
    expect(moved.x - opened.x).toBeCloseTo(60, 0);
    expect(moved.y - opened.y).toBeCloseTo(40, 0);
    await page.locator('#tool-close').click();
    await expect(frame).toHaveCount(0);
    await expect(page.locator('#tool-window')).toBeHidden();
    await expect(page.locator('#tool-open')).toBeVisible();
    await page.locator('#tool-open').click();
    await expect(frame).toBeVisible();
    await page.locator('#leave').click();
    await expect(frame).toHaveCount(0);
  } finally { if (observer.connection.isOpen) await observer.leave(); }
});


test('embed presentation provides a manual external link and clears both on zone exit', async ({ page, context }) => {
  await page.route('**/api/tools', route => route.fulfill({ json: [{ ...toolDirectory[1], mode: 'embed', manualExternalOpen: true }] }));
  await context.route('https://tools.example/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>Web tool fallback fixture</p>' }));
  await enter(page, 'E2EWebFallback');
  const observer = await observe();
  try {
    await walkToTool(page, observer, toolCases[1]);
    await expect(page.locator('#tool-window iframe')).toHaveCount(0);
    await page.locator('#tool-open').click();
    const fallback = page.locator('#tool-window').getByRole('link', { name: '手动在新标签页打开', exact: true });
    await expect(fallback).toHaveAttribute('href', toolDirectory[1].url);
    await expect(page.locator('#tool-window iframe')).toBeVisible();
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
    try { await expect(page.locator('#tool-hint')).toBeHidden(); }
    finally { await page.keyboard.up('d'); }
    await expect(page.locator('#tool-window')).toBeHidden();
    await expect(page.locator('#tool-window iframe')).toHaveCount(0);
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
