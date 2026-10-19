import { randomUUID } from 'node:crypto';
import { Room, validate, CloseCode, type AuthContext } from '@colyseus/core';
import { SpaceState, Player, joinSchema, inputSchema, chatSchema, typingSchema, TYPING_TIMEOUT_MS, stepMovement, currentZone,
  TICK_MS, movementFacing, facingSchema, voiceEnabledSchema, voiceOfferSchema, voiceAnswerSchema,
  voiceIceCandidateSchema, voiceEndSchema, type VoiceOffer, type VoiceAnswer, type VoiceIceCandidate, type VoiceEnd,
  type JoinOptions, type MovementInput, type ChatMessage, type Zone } from '@virtual-workspace/shared';
import { worldRegistry, worlds } from '../world.js';
import { createInteractions } from '../interactions/index.js';
import type { SpaceClient } from '../interactions/context.js';
import { activeProfile, ensureProfile, identityFromHeaders, type Identity } from '../identity.js';
import { config, voiceConfig } from '../config.js';
import { cancelAction } from '../interactions/action/handler.js';
import { VoiceSignaling } from './VoiceSignaling.js';

export class SpaceRoom extends Room<{ state: SpaceState; client: SpaceClient }> {
  state = new SpaceState();
  maxClients = 32;
  reconnectionSeconds = 20;
  private identities = new Map<string, Identity>();
  private movementInputs = new Map<string, MovementInput & { receivedAt: number }>();
  private lastChat = new Map<string, number>();
  private typingUntil = new Map<string, number>();
  private lastInteraction = new Map<string, number>();
  private voice = new VoiceSignaling(this.state, voiceConfig, id => this.clients.find(client => client.sessionId === id));
  private interactions = createInteractions({
    state: this.state, maps: worlds, worlds: worldRegistry.maps.map(map => map.world),
    authorize: client => this.authorize(client), check: (client, kind, resource) => this.checkInteraction(client, kind, resource),
    resetMovement: client => this.movementInputs.delete(client.sessionId),
    throttle: client => this.throttleInteraction(client),
  });

  messages = {
    input: validate(inputSchema, async (client: SpaceClient, input: MovementInput) => {
      if (!await this.authorize(client)) return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (input.x || input.y) {
        cancelAction({ state: this.state, maps: worlds }, player, client.sessionId);
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
      const message: ChatMessage = { id: randomUUID(), sessionId: client.sessionId, name: player.name, text, sentAt: now };
      this.broadcast('chat', message);
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
    if (!value || !player?.connected) return;
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
    const map = player && worlds.get(player.mapId);
    const current = player && map && currentZone(map.world, player);
    if (!player?.connected || current?.kind !== kind || current.resourceId !== resourceId) return '请先走进对应功能区';
    return this.throttleInteraction(client);
  }

  private throttleInteraction(client: SpaceClient): string | undefined {
    const now = Date.now();
    if (now - (this.lastInteraction.get(client.sessionId) ?? 0) < 500) return '操作过快，请稍后重试';
    this.lastInteraction.set(client.sessionId, now);
  }

  onCreate() {
    this.patchRate = TICK_MS;
    for (const handler of this.interactions.registry.values()) handler.initialize?.();
    this.clock.setInterval(() => {
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
        const world = worlds.get(player.mapId)!.world;
        const next = stepMovement(world, player, input, delta, point => this.interactions.access.canMove(player.mapId, id, player, point));
        player.motion = next.x !== player.x || next.y !== player.y ? 'walk' : 'idle';
        player.x = next.x;
        player.y = next.y;
        player.zoneId = currentZone(world, player)?.id ?? '';
        this.interactions.access.syncPlayer(id, player);
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
    const { name, avatar, appearance, role } = ensureProfile(auth.userId);
    const map = worlds.get(worldRegistry.initialMap)!;
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
      if (worlds.get(player.mapId)?.world.selectors.some(selector => selector.id === player.actionTargetId))
        cancelAction({ state: this.state, maps: worlds }, player, client.sessionId);
    }
    this.interactions.access.release(client.sessionId);
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
    if (player) {
      if (!this.interactions.access.canEnter(player.mapId, client.sessionId, player)) {
        const map = worlds.get(player.mapId)!;
        const spawn = [map.world.spawns[map.defaultSpawn], ...Object.values(map.world.spawns)]
          .find(point => this.interactions.access.canEnter(player.mapId, client.sessionId, point));
        if (!spawn) { client.leave(4003, 'No accessible spawn'); return; }
        cancelAction({ state: this.state, maps: worlds }, player, client.sessionId);
        player.x = spawn.x; player.y = spawn.y;
      }
      player.connected = true;
      player.zoneId = currentZone(worlds.get(player.mapId)!.world, player)?.id ?? '';
      this.interactions.access.syncPlayer(client.sessionId, player);
    }
  }
  onLeave(client: SpaceClient) {
    this.interactions.access.release(client.sessionId);
    this.voice.clear(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (player) cancelAction({ state: this.state, maps: worlds }, player, client.sessionId);
    this.identities.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.movementInputs.delete(client.sessionId);
    this.lastChat.delete(client.sessionId);
    this.typingUntil.delete(client.sessionId);
    this.lastInteraction.delete(client.sessionId);
  }
  onDispose() { this.voice.dispose(); for (const handler of this.interactions.registry.values()) handler.dispose?.(); }
}
