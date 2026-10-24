import { z } from 'zod';
import { currentZone, portalPropertiesSchema, quickTravelSchema, type QuickTravelInput, type Point,
  type InteractionResult, type RegisteredMap } from '@impartation/shared';
import type { InteractionContext, SpaceClient } from '../context.js';
import type { PrivateAreaAccess } from '../privateArea/handler.js';
import { cancelAction } from '../action/handler.js';

export function createPortalInteraction(context: InteractionContext & {
  access: PrivateAreaAccess;
  maps: ReadonlyMap<string, RegisteredMap>;
  resetMovement(client: SpaceClient): void;
  throttle(client: SpaceClient): string | undefined;
  onMapChanged?(client: SpaceClient): void;
}) {
  const transfer = (client: SpaceClient, destination: RegisteredMap, spawn: Point): InteractionResult => {
    const player = context.state.players.get(client.sessionId);
    if (!player?.connected) return { ok: false, message: '角色尚未连接' };
    if (!context.access.canEnter(destination.id, client.sessionId, spawn)) return { ok: false, message: '目标私密区域已锁定' };
    if (destination.id !== player.mapId) context.access.release(client.sessionId, player.mapId);
    cancelAction(context, player, client.sessionId);
    player.motion = 'idle';
    player.mapId = destination.id; player.x = spawn.x; player.y = spawn.y;
    player.zoneId = currentZone(destination.world, player)?.id ?? '';
    context.access.syncPlayer(client.sessionId, player);
    context.resetMovement(client);
    context.onMapChanged?.(client);
    return { ok: true, message: '已切换地图' };
  };
  return { messages: {
    portal: { format: z.object({ zoneId: z.string().trim().min(1).max(128) }),
      handler: async (client: SpaceClient, { zoneId }: { zoneId: string }): Promise<InteractionResult> => {
        if (!await context.authorize(client)) return { ok: false, message: '身份已失效，请重新连接' };
        const player = context.state.players.get(client.sessionId);
        const map = player && context.maps.get(player.mapId);
        const zone = map && player && currentZone(map.world, player);
        if (!player?.connected || zone?.id !== zoneId || zone.kind !== 'Portal') return { ok: false, message: '请先走进对应传送区' };
        const error = context.check(client, 'Portal', zone.resourceId);
        if (error) return { ok: false, message: error };
        const target = portalPropertiesSchema.parse(zone.properties);
        const destination = context.maps.get(target.targetMap);
        const spawn = destination?.world.spawns[target.targetSpawn];
        if (!destination || !spawn) return { ok: false, message: '目标地图不在当前 Space 内或出生点不存在' };
        return transfer(client, destination, spawn);
      } },
    quickTravel: { format: quickTravelSchema,
      handler: async (client: SpaceClient, { mapId }: QuickTravelInput): Promise<InteractionResult> => {
        if (!await context.authorize(client)) return { ok: false, message: '身份已失效，请重新连接' };
        const player = context.state.players.get(client.sessionId);
        if (!player?.connected) return { ok: false, message: '角色尚未连接' };
        const destination = context.maps.get(mapId);
        if (!destination) return { ok: false, message: '目标地图不在当前 Space 内' };
        if (player.mapId === destination.id) return { ok: false, message: '已在当前地图' };
        const error = context.throttle(client);
        if (error) return { ok: false, message: error };
        return transfer(client, destination, destination.world.spawns[destination.defaultSpawn]!);
      } },
  } };
}
