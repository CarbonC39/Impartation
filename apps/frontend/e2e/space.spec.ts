import { test, expect, type Page, type Route } from '@playwright/test';
import { Client, type Room } from '@colyseus/sdk';
import { DEFAULT_APPEARANCE, worldRegistryResponseSchema, type WebTool, type SpaceProtocol } from '@virtual-workspace/shared';
import type Phaser from 'phaser';
import type { SpaceScene } from '../src/SpaceScene';
import { avatars } from '../src/characters';

const E2E_PASSWORD = 'e2e-workspace-password';
let accountSequence = 0;
function nextUsername() { return `e2e${Date.now().toString(36)}${(++accountSequence).toString(36)}`; }
type TestAccount = { username: string; password: string; id: string };

async function createTestAccount(page: Page, displayName: string): Promise<TestAccount> {
  const username = nextUsername();
  const response = await page.request.post(new URL('/api/register', test.info().project.use.baseURL!).toString(), {
    headers: { Origin: test.info().project.use.baseURL! },
    data: { username, password: E2E_PASSWORD, displayName },
  });
  expect(response.status()).toBe(200);
  const profile = await response.json() as { id: string };
  return { username, password: E2E_PASSWORD, id: profile.id };
}

async function signInFresh(page: Page, displayName: string): Promise<TestAccount> {
  const account = await createTestAccount(page, displayName);
  await page.goto('/');
  await expect(page.locator('#account-status')).toContainText(`@${account.username}`);
  return account;
}

async function enter(page: Page, name: string, outfit = 'mint', prepare?: () => Promise<void>): Promise<TestAccount> {
  const account = await signInFresh(page, name);
  await prepare?.();
  await openAvatarScreen(page);
  await page.locator('#name').fill(name);
  if (outfit === 'amber') {
    await page.locator('[data-appearance-category="hair"]').click();
    await page.locator('#appearance-choices [data-appearance-item="hair2"]').click();
  } else if (outfit === 'violet') {
    await page.locator('[data-appearance-category="top"]').click();
    await page.locator('#appearance-choices [data-appearance-item="shirt"]').click();
  }
  await page.locator('#join').click();
  await page.locator('#prejoin-enter').click();
  await expect(page.locator('#status')).toContainText('已进入空间');
  await expect(page.locator('#game canvas')).toBeVisible();
  return account;
}

test('registration and sign-in create a session and clear credential fields after success', async ({ page }) => {
  await page.goto('/');
  const username = nextUsername();
  const password = E2E_PASSWORD;
  await page.locator('#show-register').click();
  await page.locator('#register-form [name="username"]').fill(username);
  await page.locator('#register-form [name="displayName"]').fill('同名显示');
  await page.locator('#register-form [name="password"]').fill(password);
  await page.locator('#register-form [name="confirmPassword"]').fill(password);
  await page.locator('#register-form button[type="submit"]').click();
  await expect(page.locator('#account-status')).toContainText(`@${username}`);
  await expect(page.locator('#register-form [name="password"]')).toHaveValue('');
  await page.locator('#sign-out').click();
  await expect(page.locator('#account-status')).toHaveText('请登录或注册账号后进入空间。');
  await expect(page.locator('#welcome-name')).toHaveText('小访客');
  await page.locator('#sign-in-form [name="username"]').fill(username);
  await page.locator('#sign-in-form [name="password"]').fill(password);
  await page.locator('#sign-in-form button[type="submit"]').click();
  await expect(page.locator('#account-status')).toContainText(`@${username}`);
  await expect(page.locator('#sign-in-form [name="password"]')).toHaveValue('');
});

test('choosing a world refreshes remote appearance while preserving only edited wardrobe layers', async ({ page, browser }) => {
  const account = await signInFresh(page, 'E2EAppearanceSync');
  const secondDevice = await browser.newPage();
  try {
    await secondDevice.goto('/');
    await secondDevice.locator('#sign-in-form [name="username"]').fill(account.username);
    await secondDevice.locator('#sign-in-form [name="password"]').fill(account.password);
    await secondDevice.locator('#sign-in-form button[type="submit"]').click();
    await expect(secondDevice.locator('#account-status')).toContainText(`@${account.username}`);

    const remoteAppearance = structuredClone(DEFAULT_APPEARANCE);
    remoteAppearance.top.assetId = 'shirt';
    const updated = await secondDevice.request.patch(new URL('/api/me', test.info().project.use.baseURL!).toString(), {
      data: { name: 'E2EAppearanceSync', avatar: 'mint', appearance: remoteAppearance },
    });
    expect(updated.status()).toBe(200);
    await page.locator('#world-list [data-world="main"]').click();
    await expect(page.locator('#avatar-screen')).toBeVisible();
    await page.locator('[data-appearance-category="top"]').click();
    await expect(page.locator('#appearance-choices [data-appearance-item="shirt"]')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('[data-appearance-category="hair"]').click();
    await page.locator('#appearance-choices [data-appearance-item="hair2"]').click();
    await page.locator('#avatar-screen [data-back="login-screen"]').click();
    const latestAppearance = structuredClone(DEFAULT_APPEARANCE);
    latestAppearance.top.assetId = 'suit';
    latestAppearance.hair.assetId = 'hair3';
    const latestUpdate = await secondDevice.request.patch(new URL('/api/me', test.info().project.use.baseURL!).toString(), {
      data: { name: 'E2EAppearanceSync', avatar: 'mint', appearance: latestAppearance },
    });
    expect(latestUpdate.status()).toBe(200);

    await page.locator('#world-list [data-world="main"]').click();
    await expect(page.locator('#avatar-screen')).toBeVisible();
    await page.locator('[data-appearance-category="hair"]').click();
    await expect(page.locator('#appearance-choices [data-appearance-item="hair2"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-appearance-category="top"]').click();
    await expect(page.locator('#appearance-choices [data-appearance-item="suit"]')).toHaveAttribute('aria-pressed', 'true');
  } finally { await secondDevice.close(); }
});

test('a second tab switching the shared session cannot receive another account tab draft', async ({ page }) => {
  const first = await signInFresh(page, 'E2EFirstTab');
  await openAvatarScreen(page);
  await page.locator('[data-appearance-category="hair"]').click();
  await page.locator('#appearance-choices [data-appearance-item="hair2"]').click();
  await page.locator('#avatar-screen [data-back="login-screen"]').click();

  const second = await page.context().newPage();
  try {
    const username = nextUsername();
    const response = await second.request.post(new URL('/api/register', test.info().project.use.baseURL!).toString(), {
      headers: { Origin: test.info().project.use.baseURL! },
      data: { username, password: E2E_PASSWORD, displayName: 'E2ESecondTab' },
    });
    expect(response.status()).toBe(200);
    await expect.poll(async () => (await page.request.get(new URL('/api/me', test.info().project.use.baseURL!).toString())).status()).toBe(200);
    await page.locator('#world-list [data-world="main"]').click();
    await expect(page.locator('#avatar-screen')).toBeVisible();
    await expect(page.locator('#name')).toHaveValue('E2ESecondTab');
    await page.locator('[data-appearance-category="hair"]').click();
    await expect(page.locator(`#appearance-choices [data-appearance-item="${DEFAULT_APPEARANCE.hair.assetId}"]`)).toHaveAttribute('aria-pressed', 'true');
    const latest = await page.request.get(new URL('/api/me', test.info().project.use.baseURL!).toString());
    const profile = await latest.json() as { id: string; appearance: typeof DEFAULT_APPEARANCE; currentAppearance?: typeof DEFAULT_APPEARANCE };
    expect(profile.id).not.toBe(first.id);
    expect(profile.currentAppearance?.hair ?? profile.appearance.hair).toEqual(DEFAULT_APPEARANCE.hair);
  } finally { await second.close(); }
});

test('a display name edited in the wardrobe is saved when entering a world', async ({ page }) => {
  await signInFresh(page, 'E2EDisplayNameBefore');
  await openAvatarScreen(page);
  await page.locator('#name').fill('衣橱里改的名字');
  await page.locator('#join').click();
  await page.locator('#prejoin-enter').click();
  await expect(page.locator('#status')).toContainText('已进入空间');
  const response = await page.request.get(new URL('/api/me', test.info().project.use.baseURL!).toString());
  const profile = await response.json() as { displayName: string; name: string };
  expect(profile.displayName ?? profile.name).toBe('衣橱里改的名字');
});

test('voice requests microphone only after opt-in and clears controls on leave', async ({ page }) => {
  await page.addInitScript(() => {
    const typedWindow = window as Window & { voiceCaptureCalls?: number };
    typedWindow.voiceCaptureCalls = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      typedWindow.voiceCaptureCalls = (typedWindow.voiceCaptureCalls ?? 0) + 1;
      return new MediaStream();
    } });
  });
  await enter(page, 'VoiceBrowser');
  expect(await page.evaluate(() => (window as Window & { voiceCaptureCalls?: number }).voiceCaptureCalls)).toBe(0);
  await expect(page.locator('#voice-status')).toContainText('语音已关闭');
  await page.locator('#voice-mic').click();
  await expect(page.locator('#voice-status')).toContainText('语音已开启');
  await expect(page.locator('#voice-mic')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as Window & { voiceCaptureCalls?: number }).voiceCaptureCalls)).toBe(1);
  await page.locator('#voice-mic').click();
  await expect(page.locator('#voice-status')).toContainText('麦克风已关');
  await expect(page.locator('#voice-mic')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#voice-mic').click();
  await expect(page.locator('#voice-status')).not.toContainText('麦克风已关');
  expect(await page.evaluate(() => (window as Window & { voiceCaptureCalls?: number }).voiceCaptureCalls)).toBe(1);
  await page.locator('#settings-toggle').click();
  await page.locator('#voice-disconnect').click();
  await expect(page.locator('#voice-status')).toContainText('语音已关闭');
  await expect(page.locator('#voice-disconnect')).toBeHidden();
  await page.locator('#voice-mic').click();
  await expect(page.locator('#voice-status')).toContainText('语音已开启');
  await page.locator('#leave').click();
  await expect(page.locator('#voice-status')).toContainText('语音已关闭');
  await expect(page.locator('#voice-mic')).toBeDisabled();
});

