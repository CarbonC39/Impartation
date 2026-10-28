import { expect, test, type Page } from '@playwright/test';
import type Phaser from 'phaser';
import type { WorldRegistry } from '@impartation/shared';
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

  await page.route('**/api/world', async route => {
    const response = await route.fetch();
    const registry = await response.json() as WorldRegistry;
    const world = registry.maps.find(map => map.id === 'workspace')!.world;
    // Keep the variant probe inside the private-area mask's clear region.
    const privateArea = world.zones.find(zone => zone.id === '30')!;
    privateArea.width = 160;
    world.zones.push(...['overlap-a', 'overlap-b'].map(id => ({ id, kind: 'board', resourceId: id, properties: {}, x: 336, y: 368, width: 32, height: 32 })),
      { id: 'overlap-wardrobe', kind: 'wardrobe', resourceId: '', properties: {}, x: 336, y: 368, width: 32, height: 32 });
    await route.fulfill({ response, json: registry });
  });
  await page.route('**/api/maps/workspace/map.json', async route => {
    const response = await route.fetch();
    const map = await response.json() as RenderMap;
    map.version = '1.10';
    const ground = map.layers.find(layer => layer.name === 'floor' && layer.type === 'tilelayer');
    if (!ground || !Array.isArray(ground.data)) throw new Error('Expected the fixture floor tile layer');
    const width = Number(ground.width);
    const height = Number(ground.height);
    const makeLayer = (name: string, properties: { name: string; type: string; value: boolean | number }[], cells: { x: number; y: number; gid: number }[]): TiledLayer => {
      const data = Array<number>(width * height).fill(0);
      for (const cell of cells) data[cell.y * width + cell.x] = cell.gid;
      return { id: 100 + map.layers.length, name, type: 'tilelayer', width, height, visible: true, opacity: 1, x: 0, y: 0, data,
        properties: properties.map(property => ({ ...property })) };
    };
    map.layers.push(
      makeLayer('wall-underlayer', [{ name: 'ySort', type: 'bool', value: true }], [
        ...[23, 24, 25].flatMap(y => [{ x: 26, y, gid: 2 }, { x: 27, y, gid: 2 }]),
      ]),
      makeLayer('sorted-probe', [{ name: 'ySort', type: 'bool', value: true }], [{ x: 18, y: 24, gid: 7 }, { x: 23, y: 24, gid: 7 }, { x: 20, y: 24, gid: 7 }]),
      makeLayer('above-players-probe', [{ name: 'abovePlayers', type: 'bool', value: true }], [{ x: 19, y: 24, gid: 7 }]),
      makeLayer('animated-probe', [], [{ x: 30, y: 18, gid: 7 }, { x: 28, y: 22, gid: 10 }]),
      { ...makeLayer('shifted-sort-probe', [{ name: 'ySort', type: 'bool', value: true }], [{ x: 23, y: 24, gid: 5 }]), offsety: 8 },
      { ...makeLayer('raised-sort-probe', [{ name: 'ySort', type: 'bool', value: true },
        { name: 'sortOffsetY', type: 'float', value: 0.5 }], [{ x: 20, y: 24, gid: 5 }]), offsety: -8 },
      { ...makeLayer('hanging-positive', [{ name: 'ySort', type: 'bool', value: true }], [{ x: 26, y: 24, gid: 5 }]), offsety: 8 },
      { ...makeLayer('hanging-negative', [{ name: 'ySort', type: 'bool', value: true }], [{ x: 27, y: 24, gid: 5 }]), offsety: -8 },
    );
    // Exercise both axes, fractional and multi-tile offsets, and nested group accumulation.
    for (const [index, [dx, dy]] of [[-24, -24], [-8, 8], [8, -8], [24, 24], [0.5, -0.5], [0, 0]].entries()) {
      const probe = makeLayer(`offset-matrix-${index}`, [{ name: 'ySort', type: 'bool', value: true }], [{ x: 24, y: 24, gid: 5 }]);
      map.layers.push({ name: `offset-group-${index}`, type: 'group', x: 2, y: 3, offsetx: dx / 2, offsety: dy / 2,
        opacity: 1, visible: true, layers: [{ name: 'nested', type: 'group', x: -2, y: -3, offsetx: dx / 2, offsety: dy / 2,
          opacity: 1, visible: true, layers: [{ ...probe, x: 1, y: -1 }] }] });
    }
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
  expect([...seen]).toContain(colors[0]);
  expect([...seen]).toContain(colors[1]);
}

async function expectLayerOrdering(page: Page) {
  const depths = await page.evaluate(() => {
    const scene = (window as RenderingWindow).sceneUnderTest;
    if (!scene) throw new Error('Scene missing');
    const player = scene.children.getByName(scene['room'].sessionId) as Phaser.GameObjects.Sprite | null;
    const images = scene.children.list.filter(child => child.type === 'Image') as Phaser.GameObjects.Image[];
    const sorted = images.find(child => child.name.startsWith('__ySort_sorted-probe_24_18_'));
    const layers = scene.children.list.filter(child => child.type.startsWith('Tilemap')) as Phaser.Tilemaps.TilemapLayer[];
    const overlay = layers.find(child => child.layer.name === 'above-players-probe');
    const shifted = images.find(child => child.name.startsWith('__ySort_shifted-sort-probe_24_23_'));
    const raised = images.find(child => child.name.startsWith('__ySort_raised-sort-probe_24_20_'));
    if (!player || !sorted || !overlay || !shifted || !raised) throw new Error('Expected rendered player and depth probe layers');
    return { player: player.depth, sorted: sorted.depth, overlay: overlay.depth,
      shifted: shifted.depth, shiftedY: shifted.y, raised: raised.depth, raisedY: raised.y,
      sortedName: sorted.name, shiftedName: shifted.name, raisedName: raised.name };
  });
  expect(depths.sorted).toBeGreaterThan(depths.player);
  expect(depths.overlay).toBeGreaterThan(515);
  expect(depths.shiftedY).toBe(400);
  expect(depths.shifted).toBeGreaterThanOrEqual(400);
  expect(depths.shifted).toBeLessThan(416.1);
  expect(depths.raisedY).toBe(384);
  expect(depths.raised).toBeGreaterThanOrEqual(384.5);
  expect(depths.raised).toBeLessThan(400.6);
  const matrix = await page.evaluate(() => {
    const scene = (window as RenderingWindow).sceneUnderTest!;
    return scene.children.list.filter(child => child.type === 'Image')
      .map(child => child as Phaser.GameObjects.Image)
      .filter(child => /^__ySort_offset-group-\d+\/nested\/offset-matrix-\d+_24_24_/.test(child.name))
      .map(child => ({ name: child.name, x: child.x, y: child.y, depth: child.depth }));
  });
  expect(matrix.length).toBeGreaterThanOrEqual(6);
  for (const [index, [dx, dy]] of [[-24, -24], [-8, 8], [8, -8], [24, 24], [0.5, -0.5], [0, 0]].entries()) {
    const fragments = matrix.filter(fragment => fragment.name.startsWith(`__ySort_offset-group-${index}/nested/offset-matrix-${index}_`));
    expect(fragments.length).toBeGreaterThan(0);
    for (const fragment of fragments) {
      expect(fragment.x).toBe(408 + dx);
      expect(fragment.y).toBe(376 + dy);
      const band = Number(fragment.name.split('_').at(-1));
      expect(fragment.depth).toBeGreaterThanOrEqual((band + 1) * 16);
      expect(fragment.depth).toBeLessThan((band + 1) * 16 + 0.1);
    }
  }
  // The later authored layer wins the overlap while retaining its 8px visual shift.
  expect(await pixelAtWorld(page, 376, 396)).toBe('24,168,74');
  expect(await pixelAtWorld(page, 328, 388)).toBe('24,168,74');
  for (const point of [{ x: 424, y: 396 }, { x: 424, y: 404 }, { x: 440, y: 380 }, { x: 440, y: 388 }]) {
    expect(await pixelAtWorld(page, point.x, point.y)).toBe('24,168,74');
  }
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

    const entries = page.locator('#zone-entries');
    await entries.getByRole('button', { name: '留言板 · overlap-b', exact: true }).click();
    await expect(page.locator('#board-panel')).toBeVisible();
    await expect(entries.getByRole('button', { name: '留言板 · overlap-b', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await entries.getByRole('button', { name: '留言板 · overlap-a', exact: true }).click();
    await expect(page.locator('#board-panel')).toBeVisible();
    await expect(entries.getByRole('button', { name: '留言板 · overlap-b', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await entries.getByRole('button', { name: '留言板 · overlap-a', exact: true }).click();
    await expect(page.locator('#board-panel')).toBeHidden();
    await expect(entries.getByRole('button', { name: '更衣处', exact: true })).toBeVisible();

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
    // Attachment pixels must match the same global GID on a static layer, at zero-based pixel coordinates.
    expect(await pixelAtWorld(page, 440, 360)).toBe('194,29,55');
    expect(await pixelAtWorld(page, 456, 360)).toBe('194,29,55');
    expect(await pixelAtWorld(page, 424, 344)).toBe('73,73,73');
    const partDepths = await page.evaluate(() => {
      const scene = (window as RenderingWindow).sceneUnderTest!;
      const visual = scene['sprites'].get(scene['room'].sessionId)!;
      return [...visual.layers, visual.attachment].map(part => part.depth);
    });
    expect(new Set(partDepths).size).toBe(1);
    await expectBothAnimationFrames(page, { x: 488, y: 296 }, ['223,36,115', '34,68,238']);
    await expectBothAnimationFrames(page, { x: 296, y: 392 }, ['223,36,115', '34,68,238']);
    await expectBothAnimationFrames(page, { x: 312, y: 392 }, ['223,36,115', '34,68,238']);

    await selectAnimatedVariant(page);
    await expectBothAnimationFrames(page, { x: 392, y: 440 }, ['223,36,115', '34,68,238']);
  });
}
