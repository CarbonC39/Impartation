import Phaser from 'phaser';
import { Client, type Room } from '@colyseus/sdk';
import { ROOM_NAME, joinSchema, chatSchema, parseWorldMap } from '@virtual-workspace/shared';
import type { SpaceRoom } from '@virtual-workspace/backend/rooms/SpaceRoom';
import type { server } from '@virtual-workspace/backend/app.config';
import { SpaceScene } from './SpaceScene';
import { FeaturePanels } from './features';
import './style.css';

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
const client = new Client<typeof server>(import.meta.env.VITE_SERVER_URL || window.location.origin);
let room: Room<SpaceRoom> | undefined;
let game: Phaser.Game | undefined;
let connected = false;
let features: FeaturePanels | undefined;

function setConnected(value: boolean) {
  connected = value;
  send.disabled = !value;
  messageInput.disabled = !value;
  features?.setConnected(value);
}
function cleanup() {
  features?.dispose();
  features = undefined;
  game?.destroy(true);
  game = undefined;
  room = undefined;
  setConnected(false);
  join.disabled = false;
  leave.disabled = true;
  zone.textContent = '当前区域：无';
}
element<HTMLFormElement>('join-form').addEventListener('submit', async event => {
  event.preventDefault();
  join.disabled = true;
  status.textContent = '连接中…';
  try {
    const options = joinSchema.parse({ name: element<HTMLInputElement>('name').value,
      avatar: element<HTMLSelectElement>('avatar').value });
    const response = await fetch('/maps/lobby.tmj');
    if (!response.ok) throw new Error('地图加载失败');
    const world = parseWorldMap(await response.json());
    room = await client.joinOrCreate(ROOM_NAME, options);
    room.reconnection.minUptime = 0;
    features = new FeaturePanels(room);
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
    game = new Phaser.Game({
      type: Phaser.AUTO, parent: 'game', width: world.width, height: world.height,
      backgroundColor: '#2b423e',
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: new SpaceScene(room, world, id => {
        const current = world.zones.find(item => item.id === id);
        const names = { board: '留言板', pomodoro: '番茄钟', media: '影音（待接入）', whiteboard: '白板（待接入）' };
        const text = current ? `当前区域：${names[current.kind]}` : '当前区域：无';
        if (zone.textContent !== text) zone.textContent = text;
        features?.setZone(current);
      }),
    });
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
leave.addEventListener('click', () => { leave.disabled = true; void room?.leave(); });
element<HTMLFormElement>('chat-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!connected || !room) return;
  const payload = chatSchema.safeParse({ text: messageInput.value });
  if (!payload.success) return;
  room.send('chat', payload.data);
  messageInput.value = '';
});
