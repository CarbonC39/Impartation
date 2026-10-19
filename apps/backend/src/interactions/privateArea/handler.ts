import { contains, PLAYER_FOOTPRINT, PRIVATE_AREA_IDLE_MS, MapPrivateAreaState, PrivateAreaState,
  privateAreaOperationSchema, type PrivateAreaOperationInput, type InteractionResult,
  type Player, type Point, type RegisteredMap, type Zone } from '@virtual-workspace/shared';
import type { InteractionContext, SpaceClient } from '../context.js';

type Context = InteractionContext & { maps: ReadonlyMap<string, RegisteredMap>; throttle(client: SpaceClient): string | undefined };

/** Temporary spatial contexts. Membership belongs to a verified live connection, never to an owner. */
export function createPrivateAreaInteraction(context: Context) {
  const areas = (mapId: string) => context.maps.get(mapId)?.world.zones.filter(zone => zone.kind === 'privateArea') ?? [];
  const stateFor = (mapId: string, areaId: string) => context.state.privateAreas.get(mapId)?.areas.get(areaId);
  const overlaps = (area: Zone, point: Point) => point.x + PLAYER_FOOTPRINT.width / 2 > area.x &&
    point.x - PLAYER_FOOTPRINT.width / 2 < area.x + area.width && point.y > area.y &&
    point.y - PLAYER_FOOTPRINT.height < area.y + area.height;
  const canEnter = (mapId: string, sessionId: string, point: Point) => areas(mapId).every(area => {
    const state = stateFor(mapId, area.id);
    return !overlaps(area, point) || !state?.locked || state.members.has(sessionId);
  });
  const overlapArea = (area: Zone, point: Point) => Math.max(0,
    Math.min(point.x + PLAYER_FOOTPRINT.width / 2, area.x + area.width) - Math.max(point.x - PLAYER_FOOTPRINT.width / 2, area.x)) *
    Math.max(0, Math.min(point.y, area.y + area.height) - Math.max(point.y - PLAYER_FOOTPRINT.height, area.y));
  const canMove = (mapId: string, sessionId: string, from: Point, to: Point) => areas(mapId).every(area => {
    const state = stateFor(mapId, area.id);
    if (!state?.locked || state.members.has(sessionId) || !overlaps(area, to)) return true;
    // A lock may close while an outsider's footprint straddles the border. Allow retreat/sideways movement.
    const sameSide = (from.x <= area.x && to.x <= area.x) ||
      (from.x >= area.x + area.width && to.x >= area.x + area.width) ||
      (from.y <= area.y && to.y <= area.y) || (from.y >= area.y + area.height && to.y >= area.y + area.height);
    return sameSide && !contains(area, from.x, from.y) && !contains(area, to.x, to.y) && overlapArea(area, from) > 0 &&
      overlapArea(area, to) <= overlapArea(area, from);
  });
  const syncPlayer = (sessionId: string, player: Player) => {
    player.privateAreaId = '';
    if (!player.connected) return;
    for (const area of areas(player.mapId)) {
      if (!contains(area, player.x, player.y)) continue;
      const state = stateFor(player.mapId, area.id)!;
      if (!state.locked || state.members.has(sessionId)) {
        state.members.set(sessionId, true);
        state.resetAt = 0;
        player.privateAreaId = area.id;
      }
    }
  };
  const reset = (state: PrivateAreaState) => { state.locked = false; state.members.clear(); state.resetAt = 0; };
  const tick = (now = Date.now()) => {
    // Prune disconnected/missing players before admitting or counting occupants.
    for (const map of context.state.privateAreas.values()) for (const state of map.areas.values()) {
      for (const id of [...state.members.keys()]) if (!context.state.players.get(id)?.connected) state.members.delete(id);
    }
    for (const [id, player] of context.state.players) syncPlayer(id, player);
    for (const [mapId, map] of context.state.privateAreas) for (const [areaId, state] of map.areas) {
      const active = [...state.members.keys()].some(id => {
        const player = context.state.players.get(id);
        return player?.connected && player.mapId === mapId && player.privateAreaId === areaId;
      });
      if (active) state.resetAt = 0;
      else if (!state.members.size) reset(state);
      else if (!state.resetAt) state.resetAt = now + PRIVATE_AREA_IDLE_MS;
      else if (now >= state.resetAt) reset(state);
    }
  };
  const release = (sessionId: string, mapId?: string) => {
    for (const [id, map] of context.state.privateAreas) {
      if (mapId !== undefined && id !== mapId) continue;
      for (const state of map.areas.values()) {
        state.members.delete(sessionId);
        if (!state.members.size) reset(state);
      }
    }
    const player = context.state.players.get(sessionId);
    if (player) player.privateAreaId = '';
  };
  return {
    canEnter, canMove, syncPlayer, release, tick,
    initialize() {
      for (const map of context.maps.values()) {
        const state = new MapPrivateAreaState();
        for (const area of areas(map.id)) state.areas.set(area.id, new PrivateAreaState());
        context.state.privateAreas.set(map.id, state);
      }
    },
    messages: {
      privateArea: { format: privateAreaOperationSchema,
        handler: async (client: SpaceClient, input: PrivateAreaOperationInput): Promise<InteractionResult> => {
          if (!await context.authorize(client)) return { ok: false, message: '身份已失效，请重新连接' };
          tick();
          const player = context.state.players.get(client.sessionId);
          const state = player && stateFor(player.mapId, input.areaId);
          if (!player?.connected || !state?.members.has(client.sessionId)) return { ok: false, message: '只有当前私密会话成员可以操作' };
          const error = context.throttle(client);
          if (error) return { ok: false, message: error };
          // No await between permission checks and mutations: requests serialize on the room event loop.
          if (input.operation === 'lock') state.locked = input.locked;
          else {
            if (!context.state.players.get(input.playerId)?.connected) return { ok: false, message: '请选择在线玩家' };
            state.members.set(input.playerId, true);
          }
          return { ok: true, message: input.operation === 'lock' ? (input.locked ? '区域已锁定' : '区域已解锁') : '已添加成员' };
        },
      },
    },
  };
}
export type PrivateAreaAccess = Pick<ReturnType<typeof createPrivateAreaInteraction>, 'canEnter' | 'syncPlayer' | 'release'>;