test('voice shows microphone permission errors and stays disabled', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true,
      value: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); } });
  });
  await enter(page, 'VoiceDenied');
  await page.locator('#voice-mic').click();
  await expect(page.locator('#voice-status')).toContainText('语音错误：麦克风权限被拒绝');
  await expect(page.locator('#voice-mic')).toBeEnabled();
  await expect(page.locator('#voice-mic')).toHaveAttribute('aria-pressed', 'false');
});

test('voice reports missing WebRTC separately from microphone support', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'RTCPeerConnection', { configurable: true, value: undefined });
  });
  await enter(page, 'VoiceNoWebRTC');
  await page.locator('#voice-mic').click();
  await expect(page.locator('#voice-status')).toContainText('未提供 WebRTC（RTCPeerConnection）');
  await expect(page.locator('#voice-mic')).toHaveAttribute('aria-pressed', 'false');
});

test('two nearby opted-in browsers exchange WebRTC audio and stop on peer leave', async ({ page, browser }) => {
  test.setTimeout(90000);
  const bob = await browser.newPage();
  let aliceCredentialRequests = 0;
  let bobCredentialRequests = 0;
  const mockCredentials = (count: () => number) => async (route: Route) => {
    const requestCount = count();
    await route.fulfill({ json: { iceServers: [], expiresAt: Date.now() + (requestCount === 1 ? 250 : 60_000) } });
  };
  const countAlice = () => ++aliceCredentialRequests;
  const countBob = () => ++bobCredentialRequests;
  await page.route('**/api/voice-credentials', mockCredentials(countAlice));
  await bob.route('**/api/voice-credentials', mockCredentials(countBob));
  const microphone = () => {
    const typedWindow = window as Window & { voiceAudioContexts?: AudioContext[] };
    typedWindow.voiceAudioContexts = [];
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const context = new AudioContext();
      const destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator();
      oscillator.connect(destination);
      oscillator.start();
      typedWindow.voiceAudioContexts?.push(context);
      return destination.stream;
    } });
  };
  try {
    await page.addInitScript(microphone);
    await bob.addInitScript(microphone);
    await enter(page, 'VoicePeerA', 'mint', () => captureRenderedScene(page));
    await enter(bob, 'VoicePeerB');
    await page.locator('#voice-mic').click();
    await bob.locator('#voice-mic').click();
    await expect(page.locator('#voice-status')).toContainText('附近 1 人', { timeout: 10000 });
    await expect(bob.locator('#voice-status')).toContainText('附近 1 人', { timeout: 10000 });
    await expect.poll(() => page.locator('audio[data-voice-peer]').evaluateAll(elements =>
      elements.some(element => (element as HTMLAudioElement).srcObject instanceof MediaStream &&
        ((element as HTMLAudioElement).srcObject as MediaStream).getAudioTracks().length > 0)),
    { timeout: 10000 }).toBe(true);
    // Both test tones count as speech: this browser shows a mic over itself and over the remote peer.
    const visibleMics = () => visibleMicCount(page);
    await expect.poll(visibleMics, { timeout: 10000 }).toBe(2);
    await expect.poll(() => aliceCredentialRequests).toBeGreaterThanOrEqual(1);
    await expect.poll(() => bobCredentialRequests).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(300);
    await page.locator('#settings-toggle').click();
    await page.locator('#voice-disconnect').click();
    await bob.locator('#settings-toggle').click();
    await bob.locator('#voice-disconnect').click();
    await page.locator('#voice-mic').click();
    await bob.locator('#voice-mic').click();
    await expect(page.locator('#voice-status')).toContainText('附近 1 人', { timeout: 10000 });
    await expect(bob.locator('#voice-status')).toContainText('附近 1 人', { timeout: 10000 });
    expect(aliceCredentialRequests).toBeGreaterThanOrEqual(2);
    expect(bobCredentialRequests).toBeGreaterThanOrEqual(2);
    // The speaker button silences incoming voices without closing the connection.
    const peerAudioMuted = () => page.locator('audio[data-voice-peer]').evaluateAll(elements =>
      elements.every(element => (element as HTMLAudioElement).muted));
    await page.locator('#sound-toggle').click();
    await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#voice-status')).toContainText('声音已关');
    expect(await peerAudioMuted()).toBe(true);
    await page.locator('#sound-toggle').click();
    expect(await peerAudioMuted()).toBe(false);
    await bob.locator('#leave').click();
    await expect(page.locator('audio[data-voice-peer]')).toHaveCount(0, { timeout: 5000 });
    await expect.poll(visibleMics).toBe(1);
  } finally { await bob.close(); }
});

type RenderingWindow = Window & { sceneUnderTest?: SpaceScene };
type StatusView = { bubble: string; mic: boolean; typing: boolean };

/** Reads the canvas-drawn status (bubble text, mic, typing dots) above one character. */
function statusOf(page: Page, sessionId: string): Promise<StatusView | undefined> {
  return page.evaluate(id => {
    const group = (window as RenderingWindow).sceneUnderTest?.children.getByName(`status:${id}`) as Phaser.GameObjects.Container | null | undefined;
    if (!group) return undefined;
    const shown = (name: string) => group.visible && Boolean((group.getByName(name) as Phaser.GameObjects.Image | null)?.visible);
    const text = group.getByName('bubble-text') as Phaser.GameObjects.Text;
    return { bubble: shown('bubble-text') ? text.text : '', mic: shown('mic'), typing: shown('typing') };
  }, sessionId);
}
function visibleMicCount(page: Page): Promise<number> {
  return page.evaluate(() => ((window as RenderingWindow).sceneUnderTest?.children.list ?? [])
    .filter(child => child.name.startsWith('status:') && (child as Phaser.GameObjects.Container).visible &&
      Boolean(((child as Phaser.GameObjects.Container).getByName('mic') as Phaser.GameObjects.Image | null)?.visible)).length);
}
function sessionOf(page: Page) {
  return page.locator('#status').textContent().then(text => text!.split(' · ').at(-1)!);
}

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

test('pre-join check opens the microphone once, enters muted, and shows a mic over the speaking character', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    const typedWindow = window as Window & { voiceCaptureCalls?: number };
    typedWindow.voiceCaptureCalls = 0;
    // A steady tone stands in for speech, so the level meter crosses the speaking threshold.
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      typedWindow.voiceCaptureCalls = (typedWindow.voiceCaptureCalls ?? 0) + 1;
      const context = new AudioContext();
      const destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator();
      oscillator.connect(destination);
      oscillator.start();
      return destination.stream;
    } });
  });
  const captures = () => page.evaluate(() => (window as Window & { voiceCaptureCalls?: number }).voiceCaptureCalls);
  await signInFresh(page, 'VoicePrejoin');
  await captureRenderedScene(page);
  await openAvatarScreen(page);
  await page.locator('#name').fill('VoicePrejoin');
  await page.locator('#join').click();
  await expect(page.locator('#prejoin-dialog')).toBeVisible();
  expect(await captures()).toBe(0);
  await page.locator('#prejoin-mic').click();
  await expect(page.locator('#prejoin-mic-options')).toBeVisible();
  await expect(page.locator('#prejoin-status')).toContainText('对着麦克风说话');
  await expect(page.locator('#prejoin-device option')).not.toHaveCount(0);
  await page.locator('#prejoin-muted').check();
  await page.locator('#prejoin-enter').click();
  await expect(page.locator('#status')).toContainText('已进入空间');
  await expect(page.locator('#voice-status')).toContainText('语音已开启 · 麦克风已关');
  expect(await captures()).toBe(1);

  const ownId = await sessionOf(page);
  const micVisible = () => statusOf(page, ownId).then(status => status?.mic ?? false);
  expect(await micVisible()).toBe(false);
  await page.locator('#voice-mic').click();
  await expect(page.locator('#voice-status')).not.toContainText('麦克风已关');
  await expect.poll(micVisible).toBe(true);
  await page.locator('#voice-mic').click();
  await expect.poll(micVisible).toBe(false);
  await page.locator('#leave').click();
  await expect(page.locator('#voice-status')).toContainText('语音已关闭');
});

