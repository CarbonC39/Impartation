import type { Room } from '@colyseus/sdk';
import { pomodoroModeSchema, type SpaceProtocol } from '@impartation/shared';
import { PanelInteraction, element } from '../panel';

export class PomodoroInteraction extends PanelInteraction {
  private mode = element<HTMLSelectElement>('pomodoro-mode');
  private serverTime = 0;
  private receivedAt = 0;
  private interval: ReturnType<typeof setInterval>;

  constructor(room: Room<SpaceProtocol>) {
    super(room, element('pomodoro-panel'));
    const options = { signal: this.controller.signal };
    for (const action of ['start', 'pause', 'resume', 'reset'] as const) {
      element(`pomodoro-${action}`).addEventListener('click', () => {
        if (!this.current) return;
        const resourceId = this.current.resourceId;
        const mode = pomodoroModeSchema.parse(this.mode.value);
        const payload = action === 'start' || action === 'reset' ? { resourceId, action, mode } : { resourceId, action };
        void this.run(() => this.room.request('pomodoro', payload));
      }, options);
    }
    this.interval = setInterval(() => this.render(), 250);
  }
  override setConnected(value: boolean) {
    if (this.connected && !value) this.serverTime += performance.now() - this.receivedAt;
    this.receivedAt = performance.now();
    super.setConnected(value);
  }
  override dispose() { clearInterval(this.interval); super.dispose(); }
  protected render() {
    if (this.serverTime !== this.room.state.serverTime) {
      this.serverTime = this.room.state.serverTime; this.receivedAt = performance.now();
    }
    if (!this.current) return;
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
  }}
