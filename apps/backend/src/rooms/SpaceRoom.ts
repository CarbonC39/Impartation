import { randomUUID } from 'node:crypto';
import { Room, validate, CloseCode, type AuthContext } from '@colyseus/core';
import { SpaceState, Player, joinSchema, inputSchema, chatSchema, stepMovement, contains,
  TICK_MS, type JoinOptions, type MovementInput, type ChatMessage, type Zone } from '@virtual-workspace/shared';
import { worldRegistry, worlds } from '../world.js';
import { createInteractions } from '../interactions/index.js';
import type { SpaceClient } from '../interactions/context.js';
import { activeProfile, ensureProfile, identityFromHeaders, type Identity } from '../identity.js';
import { config } from '../config.js';

export class SpaceRoom extends Room<{ state: SpaceState; client: SpaceClient }> {
  state = new SpaceState();
  maxClients = 32;
  reconnectionSeconds = 20;
  private identities = new Map<string, Identity>();
  private movementInputs = new Map<string, MovementInput & { receivedAt: number }>();
  private lastChat = new Map<string, number>();
  private lastInteraction = new Map<string, number>();
  private interactions = createInteractions({
    state: this.state, maps: worlds, worlds: worldRegistry.maps.map(map => map.world),
    authorize: client => this.authorize(client), check: (client, kind, resource) => this.checkInteraction(client, kind, resource),
    resetMovement: client => this.movementInputs.delete(client.sessionId),
  });

  messages = {
    input: validate(inputSchema, async (client: SpaceClient, input: MovementInput) => {
      if (!await this.authorize(client)) return;
      this.movementInputs.set(client.sessionId, { ...input, receivedAt: Date.now() });
    }),
    chat: validate(chatSchema, async (client: SpaceClient, { text }: { text: string }) => {
      if (!await this.authorize(client)) return;
      const player = this.state.players.get(client.sessionId);
      const now = Date.now();
      if (!player || now - (this.lastChat.get(client.sessionId) ?? 0) < 500) return;
      this.lastChat.set(client.sessionId, now);
      const message: ChatMessage = { id: randomUUID(), name: player.name, text, sentAt: now };
      this.broadcast('chat', message);
    }),
    ...this.interactions.messages,
  };

  private async authorize(client: SpaceClient) {
    const identity = this.identities.get(client.sessionId);
    const value = identity && await activeProfile(identity);
    const player = this.state.players.get(client.sessionId);
    if (!value || !player?.connected) return;
    player.name = value.name; player.avatar = value.avatar; player.role = value.role;
    return value;
  }

  private checkInteraction(client: SpaceClient, kind: Zone['kind'], resourceId: string): string | undefined {
    const player = this.state.players.get(client.sessionId);
    const current = player && worlds.get(player.mapId)?.world.zones.find(zone => contains(zone, player.x, player.y));
    if (!player?.connected || current?.kind !== kind || current.resourceId !== resourceId) return '请先走进对应功能区';
    const now = Date.now();
    if (now - (this.lastInteraction.get(client.sessionId) ?? 0) < 500) return '操作过快，请稍后重试';
    this.lastInteraction.set(client.sessionId, now);
  }

  onCreate() {
    this.patchRate = TICK_MS;
    for (const handler of this.interactions.registry.values()) handler.initialize?.();
    this.clock.setInterval(() => {
      for (const handler of this.interactions.registry.values()) handler.tick?.();
      for (const client of this.clients) void this.authorize(client).then(value => {
        if (!value) { this.movementInputs.delete(client.sessionId); client.leave(4003, 'Identity expired'); }
      });
    }, 1000);
    this.setTimestep(delta => {
      for (const [id, player] of this.state.players) {
        const input = this.movementInputs.get(id);
        if (!input || !player.connected || Date.now() - input.receivedAt > 250) continue;
        const world = worlds.get(player.mapId)!.world;
        const next = stepMovement(world, player, input, delta);
        player.x = next.x;
        player.y = next.y;
        player.zoneId = world.zones.find(zone => contains(zone, next.x, next.y))?.id ?? '';
      }
    }, TICK_MS);
  }
  async onAuth(_client: SpaceClient, options: JoinOptions, context: AuthContext) {
    const origin = context.headers.get('origin');
    if (origin && !config.IDENTITY_TRUSTED_ORIGINS.split(',').map(value => value.trim()).includes(origin)) {
      throw new Error('Untrusted connection origin');
    }
    const parsed = joinSchema.parse(options);
    const identity = await identityFromHeaders(context.headers);
    if (!identity) throw new Error('A valid anonymous identity is required');
    ensureProfile(identity.userId, parsed);
    return identity;
  }
  onJoin(client: SpaceClient, _options: JoinOptions, auth: Identity) {
    for (const handler of this.interactions.registry.values()) handler.tick?.();
    this.identities.set(client.sessionId, auth);
    const { name, avatar, role } = ensureProfile(auth.userId);
    const map = worlds.get(worldRegistry.initialMap)!;
    const world = map.world;
    const spawn = world.spawns[map.defaultSpawn];
    const player = new Player({ name, avatar, role, userId: auth.userId, mapId: map.id, x: spawn.x, y: spawn.y });
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
  async onReconnect(client: SpaceClient) {
    const identity = this.identities.get(client.sessionId);
    if (!identity || !await activeProfile(identity)) { client.leave(4003, 'Identity expired'); return; }
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
  }
  onLeave(client: SpaceClient) {
    this.identities.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.movementInputs.delete(client.sessionId);
    this.lastChat.delete(client.sessionId);
    this.lastInteraction.delete(client.sessionId);
  }
  onDispose() { for (const handler of this.interactions.registry.values()) handler.dispose?.(); }
}
