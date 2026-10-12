import { Pomodoro, POMODORO_DURATIONS, pomodoroActionSchema, type PomodoroActionInput, type InteractionResult } from '@virtual-workspace/shared';
import type { InteractionContext, SpaceClient } from '../context.js';

export function createPomodoroInteraction(context: InteractionContext) {
  function updateTimers() {
    const now = Date.now();
    context.state.serverTime = now;
    for (const timer of context.state.pomodoros.values()) {
      if (timer.status === 'running' && now >= timer.endsAt) {
        timer.status = 'finished';
        timer.endsAt = 0;
        timer.remainingMs = 0;
      }
    }
  }

  return {
    initialize() {
      for (const world of context.worlds) for (const zone of world.zones) {
        if (zone.kind === 'pomodoro' && !context.state.pomodoros.has(zone.resourceId)) context.state.pomodoros.set(zone.resourceId, new Pomodoro());
      }
      updateTimers();
    },
    tick: updateTimers,
    messages: {
      pomodoro: { format: pomodoroActionSchema, handler: async (client: SpaceClient, input: PomodoroActionInput): Promise<InteractionResult> => {
        if (!await context.authorize(client)) return { ok: false, message: '身份已失效，请重新连接' };
        const error = context.check(client, 'pomodoro', input.resourceId);
        if (error) return { ok: false, message: error };
        updateTimers();
        const timer = context.state.pomodoros.get(input.resourceId)!;
        const now = Date.now();
        switch (input.action) {
          case 'start':
            if (timer.status === 'running' || timer.status === 'paused') return { ok: false, message: '计时已开始，请暂停或重置' };
            timer.mode = input.mode;
            timer.remainingMs = POMODORO_DURATIONS[input.mode];
            timer.endsAt = now + timer.remainingMs;
            timer.status = 'running';
            break;
          case 'pause':
            if (timer.status !== 'running') return { ok: false, message: '当前没有正在运行的计时' };
            timer.remainingMs = Math.max(0, timer.endsAt - now);
            timer.endsAt = 0;
            timer.status = 'paused';
            break;
          case 'resume':
            if (timer.status !== 'paused') return { ok: false, message: '只有暂停的计时可以继续' };
            timer.endsAt = now + timer.remainingMs;
            timer.status = 'running';
            break;
          case 'reset':
            timer.mode = input.mode;
            timer.remainingMs = POMODORO_DURATIONS[input.mode];
            timer.endsAt = 0;
            timer.status = 'idle';
            break;
        }
        context.state.serverTime = now;
        return { ok: true, message: '番茄钟已更新' };
      } },
    },
  };
}
