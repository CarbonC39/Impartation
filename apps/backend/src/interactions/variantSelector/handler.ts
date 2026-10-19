import { selectVariantSchema, actionFacingMatches, type SelectVariantInput, type InteractionResult, type RegisteredMap } from '@virtual-workspace/shared';
import type { InteractionContext, SpaceClient } from '../context.js';
import { cancelAction, releaseActionClaim } from '../action/handler.js';

export function createVariantSelectorInteraction(context: InteractionContext & {
  maps: ReadonlyMap<string, RegisteredMap>; throttle(client: SpaceClient): string | undefined;
}) {
  return {
    tick() {
      for (const [mapId, objects] of context.state.worldObjects) for (const selector of context.maps.get(mapId)?.world.selectors ?? []) {
        const claim = objects.objects.get(selector.id);
        const owner = claim?.occupiedBy;
        if (!owner) continue;
        const player = context.state.players.get(owner);
        if (!player || !player.connected || player.mapId !== mapId || player.actionTargetId !== selector.id || player.action !== selector.action || !actionFacingMatches(selector, player.facing) ||
          player.x !== selector.x + selector.offsetX || player.y !== selector.y + selector.offsetY) {
          if (player && player.mapId === mapId && player.actionTargetId === selector.id) cancelAction(context, player, owner);
          releaseActionClaim(context, mapId, selector.id, owner);
        }
      }
    },
    messages: { selectVariant: { format: selectVariantSchema,
      handler: async (client: SpaceClient, input: SelectVariantInput): Promise<InteractionResult> => {
        if (!await context.authorize(client)) return { ok: false, message: '身份已失效，请重新连接' };
        const player = context.state.players.get(client.sessionId);
        const selector = player && context.maps.get(player.mapId)?.world.selectors.find(item => item.id === input.selectorId);
        const objects = player && context.state.worldObjects.get(player.mapId)?.objects;
        if (!player?.connected || !selector || player.actionTargetId !== selector.id || player.action !== selector.action || !actionFacingMatches(selector, player.facing) ||
          objects?.get(selector.id)?.occupiedBy !== client.sessionId || player.x !== selector.x + selector.offsetX || player.y !== selector.y + selector.offsetY)
          return { ok: false, message: '请先在选择点执行所需动作' };
        if (input.variant !== null && !selector.variants.includes(input.variant)) return { ok: false, message: '该选择点不支持此变体' };
        const error = context.throttle(client);
        if (error) return { ok: false, message: error };
        const target = objects.get(selector.targetObjectId)!;
        target.variant = input.variant ?? '';
        target.variantCleared = input.variant === null;
        return { ok: true, message: input.variant === null ? '已清除物品' : '已切换物品' };
      },
    } },
  };
}
