import Phaser from 'phaser';
import { Client, type Room } from '@colyseus/sdk';
import { ROOM_NAME, appearanceSchema, joinSchema, chatSchema, worldRegistryResponseSchema, validateMapRegistry, type WorldRegistry, type SpaceProtocol, type MovementInput, type JoinOptions } from '@virtual-workspace/shared';
import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/700.css';
import { SpaceScene } from './SpaceScene';
import { drawAppearancePreview } from './appearancePreview';
import { createInteractions } from './interactions';
import type { InteractionDispatcher } from './interactions/dispatcher';
import { z } from 'zod';
import { zoneLabels } from './interactions/labels';
import { loadProfile, saveProfile, generateBinding, importBinding, type Profile } from './identity';
import './style.css';
import { createCharacterActions, type CharacterActions } from './interactions/actions';
import { readPreference, writePreference } from './preferences';
import { mountThemePanel } from './theme';
import { Wardrobe } from './wardrobe';
import { mountOutfitSlots } from './outfitSlots';
import { ProximityVoice } from './voice';
import { TouchPad } from './touchPad';
import { ChatLayout } from './chatLayout';
import { HeadOverlay } from './headOverlay';
import { mountPrejoin, type VoicePlan } from './prejoin';
import { fillMicrophoneSelect, preferredMicrophone, setPreferredMicrophone } from './microphone';

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
mountThemePanel(element<HTMLButtonElement>('theme-toggle'), element('theme-panel'));
const client = new Client(import.meta.env.VITE_SERVER_URL || window.location.origin);
let room: Room<SpaceProtocol> | undefined;
let connected = false;
let interactions: InteractionDispatcher | undefined;
let actions: CharacterActions | undefined;
let voice: ProximityVoice | undefined;
const voiceToggle = element<HTMLButtonElement>('voice-toggle');
const voiceMute = element<HTMLButtonElement>('voice-mute');
voiceToggle.addEventListener('click', () => { void voice?.toggle(); voiceToggle.blur(); });
voiceMute.addEventListener('click', () => { voice?.toggleMute(); voiceMute.blur(); });
const voiceDevice = element<HTMLSelectElement>('voice-device');
function refreshVoiceDevices() { void fillMicrophoneSelect(voiceDevice, voice?.deviceId || preferredMicrophone()); }
voiceDevice.addEventListener('change', () => {
  if (voice) void voice.setDevice(voiceDevice.value); else setPreferredMicrophone(voiceDevice.value);
});
navigator.mediaDevices?.addEventListener?.('devicechange', refreshVoiceDevices);
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
const headOverlay = new HeadOverlay(element('head-overlay'));
const chatLayout = new ChatLayout(chatCard, element('chat-drag'), element('chat-resize'), element('messages'));
element<HTMLButtonElement>('chat-reset').addEventListener('click', event => {
  chatLayout.reset();
  (event.currentTarget as HTMLButtonElement).blur();
});
chatToggle.addEventListener('click', () => {
  setChatCollapsed(!chatCard.classList.contains('collapsed'));
  chatToggle.blur(); // Return keyboard movement to the map.
});

