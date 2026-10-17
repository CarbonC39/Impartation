import Phaser from 'phaser';
import { Client, type Room } from '@colyseus/sdk';
import { APPEARANCE_ASSETS, DEFAULT_APPEARANCE, ROOM_NAME, appearanceSchema, joinSchema, chatSchema, worldRegistryResponseSchema, validateMapRegistry, type WorldRegistry, type SpaceProtocol, type MovementInput, type JoinOptions } from '@virtual-workspace/shared';
import { SpaceScene } from './SpaceScene';
import { drawAppearancePreview } from './appearancePreview';
import { createInteractions } from './interactions';
import type { InteractionDispatcher } from './interactions/dispatcher';
import { z } from 'zod';
import { zoneLabels } from './interactions/labels';
import { loadProfile, saveProfile, generateBinding, importBinding, type Profile } from './identity';
import './style.css';
import { createCharacterActions, type CharacterActions } from './interactions/actions';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}
const status = element('status');
const join = element<HTMLButtonElement>('join');
const joinFeedback = element('join-feedback');
const leave = element<HTMLButtonElement>('leave');
const send = element<HTMLButtonElement>('send');
const messageInput = element<HTMLInputElement>('message');
const messages = element<HTMLOListElement>('messages');
const zone = element('zone');
let game: Phaser.Game | undefined;
let scene: SpaceScene | undefined;
const themePicker = element<HTMLSelectElement>('theme');
const themes = ['meadow', 'ocean', 'sunset', 'lavender'] as const;
type Theme = typeof themes[number];
const themeBackgrounds: Record<Theme, string> = { meadow:'#bdebd0', ocean:'#b7e8ff', sunset:'#ffd2b5', lavender:'#e4caff' };
let currentTheme: Theme = themes.find(theme => theme === readPreference('virtual-workspace-theme')) ?? 'meadow';
function applyTheme(theme: Theme) {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  themePicker.value = theme;
  writePreference('virtual-workspace-theme', theme);
  if (game) game.canvas.style.backgroundColor = themeBackgrounds[theme];
}
applyTheme(currentTheme);
themePicker.addEventListener('change', () => {
  const theme = themes.find(value => value === themePicker.value);
  if (theme) applyTheme(theme);
});
const client = new Client(import.meta.env.VITE_SERVER_URL || window.location.origin);
let room: Room<SpaceProtocol> | undefined;
let connected = false;
let interactions: InteractionDispatcher | undefined;
let actions: CharacterActions | undefined;
let worldRegistry: WorldRegistry | undefined;
let renderedMap = '';
let renderingMap = '';
let renderGeneration = 0;
let selectedWorld = '阳光大厅';
let leavingIntentionally = false;

const chatCard = element('chat-card');
const chatToggle = element<HTMLButtonElement>('chat-toggle');
const chatUnread = element('chat-unread');
let unread = 0;
function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Preferences are optional. */ }
}
function setChatCollapsed(collapsed: boolean) {
  chatCard.classList.toggle('collapsed', collapsed);
  element('chat-body').hidden = collapsed;
  chatToggle.setAttribute('aria-expanded', String(!collapsed));
  chatToggle.setAttribute('aria-label', collapsed ? '展开聊天' : '折叠聊天');
  chatToggle.textContent = collapsed ? '展开' : '收起';
  if (!collapsed) setUnread(0);
  writePreference('virtual-workspace-chat-collapsed', String(collapsed));
}
function setUnread(count: number) {
  unread = count;
  chatUnread.hidden = count === 0;
  chatUnread.textContent = count > 99 ? '99+' : String(count);
}
setChatCollapsed(readPreference('virtual-workspace-chat-collapsed') === 'true');
chatToggle.addEventListener('click', () => {
  setChatCollapsed(!chatCard.classList.contains('collapsed'));
  chatToggle.blur(); // Return keyboard movement to the map.
});

