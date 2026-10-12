import { activateSchema, standsOnSeat, contains, MapObjectState, WorldObjectState,
  type ActivateInput, type InteractionResult, type Player } from '@virtual-workspace/shared';
import type { createPortalInteraction } from '../portal/handler.js';
import type { SpaceClient } from '../context.js';

type SeatContext = Parameters<typeof createPortalInteraction>[0] & {
  throttle(client: SpaceClient): string | undefined;
};

/** Release before walking, changing map or leaving. Dropped players retain their seat during reconnection. */
export function releaseSeat(context: Pick<SeatContext, 'state'>, player: Player, sessionId: string) {
  const object = context.state.worldObjects.get(player.mapId)?.objects.get(player.actionTargetId);
  if (object?.occupiedBy === sessionId) {
    object.occupiedBy = '';
    object.variant = 'empty';
  }
  player.action = 'none';
  player.actionTargetId = '';
}

export function createSeatInteraction(context: SeatContext) {
  return {
    initialize() {
      for (const map of context.maps.values()) {
        const state = new MapObjectState();
        // Reserve entries for authored interaction objects, scoped by their map ID.
        for (const object of [...map.world.zones, ...map.world.seats]) {
          state.objects.set(object.id, new WorldObjectState({ variant: object.kind === 'seat' ? 'empty' : '' }));
        }
        context.state.worldObjects.set(map.id, state);
      }
    },
    messages: {
      activate: {
        format: activateSchema,
        handler: async (client: SpaceClient, { objectId }: ActivateInput): Promise<InteractionResult> => {
          if (!await context.authorize(client)) return { ok: false, message: '身份已失效，请重新连接' };
          const player = context.state.players.get(client.sessionId);
          const map = player && context.maps.get(player.mapId);
          const seat = map?.world.seats.find(seat => seat.id === objectId);
          if (!player?.connected || !seat || !standsOnSeat(seat, player)) return { ok: false, message: '请先站到座位所在格子' };
          const object = context.state.worldObjects.get(player.mapId)?.objects.get(seat.id);
          if (!object || (object.occupiedBy && object.occupiedBy !== client.sessionId)) return { ok: false, message: '座位已被占用' };
          const error = context.throttle(client);
          if (error) return { ok: false, message: error };
          releaseSeat(context, player, client.sessionId);
          context.resetMovement(client);
          player.x = seat.x; player.y = seat.y;
          player.facing = seat.facing; player.motion = 'idle';
          player.action = 'sit'; player.actionTargetId = seat.id;
          player.zoneId = map!.world.zones.find(zone => contains(zone, player.x, player.y))?.id ?? '';
          object.occupiedBy = client.sessionId; object.variant = 'occupied';
          return { ok: true, message: '已坐下，移动即可起身' };
        },
      },
    },
  };
}