// Map display preferences: name tags and the chat background.
const chatModes = ['clear', 'half', 'solid'] as const;
type ChatMode = typeof chatModes[number];
let namesVisible = readPreference('virtual-workspace-show-names') !== 'false';
function setNamesVisible(visible: boolean) {
  namesVisible = visible;
  writePreference('virtual-workspace-show-names', String(visible));
  element('toggle-names').setAttribute('aria-pressed', String(visible));
  element('names-switch').setAttribute('aria-checked', String(visible));
}
function setChatMode(mode: ChatMode) {
  chatCard.dataset.mode = mode;
  writePreference('virtual-workspace-chat-mode', mode);
  document.querySelectorAll<HTMLButtonElement>('[data-chat-mode]').forEach(button =>
    button.setAttribute('aria-checked', String(button.dataset.chatMode === mode)));
}
setNamesVisible(namesVisible);
setChatMode(chatModes.find(mode => mode === readPreference('virtual-workspace-chat-mode')) ?? 'half');
for (const id of ['toggle-names', 'names-switch']) {
  element<HTMLButtonElement>(id).addEventListener('click', event => {
    setNamesVisible(!namesVisible);
    (event.currentTarget as HTMLButtonElement).blur();
  });
}
document.querySelectorAll<HTMLButtonElement>('[data-chat-mode]').forEach(button => button.addEventListener('click', () => {
  const mode = chatModes.find(value => value === button.dataset.chatMode);
  if (mode) setChatMode(mode);
}));
const settingsToggle = element<HTMLButtonElement>('settings-toggle');
settingsToggle.addEventListener('click', () => {
  const panel = element('settings-panel');
  panel.hidden = !panel.hidden;
  settingsToggle.setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) refreshVoiceDevices();
});

function showScreen(id: string) {
  document.querySelectorAll<HTMLElement>('.flow-screen').forEach(screen => {
    const active = screen.id === id;
    screen.classList.toggle('active', active);
    screen.hidden = !active;
  });
  document.body.classList.toggle('map-open', id === 'map-screen');
  if (id === 'map-screen') { touchPad.refresh(); chatLayout.refresh(); element('theme-panel').hidden = true; element('theme-toggle').setAttribute('aria-expanded', 'false'); }
  if (id === 'login-screen') renderWelcome();
}
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(value => { window.clearTimeout(timer); resolve(value); }, error => { window.clearTimeout(timer); reject(error); });
  });
}
function chooseWorld(name: string, isNew = false) {
  selectedWorld = name;
  element('chosen-world-label').textContent = isNew ? `${name} · 新建` : name;
  element('join-world-name').textContent = name;
  element('map-world-name').textContent = name;
  showScreen('avatar-screen');
}
element<HTMLDivElement>('world-list').addEventListener('click', event => {
  const tile = (event.target as HTMLElement).closest<HTMLButtonElement>('.world-tile[data-world]');
  if (tile) chooseWorld(tile.dataset.world === 'cloud-garden' ? '云朵花园' : '阳光大厅');
});
element<HTMLFormElement>('create-world-form').addEventListener('submit', event => {
  event.preventDefault();
  chooseWorld(element<HTMLInputElement>('world-name').value.trim() || '我的小世界', true);
});
document.querySelectorAll<HTMLButtonElement>('[data-back]').forEach(button => {
  button.addEventListener('click', () => showScreen(button.dataset.back ?? 'login-screen'));
});

let currentAvatar: JoinOptions['avatar'] = 'mint';
const nameInput = element<HTMLInputElement>('name');
const wardrobe = new Wardrobe({
  preview: element<HTMLCanvasElement>('avatar-canvas'), facingLabel: element('facing-label'), nameTag: element('avatar-name-tag'), nameInput,
  turnLeft: element<HTMLButtonElement>('turn-left'), turnRight: element<HTMLButtonElement>('turn-right'), sit: element<HTMLButtonElement>('preview-sit'),
  undo: element<HTMLButtonElement>('undo-appearance'), randomize: element<HTMLButtonElement>('randomize-appearance'),
  tabs: [...document.querySelectorAll<HTMLButtonElement>('[data-appearance-category]')],
  items: element('appearance-choices'), swatches: element('appearance-swatches'), swatchTitle: element('swatch-title'),
  picker: element('appearance-picker'), colorTitle: element('color-title'),
  onError: message => { joinFeedback.textContent = message; },
});
function renderWelcome() {
  element('welcome-name').textContent = nameInput.value.trim() || '小访客';
  void drawAppearancePreview(element<HTMLCanvasElement>('welcome-canvas'), wardrobe.value).catch(() => {});
}
async function persistProfile() {
  await identityReady;
  const options = joinSchema.parse({ name: nameInput.value, avatar: currentAvatar, appearance: wardrobe.value });
  showIdentity(await saveProfile(options));
}
const outfits = mountOutfitSlots(element<HTMLDialogElement>('outfit-dialog'), element('outfit-slots'), element('outfit-status'), {
  current: () => wardrobe.value,
  wear: appearance => wardrobe.replace(appearance),
  saved: async () => {
    try { await persistProfile(); return '也已设为当前身份的造型'; }
    catch (error) { return `但同步到身份失败：${error instanceof Error ? error.message : String(error)}`; }
  },
});
element<HTMLButtonElement>('save-appearance').addEventListener('click', () => outfits.open());
renderWelcome();
const touchPad = new TouchPad(element('touch-controls'), element('touch-grip'));
window.addEventListener('blur', () => touchPad.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) touchPad.clear(); });
element<HTMLButtonElement>('touch-reset').addEventListener('click', event => {
  touchPad.resetPosition();
  (event.currentTarget as HTMLButtonElement).blur();
});

