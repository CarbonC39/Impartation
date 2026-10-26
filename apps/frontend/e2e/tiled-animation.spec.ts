import { expect, test, type Page } from '@playwright/test';
import type Phaser from 'phaser';
import type { SpaceScene } from '../src/SpaceScene';

const PASSWORD = 'e2e-workspace-password';
let accountSequence = 0;

type AnimationFrame = { tileid: number; duration: number };
type TiledLayer = { name: string; type: string; [key: string]: unknown };
type RenderTileset = { name: string; image?: string; tiles?: { id: number; animation: AnimationFrame[] }[]; [key: string]: unknown };
type RenderMap = { version?: string; tilewidth: number; tileheight: number; layers: TiledLayer[]; tilesets: RenderTileset[] };
type RenderingWindow = Window & { sceneUnderTest?: SpaceScene };
type TestIdentity = { username: string };

function username() { return `tileanim${Date.now().toString(36)}${(++accountSequence).toString(36)}`; }

async function createAccount(page: Page): Promise<TestIdentity> {
  const baseURL = test.info().project.use.baseURL!;
  const name = username();
  const response = await page.request.post(new URL('/api/register', baseURL).toString(), {
    headers: { Origin: baseURL }, data: { username: name, password: PASSWORD, displayName: 'TileAnimation' },
  });
  expect(response.status()).toBe(200);
  return { username: name };
}

async function installAnimationMap(page: Page) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 192; canvas.height = 96;
    const context = canvas.getContext('2d')!;
    const colors = ['#494949', '#676767', '#df2473', '#2244ee', '#18a84a', '#f1aa22', '#808080', '#a0a0a0', '#b0b0b0', '#c21d37', '#15cfcf'];
    for (let id = 0; id < 72; id++) {
      context.fillStyle = colors[id] ?? '#393939';
      context.fillRect((id % 12) * 16, Math.floor(id / 12) * 16, 16, 16);
    }
    return canvas.toDataURL('image/png').split(',')[1]!;
  });

  await page.route('**/api/maps/workspace/map.json', async route => {
    const response = await route.fetch();
    const map = await response.json() as RenderMap;
    map.version = '1.10';
    const ground = map.layers.find(layer => layer.name === 'floor' && layer.type === 'tilelayer');
    if (!ground || !Array.isArray(ground.data)) throw new Error('Expected the fixture floor tile layer');
    const width = Number(ground.width);
    const height = Number(ground.height);
    const makeLayer = (name: string, properties: { name: string; type: string; value: boolean }[], cells: { x: number; y: number; gid: number }[]): TiledLayer => {
      const data = Array<number>(width * height).fill(0);
      for (const cell of cells) data[cell.y * width + cell.x] = cell.gid;
      return { id: 100 + map.layers.length, name, type: 'tilelayer', width, height, visible: true, opacity: 1, x: 0, y: 0, data,
        properties: properties.map(property => ({ ...property })) };
    };
    map.layers.push(
      makeLayer('sorted-probe', [{ name: 'ySort', type: 'bool', value: true }], [{ x: 18, y: 24, gid: 7 }]),
      makeLayer('above-players-probe', [{ name: 'abovePlayers', type: 'bool', value: true }], [{ x: 19, y: 24, gid: 7 }]),
      makeLayer('animated-probe', [], [{ x: 30, y: 18, gid: 7 }]),
    );
    const tileset = map.tilesets[0];
    if (!tileset) throw new Error('Expected one atlas tileset');
    tileset.tiles = [
      { id: 6, animation: [{ tileid: 2, duration: 90 }, { tileid: 3, duration: 270 }] },
      { id: 7, animation: [{ tileid: 4, duration: 120 }, { tileid: 5, duration: 360 }] },
    ];
    await route.fulfill({ response, json: map });
  });
  await page.route('**/api/maps/workspace/assets/0', route => route.fulfill({
    contentType: 'image/png', body: Buffer.from(png, 'base64'),
  }));
}

