import { z } from 'zod';
import { currentZone, type InteractionResult, type RegisteredMap } from '@virtual-workspace/shared';
import type { InteractionContext, SpaceClient } from '../context.js';
import type { PrivateAreaAccess } from '../privateArea/handler.js';
import { cancelAction } from '../action/handler.js';

export function createQuickTravelInteraction(context: InteractionContext & {
  access: PrivateAreaAccess;
  maps: ReadonlyMap<string, RegisteredMap>;
  resetMovement(client: SpaceClient): void;
}) {
  return { messages: {
    quickTravel: { format: z.object({ mapId: z.string().min(1).max(128) }).strict(),
      handler: async (client: SpaceClient, { mapId }: { mapId: string }): Promise<InteractionResult> => {
        if (!await context.authorize(client)) return { ok: false, message: '身份已失效，请重新连接' };
        const player = context.state.players.get(client.sessionId);
        if (!player?.connected) return { ok: false, message: '连接已断开' };
        const destination = context.maps.get(mapId);
        if (!destination) return { ok: false, message: '目标地图不在当前 Space 内' };
        if (destination.id === player.mapId) return { ok: true, message: '已在当前地图' };
        const preferred = destination.world.spawns[destination.defaultSpawn];
        const spawn = [preferred, ...Object.values(destination.world.spawns)]
          .find(point => point && context.access.canEnter(destination.id, client.sessionId, point));
        if (!spawn) return { ok: false, message: '目标地图没有可进入的出生点' };
        context.access.release(client.sessionId, player.mapId);
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