function showIdentity(value: Profile) {
  element('identity-status').textContent = `身份：${value.id} · ${value.role === 'admin' ? '管理员' : '成员'}`;
  nameInput.value = value.name;
  currentAvatar = value.avatar;
  wardrobe.replace(appearanceSchema.parse(value.appearance), false);
  renderWelcome();
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
  voice?.setConnected(value);
  send.disabled = !value;
  messageInput.disabled = !value;
  interactions?.setConnected(value);
  actions?.refresh();
}
function cleanup() {
  touchPad.clear();
  resetTyping();
  headOverlay.clear();
  renderGeneration++;
  worldRegistry = undefined; renderedMap = ''; renderingMap = '';
  interactions?.dispose();
  voice?.dispose();
  voice = undefined;
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
const prejoin = mountPrejoin({
  dialog: element<HTMLDialogElement>('prejoin-dialog'), worldLabels: [element('prejoin-world'), element('prejoin-enter-world')],
  micSwitch: element<HTMLButtonElement>('prejoin-mic'), options: element('prejoin-mic-options'),
  device: element<HTMLSelectElement>('prejoin-device'), level: element('prejoin-level'),
  muted: element<HTMLInputElement>('prejoin-muted'), status: element('prejoin-status'),
  enter: element<HTMLButtonElement>('prejoin-enter'), cancel: element<HTMLButtonElement>('prejoin-cancel'),
}, plan => { void enterWorld(plan); });
element<HTMLFormElement>('join-form').addEventListener('submit', event => {
  event.preventDefault();
  if (join.disabled) return;
  joinFeedback.textContent = '';
  prejoin.open(selectedWorld);
});
async function enterWorld(plan: VoicePlan) {
  showScreen('map-screen');
  join.disabled = true;
  joinFeedback.textContent = '';
  status.textContent = '连接中…';
  try {
    await identityReady;
    const options = joinSchema.parse({ name: nameInput.value, avatar: currentAvatar, appearance: wardrobe.value });
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
    voice = new ProximityVoice(room, voiceToggle, voiceMute, element('voice-status'));
    voice.onDeviceChange = refreshVoiceDevices;
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
    if (plan.enabled) {
      const stream = plan.stream;
      plan.stream = undefined;
      void voice.enable({ ...(stream ? { stream } : {}), muted: plan.muted });
    }
  } catch (error) {
    plan.stream?.getTracks().forEach(track => track.stop());
    void room?.leave().catch(() => {});
    cleanup();
    showScreen('avatar-screen');
    joinFeedback.textContent = `进入失败：${error instanceof Error ? error.message : String(error)}`;
  }
}
const renderMapSchema = z.object({ tilesets: z.array(z.object({ name: z.string(), image: z.string().optional() }).passthrough()).default([]) }).passthrough();
async function renderWorld(mapId: string, activeRoom: Room<SpaceProtocol>) {
  const entry = worldRegistry?.maps.find(map => map.id === mapId);
  if (!entry) throw new Error(`Unknown map: ${mapId}`);
  const generation = ++renderGeneration;
  if (renderedMap && renderedMap !== mapId) voice?.mapChanged();
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
      virtualInput: () => touchPad.read(),
      chatInput: readChatInput,
      namesVisible: () => namesVisible,
      speaking: id => voice?.isSpeaking(id) ?? false,
      overlay: headOverlay,
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

leave.addEventListener('click', () => { leavingIntentionally = true; leave.disabled = true; void room?.leave(); showScreen('login-screen'); });
// Enter opens the chat from the map; while typing, arrow keys still walk (handled by the scene),
// and Esc or Enter on an empty line hands the keyboard back to the map.
function focusMap() {
  messageInput.blur();
  document.querySelector<HTMLCanvasElement>('#game canvas')?.focus();
}
const arrowKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const chatArrows = new Set<string>();
function readChatInput(): MovementInput {
  return { x: Number(chatArrows.has('ArrowRight')) - Number(chatArrows.has('ArrowLeft')),
    y: Number(chatArrows.has('ArrowDown')) - Number(chatArrows.has('ArrowUp')) };
}
messageInput.addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (arrowKeys.has(event.key)) { event.preventDefault(); chatArrows.add(event.key); }
  else if (event.key === 'Escape' || (event.key === 'Enter' && !messageInput.value.trim())) { event.preventDefault(); focusMap(); }
});
messageInput.addEventListener('keyup', event => { chatArrows.delete(event.key); });
messageInput.addEventListener('blur', () => chatArrows.clear());
window.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.isComposing || event.repeat || !connected || messageInput.disabled) return;
  if (!document.body.classList.contains('map-open')) return;
  const target = event.target;
  if (target instanceof HTMLElement && target !== document.body && !(target instanceof HTMLCanvasElement)) return;
  event.preventDefault();
  if (chatCard.classList.contains('collapsed')) setChatCollapsed(false);
  messageInput.focus();
});
// "Typing…" hint: sent while the chat box has text and focus, refreshed while keys keep coming,
// and dropped after a pause. The server expires it too, so a lost "false" never sticks.
const TYPING_REFRESH_MS = 3000;
const TYPING_IDLE_MS = 5000;
let shareTyping = readPreference('virtual-workspace-share-typing') !== 'false';
let typingSent = false;
let typingSentAt = 0;
let typingIdle: number | undefined;
function sendTyping(typing: boolean) {
  if (typing === typingSent && (!typing || performance.now() - typingSentAt < TYPING_REFRESH_MS)) return;
  typingSent = typing;
  typingSentAt = performance.now();
  if (connected && room?.connection.isOpen) room.send('typing', { typing });
}
function resetTyping() {
  window.clearTimeout(typingIdle);
  typingIdle = undefined;
  typingSent = false;
}
function stopTyping() {
  window.clearTimeout(typingIdle);
  typingIdle = undefined;
  sendTyping(false);
}
messageInput.addEventListener('input', () => {
  if (!shareTyping || !messageInput.value.trim()) { stopTyping(); return; }
  sendTyping(true);
  window.clearTimeout(typingIdle);
  typingIdle = window.setTimeout(stopTyping, TYPING_IDLE_MS);
});
messageInput.addEventListener('blur', stopTyping);
function setShareTyping(value: boolean) {
  shareTyping = value;
  writePreference('virtual-workspace-share-typing', String(value));
  element('typing-switch').setAttribute('aria-checked', String(value));
  if (!value) stopTyping();
}
setShareTyping(shareTyping);
element<HTMLButtonElement>('typing-switch').addEventListener('click', event => {
  setShareTyping(!shareTyping);
  (event.currentTarget as HTMLButtonElement).blur();
});
element<HTMLFormElement>('chat-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!connected || !room) return;
  const payload = chatSchema.safeParse({ text: messageInput.value });
  if (!payload.success) return;
  room.send('chat', payload.data);
  messageInput.value = '';
  // The server clears typing when it accepts the message; keep local state in step.
  window.clearTimeout(typingIdle);
  typingIdle = undefined;
  typingSent = false;
});
