import type { Room } from '@colyseus/sdk';
import type { SpaceRoom } from '@virtual-workspace/backend/rooms/SpaceRoom';
import { boardPostSchema, pomodoroModeSchema, type FeatureResult, type Zone } from '@virtual-workspace/shared';
import { ExternalToolPanel } from './external-tools';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}

export class FeaturePanels {
  private tools = new ExternalToolPanel();
  private board = element('board-panel');
  private pomodoro = element('pomodoro-panel');
  private notes = element<HTMLOListElement>('board-notes');
  private text = element<HTMLTextAreaElement>('board-text');
  private post = element<HTMLButtonElement>('board-post');
  private mode = element<HTMLSelectElement>('pomodoro-mode');
  private feedback = element('feature-status');
  private current?: Zone;
  private connected = true;
  private pending = false;
  private disposed = false;
  private controller = new AbortController();
  private interval: ReturnType<typeof setInterval>;
  private serverTime = 0;
  private receivedAt = 0;
  private notesKey = '';
  private renderState = () => {
    if (this.serverTime !== this.room.state.serverTime) {
      this.serverTime = this.room.state.serverTime;
      this.receivedAt = performance.now();
    }
    this.renderNotes();
    this.renderTimer();
  };

  constructor(private room: Room<SpaceRoom>) {
    const options = { signal: this.controller.signal };
    element<HTMLFormElement>('board-form').addEventListener('submit', event => {
      event.preventDefault();
      if (!this.current || !this.connected || this.pending) return;
      const payload = boardPostSchema.safeParse({ resourceId: this.current.resourceId, text: this.text.value });
      if (!payload.success) { this.feedback.textContent = '请输入 1–500 字留言'; return; }
      void this.run(() => this.room.request('boardPost', payload.data), () => { this.text.value = ''; });
    }, options);
    this.notes.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement) || !target.dataset.noteId || !this.current) return;
      const payload = { resourceId: this.current.resourceId, id: target.dataset.noteId };
      void this.run(() => this.room.request('boardDelete', payload));
    }, options);
    for (const action of ['start', 'pause', 'resume', 'reset'] as const) {
      element(`pomodoro-${action}`).addEventListener('click', () => {
        if (!this.current) return;
        const resourceId = this.current.resourceId;
        const mode = pomodoroModeSchema.parse(this.mode.value);
        const payload = action === 'start' || action === 'reset' ? { resourceId, action, mode } : { resourceId, action };
        void this.run(() => this.room.request('pomodoro', payload));
      }, options);
    }
    this.room.onStateChange(this.renderState);
    if (this.room.state?.notes) this.renderState();
    this.interval = setInterval(() => this.renderTimer(), 250);
  }

  setZone(zone: Zone | undefined) {
    if (this.current?.id === zone?.id) return;
    this.current = zone;
    this.feedback.textContent = '';
    this.text.value = '';
    this.board.hidden = zone?.kind !== 'board';
    this.pomodoro.hidden = zone?.kind !== 'pomodoro';
    this.tools.setZone(zone);
    this.renderNotes();
    this.renderTimer();
  }

  setConnected(value: boolean) {
    if (this.connected && !value) this.serverTime += performance.now() - this.receivedAt;
    this.receivedAt = performance.now();
    this.connected = value;
    this.renderNotes();
    this.renderTimer();
  }

  dispose() {
    this.disposed = true;
    this.tools.dispose();
    this.controller.abort();
    clearInterval(this.interval);
    this.room.onStateChange.remove(this.renderState);
    this.board.hidden = true;
    this.pomodoro.hidden = true;
    this.notes.replaceChildren();
    this.text.value = '';
    this.feedback.textContent = '';
  }

  private async run(request: () => Promise<FeatureResult>, success?: () => void) {
    if (!this.connected || this.pending || this.disposed) return;
    const zoneId = this.current?.id;
    this.pending = true;
    this.renderNotes();
    this.renderTimer();
    try {
      const result = await request();
      if (this.disposed || this.current?.id !== zoneId) return;
      this.feedback.textContent = result.message;
      if (result.ok) success?.();
    } catch {
      if (!this.disposed && this.current?.id === zoneId) this.feedback.textContent = '操作失败，请检查连接后重试';
    } finally {
      this.pending = false;
      if (!this.disposed) { this.renderNotes(); this.renderTimer(); }
    }
  }

  private renderNotes() {
    this.text.disabled = !this.connected || this.pending;
    this.post.disabled = !this.connected || this.pending;
    if (this.current?.kind !== 'board' || !this.room.state?.notes) return;
    const notes = [...this.room.state.notes.entries()]
      .filter(([, note]) => note.resourceId === this.current?.resourceId)
      .sort(([a, x], [b, y]) => x.createdAt - y.createdAt || a.localeCompare(b));
    const player = this.room.state.players.get(this.room.sessionId);
    const key = JSON.stringify([this.current.resourceId, this.connected, this.pending, player?.userId, player?.role, notes.map(([id]) => id)]);
    if (key === this.notesKey) return;
    this.notesKey = key;
    const children = notes.map(([id, note]) => {
      const item = document.createElement('li');
      const meta = document.createElement('small');
      meta.textContent = `${note.name} · ${new Date(note.createdAt).toLocaleString()}`;
      const body = document.createElement('p');
      body.textContent = note.text;
      item.append(meta, body);
      if (player && (note.authorUserId === player.userId || player.role === 'admin')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = note.authorUserId === player.userId ? '删除我的留言' : '管理员删除';
        button.dataset.noteId = id;
        button.disabled = !this.connected || this.pending;
        item.append(button);
      }
      return item;
    });
    if (!children.length) {
      const empty = document.createElement('li');
      empty.textContent = '还没有留言，写下第一条吧。';
      children.push(empty);
    }
    this.notes.replaceChildren(...children);
    element('board-count').textContent = `${notes.length} / 100 条`;
  }

  private renderTimer() {
    if (this.current?.kind !== 'pomodoro') return;
    const timer = this.room.state?.pomodoros?.get(this.current.resourceId);
    const labels: Record<string, string> = { idle: '准备开始', running: '进行中', paused: '已暂停', finished: '本轮完成' };
    const now = this.serverTime + (this.connected ? performance.now() - this.receivedAt : 0);
    const remaining = timer?.status === 'running' ? Math.max(0, timer.endsAt - now) : (timer?.remainingMs ?? 25 * 60_000);
    const seconds = Math.ceil(remaining / 1000);
    element('pomodoro-time').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    element('pomodoro-status').textContent = timer ? `${timer.mode === 'focus' ? '专注' : '休息'} · ${labels[timer.status] ?? ''}${this.connected ? '' : ' · 等待重连'}` : '正在同步…';
    const disabled = !this.connected || this.pending || !timer;
    if (timer?.status === 'running' || timer?.status === 'paused') this.mode.value = timer.mode;
    element<HTMLButtonElement>('pomodoro-start').disabled = disabled || !['idle', 'finished'].includes(timer?.status ?? '');
    element<HTMLButtonElement>('pomodoro-pause').disabled = disabled || timer?.status !== 'running';
    element<HTMLButtonElement>('pomodoro-resume').disabled = disabled || timer?.status !== 'paused';
    element<HTMLButtonElement>('pomodoro-reset').disabled = disabled;
    this.mode.disabled = disabled || timer?.status === 'running' || timer?.status === 'paused';
  }
}