async function captureScene(page: Page) {
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

async function enter(page: Page, canvasOnly: boolean) {
  if (canvasOnly) {
    await page.addInitScript(() => {
      const prototype = HTMLCanvasElement.prototype as unknown as {
        getContext: (this: HTMLCanvasElement, kind: string, ...args: unknown[]) => RenderingContext | null;
      };
      const nativeGetContext = prototype.getContext;
      prototype.getContext = function (kind, ...args) {
        if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') return null;
        return nativeGetContext.call(this, kind, ...args);
      };
    });
  }
  await installAnimationMap(page);
  const account = await createAccount(page);
  await page.goto('/');
  await expect(page.locator('#account-status')).toContainText(`@${account.username}`);
  await captureScene(page);
  await page.locator('#world-list [data-world="main"]').click();
  await expect(page.locator('#avatar-screen')).toBeVisible();
  await page.locator('#name').fill('TileAnimation');
  await page.locator('#join').click();
  await page.locator('#prejoin-enter').click();
  await expect(page.locator('body')).toHaveAttribute('data-connection-state', 'connected');
  await expect(page.locator('#game canvas')).toBeVisible();
}

async function pixelAtWorld(page: Page, x: number, y: number): Promise<string> {
  const color = await page.evaluate(({ worldX, worldY }) => new Promise<number[]>((resolve, reject) => {
    const scene = (window as RenderingWindow).sceneUnderTest;
    if (!scene) { reject(new Error('Scene missing')); return; }
    const point = scene.cameras.main.getViewMatrix().transformPoint(worldX, worldY);
    scene.game.renderer.snapshotPixel(Math.round(point.x), Math.round(point.y), pixel => {
      if ('red' in pixel) resolve([pixel.red, pixel.green, pixel.blue]);
      else reject(new Error('Expected an RGB pixel'));
    });
  }), { worldX: x, worldY: y });
  return color.join(',');
}

async function expectBothAnimationFrames(page: Page, point: { x: number; y: number }, colors: [string, string]) {
  const seen = new Set<string>();
  for (let sample = 0; sample < 44; sample++) {
    seen.add(await pixelAtWorld(page, point.x, point.y));
    await page.waitForTimeout(25);
  }
  expect(seen.has(colors[0])).toBe(true);
  expect(seen.has(colors[1])).toBe(true);
}

async function expectLayerOrdering(page: Page) {
  const depths = await page.evaluate(() => {
    const scene = (window as RenderingWindow).sceneUnderTest;
    if (!scene) throw new Error('Scene missing');
    const player = scene.children.getByName(scene['room'].sessionId) as Phaser.GameObjects.Sprite | null;
    const layers = scene.children.list.filter(child => child.type.startsWith('Tilemap')) as Phaser.Tilemaps.TilemapLayer[];
    const sorted = layers.find(child => child.layer.name.startsWith('__ySort_') && child.layer.name.endsWith('_24'));
    const overlay = layers.find(child => child.layer.name === 'above-players-probe');
    if (!player || !sorted || !overlay) throw new Error('Expected rendered player, Y-sorted row, and abovePlayers layer');
    return { player: player.depth, sorted: sorted.depth, overlay: overlay.depth };
  });
  expect(depths.sorted).toBeGreaterThan(depths.player);
  expect(depths.overlay).toBeGreaterThan(515);
}

async function selectAnimatedVariant(page: Page) {
  await page.locator('#game canvas').focus();
  await page.keyboard.down('s');
  try {
    await expect.poll(() => page.evaluate(() => {
      const scene = (window as RenderingWindow).sceneUnderTest;
      return scene?.['room'].state.players.get(scene['room'].sessionId)?.y ?? 0;
    }), { intervals: [20] }).toBeGreaterThanOrEqual(449);
  } finally { await page.keyboard.up('s'); }
  await expect.poll(() => page.evaluate(() => (window as RenderingWindow).sceneUnderTest?.['room'].state.players
    .get((window as RenderingWindow).sceneUnderTest!['room'].sessionId)?.motion)).toBe('idle');
  await page.evaluate(async () => {
    const scene = (window as RenderingWindow).sceneUnderTest!;
    await scene['room'].request('activateAction', { action: 'sit' });
  });
  await page.locator('#zone-entries').getByRole('button', { name: '图块选择', exact: true }).click();
  await expect(page.locator('#variant-selector-panel')).toBeVisible();
  await page.waitForTimeout(550);
  await page.locator('#variant-choices [data-variant="computer"]').click();
  await expect.poll(() => page.evaluate(() => {
    const scene = (window as RenderingWindow).sceneUnderTest!;
    return scene['room'].state.worldObjects.get('workspace')?.objects.get('90')?.variant;
  })).toBe('computer');
}

for (const renderer of ['WebGL', 'Canvas'] as const) {
  test(`${renderer} renders animated Tiled layers and variant targets, with authored depth ordering`, async ({ page }) => {
    test.setTimeout(30000);
    await enter(page, renderer === 'Canvas');
    await expect.poll(() => page.evaluate(() => (window as RenderingWindow).sceneUnderTest?.game.renderer.type))
      .toBe(renderer === 'Canvas' ? 1 : 2);

    // The fixture intentionally uses unequal frame durations for both layer and object animations.
    const frameDurations = await page.evaluate(() => {
      const scene = (window as RenderingWindow).sceneUnderTest;
      const animatedLayer = scene?.children.list.find(child => child.type.startsWith('Tilemap') &&
        (child as Phaser.Tilemaps.TilemapLayer).layer.name === 'animated-probe') as Phaser.Tilemaps.TilemapLayer | undefined;
      const animatedTile = animatedLayer?.getTileAt(30, 18);
      const tileset = animatedTile?.tileset;
      const layerData = tileset?.getTileData(7) as { animation?: { duration: number }[] } | undefined;
      const variantData = tileset?.getTileData(8) as { animation?: { duration: number }[] } | undefined;
      return [layerData?.animation?.map(frame => frame.duration), variantData?.animation?.map(frame => frame.duration)];
    });
    expect(frameDurations).toEqual([[90, 270], [120, 360]]);
    await expectLayerOrdering(page);
    await expectBothAnimationFrames(page, { x: 488, y: 296 }, ['223,36,115', '34,68,238']);
    await expectBothAnimationFrames(page, { x: 296, y: 392 }, ['223,36,115', '34,68,238']);
    await expectBothAnimationFrames(page, { x: 312, y: 392 }, ['223,36,115', '34,68,238']);

    await selectAnimatedVariant(page);
    await expectBothAnimationFrames(page, { x: 392, y: 440 }, ['223,36,115', '34,68,238']);
  });
}
