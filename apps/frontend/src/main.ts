import Phaser from 'phaser';
import { Client, type Room } from '@colyseus/sdk';
import { DEFAULT_APPEARANCE, ROOM_NAME, appearanceSchema, joinSchema, chatSchema, worldRegistryResponseSchema, validateMapRegistry, type WorldRegistry, type SpaceProtocol, type MovementInput, type JoinOptions } from '@virtual-workspace/shared';
import { SpaceScene } from './SpaceScene';
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
const themePicker = element<HTMLSelectElement>('theme');
const themes = ['meadow', 'ocean', 'sunset', 'lavender'] as const;
type Theme = typeof themes[number];
const themeBackgrounds: Record<Theme, string> = { meadow:'#bdebd0', ocean:'#b7e8ff', sunset:'#ffd2b5', lavender:'#e4caff' };
let currentTheme: Theme = themes.find(theme => theme === localStorage.getItem('virtual-workspace-theme')) ?? 'meadow';
function applyTheme(theme: Theme) {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  themePicker.value = theme;
  localStorage.setItem('virtual-workspace-theme', theme);
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
element<HTMLFormElement>('login-form').addEventListener('submit', event => {
  event.preventDefault();
  showScreen('world-screen');
});
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
const avatarChoices = [...document.querySelectorAll<HTMLInputElement>('input[name="avatar-choice"]')];
type AppearancePart = keyof JoinOptions['appearance'];
const appearanceChoices: Record<AppearancePart, readonly string[]> = {
  skin: ['light', 'warm', 'deep'], hair: ['short', 'long', 'bun'],
  hairColor: ['dark', 'brown', 'blonde', 'pink'], top: ['tee', 'sweater', 'overall'],
  topColor: ['coral', 'sunshine', 'sky', 'leaf', 'lilac'], bottom: ['pants', 'skirt', 'shorts'],
  bottomColor: ['denim', 'navy', 'plum', 'mint'], accessory: ['none', 'glasses', 'flower', 'hat'],
};
const appearanceLabels: Record<string, string> = {
  light:'白皙', warm:'暖调', deep:'小麦', short:'短发', long:'长发', bun:'丸子头',
  dark:'黑色', brown:'棕色', blonde:'金色', pink:'粉色', tee:'短袖', sweater:'毛衣', overall:'背带裤',
  coral:'珊瑚红', sunshine:'向日黄', sky:'天空蓝', leaf:'嫩叶绿', lilac:'丁香紫',
  pants:'长裤', skirt:'裙子', shorts:'短裤', denim:'牛仔蓝', navy:'海军蓝', plum:'梅子紫', mint:'薄荷绿',
  none:'无', glasses:'眼镜', flower:'小花', hat:'帽子',
};
const appearanceColors = {
  skin: { light:'#f7d6bd', warm:'#d99a70', deep:'#a9684c' },
  hairColor: { dark:'#343344', brown:'#704b3c', blonde:'#efc75e', pink:'#dc7196' },
  topColor: { coral:'#f07872', sunshine:'#f2c552', sky:'#64a9df', leaf:'#67ae80', lilac:'#aa82cf' },
  bottomColor: { denim:'#587eaa', navy:'#354d71', plum:'#805a91', mint:'#6aa989' },
} as const;
let currentAppearance: JoinOptions['appearance'] = { ...DEFAULT_APPEARANCE };
let activeAppearancePart: AppearancePart = 'skin';
function renderAppearancePreview() {
  const skin = appearanceColors.skin[currentAppearance.skin];
  const hair = appearanceColors.hairColor[currentAppearance.hairColor];
  const top = appearanceColors.topColor[currentAppearance.topColor];
  const bottom = appearanceColors.bottomColor[currentAppearance.bottomColor];
  const hairShape = currentAppearance.hair === 'long'
    ? `<path fill="${hair}" d="M16 27V14h4V9h24v5h4v26h-6V23H20v17h-4z"/>`
    : currentAppearance.hair === 'bun'
      ? `<path fill="${hair}" d="M16 27V14h4V9h20v5h4v13H20v-4z"/><rect x="37" y="3" width="10" height="10" fill="${hair}"/>`
      : `<path fill="${hair}" d="M16 27V14h4V9h24v5h4v13H20v-4z"/>`;
  const garment = currentAppearance.top === 'overall'
    ? `<path fill="${top}" d="M14 39h36v26H14zM19 34h7v17h-7zM38 34h7v17h-7z"/><path fill="#f5d675" d="M18 47h9v7h-9zM37 47h9v7h-9z"/>`
    : `<path fill="${top}" d="M18 37h28l8 9-5 7-5-4v17H20V49l-5 4-5-7z"/><path fill="#ffffff55" d="M27 38h10v4H27z"/>`;
  const lower = currentAppearance.bottom === 'skirt'
    ? `<path fill="${bottom}" d="M19 63h26l7 17H12z"/>`
    : currentAppearance.bottom === 'shorts'
      ? `<path fill="${bottom}" d="M19 62h26v12H34v-6h-4v6H19z"/>`
      : `<path fill="${bottom}" d="M19 62h26v18H32V68h-4v12H16z"/>`;
  const accessory = currentAppearance.accessory === 'glasses'
    ? '<path fill="none" stroke="#343344" stroke-width="3" d="M20 27h9v7h-9zM35 27h9v7h-9zM29 29h6" />'
    : currentAppearance.accessory === 'flower'
      ? '<path fill="#f486a1" d="M42 12h4v4h4v4h-4v4h-4v-4h-4v-4h4z"/><rect x="43" y="16" width="3" height="3" fill="#ffd86a"/>'
      : currentAppearance.accessory === 'hat'
        ? '<path fill="#f2c552" d="M13 13h38v5H13zM20 6h24v8H20z"/>' : '';
  element('avatar-preview').innerHTML = `<svg class="avatar-diy-sprite pixel-svg" viewBox="0 0 64 84" aria-hidden="true"><ellipse cx="32" cy="80" rx="20" ry="3" fill="#23324733"/><path fill="${bottom}" d="M25 72h6v9h-6zM36 72h6v9h-6z"/>${lower}${garment}<path fill="${skin}" d="M12 42h7v16h-7zM45 42h7v16h-7zM22 16h20v24H22z"/>${hairShape}<path fill="#343344" d="M26 27h3v4h-3zM36 27h3v4h-3z"/><path fill="#aa5260" d="M29 35h7v2h-7z"/>${accessory}</svg>`;
  renderAppearanceOptions();
}
function renderAppearanceOptions() {
  const values = appearanceChoices[activeAppearancePart];
  const container = element('appearance-choices');
  container.replaceChildren(...values.map(value => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'appearance-option';
    button.dataset.appearanceValue = value;
    button.setAttribute('aria-pressed', String(currentAppearance[activeAppearancePart] === value));
    const swatch = document.createElement('span'); swatch.className = 'appearance-swatch';
    if (activeAppearancePart in appearanceColors) {
      const palette = appearanceColors[activeAppearancePart as keyof typeof appearanceColors] as Record<string, string>;
      swatch.style.backgroundColor = palette[value];
    } else swatch.textContent = activeAppearancePart === 'hair' ? '发' : activeAppearancePart === 'accessory' ? '饰' : '衣';
    button.append(swatch, document.createTextNode(appearanceLabels[value] ?? value));
    button.addEventListener('click', () => {
      currentAppearance = appearanceSchema.parse({ ...currentAppearance, [activeAppearancePart]: value });
      renderAppearancePreview();
    });
    return button;
  }));
}
document.querySelectorAll<HTMLButtonElement>('[data-appearance-category]').forEach(button => {
  button.addEventListener('click', () => {
    const part = button.dataset.appearanceCategory as AppearancePart | undefined;
    if (!part || !(part in appearanceChoices)) return;
    activeAppearancePart = part;
    document.querySelectorAll('[data-appearance-category]').forEach(tab => tab.setAttribute('aria-selected', String(tab === button)));
    renderAppearanceOptions();
  });
});
element<HTMLButtonElement>('randomize-appearance').addEventListener('click', () => {
  const random = <T extends readonly string[]>(values: T): T[number] => values[Math.floor(Math.random() * values.length)]!;
  currentAppearance = appearanceSchema.parse(Object.fromEntries(Object.entries(appearanceChoices).map(([part, values]) => [part, random(values)])));
  renderAppearancePreview();
});
element<HTMLButtonElement>('save-appearance').addEventListener('click', async event => {
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true;
  joinFeedback.textContent = '';
  try {
    await identityReady;
    const options = joinSchema.parse({ name: element<HTMLInputElement>('name').value,
      avatar: element<HTMLSelectElement>('avatar').value, appearance: currentAppearance });
    showIdentity(await saveProfile(options));
    joinFeedback.textContent = '造型已保存';
  } catch (error) {
    joinFeedback.textContent = `保存失败：${error instanceof Error ? error.message : String(error)}`;
  } finally { button.disabled = false; }
});
function updateAvatarPreview() {
  const selected = avatarChoices.find(input => input.checked);
  if (selected) element<HTMLSelectElement>('avatar').value = selected.value;
  renderAppearancePreview();
}
avatarChoices.forEach(input => input.addEventListener('change', updateAvatarPreview));
updateAvatarPreview();
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
  element<HTMLSelectElement>('avatar').value = value.avatar;
  currentAppearance = appearanceSchema.parse(value.appearance);
  const choice = avatarChoices.find(input => input.value === value.avatar);
  if (choice) { choice.checked = true; updateAvatarPreview(); }
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
  room = undefined;
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
      avatar: element<HTMLSelectElement>('avatar').value, appearance: currentAppearance });
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
    actions = createCharacterActions(room);
    messages.replaceChildren();
    room.onMessage('chat', message => {
      const li = document.createElement('li');
      li.textContent = `${message.name}：${message.text}`;
      messages.append(li);
      if (messages.children.length > 100) messages.firstElementChild?.remove();
      messages.scrollTop = messages.scrollHeight;
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
    game = new Phaser.Game({
      type: Phaser.AUTO, parent: 'game', width: entry.world.width, height: entry.world.height,
      backgroundColor: '#2b423e',
      pixelArt: true,
      scale: { mode: Phaser.Scale.RESIZE },
      scene: new SpaceScene(activeRoom, entry, renderMap, id => {
        const current = entry.world.zones.find(item => item.id === id);
        const text = current ? `当前区域：${zoneLabels[current.kind] ?? current.kind}` : '当前区域：无';
        if (zone.textContent !== text) zone.textContent = text;
        interactions?.setZone(current);
      }, () => { void actions?.activate(); }, readVirtualInput),
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