test('pre-join check without the microphone enters with voice off and can go back', async ({ page }) => {
  await signInFresh(page, 'VoicePrejoinCancel');
  await openAvatarScreen(page);
  await page.locator('#join').click();
  await expect(page.locator('#prejoin-mic')).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#prejoin-mic-options')).toBeHidden();
  await page.locator('#prejoin-cancel').click();
  await expect(page.locator('#prejoin-dialog')).toBeHidden();
  await expect(page.locator('#avatar-screen')).toBeVisible();
});

test('camera zoom defaults to map tiles and settings apply integer zoom', async ({ page }, testInfo) => {
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
      targetImages: scene.children.list.filter(child => child.type === 'Image' && (child as Phaser.GameObjects.Image).frame.name === 'world-variant-8').length,
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
  const cameraZoom = 3;
  expect(initial.zoom).toBe(cameraZoom);
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#camera-zoom-auto')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#camera-zoom')).toHaveValue('3');
  await expect(page.locator('#camera-zoom-value')).toHaveText('自动 · 3x');
  // Only the opaque selector target adds an image; action anchors remain invisible.
  expect(initial.objectImages).toBe(1);
  expect(initial.targetImages).toBe(1);
  expect(seatVisualRequests).toEqual([]);
  expect(initial.origin).toEqual([avatar.groundAnchor.x / avatar.frameWidth, avatar.groundAnchor.y / avatar.frameHeight]);
  expect(initial.groundAnchor).toEqual([avatar.groundAnchor.x, avatar.groundAnchor.y]);
  expect(initial.worldSize).toEqual([avatar.frameWidth, avatar.frameHeight]);
  expect(initial.screenSize).toEqual([avatar.frameWidth * cameraZoom, avatar.frameHeight * cameraZoom]);
  // The current idle art's visible feet, rather than its transparent frame edge, meet the ground.
  expect(initial.visibleFootOffset).toBeCloseTo(0);
  expect(initial.frames).toEqual(Array.from({ length: 16 }, (_, index) => [index % 4 * avatar.frameWidth,
    Math.floor(index / 4) * avatar.frameHeight, avatar.frameWidth, avatar.frameHeight]));
  await page.locator('#camera-zoom').fill('5');
  await expect(page.locator('#camera-zoom-auto')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await renderState())?.zoom).toBe(5);
  await expect.poll(async () => (await renderState())?.screenSize).toEqual([avatar.frameWidth * 5, avatar.frameHeight * 5]);
  await page.locator('#camera-zoom-auto').click();
  await expect.poll(async () => (await renderState())?.zoom).toBe(cameraZoom);
  await page.locator('#settings-toggle').click();
  await page.locator('#game canvas').focus();
  await page.keyboard.down('d');
  try {
    // Walking right starts on the first step column and cycles the step frames, not the idle one.
    await expect.poll(async () => (await renderState())?.frame, { intervals: [10] }).toBe(9);
    await expect.poll(async () => (await renderState())?.frame, { intervals: [10] }).toBe(10);
  } finally { await page.keyboard.up('d'); }
  await expect.poll(async () => (await renderState())?.frame).toBe(8);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await renderState())?.screenSize).toEqual([avatar.frameWidth * cameraZoom, avatar.frameHeight * cameraZoom]);
  await page.screenshot({ path: testInfo.outputPath('character-zoom-mobile.png'), fullPage: true });
  await page.locator('#leave').click();
});

test('map zoom choice persists across visits', async ({ page }) => {
  await enter(page, 'ZoomPreference');
  await page.locator('#settings-toggle').click();
  await page.locator('#camera-zoom').fill('6');
  await page.reload();
  await expect(page.locator('#camera-zoom')).toHaveValue('6');
  await expect(page.locator('#account-status')).toContainText('@');
  await captureRenderedScene(page);
  await joinSavedProfile(page);
  await expect(page.locator('#status')).toContainText('已进入空间', { timeout: 7_000 });
  await expect.poll(() => page.evaluate(() => (window as RenderingWindow).sceneUnderTest?.cameras.main.zoom)).toBe(6);
});

test('pagehide releases the current room and bfcache restore allows rejoining', async ({ page }) => {
  await enter(page, 'PagehideRejoin');
  const sessionId = await sessionOf(page);
  const observer = await observe();
  try {
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await expect(page.locator('#game canvas')).toHaveCount(0);
    await expect.poll(() => observer.state.players.has(sessionId)).toBe(false);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(page.locator('#avatar-screen')).toBeVisible();
    await joinSavedProfile(page);
    const rejoinedSessionId = await sessionOf(page);
    expect(rejoinedSessionId).not.toBe(sessionId);
    await expect.poll(() => observer.state.players.has(rejoinedSessionId)).toBe(true);
  } finally { if (observer.connection.isOpen) await observer.leave(); }
});