function showScreen(id: string) {
  document.querySelectorAll<HTMLElement>('.flow-screen').forEach(screen => {
    const active = screen.id === id;
    screen.classList.toggle('active', active);
    screen.hidden = !active;
  });
  document.body.classList.toggle('map-open', id === 'map-screen');
}
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(value => { window.clearTimeout(timer); resolve(value); }, error => { window.clearTimeout(timer); reject(error); });
  });
}
element<HTMLButtonElement>('start').addEventListener('click', () => showScreen('world-screen'));
element<HTMLDivElement>('world-list').addEventListener('click', event => {
  const tile = (event.target as HTMLElement).closest<HTMLButtonElement>('.world-tile[data-world]');
  if (!tile) return;
  selectedWorld = tile.dataset.world === 'cloud-garden' ? '云朵花园' : '阳光大厅';
  element('chosen-world-label').textContent = selectedWorld;
  element('map-world-name').textContent = selectedWorld;
  showScreen('avatar-screen');
});
element<HTMLFormElement>('create-world-form').addEventListener('submit', event => {
  event.preventDefault();
  selectedWorld = element<HTMLInputElement>('world-name').value.trim() || '我的小世界';
  element('chosen-world-label').textContent = `${selectedWorld} · 新建`;
  element('map-world-name').textContent = selectedWorld;
  showScreen('avatar-screen');
});
document.querySelectorAll<HTMLButtonElement>('[data-back]').forEach(button => {
  button.addEventListener('click', () => showScreen(button.dataset.back ?? 'world-screen'));
});
type AppearancePart = keyof JoinOptions['appearance'];
const appearanceLabels: Record<string, string> = {
  walk: '基础身体', eyes: '默认面部', hair1: '发型一', hair2: '发型二',
  hair3: '发型三', hair4: '发型四', hair6: '发型六', hair7: '发型七',
  shirt: '衬衫', 't-shirt': '短袖', school_uniform: '校服', suit: '西装', pants: '长裤', skirt: '裙子', shoes: '基础鞋',
  accessories: '配饰', none: '不穿',
};
let currentAvatar: JoinOptions['avatar'] = 'mint';
let currentAppearance: JoinOptions['appearance'] = structuredClone(DEFAULT_APPEARANCE);
let activeAppearancePart: AppearancePart = 'body';
const previewCanvas = element<HTMLCanvasElement>('avatar-canvas');
function renderAppearancePreview() {
  void drawAppearancePreview(previewCanvas, currentAppearance).catch(error => {
    joinFeedback.textContent = error instanceof Error ? error.message : String(error);
  });
}
function changeAppearance(part: AppearancePart, change: Partial<JoinOptions['appearance'][AppearancePart]>) {
  currentAppearance = appearanceSchema.parse({ ...currentAppearance, [part]: { ...currentAppearance[part], ...change } });
  renderAppearancePreview();
}
function renderAppearanceOptions() {
  const container = element('appearance-choices');
  const assetLabel = document.createElement('label');
  assetLabel.textContent = '素材';
  const select = document.createElement('select');
  select.setAttribute('aria-label', '图层素材');
  for (const id of APPEARANCE_ASSETS[activeAppearancePart]) {
    const option = document.createElement('option');
    option.value = id; option.textContent = appearanceLabels[id] ?? id;
    select.append(option);
  }
  select.value = currentAppearance[activeAppearancePart].assetId;
  select.addEventListener('change', () => {
    const selected = APPEARANCE_ASSETS[activeAppearancePart].find(id => id === select.value);
    if (selected) changeAppearance(activeAppearancePart, { assetId: selected });
  });
  assetLabel.append(select);
  const colorLabel = document.createElement('label');
  colorLabel.textContent = activeAppearancePart === 'body' ? '身体乘色' : '颜色';
  const color = document.createElement('input');
  color.type = 'color'; color.value = currentAppearance[activeAppearancePart].color;
  color.setAttribute('aria-label', '选择 RGB 颜色');
  const hex = document.createElement('input');
  hex.type = 'text'; hex.maxLength = 7; hex.value = color.value;
  hex.pattern = '#[0-9a-fA-F]{6}'; hex.setAttribute('aria-label', '十六进制 RGB 颜色');
  color.addEventListener('input', () => { hex.value = color.value; changeAppearance(activeAppearancePart, { color: color.value }); });
  hex.addEventListener('change', () => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex.value)) { hex.value = currentAppearance[activeAppearancePart].color; return; }
    color.value = hex.value; changeAppearance(activeAppearancePart, { color: hex.value });
  });
  const colorFields = document.createElement('span');
  colorFields.className = 'appearance-color-fields';
  colorFields.append(color, hex);
  colorLabel.append(colorFields);
  container.replaceChildren(assetLabel, colorLabel);
}
document.querySelectorAll<HTMLButtonElement>('[data-appearance-category]').forEach(button => {
  button.addEventListener('click', () => {
    const part = button.dataset.appearanceCategory as AppearancePart | undefined;
    if (!part || !(part in APPEARANCE_ASSETS)) return;
    activeAppearancePart = part;
    document.querySelectorAll('[data-appearance-category]').forEach(tab => tab.setAttribute('aria-selected', String(tab === button)));
    renderAppearanceOptions();
  });
});
element<HTMLButtonElement>('randomize-appearance').addEventListener('click', () => {
  const random = <T extends readonly string[]>(values: T): T[number] => values[Math.floor(Math.random() * values.length)]!;
  const rgb = () => `#${Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0')}`;
  currentAppearance = appearanceSchema.parse(Object.fromEntries(
    Object.entries(APPEARANCE_ASSETS).map(([part, assets]) => [part, { assetId: random(assets), color: part === 'body' ? '#ffffff' : part === 'face' ? '#000000' : rgb() }])));
  renderAppearanceOptions();
  renderAppearancePreview();
});
element<HTMLButtonElement>('save-appearance').addEventListener('click', async event => {
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true;
  joinFeedback.textContent = '';
  try {
    await identityReady;
    const options = joinSchema.parse({ name: element<HTMLInputElement>('name').value,
      avatar: currentAvatar, appearance: currentAppearance });
    showIdentity(await saveProfile(options));
    joinFeedback.textContent = '造型已保存';
  } catch (error) {
    joinFeedback.textContent = `保存失败：${error instanceof Error ? error.message : String(error)}`;
  } finally { button.disabled = false; }
});
renderAppearanceOptions();
renderAppearancePreview();
const virtualDirections = new Set<string>();
window.addEventListener('blur', () => virtualDirections.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) virtualDirections.clear(); });
document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button => {
  const direction = button.dataset.move;
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    if (direction) virtualDirections.add(direction);
    button.setPointerCapture(event.pointerId);
  });
  const release = () => { if (direction) virtualDirections.delete(direction); };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
});
function readVirtualInput(): MovementInput {
  return { x:Number(virtualDirections.has('right'))-Number(virtualDirections.has('left')),
    y:Number(virtualDirections.has('down'))-Number(virtualDirections.has('up')) };
}

