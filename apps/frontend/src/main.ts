import Phaser from 'phaser';
import { Client, type Room } from '@colyseus/sdk';
import { ROOM_NAME, SPACE_REPLACED_CLOSE_CODE, DEFAULT_APPEARANCE, APPEARANCE_LAYERS, appearanceSchema, joinSchema, chatSchema, worldRegistryResponseSchema, validateWorldRegistry, spaceJoinSchema, type WorldRegistry, type MapCollection, type SpaceProtocol, type JoinOptions } from '@virtual-workspace/shared';
import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/700.css';
import { SpaceScene } from './SpaceScene';
import { drawAppearancePreview } from './appearancePreview';
import { createInteractions } from './interactions';
import type { InteractionDispatcher } from './interactions/dispatcher';
import { z } from 'zod';
import { zoneLabels } from './interactions/labels';
import { loadProfile, saveProfile, type Profile } from './identity';
import { mountAccounts } from './accounts';
import './style.css';
import { createCharacterActions, type CharacterActions } from './interactions/actions';
import { readPreference, writePreference } from './preferences';
import { mountThemePanel } from './theme';
import { Wardrobe } from './wardrobe';
import { mountOutfitSlots } from './outfitSlots';
import { ProximityVoice } from './voice';
import { TouchPad } from './touchPad';
import { LayoutEditor } from './layoutEditor';
import { ChatLayout } from './chatLayout';
import { PanelLayout } from './panelLayout';
import { mountPrejoin, type VoicePlan } from './prejoin';
import { fillMicrophoneSelect, preferredMicrophone, setPreferredMicrophone } from './microphone';
import { automaticCameraZoom, cameraZoomPreference, MAX_CAMERA_ZOOM, MIN_CAMERA_ZOOM, setCameraZoomPreference } from './cameraZoom';
import { setRangeFill } from './range';

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
let gameDestruction: Promise<void> = Promise.resolve();
/** Phaser destroys on the next frame; serialize replacement against that lifecycle. */
function destroyScene(): Promise<void> {
  const previous = game;
  game = undefined; scene = undefined;
  element('zone-anchor').hidden = true;
  if (previous) {
    // Remove the old canvas immediately, including during leave/rejoin on the same page.
    previous.canvas?.remove();
    const destroyed = new Promise<void>(resolve => { previous.events.once(Phaser.Core.Events.DESTROY, resolve); });
    previous.destroy(true);
    gameDestruction = Promise.all([gameDestruction, destroyed]).then(() => {});
  }
  return gameDestruction;
}
mountThemePanel(element<HTMLButtonElement>('theme-toggle'), element('theme-panel'));
const client = new Client(import.meta.env.VITE_SERVER_URL || window.location.origin);
let room: Room<SpaceProtocol> | undefined;
let connected = false;
let interactions: InteractionDispatcher | undefined;
let actions: CharacterActions | undefined;
let voice: ProximityVoice | undefined;
const voiceMic = element<HTMLButtonElement>('voice-mic');
const voiceDisconnect = element<HTMLButtonElement>('voice-disconnect');
voiceMic.addEventListener('click', () => { void voice?.toggleMic(); voiceMic.blur(); });
voiceDisconnect.addEventListener('click', () => { voice?.disable(); voiceDisconnect.blur(); });
// Speaker button: a per-browser switch for all incoming sound, kept across visits.
const soundToggle = element<HTMLButtonElement>('sound-toggle');
let soundOn = readPreference('virtual-workspace-sound-off') !== 'true';
function setSoundOn(on: boolean) {
  soundOn = on;
  writePreference('virtual-workspace-sound-off', String(!on));
  const label = on ? '关闭声音' : '开启声音';
  soundToggle.setAttribute('aria-pressed', String(on));
  soundToggle.setAttribute('aria-label', label);
  soundToggle.title = label;
  voice?.setDeafened(!on);
}
setSoundOn(soundOn);
soundToggle.addEventListener('click', () => { setSoundOn(!soundOn); soundToggle.blur(); });
const voiceDevice = element<HTMLSelectElement>('voice-device');
function refreshVoiceDevices() { void fillMicrophoneSelect(voiceDevice, voice?.deviceId || preferredMicrophone()); }
voiceDevice.addEventListener('change', () => {
  if (voice) void voice.setDevice(voiceDevice.value); else setPreferredMicrophone(voiceDevice.value);
});
navigator.mediaDevices?.addEventListener?.('devicechange', refreshVoiceDevices);
let worldRegistry: MapCollection | undefined;
let spaceDirectory: WorldRegistry | undefined;
let selectedSpaceId = '';
let renderedMap = '';
let renderingMap = '';
let renderGeneration = 0;
let joinGeneration = 0;
let pageLeaving = false;
let selectedWorld = '阳光大厅';
let leavingIntentionally = false;
let currentProfile: Profile | undefined;