test('a room that resolves after pagehide is released instead of replacing the restored page', async ({ page }) => {
  await signInFresh(page, 'PendingJoinPagehide');
  await openAvatarScreen(page);
  let releaseMatchmake!: () => void;
  let signalMatchmake!: () => void;
  let signalSocketClose!: () => void;
  const held = new Promise<void>(resolve => { releaseMatchmake = resolve; });
  const requested = new Promise<void>(resolve => { signalMatchmake = resolve; });
  const socketClosed = new Promise<void>(resolve => { signalSocketClose = resolve; });
  const matchmakeRoute = '**/matchmake/joinOrCreate/space';
  page.on('websocket', socket => { socket.on('close', signalSocketClose); });
  await page.route(matchmakeRoute, async route => {
    signalMatchmake();
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  try {
    await page.locator('#join').click();
    await page.locator('#prejoin-enter').click();
    await requested;
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect(page.locator('#avatar-screen')).toBeVisible();
    releaseMatchmake();
    await socketClosed;
    await expect(page.locator('#game canvas')).toHaveCount(0);
    await expect(page.locator('#avatar-screen')).toBeVisible();
    await joinSavedProfile(page);
    await page.unroute(matchmakeRoute);
  } finally {
    releaseMatchmake();
    if (!page.isClosed()) await page.unroute(matchmakeRoute);
  }
});

test('closing the queue dialog cancels its ticket and returns to Space selection', async ({ page }) => {
  await signInFresh(page, 'QueueCancel');
  await openAvatarScreen(page);
  const ticket = '11111111-1111-4111-8111-111111111111';
  let cancelled = 0;
  let matchmade = false;
  await page.route('**/api/space-queue', route => route.fulfill({ json: { ticket, ahead: 2, ready: false } }));
  await page.route(`**/api/space-queue/main/${ticket}`, route => {
    if (route.request().method() === 'DELETE') { cancelled++; return route.fulfill({ status: 204 }); }
    return route.fulfill({ json: { ticket, ahead: 2, ready: false } });
  });
  await page.route('**/matchmake/joinOrCreate/space', route => { matchmade = true; return route.continue(); });
  await page.locator('#join').click();
  await page.locator('#prejoin-enter').click();
  await expect(page.locator('#space-queue-panel')).toBeVisible();
  await expect(page.locator('#space-queue-panel')).toHaveAttribute('open', '');
  await expect(page.locator('#space-queue-status')).toHaveText('前面还有 2 人');
  await page.locator('#space-queue-cancel').click();
  await expect(page.locator('#space-queue-panel')).toBeHidden();
  await expect(page.locator('#login-screen')).toBeVisible();
  await expect(page.locator('#world-list')).toBeVisible();
  await expect.poll(() => cancelled).toBe(1);
  await openAvatarScreen(page);
  await page.locator('#join').click();
  await page.locator('#prejoin-enter').click();
  await expect(page.locator('#space-queue-panel')).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('#login-screen')).toBeVisible();
  await expect.poll(() => cancelled).toBe(2);
  expect(matchmade).toBe(false);
});

test('chat alerts cover hidden tabs and unfocused windows but skip focused windows and own messages', async ({ page, browser }) => {
  await page.addInitScript(() => {
    const state = { hidden: false, focused: true, requests: 0, sounds: 0, messages: [] as string[] };
    Object.defineProperty(window, '__chatAlertTest', { value: state });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => state.hidden });
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => state.focused });
    Object.defineProperty(window, 'Notification', { configurable: true, value: class {
      static permission = 'default';
      static requestPermission() { state.requests++; this.permission = 'granted'; return Promise.resolve('granted'); }
      constructor(_title: string, options?: { body?: string }) { state.messages.push(options?.body ?? ''); }
    } });
  });
  await enter(page, 'AlertReceiver');
  await page.evaluate(() => {
    const state = (window as unknown as { __chatAlertTest: { sounds: number } }).__chatAlertTest;
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: class {
      state = 'running'; currentTime = 0; destination = {};
      resume() { return Promise.resolve(); }
      createOscillator() { return { type: 'sine', frequency: { value: 0 }, connect() {}, start() { state.sounds++; }, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    } });
  });
  const sender = await browser.newPage();
  try {
    await enter(sender, 'AlertSender');
    await page.locator('#settings-toggle').click();
    await page.locator('#chat-notification-switch').click();
    await expect(page.locator('#chat-notification-switch')).toHaveAttribute('aria-checked', 'true');
    await page.locator('#chat-sound-alert-switch').click();
    await expect(page.locator('#chat-sound-alert-switch')).toHaveAttribute('aria-checked', 'true');
    await page.evaluate(() => { (window as unknown as { __chatAlertTest: { hidden: boolean } }).__chatAlertTest.hidden = true; });
    await sender.locator('#message').fill('后台新消息');
    await sender.locator('#send').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __chatAlertTest: { messages: string[] } }).__chatAlertTest.messages)).toEqual(['后台新消息']);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __chatAlertTest: { sounds: number } }).__chatAlertTest.sounds)).toBe(1);
    await page.locator('#message').fill('自己的消息');
    await page.locator('#send').click();
    await expect(page.locator('#messages')).toContainText('自己的消息');
    await page.evaluate(() => {
      const state = (window as unknown as { __chatAlertTest: { hidden: boolean; focused: boolean } }).__chatAlertTest;
      state.hidden = false; state.focused = false;
    });
    await sender.waitForTimeout(550);
    await sender.locator('#message').fill('失焦新消息');
    await sender.locator('#send').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __chatAlertTest: { messages: string[] } }).__chatAlertTest.messages)).toEqual(['后台新消息', '失焦新消息']);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __chatAlertTest: { sounds: number } }).__chatAlertTest.sounds)).toBe(2);
    await page.evaluate(() => { (window as unknown as { __chatAlertTest: { focused: boolean } }).__chatAlertTest.focused = true; });
    await sender.waitForTimeout(550);
    await sender.locator('#message').fill('前台新消息');
    await sender.locator('#send').click();
    await expect(page.locator('#messages')).toContainText('前台新消息');
    expect(await page.evaluate(() => (window as unknown as { __chatAlertTest: { requests: number; sounds: number; messages: string[] } }).__chatAlertTest)).toMatchObject({ requests: 1, sounds: 2, messages: ['后台新消息', '失焦新消息'] });
  } finally { await sender.close(); }
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
  await page.route('**/characters/body/walk.png', route => route.fulfill({
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
    await page.locator('#world-list [data-world="main"]').click();
  }
  await expect(page.locator('#avatar-screen')).toBeVisible();
}

async function joinSavedProfile(page: Page) {
  await openAvatarScreen(page);
  await page.locator('#join').click();
  await page.locator('#prejoin-enter').click();
  await expect(page.locator('#status')).toContainText('已进入空间');
  await expect(page.locator('#game canvas')).toBeVisible();
}
async function observe(spaceId = 'main'): Promise<Room<SpaceProtocol>> {
  const endpoint = test.info().project.use.baseURL!;
  const username = nextUsername();
  const response = await fetch(endpoint + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: endpoint },
    body: JSON.stringify({ username, password: E2E_PASSWORD, displayName: 'E2EObserver' }) });
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const room = await new Client(endpoint, { headers: { Cookie: cookie } }).joinOrCreate<SpaceProtocol>('space',
    { name: 'E2EObserver', avatar: 'mint', appearance: DEFAULT_APPEARANCE, spaceId });
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
    await expect(page.locator('#account-status')).toContainText('@');
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
    return url.pathname === '/characters/body/walk.png' && response.ok();
  });
  await enter(page, 'E2ESeat');
  await spriteResponse;
  const observer = await observe();
  const button = page.locator('#action-list [data-action="sit"]');
  const canvas = page.locator('#game canvas');
  const sessionId = (await page.locator('#status').textContent())!.split(' · ').at(-1)!;
  const player = () => observer.state.players.get(sessionId)!;
  const seat = () => observer.state.worldObjects.get(player().mapId)?.objects.get('lobby-seat-1');
  const vertical = async (key: string, arrived: () => boolean) => {
    await canvas.focus(); await page.keyboard.down(key);
    try { await expect.poll(arrived, { intervals: [10] }).toBe(true); }
    finally { await page.keyboard.up(key); }
    await expect.poll(() => player().motion).toBe('idle');
  };
  const faceSeat = async () => {
    await vertical('s', () => player().y >= 408);
    await vertical('w', () => player().y < 400);
    await expect(button).toHaveText('坐下');
  };
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
    await vertical('s', () => player().y >= 392);
    await expect(button).toHaveText('坐下');
    const before = { x: player().x, y: player().y, facing: player().facing };
    await button.click();
    await expect(page.locator('#object-feedback')).toContainText('已原地坐下');
    expect({ x: player().x, y: player().y, facing: player().facing }).toEqual(before);
    await expect.poll(() => player().action).toBe('sit'); expect(player().actionTargetId).toBe('');
    expect(seat()?.occupiedBy).toBe('');
    await page.waitForTimeout(550);
    await faceSeat();
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
    await faceSeat();
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
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const bob = await browser.newPage();
  bob.on('pageerror', error => errors.push(error.message));
  await enter(page, 'E2EAlice', 'amber', () => captureRenderedScene(page));
  await enter(bob, 'E2EBob', 'violet', () => captureRenderedScene(bob));
  const observer = await observe();
  try {
    await expect.poll(() => [...observer.state.players.values()].some(player => player.name === 'E2EAlice' &&
      JSON.parse(player.appearance).hair.assetId === 'hair2')).toBe(true);
    await expect.poll(() => [...observer.state.players.values()].some(player => player.name === 'E2EBob' &&
      JSON.parse(player.appearance).top.assetId === 'shirt')).toBe(true);
    // Typing shows three dots over Alice for Bob, and sending clears them.
    const aliceId = await sessionOf(page);
    const bobId = await sessionOf(bob);
    const aliceTyping = () => statusOf(bob, aliceId).then(status => status?.typing ?? false);
    await page.locator('#message').pressSequentially('<b>你好</b>');
    await expect.poll(aliceTyping).toBe(true);
    // Nobody sees their own typing dots.
    expect((await statusOf(page, aliceId))?.typing).toBe(false);
    await page.locator('#send').click();
    await expect(bob.locator('#messages')).toContainText('E2EAlice：<b>你好</b>');
    await expect.poll(aliceTyping).toBe(false);
    await expect(bob.locator('#messages b')).toHaveCount(0);
    await expect(page.locator('#message')).toHaveValue('');
    await bob.locator('#message').fill('收到');
    await bob.locator('#send').click();
    await expect(page.locator('#messages')).toContainText('E2EBob：收到');
    // Speech bubbles render above the speaker as plain canvas text.
    await expect.poll(() => statusOf(page, bobId).then(status => status?.bubble)).toBe('收到');
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

    // Turning off "let others see I'm typing" stops sending the hint.
    await page.locator('#settings-toggle').click();
    await page.locator('#typing-switch').click();
    await expect(page.locator('#typing-switch')).toHaveAttribute('aria-checked', 'false');
    await page.locator('#message').pressSequentially('悄悄打字');
    await bob.waitForTimeout(800);
    expect(await aliceTyping()).toBe(false);
    expect(errors).toEqual([]);
  } finally { if (observer.connection.isOpen) await observer.leave(); await bob.close(); }
});

