import { activateActionSchema, CHARACTER_ACTIONS, standsOnAction, contains, canStand, MapObjectState, WorldObjectState,
  type ActivateAction, type InteractionResult, type Player, type RegisteredMap } from '@virtual-workspace/shared';
import type { InteractionContext, SpaceClient } from '../context.js';

type ActionContext = InteractionContext & {
  maps: ReadonlyMap<string, RegisteredMap>;
  resetMovement(client: SpaceClient): void;
  throttle(client: SpaceClient): string | undefined;
};

/** Release before walking, changing map or leaving. Dropped players retain their seat during reconnection. */
export function cancelAction(context: Pick<ActionContext, 'state'>, player: Player, sessionId: string) {
  const object = context.state.worldObjects.get(player.mapId)?.objects.get(player.actionTargetId);
  if (object?.occupiedBy === sessionId) {
    object.occupiedBy = '';
    object.variant = 'empty';
  }
  player.action = 'none';
  player.actionAnimated = false;
  player.actionTargetId = '';
}

export function createActionInteraction(context: ActionContext) {
  return {
    initialize() {
      for (const map of context.maps.values()) {
        const state = new MapObjectState();
        // Reserve entries for authored interaction objects, scoped by their map ID.
        for (const object of [...map.world.zones, ...map.world.actions]) {
          state.objects.set(object.id, new WorldObjectState({
            variant: object.kind === 'action' && 'action' in object && object.action === 'sit' ? 'empty' : '',
          }));
        }
        // Linked IDs are authored metadata, with semantic state ready for future handlers.
        for (const object of map.world.actions) {
          if (object.linkedObjectId && !state.objects.has(object.linkedObjectId)) {
            state.objects.set(object.linkedObjectId, new WorldObjectState());
          }
        }
        context.state.worldObjects.set(map.id, state);
      }
    },
    messages: {
      activateAction: {
        format: activateActionSchema,
        handler: async (client: SpaceClient, { action, animated: requestedAnimation }: ActivateAction): Promise<InteractionResult> => {
          const animated = requestedAnimation && CHARACTER_ACTIONS[action].animated;
          if (!await context.authorize(client)) return { ok: false, message: '身份已失效，请重新连接' };
          const player = context.state.players.get(client.sessionId);
          const map = player && context.maps.get(player.mapId);
          if (!player?.connected || !map) return { ok: false, message: '角色尚未进入地图' };
          const anchor = map.world.actions.find(object => object.action === action && standsOnAction(object, player));
          const object = anchor && context.state.worldObjects.get(player.mapId)?.objects.get(anchor.id);
          if (action === 'sit' && object?.occupiedBy && object.occupiedBy !== client.sessionId) {
            return { ok: false, message: '座位已被占用' };
          }
          const x = anchor ? anchor.x + anchor.offsetX : player.x;
          const y = anchor ? anchor.y + anchor.offsetY : player.y;
          if (!canStand(map.world, x, y)) return { ok: false, message: '动作位置不可站立' };
          const error = context.throttle(client);
          if (error) return { ok: false, message: error };
          cancelAction(context, player, client.sessionId);
          context.resetMovement(client);
          player.x = x; player.y = y;
          if (anchor?.facing) player.facing = anchor.facing;
          player.motion = 'idle';
          player.action = action; player.actionAnimated = animated; player.actionTargetId = anchor?.id ?? '';
          player.zoneId = map.world.zones.find(zone => contains(zone, player.x, player.y))?.id ?? '';
          if (action === 'sit' && object) { object.occupiedBy = client.sessionId; object.variant = 'occupied'; }
          return { ok: true, message: action === 'sit' ? '已坐下，移动即可起身' : '已开始动作，移动即可取消' };
        },
      },
    },
  };
}