function mergeAppearanceDraft(draft: JoinOptions['appearance'], previous: Profile, latest: Profile): JoinOptions['appearance'] {
  if (previous.id !== latest.id) return latest.currentAppearance ?? latest.appearance;
  const before = previous.currentAppearance ?? previous.appearance;
  const merged: Record<string, unknown> = structuredClone(latest.currentAppearance ?? latest.appearance);
  for (const layer of APPEARANCE_LAYERS) {
    if (JSON.stringify(draft[layer]) !== JSON.stringify(before[layer])) merged[layer] = draft[layer];
  }
  return appearanceSchema.parse(merged);
}

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
const chatLayout = new ChatLayout(chatCard, element('chat-drag'), element('chat-resize'), element('messages'));
element<HTMLButtonElement>('chat-reset').addEventListener('click', event => {
  chatLayout.reset();
  (event.currentTarget as HTMLButtonElement).blur();
});
for (const panel of document.querySelectorAll<HTMLElement>('#interaction-panels .feature-panel')) new PanelLayout(panel);
chatToggle.addEventListener('click', () => {
  setChatCollapsed(!chatCard.classList.contains('collapsed'));
  chatToggle.blur(); // Return keyboard movement to the map.
});

// Per-browser map display preferences.
// Zoom is a stepped slider; "自动" follows the map's tile size until the slider is moved.
const cameraZoomInput = element<HTMLInputElement>('camera-zoom');
const cameraZoomAuto = element<HTMLButtonElement>('camera-zoom-auto');
const cameraZoomValue = element<HTMLOutputElement>('camera-zoom-value');
let automaticZoom = automaticCameraZoom(16, 16);
cameraZoomInput.min = String(MIN_CAMERA_ZOOM);
cameraZoomInput.max = String(MAX_CAMERA_ZOOM);
element('camera-zoom-ticks').replaceChildren(...Array.from({ length: MAX_CAMERA_ZOOM - MIN_CAMERA_ZOOM + 1 }, (_, index) => {
  const tick = document.createElement('span');
  tick.textContent = `${MIN_CAMERA_ZOOM + index}x`;
  tick.style.setProperty('--t', String(index / (MAX_CAMERA_ZOOM - MIN_CAMERA_ZOOM)));
  return tick;
}));
function renderCameraZoom() {
  const preference = cameraZoomPreference();
  const value = preference ?? automaticZoom;
  cameraZoomInput.value = String(value);
  setRangeFill(cameraZoomInput);
  cameraZoomAuto.setAttribute('aria-pressed', String(preference === null));
  cameraZoomValue.value = preference === null ? `自动 · ${value}x` : `${value}x`;
  cameraZoomInput.setAttribute('aria-valuetext', cameraZoomValue.value);
}
function setCameraZoom(value: number | null) {
  setCameraZoomPreference(value);
  renderCameraZoom();
  scene?.refreshCameraZoom();
}
cameraZoomInput.addEventListener('input', () => setCameraZoom(Number(cameraZoomInput.value)));
cameraZoomAuto.addEventListener('click', () => setCameraZoom(cameraZoomPreference() === null ? automaticZoom : null));
renderCameraZoom();
// Chat background opacity, 0-100. The slider snaps to its 0/50/100 marks when released near them.
const CHAT_OPACITY_KEY = 'virtual-workspace-chat-opacity';
const chatOpacityInput = element<HTMLInputElement>('chat-opacity');
let namesVisible = readPreference('virtual-workspace-show-names') !== 'false';
function setNamesVisible(visible: boolean) {
  namesVisible = visible;
  writePreference('virtual-workspace-show-names', String(visible));
  element('names-switch').setAttribute('aria-checked', String(visible));
}
function setChatOpacity(value: number) {
  const opacity = Math.round(Math.min(100, Math.max(0, value)));
  chatCard.dataset.mode = opacity === 0 ? 'clear' : opacity === 100 ? 'solid' : 'half';
  chatCard.style.setProperty('--chat-opacity', String(opacity));
  chatOpacityInput.value = String(opacity);
  setRangeFill(chatOpacityInput);
  element('chat-opacity-value').textContent = `${opacity}%`;
  writePreference(CHAT_OPACITY_KEY, String(opacity));
}
function savedChatOpacity() {
  const saved = Number(readPreference(CHAT_OPACITY_KEY) ?? Number.NaN);
  if (Number.isFinite(saved)) return saved;
  // Earlier versions stored one of three background modes.
  return { clear: 0, half: 50, solid: 100 }[readPreference('virtual-workspace-chat-mode') ?? ''] ?? 50;
}
setNamesVisible(namesVisible);
setChatOpacity(savedChatOpacity());
element<HTMLButtonElement>('names-switch').addEventListener('click', event => {
  setNamesVisible(!namesVisible);
  (event.currentTarget as HTMLButtonElement).blur();
});
chatOpacityInput.addEventListener('input', () => setChatOpacity(Number(chatOpacityInput.value)));
chatOpacityInput.addEventListener('change', () => {
  const value = Number(chatOpacityInput.value);
  const mark = [0, 50, 100].find(point => Math.abs(point - value) <= 4);
  if (mark !== undefined) setChatOpacity(mark);
  chatOpacityInput.blur(); // Return keyboard movement to the map.
});
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
  document.body.classList.toggle('avatar-open', id === 'avatar-screen');
  if (id === 'map-screen') { touchPad.refresh(); layoutEditor.refresh(); chatLayout.refresh(); element('theme-panel').hidden = true; element('theme-toggle').setAttribute('aria-expanded', 'false'); }
  if (id === 'login-screen') renderWelcome();
  if (id === 'avatar-screen') labelSaveAppearance();
}
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(value => { window.clearTimeout(timer); resolve(value); }, error => { window.clearTimeout(timer); reject(error); });
  });
}
async function chooseWorld(spaceId: string) {
  const space = spaceDirectory?.spaces.find(entry => entry.id === spaceId);
  if (!space) return;
  if (!currentProfile) {
    element('account-feedback').textContent = '请先登录或注册账号，再进入空间。';
    element('sign-in-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const previousProfile = currentProfile;
  const wardrobeDraft = wardrobe.value;
  const displayNameDraft = nameInput.value;
  try {
    const latest = await loadProfile();
    if (!latest) {
      syncAccountProfile(undefined);
      clearIdentity();
      element('account-feedback').textContent = '登录已失效，请重新登录后进入空间。';
      return;
    }
    const sameAccount = latest.id === previousProfile.id;
    showIdentity(latest);
    if (sameAccount) {
      wardrobe.replace(mergeAppearanceDraft(wardrobeDraft, previousProfile, latest), false);
      if (displayNameDraft.trim() !== (previousProfile.displayName ?? previousProfile.name)) {
        nameInput.value = displayNameDraft;
        wardrobe.renderName();
        renderWelcome();
      }
    } else {
      joinFeedback.textContent = '当前登录账号已切换；已清除原账号未保存的造型草稿，请确认新账号资料。';
    }
  } catch (error) {
    element('account-feedback').textContent = `读取账号失败：${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  selectedSpaceId = space.id;
  selectedWorld = space.name;
  element('chosen-world-label').textContent = space.name;
  element('join-world-name').textContent = space.name;
  element('map-world-name').textContent = space.name;
  showScreen('avatar-screen');
}
element<HTMLDivElement>('world-list').addEventListener('click', event => {
  const tile = (event.target as HTMLElement).closest<HTMLButtonElement>('.world-tile[data-world]');
  if (tile?.dataset.world) void chooseWorld(tile.dataset.world);
});
async function loadSpaces() {
  const list = element('world-list');
  try {
    const response = await fetch('/api/world', { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error('空间目录加载失败');
    spaceDirectory = validateWorldRegistry(worldRegistryResponseSchema.parse(await response.json()));
    list.replaceChildren(...spaceDirectory.spaces.map(space => {
      const tile = document.createElement('button');
      tile.type = 'button'; tile.className = 'world-tile'; tile.dataset.world = space.id;
      const cover = document.createElement('img');
      cover.className = 'world-art'; cover.src = space.cover; cover.alt = '';
      const name = document.createElement('span'); name.className = 'world-title'; name.textContent = space.name;
      const action = document.createElement('span'); action.className = 'world-join';
      tile.append(cover, name);
      if (space.description) {
        const description = document.createElement('span'); description.className = 'world-description'; description.textContent = space.description;
        tile.append(description);
      }
      tile.append(action);
      return tile;
    }));
    renderWorldTiles();
  } catch (error) { list.textContent = `空间目录加载失败：${String(error)}`; }
}
function renderWorldTiles() {
  element('world-subtitle').textContent = currentProfile ? '选好世界后进入试衣间' : '先登录，再选一个世界';
  for (const action of document.querySelectorAll('#world-list .world-join')) action.textContent = currentProfile ? '去换装' : '登录后进入';
}
void loadSpaces();
document.querySelectorAll<HTMLButtonElement>('[data-back]').forEach(button => {
  button.addEventListener('click', () => {
    const target = button.dataset.back ?? 'login-screen';
    if (worldWardrobe && target === 'map-screen') {
      const own = room?.state.players.get(room.sessionId);
      if (own) wardrobe.replace(appearanceSchema.parse(JSON.parse(own.appearance)), false);
      restoreWardrobeNavigation();
    }
    showScreen(target);
  });
});

let currentAvatar: JoinOptions['avatar'] = 'mint';
let worldWardrobe = false;
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
function restoreWardrobeNavigation() {
  worldWardrobe = false;
  const label = document.createElement('span'); label.id = 'join-world-name'; label.textContent = selectedWorld;
  join.replaceChildren('进入', label);
  const back = document.querySelector<HTMLButtonElement>('#avatar-screen [data-back]')!;
  back.dataset.back = 'login-screen'; back.textContent = '返回选世界';
}
function renderWelcome() {
  element('welcome-name').textContent = nameInput.value.trim() || '小访客';
  void drawAppearancePreview(element<HTMLCanvasElement>('welcome-canvas'), wardrobe.value).catch(() => {});
}
async function persistProfile() {
  await identityReady;
  const previousProfile = currentProfile;
  if (!previousProfile) throw new Error('请先登录账号');
  const wardrobeDraft = wardrobe.value;
  const displayNameDraft = nameInput.value;
  const latest = await loadProfile();
  if (!latest) {
    syncAccountProfile(undefined);
    clearIdentity();
    throw new Error('登录已失效，请重新登录');
  }
  if (latest.id !== previousProfile.id) {
    showIdentity(latest);
    throw new Error('登录账号已切换，原账号的未保存资料没有提交；请确认新账号资料后重试');
  }
  showIdentity(latest);
  wardrobe.replace(mergeAppearanceDraft(wardrobeDraft, previousProfile, latest), false);
  if (displayNameDraft.trim() !== (previousProfile.displayName ?? previousProfile.name)) {
    nameInput.value = displayNameDraft;
    wardrobe.renderName();
    renderWelcome();
  }
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
/** The button reads 保存造型 only until it is first used (or an outfit already exists); after that it opens 我的造型. */
const saveAppearance = element<HTMLButtonElement>('save-appearance');
const OUTFITS_OPENED_KEY = 'virtual-workspace-outfits-opened';
function labelSaveAppearance() {
  const opened = readPreference(OUTFITS_OPENED_KEY) === '1';
  saveAppearance.textContent = opened ? '我的造型' : '保存造型';
  if (!opened) void outfits.hasSaved().then(saved => { if (saved) saveAppearance.textContent = '我的造型'; });
}
saveAppearance.addEventListener('click', () => {
  outfits.open();
  writePreference(OUTFITS_OPENED_KEY, '1');
  labelSaveAppearance();
});
renderWelcome();
const touchPad = new TouchPad(element('touch-controls'), element('touch-grip'), element('touch-hint'));
window.addEventListener('blur', () => touchPad.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) touchPad.clear(); });
const layoutEditor = new LayoutEditor({
  panel: element('layout-panel'), scale: element<HTMLInputElement>('pad-scale'), scaleValue: element<HTMLOutputElement>('pad-scale-value'),
  reset: element<HTMLButtonElement>('layout-reset'), done: element<HTMLButtonElement>('layout-done'),
  actionBar: element('positional-controls'),
}, touchPad);
touchPad.onEditRequest = () => layoutEditor.open();
element<HTMLButtonElement>('layout-edit').addEventListener('click', () => {
  element('settings-panel').hidden = true;
  element('settings-toggle').setAttribute('aria-expanded', 'false');
  layoutEditor.open();
});

let syncAccountProfile: (value: Profile | undefined) => void = () => {};
function showIdentity(value: Profile) {
  currentProfile = value;
  nameInput.value = value.displayName ?? value.name;
  currentAvatar = value.avatar;
  wardrobe.replace(appearanceSchema.parse(value.currentAppearance ?? value.appearance), false);
  element('account-status').textContent = `已登录：${value.displayName ?? value.name}（@${value.username ?? '匿名'} · ${value.role === 'admin' ? '管理员' : '成员'}）`;
  syncAccountProfile(value);
  renderWelcome();
}
function clearIdentity() {
  currentProfile = undefined;
  nameInput.value = '小访客';
  currentAvatar = 'mint';
  wardrobe.replace(appearanceSchema.parse(DEFAULT_APPEARANCE), false);
  syncAccountProfile(undefined);
  renderWelcome();
}
const accounts = mountAccounts(value => {
  currentProfile = value;
  if (value) showIdentity(value);
  else clearIdentity();
  renderWorldTiles();
});
syncAccountProfile = accounts.syncProfile;
const identityReady = accounts.ready.then(value => { currentProfile = value; if (value) showIdentity(value); renderWorldTiles(); })
  .catch(error => { status.textContent = error instanceof Error ? error.message : String(error); });

function setConnected(value: boolean) {
  connected = value;
  voice?.setConnected(value);
  send.disabled = !value;
  messageInput.disabled = !value;
  interactions?.setConnected(value);
  actions?.refresh();
}
function cleanup() {
  if (worldWardrobe) { restoreWardrobeNavigation(); showScreen('login-screen'); }
  touchPad.clear();
  layoutEditor.close();
  resetTyping();
  renderGeneration++;
  worldRegistry = undefined; renderedMap = ''; renderingMap = '';
  interactions?.dispose();
  voice?.dispose();
  voice = undefined;
  interactions = undefined;
  actions?.dispose();
  actions = undefined;
  element('object-feedback').textContent = '';
  void destroyScene();
  room = undefined;
  setUnread(0);
  setConnected(false);
  join.disabled = false;
  leave.disabled = true;
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
  if (worldWardrobe && room) {
    join.disabled = true;
    const wardrobeRoom = room;
    void persistProfile().then(() => {
      if (room !== wardrobeRoom || !worldWardrobe) return;
      restoreWardrobeNavigation();
      showScreen('map-screen');
    }).catch(error => { joinFeedback.textContent = `保存失败：${String(error)}`; }).finally(() => { join.disabled = false; });
    return;
  }
  prejoin.open(selectedWorld);
});
async function enterWorld(plan: VoicePlan) {
  if (!currentProfile) {
    element('account-feedback').textContent = '请先登录或注册账号，再进入空间。';
    showScreen('login-screen');
    plan.stream?.getTracks().forEach(track => track.stop());
    return;
  }
  showScreen('map-screen');
  join.disabled = true;
  joinFeedback.textContent = '';
  status.textContent = '连接中…';
  const generation = ++joinGeneration;
  const isCurrentJoin = () => generation === joinGeneration && !pageLeaving;
  const stopPlannedStream = () => { plan.stream?.getTracks().forEach(track => track.stop()); plan.stream = undefined; };
  try {
    await identityReady;
    if (!isCurrentJoin()) { stopPlannedStream(); return; }
    if (!currentProfile) throw new Error('登录已失效，请重新登录');
    await persistProfile();
    if (!isCurrentJoin()) { stopPlannedStream(); return; }
    const options = joinSchema.parse({ name: nameInput.value, avatar: currentAvatar, appearance: wardrobe.value });
    const space = spaceDirectory?.spaces.find(entry => entry.id === selectedSpaceId);
    if (!space || !spaceDirectory) throw new Error('请先选择空间');
    worldRegistry = { initialMap: space.initialMap, maps: spaceDirectory.maps.filter(map => space.maps.includes(map.id)) };
    const roomOptions = spaceJoinSchema.parse({ ...options, spaceId: space.id });
    const pendingRoom = client.joinOrCreate<SpaceProtocol>(ROOM_NAME, roomOptions);
    let joinedRoom: Room<SpaceProtocol>;
    try { joinedRoom = await withTimeout(pendingRoom, 15_000, '连接空间超时，请检查服务是否启动后重试'); }
    catch (error) { void pendingRoom.then(lateRoom => lateRoom.leave()).catch(() => {}); throw error; }
    if (!isCurrentJoin()) { stopPlannedStream(); void joinedRoom.leave().catch(() => {}); return; }
    room = joinedRoom;
    joinedRoom.reconnection.minUptime = 0;
    if (!joinedRoom.state?.players) await withTimeout(new Promise<void>(resolve => joinedRoom.onStateChange.once(() => resolve())),
      10_000, '空间已连接，但没有收到地图角色数据');
    if (!isCurrentJoin() || room !== joinedRoom) { stopPlannedStream(); void joinedRoom.leave().catch(() => {}); return; }
    const nativeRoom = room;
    interactions = createInteractions(room, undefined, {
      world: () => worldRegistry?.maps.find(map => map.id === nativeRoom.state.players.get(nativeRoom.sessionId)?.mapId)?.world,
      openWardrobe: () => {
        nativeRoom.send('input', { x: 0, y: 0 }); touchPad.clear();
        worldWardrobe = true; join.disabled = false;
        join.textContent = '保存并返回地图';
        const back = document.querySelector<HTMLButtonElement>('#avatar-screen [data-back]')!;
        back.dataset.back = 'map-screen'; back.textContent = '返回地图';
        showScreen('avatar-screen');
      },
      speaking: id => voice?.isSpeaking(id) ?? false,
    });
    voice = new ProximityVoice(room, voiceMic, voiceDisconnect, element('voice-status'));
    voice.setDeafened(!soundOn);
    voice.onDeviceChange = refreshVoiceDevices;
    const actionRoom = room;
    actions = createCharacterActions(room, () => {
      const mapId = actionRoom.state.players.get(actionRoom.sessionId)?.mapId;
      return worldRegistry?.maps.find(map => map.id === mapId)?.world;
    });
    messages.replaceChildren();
    const appendChat = (text: string, className?: string) => {
      const li = document.createElement('li');
      li.textContent = text;
      if (className) li.className = className;
      messages.append(li);
      if (messages.children.length > 100) messages.firstElementChild?.remove();
      messages.scrollTop = messages.scrollHeight;
    };
    room.onMessage('chat', message => {
      if (room !== nativeRoom) return;
      appendChat(`${message.privateAreaId ? '［房间］' : ''}${message.name}：${message.text}`, message.privateAreaId ? 'chat-private' : undefined);
      if (chatCard.classList.contains('collapsed')) setUnread(unread + 1);
      scene?.showBubble(message.sessionId, message.text);
    });
    // The server routes chat and voice by private area; tell the player when their audience changes.
    let audience = '';
    const chatRoom = room;
    room.onStateChange(() => {
      if (room !== nativeRoom) return;
      const own = chatRoom.state.players.get(chatRoom.sessionId);
      if (!own?.connected) return; // Disconnects clear privateAreaId; that is not a move to public.
      const next = own.privateAreaId ? `${own.mapId}/${own.privateAreaId}` : '';
      if (next === audience) return;
      audience = next;
      appendChat(next ? '已进入私密房间：聊天和语音只在房间内互通。' : '已回到公共区域：聊天和语音恢复公共范围。', 'chat-system');
    });
    room.onDrop(() => { if (room !== nativeRoom) return; setConnected(false); status.textContent = '连接中断，正在自动重连…'; });
    room.onReconnect(() => { if (room !== nativeRoom) return; setConnected(true); status.textContent = '连接已恢复'; });
    room.onLeave(code => {
      if (room !== nativeRoom) return;
      nativeRoom.reconnection.enabled = false;
      cleanup(); status.textContent = code === SPACE_REPLACED_CLOSE_CODE
        ? '账号已在其他设备进入此空间，当前连接已下线'
        : '已离开，可以重新进入';
      void accounts.refreshProfile().then(value => { if (!value) showScreen('login-screen'); })
        .catch(error => { status.textContent = `无法刷新登录状态：${error instanceof Error ? error.message : String(error)}`; });
    });
    room.onError((_code, message) => { if (room === nativeRoom) status.textContent = `房间错误：${message}`; });
    const activeRoom = room;
    room.onStateChange(() => {
      if (room !== activeRoom) return;
      const mapId = activeRoom.state.players.get(activeRoom.sessionId)?.mapId;
      if (mapId && renderedMap !== mapId && renderingMap !== mapId) {
        void renderWorld(mapId, activeRoom).catch(error => { status.textContent = `地图加载失败：${String(error)}`; });
      }
    });
    await renderWorld(room.state?.players?.get(room.sessionId)?.mapId ?? worldRegistry.initialMap, room);
    if (!isCurrentJoin() || room !== nativeRoom) { stopPlannedStream(); return; }
    setConnected(true);
    leave.disabled = false;
    const sessionId = document.createElement('span');
    sessionId.className = 'session-id';
    sessionId.textContent = ` · ${room.sessionId}`;
    status.replaceChildren('已进入空间', sessionId);
    join.blur();
    if (plan.enabled) {
      const stream = plan.stream;
      plan.stream = undefined;
      void voice.enable({ ...(stream ? { stream } : {}), muted: plan.muted });
    }
  } catch (error) {
    stopPlannedStream();
    if (!isCurrentJoin()) return;
    void room?.leave().catch(() => {});
    cleanup();
    showScreen(currentProfile ? 'avatar-screen' : 'login-screen');
    joinFeedback.textContent = `进入失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

window.addEventListener('pagehide', () => {
  pageLeaving = true;
  joinGeneration++;
  const departingRoom = room;
  room = undefined;
  cleanup();
  if (departingRoom) void departingRoom.leave().catch(() => {});
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  pageLeaving = false;
  joinGeneration++;
  cleanup();
  status.textContent = '已离开，可以重新进入';
  showScreen(currentProfile ? 'avatar-screen' : 'login-screen');
});
const renderMapSchema = z.object({
  tilewidth: z.number().positive(), tileheight: z.number().positive(),
  tilesets: z.array(z.object({ name: z.string(), image: z.string().optional() }).passthrough()).default([]),
}).passthrough();
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
    automaticZoom = automaticCameraZoom(renderMap.tilewidth, renderMap.tileheight);
    renderCameraZoom();
    if (generation !== renderGeneration || room !== activeRoom) return;
    await destroyScene();
    if (generation !== renderGeneration || room !== activeRoom) return;
    const zoneAnchor = element('zone-anchor');
    scene = new SpaceScene(activeRoom, entry, renderMap, {
      zoneChanged: id => {
        if (generation !== renderGeneration || room !== activeRoom) return;
        const current = entry.world.zones.find(item => item.id === id);
        const text = current ? `当前区域：${zoneLabels[current.kind] ?? current.kind}` : '当前区域：无';
        if (zone.textContent !== text) zone.textContent = text;
        interactions?.setZone(current);
      },
      zoneAnchor: point => {
        if (generation !== renderGeneration || room !== activeRoom) return;
        zoneAnchor.hidden = !point;
        if (point) zoneAnchor.style.transform = `translate(${point.x}px, ${point.y}px)`;
      },
      activate: () => { void actions?.activate(); },
      virtualInput: () => touchPad.read(),
      namesVisible: () => namesVisible,
      speaking: id => voice?.isSpeaking(id) ?? false,
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
// Chat focus works like a game chat line: Enter on the map opens it, Enter sends and hands the
// keyboard back to the map, and Esc or Tab leave it without sending (the draft is kept).
// While it has focus, every key edits text, so arrow keys move the caret as usual.
function focusMap() {
  messageInput.blur();
  document.querySelector<HTMLCanvasElement>('#game canvas')?.focus();
}
messageInput.addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (event.key === 'Escape' || event.key === 'Tab' || (event.key === 'Enter' && !messageInput.value.trim())) {
    event.preventDefault();
    focusMap();
  }
});
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
  focusMap();
});