test('keyboard moves the player; chat takes every key until Enter, Esc or Tab returns to the map', async ({ page }) => {
  test.setTimeout(45000);
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
    await expect(page.locator('#message')).toHaveValue('d');

    // Inside chat every key edits text: arrow keys move the caret and never walk.
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(350);
    await page.keyboard.up('ArrowLeft');
    expect(player.x).toBe(stopped);
    expect(await page.locator('#message').evaluate(input => (input as HTMLInputElement).selectionStart)).toBe(0);

    // Esc hands the keyboard back to the map and keeps the draft.
    await page.keyboard.press('Escape');
    await expect(page.locator('#message')).not.toBeFocused();
    await expect(page.locator('#message')).toHaveValue('d');
    const resumed = player.x;
    await page.keyboard.down('d');
    await expect.poll(() => player.x).toBeGreaterThan(resumed);
    await page.keyboard.up('d');

    // Enter opens chat; Enter sends and returns straight to walking.
    await page.keyboard.press('Enter');
    await expect(page.locator('#message')).toBeFocused();
    await page.locator('#message').fill('发完继续走');
    await page.waitForTimeout(550); // Server chat cooldown.
    await page.keyboard.press('Enter');
    await expect(page.locator('#messages')).toContainText('发完继续走');
    await expect(page.locator('#message')).not.toBeFocused();
    const afterSend = player.x;
    await page.keyboard.down('d');
    await expect.poll(() => player.x).toBeGreaterThan(afterSend);
    await page.keyboard.up('d');

    // Tab also leaves the chat instead of moving focus to the send button.
    await page.keyboard.press('Enter');
    await expect(page.locator('#message')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#game canvas')).toBeFocused();
  } finally { if (observer.connection.isOpen) await observer.leave(); }
});

test('chat box drags by its heading, resizes from its corner, and keeps the layout', async ({ page }) => {
  test.setTimeout(30000);
  await enter(page, 'E2EChatLayout');
  const card = page.locator('#chat-card');
  const before = (await card.boundingBox())!;
  await page.mouse.move(before.x + 30, before.y + 14);
  await page.mouse.down();
  await page.mouse.move(before.x + 230, before.y + 14 - 100, { steps: 5 });
  await page.mouse.up();
  const moved = (await card.boundingBox())!;
  expect(Math.round(moved.x - before.x)).toBe(200);
  expect(Math.round(moved.y - before.y)).toBe(-100);

  const grip = (await page.locator('#chat-resize').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 80, grip.y + grip.height / 2 - 60, { steps: 5 });
  await page.mouse.up();
  const resized = (await card.boundingBox())!;
  expect(Math.round(resized.width - moved.width)).toBe(80);
  expect(Math.round(resized.height - moved.height)).toBe(60);
  expect(Math.round(resized.y + resized.height)).toBe(Math.round(moved.y + moved.height));

  await page.locator('#leave').click();
  await joinSavedProfile(page);
  const restored = (await card.boundingBox())!;
  expect(Math.round(restored.x)).toBe(Math.round(resized.x));
  expect(Math.round(restored.width)).toBe(Math.round(resized.width));
  await page.locator('#settings-toggle').click();
  await page.locator('#chat-reset').click();
  expect(Math.round((await card.boundingBox())!.x)).toBe(Math.round(before.x));
});

test('leaving clears controls and canvas, and the same page can join again', async ({ page }) => {
  await enter(page, 'E2ERejoin');
  await page.locator('#leave').click();
  await expect(page.locator('#status')).toContainText('已离开');
  await expect(page.locator('#game canvas')).toHaveCount(0);
  await expect(page.locator('#message')).toBeDisabled();
  await expect(page.locator('#login-screen [data-world="main"]')).toBeEnabled();
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

test.describe('touch device', () => {
  test.use({ hasTouch: true });
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
});

// The pad depends on a touch pointer, not on the window width.
test.describe('touch device', () => {
  test.use({ hasTouch: true });
  test('mobile direction pad steers diagonally by sliding and its grip moves the pad persistently', async ({ page }) => {
    test.setTimeout(30000);
    await page.setViewportSize({ width: 390, height: 844 });
    await enter(page, 'E2ETouchPad');
    const pad = page.locator('#touch-controls');
    const pressed = () => pad.locator('.pressed').evaluateAll(keys => keys.map(key => (key as HTMLElement).dataset.move).sort().join('+'));
    const box = (await pad.boundingBox())!;
    const centerX = box.x + box.width / 2, centerY = box.y + box.height / 2;
    await page.mouse.move(centerX + 50, centerY);
    await page.mouse.down();
    await expect.poll(pressed).toBe('right');
    await page.mouse.move(centerX + 50, centerY + 50);
    await expect.poll(pressed).toBe('down+right');
    await page.mouse.up();
    await expect.poll(pressed).toBe('');
    expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');

    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(200, 300, { steps: 5 });
    await page.mouse.up();
    await expect.poll(pressed).toBe('');
    const moved = (await pad.boundingBox())!;
    expect(Math.round(moved.x + moved.width / 2)).toBe(200);
    expect(Math.round(moved.y + moved.height / 2)).toBe(300);
    await page.locator('#leave').click();
    await joinSavedProfile(page);
    const restored = (await pad.boundingBox())!;
    expect(Math.abs(restored.x - moved.x)).toBeLessThanOrEqual(1);
    await page.locator('#settings-toggle').click();
    await page.locator('#layout-edit').click();
    await expect(page.locator('#layout-panel')).toBeVisible();
    await page.locator('#layout-reset').click();
    await page.locator('#layout-done').click();
    expect((await pad.boundingBox())!.x).toBeCloseTo(box.x, 0);
  });

  test('double-tapping the pad grip opens the layout editor for pad size and control positions', async ({ page }) => {
    test.setTimeout(45000);
    await page.setViewportSize({ width: 390, height: 844 });
    await enter(page, 'E2ELayout');
    const pad = page.locator('#touch-controls');
    const grip = page.locator('#touch-grip');
    const bar = page.locator('#positional-controls');
    const gripBox = (await grip.boundingBox())!;
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    // One tap explains the grip in the free space beside the pad.
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator('#touch-hint')).toBeVisible();
    await expect(page.locator('#touch-hint')).toContainText('双击');
    await page.waitForTimeout(500);
    // Two quick taps open the layout editor.
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator('#layout-panel')).toBeVisible();
    await expect(page.locator('#touch-hint')).toBeHidden();

    const before = (await pad.boundingBox())!;
    await page.locator('#pad-scale').fill('150');
    await expect(page.locator('#pad-scale-value')).toHaveText('150%');
    const larger = (await pad.boundingBox())!;
    expect(larger.width).toBeGreaterThan(before.width * 1.4);

    // While editing, the action bar drags instead of acting, and the pad drags from any key.
    const sit = page.locator('#action-list [data-action="sit"]');
    const barBox = (await bar.boundingBox())!;
    await page.mouse.move(barBox.x + 10, barBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(120, 250, { steps: 5 });
    await page.mouse.up();
    const movedBar = (await bar.boundingBox())!;
    expect(Math.round(movedBar.x)).toBe(110);
    expect(Math.round(movedBar.y)).toBe(240);
    await expect(sit).toHaveAttribute('aria-pressed', 'false');
    const up = (await page.locator('[data-move="up"]').boundingBox())!;
    await page.mouse.move(up.x + up.width / 2, up.y + up.height / 2);
    await page.mouse.down();
    await page.mouse.move(up.x + up.width / 2 + 40, up.y + up.height / 2 - 120, { steps: 5 });
    await page.mouse.up();
    expect(Math.round((await pad.boundingBox())!.y)).toBe(Math.round(larger.y - 120));
    await expect(page.locator('#touch-controls .pressed')).toHaveCount(0);

    await page.locator('#layout-done').click();
    await expect(page.locator('#layout-panel')).toBeHidden();
    await page.locator('#leave').click();
    await joinSavedProfile(page);
    expect(Math.round((await pad.boundingBox())!.width)).toBe(Math.round(larger.width));
    expect(Math.round((await bar.boundingBox())!.x)).toBe(110);
  });
});

test('a narrow desktop window hides the direction pad and keeps keyboard movement', async ({ page }) => {
  test.setTimeout(30000);
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page, 'E2ENarrowDesk');
  await expect(page.locator('#touch-controls')).toBeHidden();
  const observer = await observe();
  try {
    const sessionId = (await page.locator('#status').textContent())!.split(' · ').at(-1)!;
    await expect.poll(() => observer.state.players.has(sessionId)).toBe(true);
    const start = observer.state.players.get(sessionId)!.x;
    await page.keyboard.down('d');
    try {
      await expect.poll(() => observer.state.players.get(sessionId)!.x - start).toBeGreaterThan(10);
    } finally { await page.keyboard.up('d'); }
  } finally { await observer.leave(); }
});

