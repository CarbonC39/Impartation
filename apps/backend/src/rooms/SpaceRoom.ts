import { randomUUID } from 'node:crypto';
import { Room, validate, CloseCode, ServerError, type AuthContext } from '@colyseus/core';
import { SpaceState, Player, spaceJoinSchema, spaceIdSchema, inputSchema, chatSchema, typingSchema, TYPING_TIMEOUT_MS, stepMovement, currentZone,
  TICK_MS, sameAudience, movementFacing, facingSchema, voiceEnabledSchema, voiceOfferSchema, voiceAnswerSchema,
  voiceIceCandidateSchema, voiceEndSchema, type VoiceOffer, type VoiceAnswer, type VoiceIceCandidate, type VoiceEnd,
  type SpaceJoinOptions, type WorldMap, type RegisteredMap, type MovementInput, type ChatMessage, type Zone } from '@virtual-workspace/shared';
import { worldRegistry, worlds as allMaps } from '../world.js';
import { createInteractions } from '../interactions/index.js';
import type { SpaceClient } from '../interactions/context.js';
import { activeProfile, ensureProfile, identityFromHeaders, identityEvents, type Identity } from '../identity.js';
import { db } from '../db.js';
import { config, voiceConfig } from '../config.js';
import { cancelAction } from '../interactions/action/handler.js';
import { VoiceSignaling } from './VoiceSignaling.js';

export class SpaceRoom extends Room<{ state: SpaceState; client: SpaceClient; metadata: { spaceId: string } }> {
  state = new SpaceState();
  maxClients = config.SPACE_MAX_CLIENTS;
  // The supported deployment is one backend process. Claim before the first await in onCreate.
  private static instances = new Map<string, SpaceRoom>();
  private maps = new Map<string, RegisteredMap>();
  private worldMaps: WorldMap[] = [];
  private initialMap = '';
  reconnectionSeconds = 20;
  private identities = new Map<string, Identity>();
  private joinedAt = new Map<string, number>();
  private pendingReconnections = new Map<string, ReturnType<SpaceRoom['allowReconnection']>>();
  private commandCursor = 0;
  private movementInputs = new Map<string, MovementInput & { receivedAt: number }>();
  private lastChat = new Map<string, number>();
  private typingUntil = new Map<string, number>();
  private lastInteraction = new Map<string, number>();
  private voice = new VoiceSignaling(this.state, voiceConfig, id => this.clients.find(client => client.sessionId === id));
  private interactions = createInteractions({
    state: this.state, maps: this.maps, worlds: this.worldMaps,
    authorize: client => this.authorize(client), check: (client, kind, resource) => this.checkInteraction(client, kind, resource),
    resetMovement: client => this.movementInputs.delete(client.sessionId),
    throttle: client => this.throttleInteraction(client),
  });

  static disconnectUser(userId: string, cutoff = Date.now()) {
    for (const room of SpaceRoom.instances.values()) room.disconnectUser(userId, cutoff);
  }

  private disconnectUser(userId: string, cutoff: number) {
    for (const [sessionId, identity] of [...this.identities]) {
      if (identity.userId !== userId || (this.joinedAt.get(sessionId) ?? 0) > cutoff) continue;
      this.movementInputs.delete(sessionId);
      const player = this.state.players.get(sessionId);
      if (player) player.connected = false;
      this.voice.clear(sessionId);
      this.identities.delete(sessionId);
      this.pendingReconnections.get(sessionId)?.reject(new Error('Disconnected by administrator'));
      this.clients.find(client => client.sessionId === sessionId)?.leave(4011, 'Account connection closed');
    }
  }

  private pollModeration() {
    const commands = db.prepare('SELECT id, user_id AS userId, created_at AS cutoff FROM moderation_commands WHERE id > ? ORDER BY id')
      .all(this.commandCursor) as { id: number; userId: string; cutoff: number }[];
    for (const command of commands) {
      this.commandCursor = command.id;
      this.disconnectUser(command.userId, command.cutoff);
    }
  }

