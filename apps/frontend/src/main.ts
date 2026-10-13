import Phaser from 'phaser';
import { Client, type Room } from '@colyseus/sdk';
import { ROOM_NAME, joinSchema, chatSchema, worldRegistryResponseSchema, validateMapRegistry, type WorldRegistry, type SpaceProtocol, type MovementInput } from '@virtual-workspace/shared';
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
function updateAvatarPreview() {
  const selected = avatarChoices.find(input => input.checked);
  const sprite = selected?.closest('.avatar-choice')?.querySelector('.avatar-face svg');
  if (selected) element<HTMLSelectElement>('avatar').value = selected.value;
  if (sprite) element('avatar-preview').replaceChildren(sprite.cloneNode(true));
}
avatarChoices.forEach(input => input.addEventListener('change', updateAvatarPreview));
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
  status.textContent = '连接中…';
  try {
    await identityReady;
    const options = joinSchema.parse({ name: element<HTMLInputElement>('name').value,
      avatar: element<HTMLSelectElement>('avatar').value });
    showIdentity(await saveProfile(options));
    element<HTMLButtonElement>('identity-import').disabled = true;
    const response = await fetch('/api/world');
    if (!response.ok) throw new Error('地图目录加载失败');
    worldRegistry = validateMapRegistry(worldRegistryResponseSchema.parse(await response.json()));
    room = await client.joinOrCreate<SpaceProtocol>(ROOM_NAME, options);
    room.reconnection.minUptime = 0;
    if (!room.state?.players) await new Promise<void>(resolve => room!.onStateChange.once(() => resolve()));
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
    await room?.leave();
    cleanup();
    status.textContent = `连接失败：${error instanceof Error ? error.message : String(error)}`;
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
    const response = await fetch(entry.url);
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