// The browser tests deliberately use the same-origin endpoint, including its WS query string.
test('health and Tiled assets are reachable through the dev server', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
  const directory = await request.get('/api/world');
  const registry = await directory.json() as { maps: { id: string; url: string }[]; spaces: { id: string; initialMap: string }[] };
  const entry = registry.maps.find(map => map.id === registry.spaces[0]!.initialMap)!;
  const map = await request.get(entry.url);
  expect(map.status()).toBe(200);
  expect((await map.json()).layers.some((layer: { type: string }) => layer.type === 'tilelayer')).toBe(true);
  const data = await map.json() as { tilewidth: number; tileheight: number; tilesets: { image: string }[] };
  expect([data.tilewidth, data.tileheight]).toEqual([16, 16]);
  expect((await request.get(data.tilesets[0].image)).status()).toBe(200);
});


test('logging into a second browser restores the same account, profile, outfits and note permissions', async ({ page, browser }) => {
  const account = await enter(page, 'E2EBound', 'violet');
  const profileResponse = await page.request.get(new URL('/api/me', test.info().project.use.baseURL!).toString());
  const profile = await profileResponse.json() as { id: string; currentAppearance: typeof DEFAULT_APPEARANCE };
  const outfitResponse = await page.request.put(new URL('/api/me/outfits/0', test.info().project.use.baseURL!).toString(), {
    data: { name: '跨设备造型', appearance: profile.currentAppearance },
  });
  expect(outfitResponse.status()).toBe(200);
  const target = await browser.newPage();
  const outsider = await browser.newPage();
  const observer = await observe();
  try {
    await walkTo(page, observer, 'E2EBound', 'board');
    const note = `跨设备 ${Date.now()}`;
    await page.locator('#board-text').fill(note);
    await page.locator('#board-post').click();
    await expect(page.locator('#feature-status')).toContainText('留言已发布');
    await page.locator('#leave').click();
    await expect(page.locator('#status')).toContainText('已离开');
    await target.goto('/');
    await target.locator('#sign-in-form [name="username"]').fill(account.username);
    await target.locator('#sign-in-form [name="password"]').fill(account.password);
    await target.locator('#sign-in-form button[type="submit"]').click();
    await expect(target.locator('#account-status')).toContainText(`@${account.username}`);
    await expect(target.locator('#name')).toHaveValue('E2EBound');
    await expect.poll(async () => (await target.evaluate(async () =>
      (await (await fetch('/api/me')).json()).currentAppearance.top.assetId)) as string).toBe('shirt');
    const sharedOutfits = await target.request.get(new URL('/api/me/outfits', test.info().project.use.baseURL!).toString());
    expect((await sharedOutfits.json() as Array<{ name: string } | null>)[0]?.name).toBe('跨设备造型');
    await joinSavedProfile(target);
    await walkTo(target, observer, 'E2EBound', 'board');
    await target.locator('#board-notes li').filter({ hasText: note }).getByRole('button').click();
    await expect(target.locator('#feature-status')).toContainText('留言已删除');
    const outsiderAccount = await createTestAccount(outsider, 'E2EOutsider');
    await outsider.goto('/');
    await expect(outsider.locator('#account-status')).toContainText(`@${outsiderAccount.username}`);
    const isolatedOutfits = await outsider.request.get(new URL('/api/me/outfits', test.info().project.use.baseURL!).toString());
    expect(await isolatedOutfits.json()).toEqual([null, null, null]);
    expect(account.id).toBe(profile.id);
  } finally { if (observer.connection.isOpen) await observer.leave(); await target.close(); await outsider.close(); }
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
    // The own character sits over the tool window and the map behind it is washed out.
    await expect(page.locator('#tool-stage')).toBeVisible();
    await expect(page.locator('#tool-backdrop')).toBeVisible();
    // The chat stays usable above the tool window.
    expect(Number(await page.locator('#chat-card').evaluate(node => getComputedStyle(node).zIndex))).toBeGreaterThan(20);
    // The stage overlaps the window's bottom-right corner, moves by its body and scales from its grip.
    const stage = page.locator('#tool-stage');
    const stageBox = async () => (await stage.boundingBox())!;
    const seated = await stageBox();
    const tv = (await page.locator('#tool-window').boundingBox())!;
    expect(seated.x).toBeLessThan(tv.x + tv.width);
    expect(seated.y).toBeLessThan(tv.y + tv.height);
    await page.mouse.move(seated.x + seated.width / 2, seated.y + seated.height / 2);
    await page.mouse.down();
    await page.mouse.move(seated.x + seated.width / 2 - 100, seated.y + seated.height / 2 - 50, { steps: 4 });
    await page.mouse.up();
    const dragged = await stageBox();
    expect(dragged.x - seated.x).toBeCloseTo(-100, 0);
    expect(dragged.y - seated.y).toBeCloseTo(-50, 0);
    // The grip sits over the embedded page, which must not swallow the drag.
    await page.mouse.move(dragged.x + 2, dragged.y + 2);
    await page.mouse.down();
    await page.mouse.move(dragged.x - 48, dragged.y + 2, { steps: 4 });
    await page.mouse.up();
    const scaled = await stageBox();
    expect(scaled.width - dragged.width).toBeCloseTo(50, 0);
    expect(scaled.x + scaled.width).toBeCloseTo(dragged.x + dragged.width, 0);
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
    // The top-left grip resizes the frame and keeps its bottom-right corner in place.
    const grip = (await page.locator('#tool-resize').boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 + 80, grip.y + grip.height / 2 + 60, { steps: 4 });
    await page.mouse.up();
    const resized = await windowBox();
    expect(moved.width - resized.width).toBeCloseTo(80, 0);
    expect(moved.height - resized.height).toBeCloseTo(60, 0);
    expect(resized.x + resized.width).toBeCloseTo(moved.x + moved.width, 0);
    expect(resized.y + resized.height).toBeCloseTo(moved.y + moved.height, 0);
    await page.locator('#tool-close').click();
    await expect(frame).toHaveCount(0);
    await expect(page.locator('#tool-window')).toBeHidden();
    await expect(page.locator('#tool-backdrop')).toBeHidden();
    await expect(page.locator('#tool-open')).toBeVisible();
    await page.locator('#tool-open').click();
    await expect(frame).toBeVisible();
    // Typing goes to the embedded page until the tool frame itself is clicked again.
    await page.frameLocator('#tool-window iframe').getByText('Embedded tool fixture').click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');
    await page.locator('#tool-heading').click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
    const sessionId = (await page.locator('#status').textContent())!.split(' · ').at(-1)!;
    const startY = observer.state.players.get(sessionId)!.y;
    await page.keyboard.down('w');
    try {
      await expect.poll(() => startY - observer.state.players.get(sessionId)!.y).toBeGreaterThan(4);
    } finally { await page.keyboard.up('w'); }
    await page.locator('#leave').click();
    await expect(frame).toHaveCount(0);
  } finally { if (observer.connection.isOpen) await observer.leave(); }
});


/** Steers a protocol-only client into a web zone the way `walkToTool` steers the page. */
async function steerToTool(room: Room<SpaceProtocol>, target: typeof toolCases[number]) {
  await expect.poll(() => {
    const player = room.state.players.get(room.sessionId)!;
    const dx = Math.abs(player.x - target.x) < 12 ? 0 : Math.sign(target.x - player.x);
    room.send('input', { x: dx, y: dx ? 0 : -1 });
    return player.zoneId;
  }, { intervals: [50], timeout: 20000 }).toBe(target.resourceId);
  room.send('input', { x: 0, y: 0 });
}