  messages = {
    input: validate(inputSchema, async (client: SpaceClient, input: MovementInput) => {
      if (!await this.authorize(client)) return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (input.x || input.y) {
        cancelAction({ state: this.state, maps: this.maps }, player, client.sessionId);
        player.facing = movementFacing(input, facingSchema.parse(player.facing));
      }
      if (!input.x && !input.y) player.motion = 'idle';
      this.movementInputs.set(client.sessionId, { ...input, receivedAt: Date.now() });
    }),
    chat: validate(chatSchema, async (client: SpaceClient, { text }: { text: string }) => {
      if (!await this.authorize(client)) return;
      const player = this.state.players.get(client.sessionId);
      const now = Date.now();
      if (!player || now - (this.lastChat.get(client.sessionId) ?? 0) < 500) return;
      this.lastChat.set(client.sessionId, now);
      this.setTyping(client.sessionId, false);
      const message: ChatMessage = { id: randomUUID(), sessionId: client.sessionId, name: player.name, text, sentAt: now,
        privateAreaId: player.privateAreaId };
      for (const target of this.clients) {
        const listener = this.state.players.get(target.sessionId);
        if (listener?.connected && sameAudience(player, listener)) target.send('chat', message);
      }
    }),
    typing: validate(typingSchema, async (client: SpaceClient, { typing }: { typing: boolean }) => {
      if (!await this.authorize(client)) return;
      this.setTyping(client.sessionId, typing);
    }),
    voiceEnabled: validate(voiceEnabledSchema, async (client: SpaceClient, input: { enabled: boolean }) => {
      if (!await this.authorize(client)) return false;
      this.voice.setEnabled(client.sessionId, input.enabled);
      return true;
    }),
    voiceOffer: validate(voiceOfferSchema, async (client: SpaceClient, input: VoiceOffer) => {
      return await this.authorize(client) ? this.voice.offer(client.sessionId, input) : false;
    }),
    voiceAnswer: validate(voiceAnswerSchema, async (client: SpaceClient, input: VoiceAnswer) => {
      return await this.authorize(client) ? this.voice.answer(client.sessionId, input) : false;
    }),
    voiceIceCandidate: validate(voiceIceCandidateSchema, async (client: SpaceClient, input: VoiceIceCandidate) => {
      if (await this.authorize(client)) this.voice.candidate(client.sessionId, input);
    }),
    voiceEnd: validate(voiceEndSchema, async (client: SpaceClient, input: VoiceEnd) => {
      if (await this.authorize(client)) this.voice.end(client.sessionId, input);
    }),
    ...this.interactions.messages,
  };

  private async authorize(client: SpaceClient) {
    const identity = this.identities.get(client.sessionId);
    const value = identity && await activeProfile(identity);
    const player = this.state.players.get(client.sessionId);
    if (!value || !player?.connected || this.identities.get(client.sessionId) !== identity) return;
    player.name = value.name; player.avatar = value.avatar; player.appearance = JSON.stringify(value.appearance); player.role = value.role;
    return value;
  }

  /** Typing is only an expiring hint: chat, disconnect, leave or silence clears it. */
  private setTyping(sessionId: string, typing: boolean) {
    const player = this.state.players.get(sessionId);
    const active = typing && Boolean(player?.connected);
    if (active) this.typingUntil.set(sessionId, Date.now() + TYPING_TIMEOUT_MS); else this.typingUntil.delete(sessionId);
    if (player && player.typing !== active) player.typing = active;
  }

  private checkInteraction(client: SpaceClient, kind: Zone['kind'], resourceId: string): string | undefined {
    const player = this.state.players.get(client.sessionId);
    const map = player && this.maps.get(player.mapId);
    const current = player && map && currentZone(map.world, player);
    if (!player?.connected || current?.kind !== kind || current.resourceId !== resourceId) return '请先走进对应功能区';
    return this.throttleInteraction(client);
  }