function showIdentity(value: Profile) {
  element('identity-status').textContent = `身份：${value.id} · ${value.role === 'admin' ? '管理员' : '成员'}`;
  element<HTMLInputElement>('name').value = value.name;
  currentAvatar = value.avatar;
  currentAppearance = appearanceSchema.parse(value.appearance);
  renderAppearanceOptions();
  renderAppearancePreview();
  element<HTMLButtonElement>('identity-export').disabled = false;
}
join.disabled = true;
const identityReady = loadProfile().then(value => { if (value) showIdentity(value); }).catch(error => {
  status.textContent = error instanceof Error ? error.message : String(error);
}).finally(() => { join.disabled = false; element('identity-status').dataset.ready = 'true'; });

element<HTMLButtonElement>('identity-export').addEventListener('click', async () => {
  try {
    element<HTMLInputElement>('identity-code').value = await generateBinding();
    element('identity-feedback').textContent = '绑定码 3 分钟内有效，只能使用一次。获得绑定码的设备将拥有此身份及权限。';
  } catch (error) { element('identity-feedback').textContent = error instanceof Error ? error.message : String(error); }
});
element<HTMLFormElement>('identity-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (room) { element('identity-feedback').textContent = '请先离开空间再绑定身份'; return; }
  const button = element<HTMLButtonElement>('identity-import');
  button.disabled = true;
  join.disabled = true;
  try {
    await identityReady;
    showIdentity(await importBinding(element<HTMLInputElement>('identity-code').value.trim()));
    element<HTMLInputElement>('identity-code').value = '';
    element('identity-feedback').textContent = '已绑定同一身份';
  } catch (error) { element('identity-feedback').textContent = error instanceof Error ? error.message : String(error); }
  finally { button.disabled = false; join.disabled = Boolean(room); }
});

