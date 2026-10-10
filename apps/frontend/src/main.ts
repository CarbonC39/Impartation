import Phaser from 'phaser';
import { Client, type Room } from '@colyseus/sdk';
import { ROOM_NAME, joinSchema, chatSchema, parseWorldMap } from '@virtual-workspace/shared';
import type { SpaceRoom } from '@virtual-workspace/backend/rooms/SpaceRoom';
import type { server } from '@virtual-workspace/backend/app.config';
import { SpaceScene } from './SpaceScene';
import './style.css';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}
const status = element('status');
const send = element<HTMLButtonElement>('send');
const messageInput = element<HTMLInputElement>('message');
const messages = element<HTMLOListElement>('messages');
const zone = element('zone');
const themePicker = element<HTMLSelectElement>('theme');
const themes = ['meadow', 'ocean', 'sunset', 'lavender'] as const;
type Theme = typeof themes[number];
const themeBackgrounds: Record<Theme, string> = {
  meadow: '#bdebd0', ocean: '#b7e8ff', sunset: '#ffd2b5', lavender: '#e4caff',
};
function applyTheme(theme: Theme) {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  themePicker.value = theme;
  localStorage.setItem('virtual-workspace-theme', theme);
  if (game) game.canvas.style.backgroundColor = themeBackgrounds[theme];
}
const savedTheme = localStorage.getItem('virtual-workspace-theme');
const initialTheme = themes.find(theme => theme === savedTheme) ?? 'meadow';
let currentTheme: Theme = initialTheme;
const client = new Client<typeof server>(import.meta.env.VITE_SERVER_URL || window.location.origin);
let room: Room<SpaceRoom> | undefined;
let game: Phaser.Game | undefined;
let connected = false;
let selectedWorld = '阳光大厅';
let leavingIntentionally = false;
applyTheme(initialTheme);
themePicker.addEventListener('change', () => {
  const selected = themes.find(theme => theme === themePicker.value);
  if (selected) applyTheme(selected);
});

function showScreen(id: string) {
  document.querySelectorAll<HTMLElement>('.flow-screen').forEach(screen => {
    const active = screen.id === id;
    screen.classList.toggle('active', active);
    screen.hidden = !active;
  });
  document.body.classList.toggle('map-open', id === 'map-screen');
}
function setConnected(value: boolean) {
  connected = value;
  send.disabled = !value;
  messageInput.disabled = !value;
}
function cleanup() {
  game?.destroy(true);
  game = undefined;
  room = undefined;
  setConnected(false);
  zone.textContent = '当前区域：无';
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
const avatarChoices = [...document.querySelectorAll<HTMLInputElement>('input[name="avatar"]')];
function updateAvatarPreview() {
  const selected = avatarChoices.find(input => input.checked);
  const sprite = selected?.closest('.avatar-choice')?.querySelector('.avatar-face svg');
  if (sprite) element('avatar-preview').replaceChildren(sprite.cloneNode(true));
}
function stepAvatar(direction: number) {
  const current = Math.max(0, avatarChoices.findIndex(input => input.checked));
  const next = (current + direction + avatarChoices.length) % avatarChoices.length;
  avatarChoices[next]?.click();
  updateAvatarPreview();
}
avatarChoices.forEach(input => {
  input.addEventListener('change', updateAvatarPreview);
});
document.querySelectorAll<HTMLButtonElement>('[data-avatar-step]').forEach(button => {
  button.addEventListener('click', () => stepAvatar(Number(button.dataset.avatarStep)));
});
const virtualDirections = new Set<string>();
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
function readVirtualInput() {
  return {
    x: Number(virtualDirections.has('right')) - Number(virtualDirections.has('left')),
    y: Number(virtualDirections.has('down')) - Number(virtualDirections.has('up')),
  };
}
element<HTMLFormElement>('avatar-form').addEventListener('submit', async event => {
  event.preventDefault();
  showScreen('map-screen');
  status.textContent = '正在连接世界…';
  try {
    const options = joinSchema.parse({ name: element<HTMLInputElement>('name').value,
      avatar: new FormData(event.currentTarget as HTMLFormElement).get('avatar') });
    const response = await fetch('/maps/lobby.tmj');
    if (!response.ok) throw new Error('地图加载失败');
    const world = parseWorldMap(await response.json());
    room = await client.joinOrCreate(ROOM_NAME, options);
    room.reconnection.minUptime = 0;
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
    room.onLeave(() => {
      cleanup();
      if (!leavingIntentionally) status.textContent = '连接已结束，请重新进入世界';
    });
    room.onError((_code, message) => { status.textContent = `房间错误：${message}`; });
    game = new Phaser.Game({
      type: Phaser.AUTO, parent: 'game', width: world.width, height: world.height,
      backgroundColor: themeBackgrounds[currentTheme],
      scale: { mode: Phaser.Scale.RESIZE },
      scene: new SpaceScene(room, world, id => {
        const current = world.zones.find(item => item.id === id);
        const text = current ? `当前区域：${current.kind} / ${current.resourceId}（功能待接入）` : '当前区域：无';
        if (zone.textContent !== text) zone.textContent = text;
      }, readVirtualInput),
    });
    setConnected(true);
    status.textContent = '已连接';
  } catch (error) {
    await room?.leave();
    cleanup();
    status.textContent = `连接失败：${error instanceof Error ? error.message : String(error)}`;
  }
});
element<HTMLButtonElement>('map-back').addEventListener('click', async () => {
  leavingIntentionally = true;
  await room?.leave();
  cleanup();
  showScreen('world-screen');
  leavingIntentionally = false;
});
element<HTMLFormElement>('chat-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!connected || !room) return;
  const payload = chatSchema.safeParse({ text: messageInput.value });
  if (!payload.success) return;
  room.send('chat', payload.data);
  messageInput.value = '';
});
