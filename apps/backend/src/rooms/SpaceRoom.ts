import { randomUUID } from 'node:crypto';
import { Room, validate, CloseCode, type Client } from '@colyseus/core';
import { SpaceState, Player, joinSchema, inputSchema, chatSchema, stepMovement, contains,
  TICK_MS, type JoinOptions, type MovementInput, type ChatMessage } from '@virtual-workspace/shared';
import { world } from '../world.js';

type SpaceClient = Client<{ messages: { chat: ChatMessage } }>;

export class SpaceRoom extends Room<{ state: SpaceState; client: SpaceClient }> {
  state = new SpaceState();
  maxClients = 32;
  reconnectionSeconds = 20;
  private movementInputs = new Map<string, MovementInput & { receivedAt: number }>();
  private lastChat = new Map<string, number>();

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
  };

  onCreate() {
    this.patchRate = TICK_MS;
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
  }
}