function setConnected(value: boolean) {
  connected = value;
  send.disabled = !value;
  messageInput.disabled = !value;
  interactions?.setConnected(value);
  actions?.refresh();
}
function cleanup() {
  virtualDirections.clear();
  renderGeneration++;
  worldRegistry = undefined; renderedMap = ''; renderingMap = '';
  interactions?.dispose();
  interactions = undefined;
  actions?.dispose();
  actions = undefined;
  element('object-feedback').textContent = '';
  game?.destroy(true);
  game = undefined;
  scene = undefined;
  room = undefined;
  setUnread(0);
  setConnected(false);
  join.disabled = false;
  leave.disabled = true;
  element<HTMLButtonElement>('identity-import').disabled = false;
  zone.textContent = '当前区域：无';
}
element<HTMLFormElement>('join-form').addEventListener('submit', async event => {
  event.preventDefault();
  showScreen('map-screen');
  join.disabled = true;
  joinFeedback.textContent = '';
  status.textContent = '连接中…';
  try {
    await identityReady;
    const options = joinSchema.parse({ name: element<HTMLInputElement>('name').value,
      avatar: currentAvatar, appearance: currentAppearance });
    showIdentity(await saveProfile(options));
    element<HTMLButtonElement>('identity-import').disabled = true;
    const response = await fetch('/api/world', { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error('地图目录加载失败');
    worldRegistry = validateMapRegistry(worldRegistryResponseSchema.parse(await response.json()));
    const pendingRoom = client.joinOrCreate<SpaceProtocol>(ROOM_NAME, options);
    try { room = await withTimeout(pendingRoom, 15_000, '连接空间超时，请检查服务是否启动后重试'); }
    catch (error) { void pendingRoom.then(lateRoom => lateRoom.leave()).catch(() => {}); throw error; }
    room.reconnection.minUptime = 0;
    if (!room.state?.players) await withTimeout(new Promise<void>(resolve => room!.onStateChange.once(() => resolve())),
      10_000, '空间已连接，但没有收到地图角色数据');
    interactions = createInteractions(room);
    const actionRoom = room;
    actions = createCharacterActions(room, () => {
      const mapId = actionRoom.state.players.get(actionRoom.sessionId)?.mapId;
      return worldRegistry?.maps.find(map => map.id === mapId)?.world;
    });
    messages.replaceChildren();
    room.onMessage('chat', message => {
      const li = document.createElement('li');
      li.textContent = `${message.name}：${message.text}`;
      messages.append(li);
      if (messages.children.length > 100) messages.firstElementChild?.remove();
      messages.scrollTop = messages.scrollHeight;
      if (chatCard.classList.contains('collapsed')) setUnread(unread + 1);
      scene?.showBubble(message.sessionId, message.text);
    });
    room.onDrop(() => { setConnected(false); status.textContent = '连接中断，正在自动重连…'; });
    room.onReconnect(() => { setConnected(true); status.textContent = '连接已恢复'; });
    room.onLeave(() => { cleanup(); status.textContent = '已离开，可以重新进入'; });
    room.onError((_code, message) => { status.textContent = `房间错误：${message}`; });
    const activeRoom = room;
    room.onStateChange(() => {
      if (room !== activeRoom) return;
      const mapId = activeRoom.state.players.get(activeRoom.sessionId)?.mapId;
      if (mapId && renderedMap !== mapId && renderingMap !== mapId) {
        void renderWorld(mapId, activeRoom).catch(error => { status.textContent = `地图加载失败：${String(error)}`; });
      }
    });
    await renderWorld(room.state?.players?.get(room.sessionId)?.mapId ?? worldRegistry.initialMap, room);
    setConnected(true);
    leave.disabled = false;
    status.textContent = `已进入空间 · ${room.sessionId}`;
    join.blur();
  } catch (error) {
    void room?.leave().catch(() => {});
    cleanup();
    showScreen('avatar-screen');
    joinFeedback.textContent = `进入失败：${error instanceof Error ? error.message : String(error)}`;
  }
});
const renderMapSchema = z.object({ tilesets: z.array(z.object({ name: z.string(), image: z.string().optional() }).passthrough()).default([]) }).passthrough();
async function renderWorld(mapId: string, activeRoom: Room<SpaceProtocol>) {
  const entry = worldRegistry?.maps.find(map => map.id === mapId);
  if (!entry) throw new Error(`Unknown map: ${mapId}`);
  const generation = ++renderGeneration;
  renderingMap = mapId;
  interactions?.setZone(undefined);
  try {
    const response = await fetch(entry.url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error('地图加载失败');
    const renderMap = renderMapSchema.parse(await response.json());
    if (generation !== renderGeneration || room !== activeRoom) return;
    game?.destroy(true);
    const zoneAnchor = element('zone-anchor');
    scene = new SpaceScene(activeRoom, entry, renderMap, {
      zoneChanged: id => {
        const current = entry.world.zones.find(item => item.id === id);
        const text = current ? `当前区域：${zoneLabels[current.kind] ?? current.kind}` : '当前区域：无';
        if (zone.textContent !== text) zone.textContent = text;
        interactions?.setZone(current);
      },
      zoneAnchor: point => {
        zoneAnchor.hidden = !point;
        if (point) zoneAnchor.style.transform = `translate(${point.x}px, ${point.y}px)`;
      },
      activate: () => { void actions?.activate(); },
      virtualInput: readVirtualInput,
    });
    game = new Phaser.Game({
      type: Phaser.AUTO, parent: 'game', width: entry.world.width, height: entry.world.height,
      backgroundColor: '#2b423e',
      pixelArt: true,
      scale: { mode: Phaser.Scale.RESIZE },
      scene,
    });
    renderedMap = mapId;
  } finally { if (generation === renderGeneration) renderingMap = ''; }
}

leave.addEventListener('click', () => { leavingIntentionally = true; leave.disabled = true; void room?.leave(); showScreen('world-screen'); });
element<HTMLFormElement>('chat-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!connected || !room) return;
  const payload = chatSchema.safeParse({ text: messageInput.value });
  if (!payload.success) return;
  room.send('chat', payload.data);
  messageInput.value = '';
});
