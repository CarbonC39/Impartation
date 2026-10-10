import { randomUUID } from 'node:crypto';
import { Room, validate, CloseCode, type Client } from '@colyseus/core';
import { SpaceState, Player, joinSchema, inputSchema, chatSchema, stepMovement, contains,
  TICK_MS, BoardNote, Pomodoro, POMODORO_DURATIONS, boardPostSchema, boardDeleteSchema, pomodoroActionSchema,
  type JoinOptions, type MovementInput, type ChatMessage, type BoardPostInput, type BoardDeleteInput,
  type PomodoroActionInput, type FeatureResult, type Zone } from '@virtual-workspace/shared';
import { world } from '../world.js';
import { boards } from '../board.js';

type SpaceClient = Client<{ messages: { chat: ChatMessage } }>;

export class SpaceRoom extends Room<{ state: SpaceState; client: SpaceClient }> {
  state = new SpaceState();
  maxClients = 32;
  reconnectionSeconds = 20;
  private movementInputs = new Map<string, MovementInput & { receivedAt: number }>();
  private lastChat = new Map<string, number>();
  private lastFeature = new Map<string, number>();
  private unsubscribeBoard?: () => void;

  messages = {
    input: validate(inputSchema, (client: SpaceClient, input: MovementInput) => {
      this.movementInputs.set(client.sessionId, { ...input, receivedAt: Date.now() });
    }),
    chat: validate(chatSchema, (client: SpaceClient, { text }: { text: string }) => {
      const player = this.state.players.get(client.sessionId);
      const now = Date.now();
      if (!player || now - (this.lastChat.get(client.sessionId) ?? 0) < 500) return;
      this.lastChat.set(client.sessionId, now);
      const message: ChatMessage = { id: randomUUID(), name: player.name, text, sentAt: now };
      this.broadcast('chat', message);
    }),
    boardPost: { format: boardPostSchema, handler: (client: SpaceClient, { resourceId, text }: BoardPostInput): FeatureResult => {
      const error = this.checkFeature(client, 'board', resourceId);
      if (error) return { ok: false, message: error };
      const player = this.state.players.get(client.sessionId)!;
      const ok = boards.post(resourceId, client.sessionId, player.name, text);
      return { ok, message: ok ? '留言已发布' : '留言板已满（100 条），请先删除自己的留言' };
    } },
    boardDelete: { format: boardDeleteSchema, handler: (client: SpaceClient, { resourceId, id }: BoardDeleteInput): FeatureResult => {
      const error = this.checkFeature(client, 'board', resourceId);
      if (error) return { ok: false, message: error };
      const ok = boards.delete(resourceId, id, client.sessionId);
      return { ok, message: ok ? '留言已删除' : '只能删除当前访客会话发布的留言' };
    } },
    pomodoro: { format: pomodoroActionSchema, handler: (client: SpaceClient, input: PomodoroActionInput): FeatureResult => {
      const error = this.checkFeature(client, 'pomodoro', input.resourceId);
      if (error) return { ok: false, message: error };
      this.updateTimers();
      const timer = this.state.pomodoros.get(input.resourceId)!;
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
      this.state.serverTime = now;
      return { ok: true, message: '番茄钟已更新' };
    } },
  };

  private checkFeature(client: SpaceClient, kind: Zone['kind'], resourceId: string): string | undefined {
    const player = this.state.players.get(client.sessionId);
    const current = player && world.zones.find(zone => contains(zone, player.x, player.y));
    if (!player?.connected || current?.kind !== kind || current.resourceId !== resourceId) return '请先走进对应功能区';
    const now = Date.now();
    if (now - (this.lastFeature.get(client.sessionId) ?? 0) < 500) return '操作过快，请稍后重试';
    this.lastFeature.set(client.sessionId, now);
  }

  private syncBoard() {
    const notes = world.zones.filter(zone => zone.kind === 'board').flatMap(zone => boards.list(zone.resourceId));
    const ids = new Set(notes.map(note => note.id));
    for (const id of this.state.notes.keys()) if (!ids.has(id)) this.state.notes.delete(id);
    for (const note of notes) if (!this.state.notes.has(note.id)) this.state.notes.set(note.id, new BoardNote(note));
  }

  private updateTimers() {
    const now = Date.now();
    this.state.serverTime = now;
    for (const timer of this.state.pomodoros.values()) {
      if (timer.status === 'running' && now >= timer.endsAt) {
        timer.status = 'finished';
        timer.endsAt = 0;
        timer.remainingMs = 0;
      }
    }
  }

  onCreate() {
    this.patchRate = TICK_MS;
    this.syncBoard();
    this.unsubscribeBoard = boards.subscribe(() => this.syncBoard());
    for (const zone of world.zones) if (zone.kind === 'pomodoro') this.state.pomodoros.set(zone.resourceId, new Pomodoro());
    this.updateTimers();
    this.clock.setInterval(() => this.updateTimers(), 1000);
    this.setTimestep(delta => {
      for (const [id, player] of this.state.players) {
        const input = this.movementInputs.get(id);
        if (!input || !player.connected || Date.now() - input.receivedAt > 250) continue;
        const next = stepMovement(world, player, input, delta);
        player.x = next.x;
        player.y = next.y;
        player.zoneId = world.zones.find(zone => contains(zone, next.x, next.y))?.id ?? '';
      }
    }, TICK_MS);
  }
  // Development guests only. Authentication will be implemented here with onAuth.
  onAuth(_client: SpaceClient, options: JoinOptions) { return joinSchema.parse(options); }
  onJoin(client: SpaceClient, _options: JoinOptions, auth: JoinOptions) {
    this.updateTimers();
    const { name, avatar } = auth;
    const player = new Player({ name, avatar, x: world.spawn.x, y: world.spawn.y });
    player.zoneId = world.zones.find(zone => contains(zone, player.x, player.y))?.id ?? '';
    this.state.players.set(client.sessionId, player);
  }
  onDrop(client: SpaceClient, code: number) {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    this.movementInputs.delete(client.sessionId);
    // Match SDK retryable close codes. Validation failures must release their seats.
    if ([CloseCode.NO_STATUS_RECEIVED, CloseCode.ABNORMAL_CLOSURE,
      CloseCode.GOING_AWAY, CloseCode.MAY_TRY_RECONNECT].some(retryCode => retryCode === code)) {
      this.allowReconnection(client, this.reconnectionSeconds).catch(() => {});
    }
  }
  onReconnect(client: SpaceClient) {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
  }
  onLeave(client: SpaceClient) {
    this.state.players.delete(client.sessionId);
    this.movementInputs.delete(client.sessionId);
    this.lastChat.delete(client.sessionId);
    this.lastFeature.delete(client.sessionId);
  }
  onDispose() { this.unsubscribeBoard?.(); }
}
