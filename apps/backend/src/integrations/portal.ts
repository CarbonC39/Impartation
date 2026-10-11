import { z } from 'zod';
import { contains, portalPropertiesSchema, type FeatureResult, type RegisteredMap } from '@virtual-workspace/shared';
import type { InteractionContext, SpaceClient } from './context.js';

export function createPortalInteraction(context: InteractionContext & {
  maps: ReadonlyMap<string, RegisteredMap>;
  resetMovement(client: SpaceClient): void;
}) {
  return { messages: {
    portal: { format: z.object({ zoneId: z.string().trim().min(1).max(128) }),
      handler: async (client: SpaceClient, { zoneId }: { zoneId: string }): Promise<FeatureResult> => {
        if (!await context.authorize(client)) return { ok: false, message: '身份已失效，请重新连接' };
        const player = context.state.players.get(client.sessionId);
        const zone = player && context.maps.get(player.mapId)?.world.zones.find(zone => contains(zone, player.x, player.y));
        if (!player?.connected || zone?.id !== zoneId || zone.kind !== 'Portal') return { ok: false, message: '请先走进对应传送区' };
        const error = context.check(client, 'Portal', zone.resourceId);
        if (error) return { ok: false, message: error };
        const target = portalPropertiesSchema.parse(zone.properties);
        const destination = context.maps.get(target.targetMap)!;
        const spawn = destination.world.spawns[target.targetSpawn];
        player.mapId = destination.id; player.x = spawn.x; player.y = spawn.y;
        player.zoneId = destination.world.zones.find(zone => contains(zone, player.x, player.y))?.id ?? '';
        context.resetMovement(client);
        return { ok: true, message: '已切换地图' };
      } },
  } };
}