  private throttleInteraction(client: SpaceClient): string | undefined {
    const now = Date.now();
    if (now - (this.lastInteraction.get(client.sessionId) ?? 0) < 500) return '操作过快，请稍后重试';
    this.lastInteraction.set(client.sessionId, now);
  }

  onCreate(options: { spaceId: string }) {
    const spaceId = spaceIdSchema.parse(options.spaceId);
    const space = worldRegistry.spaces.find(entry => entry.id === spaceId);
    if (!space) throw new ServerError(404, 'Unknown Space');
    const existing = SpaceRoom.instances.get(space.id);
    if (existing) throw new ServerError(409, existing.locked ? 'Space is full' : 'Space already active; join the existing Space');
    SpaceRoom.instances.set(space.id, this);
    this.commandCursor = (db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM moderation_commands').get() as { id: number }).id;
    this.state.spaceId = space.id;
    this.metadata = { spaceId: space.id };
    this.initialMap = space.initialMap;
    for (const id of space.maps) {
      const map = allMaps.get(id)!;
      this.maps.set(id, map);
      this.worldMaps.push(map.world);
    }
    this.patchRate = TICK_MS;
    for (const handler of this.interactions.registry.values()) handler.initialize?.();
    this.clock.setInterval(() => {
      this.pollModeration();
      this.voice.tick();
      const now = Date.now();
      for (const [id, until] of this.typingUntil) if (until <= now) this.setTyping(id, false);
      for (const handler of this.interactions.registry.values()) handler.tick?.();
      for (const client of this.clients) void this.authorize(client).then(value => {
        if (!value) { this.movementInputs.delete(client.sessionId); client.leave(4003, 'Identity expired'); }
      });
    }, 1000);
    this.setTimestep(delta => {
      for (const [id, player] of this.state.players) {
        if (player.action !== 'none') { player.motion = 'idle'; continue; }
        const input = this.movementInputs.get(id);
        if (!input || !player.connected || Date.now() - input.receivedAt > 250) { player.motion = 'idle'; continue; }
        const world = this.maps.get(player.mapId)!.world;
        const next = stepMovement(world, player, input, delta, point => this.interactions.access.canMove(player.mapId, id, player, point));
        player.motion = next.x !== player.x || next.y !== player.y ? 'walk' : 'idle';
        player.x = next.x;
        player.y = next.y;
        player.zoneId = currentZone(world, player)?.id ?? '';
        const privateAreaId = player.privateAreaId;
        this.interactions.access.syncPlayer(id, player);
        // Crossing a private-area border ends voice pairs now instead of on the next 1 s tick.
        if (player.privateAreaId !== privateAreaId) this.voice.tick();
      }
    }, TICK_MS);
  }
  async onAuth(_client: SpaceClient, options: SpaceJoinOptions, context: AuthContext) {
    const origin = context.headers.get('origin');
    if (origin && !config.IDENTITY_TRUSTED_ORIGINS.split(',').map(value => value.trim()).includes(origin)) {
      throw new Error('Untrusted connection origin');
    }
    const parsed = spaceJoinSchema.parse(options);
    if (parsed.spaceId !== this.state.spaceId) throw new ServerError(403, 'Space does not match this room');
    const identity = await identityFromHeaders(context.headers);
    if (!identity) throw new Error('A valid account session is required');
    ensureProfile(identity.userId, parsed);
    return identity;
  }
  async onJoin(client: SpaceClient, _options: SpaceJoinOptions, auth: Identity) {
    if (!await activeProfile(auth)) throw new ServerError(401, 'Account session expired');
    for (const handler of this.interactions.registry.values()) handler.tick?.();
    this.identities.set(client.sessionId, auth);
    this.joinedAt.set(client.sessionId, Date.now());
    const { name, avatar, appearance, role } = ensureProfile(auth.userId);
    const map = this.maps.get(this.initialMap)!;
    const world = map.world;
    const preferred = world.spawns[map.defaultSpawn];
    const spawn = [preferred, ...Object.values(world.spawns)].find(point => this.interactions.access.canEnter(map.id, client.sessionId, point));
    if (!spawn) throw new Error('All map spawns are inside locked private areas');
    const player = new Player({ name, avatar, appearance: JSON.stringify(appearance), role, userId: auth.userId, mapId: map.id, x: spawn.x, y: spawn.y });
    player.zoneId = currentZone(world, player)?.id ?? '';
    this.state.players.set(client.sessionId, player);
    this.interactions.access.syncPlayer(client.sessionId, player);
  }
  onDrop(client: SpaceClient, code: number) {
    this.voice.clear(client.sessionId);
    this.setTyping(client.sessionId, false);
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = false; player.motion = 'idle';
      // Legacy action seats retain their reconnect behavior; selectors release immediately.
      if (this.maps.get(player.mapId)?.world.selectors.some(selector => selector.id === player.actionTargetId))
        cancelAction({ state: this.state, maps: this.maps }, player, client.sessionId);
    }
    this.interactions.access.release(client.sessionId);
    this.movementInputs.delete(client.sessionId);
    // Match SDK retryable close codes. Validation failures must release their seats.
    if ([CloseCode.NO_STATUS_RECEIVED, CloseCode.ABNORMAL_CLOSURE,
      CloseCode.GOING_AWAY, CloseCode.MAY_TRY_RECONNECT].some(retryCode => retryCode === code)) {
      const pending = this.allowReconnection(client, this.reconnectionSeconds);
      this.pendingReconnections.set(client.sessionId, pending);
      pending.catch(() => {}).finally(() => this.pendingReconnections.delete(client.sessionId));
    }
  }
  async onReconnect(client: SpaceClient) {
    const identity = this.identities.get(client.sessionId);
    if (!identity || !await activeProfile(identity)) { client.leave(4003, 'Identity expired'); return; }
    const player = this.state.players.get(client.sessionId);
    if (player) {
      if (!this.interactions.access.canEnter(player.mapId, client.sessionId, player)) {
        const map = this.maps.get(player.mapId)!;
        const spawn = [map.world.spawns[map.defaultSpawn], ...Object.values(map.world.spawns)]
          .find(point => this.interactions.access.canEnter(player.mapId, client.sessionId, point));
        if (!spawn) { client.leave(4003, 'No accessible spawn'); return; }
        cancelAction({ state: this.state, maps: this.maps }, player, client.sessionId);
        player.x = spawn.x; player.y = spawn.y;
      }
      player.connected = true;
      player.zoneId = currentZone(this.maps.get(player.mapId)!.world, player)?.id ?? '';
      this.interactions.access.syncPlayer(client.sessionId, player);
    }
  }
  onLeave(client: SpaceClient) {
    this.interactions.access.release(client.sessionId);
    this.voice.clear(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (player) cancelAction({ state: this.state, maps: this.maps }, player, client.sessionId);
    this.identities.delete(client.sessionId);
    this.joinedAt.delete(client.sessionId);
    this.pendingReconnections.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.movementInputs.delete(client.sessionId);
    this.lastChat.delete(client.sessionId);
    this.typingUntil.delete(client.sessionId);
    this.lastInteraction.delete(client.sessionId);
  }
  onDispose() {
    if (SpaceRoom.instances.get(this.state.spaceId) === this) SpaceRoom.instances.delete(this.state.spaceId);
    this.voice.dispose();
    for (const handler of this.interactions.registry.values()) handler.dispose?.();
  }
}

identityEvents.on('disconnect', (userId: string, cutoff?: number) => SpaceRoom.disconnectUser(userId, cutoff));