test('embed stage seats people with the same tool open center-outward', async ({ page, context }) => {
  test.setTimeout(90000);
  const target = toolCases[1];
  await page.route('**/api/tools', route => route.fulfill({ json: [{ ...toolDirectory[1], mode: 'embed' }] }));
  await context.route('https://tools.example/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>Embedded tool fixture</p>' }));
  await enter(page, 'E2EStage');
  const first = await observe();
  const second = await observe();
  try {
    await walkToTool(page, first, target);
    const own = (await page.locator('#status').textContent())!.split(' · ').at(-1)!;
    await page.locator('#tool-open').click();
    const seats = page.locator('#tool-stage-seats .tool-stage-seat');
    const order = () => seats.evaluateAll(nodes => (nodes as HTMLElement[])
      .sort((a, b) => Number(a.style.order) - Number(b.style.order)).map(node => node.dataset.session));
    // The desk keeps its length while characters shrink to make room.
    const deskWidth = async () => (await page.locator('#tool-stage').boundingBox())!.width;
    const charWidth = async () => (await page.locator(`#tool-stage-seats [data-session="${own}"] canvas`).boundingBox())!.width;
    await expect.poll(order).toEqual([own]);
    // Whoever is already seated when the tool opens appears without sliding in.
    await expect(page.locator(`#tool-stage-seats [data-session="${own}"]`)).not.toHaveClass(/entering/);
    const alone = { desk: await deskWidth(), char: await charWidth() };
    // Standing in the zone is not enough: only people who open the tool take a seat.
    await steerToTool(first, target);
    await page.waitForTimeout(300);
    expect(await order()).toEqual([own]);
    first.send('webTool', { open: true });
    await expect.poll(order).toEqual([own, first.sessionId]);
    await expect.poll(charWidth).toBeLessThan(alone.char - 10);
    expect(await deskWidth()).toBeCloseTo(alone.desk, 0);
    await steerToTool(second, target);
    second.send('webTool', { open: true });
    await expect.poll(order).toEqual([second.sessionId, own, first.sessionId]);
    // The third opener takes the left seat and slides in from the left.
    expect(await page.locator(`#tool-stage-seats [data-session="${second.sessionId}"]`).evaluate(seat => (seat as HTMLElement).style.getPropertyValue('--enter-from'))).toBe('-1');
    // Seats follow opening time, so the second opener sits right of the first in everyone's view.
    const openers = [...first.state.players.entries()].filter(([, player]) => player.webToolZone === target.resourceId)
      .sort(([a, x], [b, y]) => x.webToolAt - y.webToolAt || a.localeCompare(b)).map(([id]) => id);
    expect(openers).toEqual([own, first.sessionId, second.sessionId]);
    // Typing in chat shows on the seated character; the title bar button hides and restores the desk.
    first.send('typing', { typing: true });
    await expect(page.locator(`#tool-stage-seats [data-session="${first.sessionId}"]`)).toHaveClass(/typing/);
    first.send('typing', { typing: false });
    await expect(page.locator(`#tool-stage-seats [data-session="${first.sessionId}"]`)).not.toHaveClass(/typing/);
    await page.locator('#tool-stage-toggle').click();
    await expect(page.locator('#tool-stage')).toBeHidden();
    await expect(page.locator('#tool-stage-toggle')).toHaveText('显示小人');
    await page.locator('#tool-stage-toggle').click();
    await expect(page.locator('#tool-stage')).toBeVisible();
    second.send('webTool', { open: false });
    await expect.poll(order).toEqual([own, first.sessionId]);
    second.send('webTool', { open: true });
    await expect.poll(order).toEqual([second.sessionId, own, first.sessionId]);
    // Leaving re-centers the row: the remaining arrival takes the first seat beside the own character.
    await first.leave();
    await expect.poll(order).toEqual([own, second.sessionId]);
  } finally {
    for (const room of [first, second]) if (room.connection.isOpen) await room.leave();
  }
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

test('wardrobe previews items, keeps three named outfit slots and remembers display preferences', async ({ page }) => {
  test.setTimeout(45000); // Two reloads plus a profile save and a room join.
  await signInFresh(page, 'E2EWardrobe');
  await page.locator('#theme-toggle').click();
  await page.locator('.theme-option', { hasText: '自定义' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'custom');
  await expect(page.locator('.theme-slot')).toHaveCount(4);
  await page.locator('#theme-toggle').click();
  await openAvatarScreen(page);
  await page.locator('#name').fill('E2EWardrobe');
  await expect(page.locator('#avatar-name-tag')).toHaveText('E2EWardrobe');
  await page.locator('[data-appearance-category="top"]').click();
  await expect(page.locator('#appearance-choices [data-appearance-item] canvas')).toHaveCount(await page.locator('#appearance-choices [data-appearance-item]').count());
  await page.locator('#appearance-choices [data-appearance-item="shirt"]').click();
  await expect(page.locator('#appearance-choices [data-appearance-item="shirt"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#appearance-swatches .swatch').nth(7).click();
  await expect(page.locator('#undo-appearance')).toBeEnabled();

  await page.locator('#save-appearance').click();
  const slots = page.locator('#outfit-slots .slot-card');
  await expect(slots).toHaveCount(3);
  await expect(page.locator('#outfit-slots [data-filled="true"]')).toHaveCount(0);
  await slots.nth(0).locator('input').fill('上班');
  await slots.nth(0).getByRole('button', { name: '存到这里' }).click();
  await expect(page.locator('#outfit-status')).toContainText('已存到槽位 1「上班」');
  await expect(slots.nth(0)).toHaveAttribute('data-filled', 'true');
  const savedOutfits = await page.request.get(new URL('/api/me/outfits', test.info().project.use.baseURL!).toString());
  expect((await savedOutfits.json() as Array<{ name: string } | null>)[0]?.name).toBe('上班');
  await slots.nth(0).getByRole('button', { name: '覆盖' }).click();
  await expect(slots.nth(0).getByRole('button', { name: '确认覆盖？' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'custom');
  await expect(page.locator('#account-status')).toContainText('@');
  await openAvatarScreen(page);
  await page.locator('#save-appearance').click();
  await expect(page.locator('#outfit-slots .slot-card').nth(0).locator('input')).toHaveValue('上班');
  await page.keyboard.press('Escape');

  await page.locator('#join').click();
  await page.locator('#prejoin-enter').click();
  await expect(page.locator('#status')).toContainText('已进入空间');
  await expect(page.locator('#chat-card')).toHaveAttribute('data-mode', 'half');
  await page.locator('#settings-toggle').click();
  // The opacity slider takes any value and snaps to its 0/50/100 marks when released near them.
  await page.locator('#chat-opacity').fill('30');
  await expect(page.locator('#chat-card')).toHaveAttribute('data-mode', 'half');
  await expect(page.locator('#chat-opacity-value')).toHaveText('30%');
  await page.locator('#chat-opacity').fill('97');
  await expect(page.locator('#chat-opacity-value')).toHaveText('100%');
  await expect(page.locator('#chat-card')).toHaveAttribute('data-mode', 'solid');
  await page.locator('#names-switch').click();
  await expect(page.locator('#names-switch')).toHaveAttribute('aria-checked', 'false');
  await page.locator('#leave').click();
  await page.reload();
  await expect(page.locator('#chat-card')).toHaveAttribute('data-mode', 'solid');
  await expect(page.locator('#names-switch')).toHaveAttribute('aria-checked', 'false');
});


test('scene selectors render chosen tiles, private members control locks, and a mirror reuses Wardrobe', async ({ page }) => {
  test.setTimeout(45000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await enter(page, 'SceneTypes', 'mint', () => captureRenderedScene(page));
  const sessionId = await sessionOf(page); const observer = await observe();
  const player = () => observer.state.players.get(sessionId)!;
  const move = async (key: string, arrived: () => boolean) => {
    await page.locator('#game canvas').focus(); await page.keyboard.down(key);
    try { await expect.poll(arrived, { intervals: [10] }).toBe(true); }
    finally { await page.keyboard.up(key); }
    await expect.poll(() => player().motion).toBe('idle');
  };
  try {
    await expect.poll(() => player()?.name).toBe('SceneTypes');
    await move('s', () => player().y >= 449);
    await page.locator('#action-list [data-action="sit"]').click();
    await expect(page.locator('#variant-selector-panel')).toBeVisible();
    await expect.poll(() => player().actionTargetId).toBe('20');
    await page.waitForTimeout(550);
    await page.locator('#variant-choices [data-variant="book"]').click();
    await expect.poll(() => observer.state.worldObjects.get('workspace')?.objects.get('90')?.variant).toBe('book');
    await expect.poll(() => page.evaluate(() => {
      const scene = (window as RenderingWindow).sceneUnderTest;
      return scene?.children.list.some(child => child instanceof Object && 'frame' in child &&
        (child as Phaser.GameObjects.Image).frame?.name === 'world-variant-19');
    })).toBe(true);
    await page.locator('#variant-cancel').click(); await expect(page.locator('#variant-selector-panel')).toBeHidden();
    await expect(page.locator('#private-area-panel')).toBeVisible();
    await page.waitForTimeout(550); await page.locator('#private-area-lock').click();
    await expect(page.locator('#private-area-lock')).toHaveText('解锁');
    await move('a', () => player().x < 346);
    await expect(page.locator('#wardrobe-panel')).toBeVisible();
    const roomId = await page.evaluate(() => (window as RenderingWindow).sceneUnderTest?.['room'].roomId);
    await page.locator('#wardrobe-open').click();
    await expect(page.locator('#avatar-screen')).toBeVisible();
    await page.locator('[data-appearance-category="top"]').click();
    await page.locator('#appearance-choices [data-appearance-item="shirt"]').click();
    await page.locator('#join').click();
    await expect(page.locator('#map-screen')).toBeVisible();
    await expect(page.locator('#prejoin-dialog')).not.toBeVisible();
    await expect.poll(() => JSON.parse(player().appearance).top.assetId).toBe('shirt');
    expect(await page.evaluate(() => (window as RenderingWindow).sceneUnderTest?.['room'].roomId)).toBe(roomId);
    expect(await sessionOf(page)).toBe(sessionId);
    await page.locator('#wardrobe-open').click();
    await page.locator('#avatar-screen [data-back]').click();
    await expect(page.locator('#map-screen')).toBeVisible();
    expect(errors).toEqual([]);
  } finally { if (observer.connection.isOpen) await observer.leave(); }
});


test('selector choices survive state patches, take priority over web areas, and visibly clear tiles', async ({ page, context }) => {
  test.setTimeout(45000);
  await page.route('**/api/tools', route => route.fulfill({ json: [{
    resourceId: 'shared-canvas', url: 'https://tools.example/selector', mode: 'embed',
  }] }));
  await context.route('https://tools.example/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Selector overlap fixture</p>' }));
  await enter(page, 'SelectorPixels', 'mint', async () => {
    await captureRenderedScene(page);
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 96;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#336699'; ctx.fillRect(0, 0, 192, 96);
      ctx.fillStyle = '#8855cc'; ctx.fillRect(112, 0, 16, 16); // authored base GID 8
      ctx.fillStyle = '#ee6633'; ctx.fillRect(96, 0, 16, 16); // local tile 6 / GID 7: computer
      ctx.fillStyle = '#22aa55'; ctx.fillRect(96, 16, 16, 16); // local tile 18 / GID 19: book
      return canvas.toDataURL().split(',')[1];
    });
    await page.route('**/api/maps/workspace/assets/0', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }));
  });
  const observer = await observe(); const sessionId = await sessionOf(page);
  const player = () => observer.state.players.get(sessionId)!;
  const targetPixel = () => page.evaluate(() => new Promise<number[]>((resolve, reject) => {
    const scene = (window as RenderingWindow).sceneUnderTest;
    if (!scene) { reject(new Error('Scene missing')); return; }
    const camera = scene.cameras.main;
    const point = camera.getViewMatrix().transformPoint(392, 440);
    scene.game.renderer.snapshotPixel(Math.round(point.x), Math.round(point.y), color => {
      if ('red' in color) resolve([color.red, color.green, color.blue]);
      else reject(new Error('Expected pixel color'));
    });
  }));
  try {
    await expect.poll(() => player()?.name).toBe('SelectorPixels');
    await page.locator('#game canvas').focus(); await page.keyboard.down('s');
    try { await expect.poll(() => player().y >= 449, { intervals: [10] }).toBe(true); }
    finally { await page.keyboard.up('s'); }
    await expect.poll(() => player().motion).toBe('idle');
    await page.locator('#tool-open').click();
    await expect(page.locator('#tool-window iframe')).toBeVisible();
    // Submit the same UI intent through the scene's real connection while the window is open.
    await page.evaluate(async () => { await (window as RenderingWindow).sceneUnderTest!['room'].request('activateAction', { action: 'sit' }); });
    await expect(page.locator('#tool-window')).toBeHidden();
    await expect(page.locator('#tool-hint')).toBeHidden();
    await expect(page.locator('#variant-selector-panel')).toBeVisible();
    await page.waitForTimeout(550);
    const empty = page.locator('#variant-choices [data-variant="empty"]');
    if (await empty.isEnabled()) await empty.click();
    await expect.poll(targetPixel).toEqual([51, 102, 153]);
    await page.waitForTimeout(550);
    const book = page.locator('#variant-choices [data-variant="book"]');
    await book.hover(); await page.mouse.down();
    // Force authoritative patches between pointer down and pointer up.
    for (const typing of [true, false]) {
      observer.send('typing', { typing });
      await expect.poll(() => page.evaluate(id =>
        (window as RenderingWindow).sceneUnderTest!['room'].state.players.get(id)?.typing, observer.sessionId),
      { intervals: [10] }).toBe(typing);
    }
    await page.mouse.up();
    await expect.poll(() => observer.state.worldObjects.get('workspace')?.objects.get('90')?.variant).toBe('book');
    await expect.poll(targetPixel).toEqual([34, 170, 85]);
    await page.waitForTimeout(550);
    await page.locator('#variant-choices [data-variant="computer"]').click();
    await expect.poll(targetPixel).toEqual([238, 102, 51]);
    await page.waitForTimeout(550);
    await page.evaluate(async () => {
      await (window as RenderingWindow).sceneUnderTest!['room'].request('selectVariant', { selectorId: '20', variant: null });
    });
    await expect.poll(() => observer.state.worldObjects.get('workspace')?.objects.get('90')?.variantCleared).toBe(true);
    expect(player().actionTargetId).toBe('20');
    await expect.poll(targetPixel).toEqual([51, 102, 153]);
    await page.locator('#variant-cancel').click();
    await expect(page.locator('#variant-selector-panel')).toBeHidden();
    await expect.poll(() => observer.state.worldObjects.get('workspace')?.objects.get('90')?.variantCleared).toBe(false);
    await expect.poll(targetPixel).toEqual([136, 85, 204]);
    await expect(page.locator('#tool-open')).toBeVisible();
    await expect(page.locator('#tool-window')).toBeHidden();
  } finally { if (observer.connection.isOpen) await observer.leave(); }
});


