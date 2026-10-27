import { z } from 'zod';
import { AttachmentSourceState, attachmentSource, attachmentSourceKey, currentZones, takeAttachmentSchema,
  type InteractionResult, type Player, type RegisteredMap, type TakeAttachmentInput } from '@impartation/shared';
import type { InteractionContext, SpaceClient } from '../context.js';

/** Clearing or replacing an attachment returns a unique source to the room. */
export function clearPlayerAttachment(context: Pick<InteractionContext, 'state'>, player: Player, sessionId: string) {
  if (player.attachmentSource) {
    const source = context.state.attachmentSources.get(player.attachmentSource);
    if (source?.holder === sessionId) source.holder = '';
  }
  player.attachmentId = '';
  player.attachmentSource = '';
}

export function createAttachmentInteraction(context: InteractionContext & { maps: ReadonlyMap<string, RegisteredMap> }) {
  return {
    initialize() {
      for (const [mapId, map] of context.maps) for (const zone of map.world.zones) {
        if (zone.kind === 'attachment' && attachmentSource(zone).mode === 'single-unique')
          context.state.attachmentSources.set(attachmentSourceKey(mapId, zone.id), new AttachmentSourceState());
      }
    },
    messages: {
      takeAttachment: { format: takeAttachmentSchema,
        handler: async (client: SpaceClient, { sourceId }: TakeAttachmentInput): Promise<InteractionResult> => {
          if (!await context.authorize(client)) return { ok: false, message: '身份已失效，请重新连接' };
          const player = context.state.players.get(client.sessionId);
          const map = player && context.maps.get(player.mapId);
          const zone = player && map && currentZones(map.world, player).find(zone => zone.kind === 'attachment' && zone.id === sourceId);
          if (!player?.connected || !zone || zone.id !== sourceId || zone.kind !== 'attachment')
            return { ok: false, message: '请先走进对应附件区' };
          const error = context.check(client, 'attachment', zone.resourceId);
          if (error) return { ok: false, message: error };
          const source = attachmentSource(zone);
          const key = attachmentSourceKey(player.mapId, zone.id);
          const state = context.state.attachmentSources.get(key);
          if (source.mode === 'single-unique' && (!state || (state.holder && state.holder !== client.sessionId)))
            return { ok: false, message: '附件已被取走' };
          const ids = source.attachmentIds;
          const id = ids[source.mode === 'multiple-unlimited-random' ? Math.floor(Math.random() * ids.length) : 0]!;
          clearPlayerAttachment(context, player, client.sessionId);
          player.attachmentId = id;
          player.attachmentSource = key;
          if (state) state.holder = client.sessionId;
          return { ok: true, message: '已附着角色' };
        },
      },
      clearAttachment: { format: z.object({}).strict(),
        handler: async (client: SpaceClient, _input: Record<string, never>): Promise<InteractionResult> => {
          if (!await context.authorize(client)) return { ok: false, message: '身份已失效，请重新连接' };
          const player = context.state.players.get(client.sessionId);
          if (!player?.connected) return { ok: false, message: '角色尚未连接' };
          clearPlayerAttachment(context, player, client.sessionId);
          return { ok: true, message: '已清除附件' };
        },
      },
    },
  };
}
