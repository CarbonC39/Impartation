import { z } from 'zod';
import { currentZone, portalPropertiesSchema, type InteractionResult, type RegisteredMap } from '@virtual-workspace/shared';
import type { InteractionContext, SpaceClient } from '../context.js';
import type { PrivateAreaAccess } from '../privateArea/handler.js';
import { cancelAction } from '../action/handler.js';

export function createPortalInteraction(context: InteractionContext & {
  access: PrivateAreaAccess;
  maps: ReadonlyMap<string, RegisteredMap>;
  resetMovement(client: SpaceClient): void;
}) {
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
        if (!context.access.canEnter(destination.id, client.sessionId, spawn)) return { ok: false, message: '目标私密区域已锁定' };
        if (destination.id !== player.mapId) context.access.release(client.sessionId, player.mapId);
        cancelAction(context, player, client.sessionId);
        player.motion = 'idle';
        player.mapId = destination.id; player.x = spawn.x; player.y = spawn.y;
        player.zoneId = currentZone(destination.world, player)?.id ?? '';
        context.access.syncPlayer(client.sessionId, player);
        context.resetMovement(client);
        return { ok: true, message: '已切换地图' };
      } },
  } };
}