test('Space tiles follow the registry and selecting a Space uses its own initial map', async ({ page }) => {
  test.setTimeout(40_000);
  const response = await page.request.get('/api/world');
  const registry = worldRegistryResponseSchema.parse(await response.json());
  await signInFresh(page, 'OtherSpace');
  await captureRenderedScene(page);
  await expect(page.locator('#world-list [data-world]')).toHaveCount(registry.spaces.length);
  expect(await page.locator('#world-list [data-world]').evaluateAll(tiles => tiles.map(tile => tile.getAttribute('data-world'))))
    .toEqual(registry.spaces.map(space => space.id));
  await page.locator('#world-list [data-world="other"]').click();
  await page.locator('#name').fill('OtherSpace');
  await page.locator('#join').click(); await page.locator('#prejoin-enter').click();
  await expect(page.locator('#status')).toContainText('已进入空间');
  await expect(page.locator('#map-world-name')).toHaveText('Other');
  const main = await observe('main');
  const identity = await page.request.get('/api/me');
  const profile = await identity.json() as { id: string };
  const sessionId = await sessionOf(page);
  const endpoint = test.info().project.use.baseURL!;
  const cookie = (await page.context().cookies()).map(value => `${value.name}=${value.value}`).join('; ');
  const sameAccountClient = new Client(endpoint, { headers: { Cookie: cookie } });
  const observer = await observe('other');
  observer.onMessage('chat', () => {});
  let replacement: Room<SpaceProtocol> | undefined;
  try {
    if (!observer.state?.players) await new Promise<void>(resolve => observer.onStateChange.once(() => resolve()));
    expect(observer.state.spaceId).toBe('other');

    // Going offline drops the real browser WebSocket. The SDK should reconnect the same Room.
    await expect.poll(() => page.evaluate(() => Boolean((window as RenderingWindow).sceneUnderTest))).toBe(true);
    await page.context().setOffline(true);
    await expect(page.locator('#status')).toContainText('连接中断');
    await expect.poll(() => observer.state.players.get(sessionId)?.connected, { timeout: 12_000 }).toBe(false);
    await page.context().setOffline(false);
    await expect(page.locator('#status')).toContainText('连接已恢复');
    await expect.poll(() => observer.state.players.get(sessionId)?.connected).toBe(true);
    expect(await page.evaluate(() => (window as RenderingWindow).sceneUnderTest?.['room'].sessionId)).toBe(sessionId);

    const admitted = await sameAccountClient.joinOrCreate<SpaceProtocol>('space',
      { name: 'OtherSpace', avatar: 'mint', appearance: DEFAULT_APPEARANCE, spaceId: 'other' });
    replacement = admitted;
    replacement.onMessage('chat', () => {});
    if (!admitted.state?.players) await new Promise<void>(resolve => admitted.onStateChange.once(() => resolve()));
    expect(replacement.sessionId).not.toBe(sessionId);
    const replacementSessionId = replacement.sessionId;
    await expect.poll(() => observer.state.players.get(replacementSessionId)?.userId).toBe(profile.id);
    await expect(page.locator('#status')).toContainText('账号已在其他设备进入此空间，当前连接已下线');
    await expect.poll(() => [...observer.state.players.values()].filter(player => player.userId === profile.id).length).toBe(1);
    expect(observer.state.players.has(sessionId)).toBe(false);
    expect(observer.state.players.get(replacement.sessionId)?.mapId).toBe('studio');
    expect(main.state.players.has(replacement.sessionId)).toBe(false);
    await page.waitForTimeout(1000);
    expect([...observer.state.players.values()].filter(player => player.userId === profile.id)).toHaveLength(1);
    await expect(page.locator('#status')).toContainText('账号已在其他设备进入此空间，当前连接已下线');
  } finally {
    await page.context().setOffline(false);
    await observer.leave(); await main.leave();
    if (replacement?.connection.isOpen) await replacement.leave();
  }
});
