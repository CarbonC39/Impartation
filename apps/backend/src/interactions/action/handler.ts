import { activateActionSchema, findActionAnchor, actionFacingMatches, canAlignAction, currentZone, CHARACTER_ACTIONS, MapObjectState, WorldObjectState,
  type ActivateAction, type InteractionResult, type Player, type RegisteredMap } from '@virtual-workspace/shared';
import { z } from 'zod';
import type { PrivateAreaAccess } from '../privateArea/handler.js';
import type { InteractionContext, SpaceClient } from '../context.js';

export type ActionContext = InteractionContext & {
  maps: ReadonlyMap<string, RegisteredMap>;
  resetMovement(client: SpaceClient): void;
  throttle(client: SpaceClient): string | undefined;
};

/** Release only the current owner's claim and restore its selector target to authored state. */
export function releaseActionClaim(context: Pick<ActionContext, 'state' | 'maps'>, mapId: string, anchorId: string, sessionId: string) {
  const objects = context.state.worldObjects.get(mapId)?.objects;
  const object = objects?.get(anchorId);
  if (!sessionId || object?.occupiedBy !== sessionId) return;
  const selector = context.maps.get(mapId)?.world.selectors.find(item => item.id === anchorId);
  const target = selector && objects?.get(selector.targetObjectId);
  if (target) { target.variant = ''; target.variantCleared = false; }
  object.occupiedBy = '';
  if (object.variant === 'occupied') object.variant = 'empty';
}

export function cancelAction(context: Pick<ActionContext, 'state' | 'maps'>, player: Player, sessionId: string) {
  releaseActionClaim(context, player.mapId, player.actionTargetId, sessionId);
  player.action = 'none';
  player.actionAnimated = false;
  player.actionTargetId = '';
}

export function createActionInteraction(context: ActionContext & { access: PrivateAreaAccess }) {
  return {
    initialize() {
      for (const map of context.maps.values()) {
        const state = new MapObjectState();
        // Reserve entries for authored interaction objects, scoped by their map ID.
        for (const object of [...map.world.zones, ...map.world.actions, ...map.world.selectors, ...map.world.variantTargets.map(target => ({ ...target, kind: 'variantTarget' }))]) {
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
      cancelAction: { format: z.object({}).strict(),
        handler: async (client: SpaceClient, _input: Record<string, never>): Promise<InteractionResult> => {
          if (!await context.authorize(client)) return { ok: false, message: '身份已失效，请重新连接' };
          const player = context.state.players.get(client.sessionId);
          if (!player?.connected) return { ok: false, message: '角色尚未连接' };
          cancelAction(context, player, client.sessionId);
          return { ok: true, message: '已取消动作' };
        },
      },
      activateAction: {
        format: activateActionSchema,
        handler: async (client: SpaceClient, { action, animated: requestedAnimation }: ActivateAction): Promise<InteractionResult> => {
          const animated = requestedAnimation && CHARACTER_ACTIONS[action].animated;
          if (!await context.authorize(client)) return { ok: false, message: '身份已失效，请重新连接' };
          const player = context.state.players.get(client.sessionId);
          const map = player && context.maps.get(player.mapId);
          if (!player?.connected || !map) return { ok: false, message: '角色尚未进入地图' };
          const candidate = findActionAnchor(map.world, player, action);
          const anchor = candidate && actionFacingMatches(candidate, player.facing) ? candidate : undefined;
          const object = anchor && context.state.worldObjects.get(player.mapId)?.objects.get(anchor.id);
          if ((action === 'sit' || anchor?.kind === 'variantSelector') && object?.occupiedBy && object.occupiedBy !== client.sessionId) {
            return { ok: false, message: '座位已被占用' };
          }
          const x = anchor ? anchor.x + anchor.offsetX : player.x;
          const y = anchor ? anchor.y + anchor.offsetY : player.y;
          if (!canAlignAction(map.world, player, { x, y }, position => context.access.canEnter(player.mapId, client.sessionId, position))) return { ok: false, message: '动作位置不可站立' };
          const error = context.throttle(client);
          if (error) return { ok: false, message: error };
          const continuingSelector = anchor?.kind === 'variantSelector' && player.actionTargetId === anchor.id &&
            player.action === anchor.action && object?.occupiedBy === client.sessionId && player.x === x && player.y === y;
          if (!continuingSelector) cancelAction(context, player, client.sessionId);
          context.resetMovement(client);
          player.x = x; player.y = y;
          player.motion = 'idle';
          player.action = action; player.actionAnimated = animated; player.actionTargetId = anchor?.id ?? '';
          player.zoneId = currentZone(map.world, player)?.id ?? '';
          context.access.syncPlayer(client.sessionId, player);
          if (object && (action === 'sit' || anchor?.kind === 'variantSelector')) {
            object.occupiedBy = client.sessionId;
            if (anchor?.kind === 'action') object.variant = 'occupied';
            if (anchor?.kind === 'variantSelector' && anchor.variants.length === 1 && !continuingSelector) {
              const target = context.state.worldObjects.get(player.mapId)!.objects.get(anchor.targetObjectId)!;
              target.variant = anchor.variants[0]!; target.variantCleared = false;
            }
          }
          if (candidate?.facing && !anchor) {
            const labels = { up: '上方', down: '下方', left: '左方', right: '右方' } as const;
            return { ok: true, message: `已原地${action === 'sit' ? '坐下' : '执行动作'}；面向${labels[candidate.facing]}可对齐并使用交互点` };
          }
          return { ok: true, message: action === 'sit' ? '已坐下，移动即可起身' : '已开始动作，移动即可取消' };
        },
      },
    },
  };
}
