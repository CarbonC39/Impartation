import { BoardNote, boardPostSchema, boardDeleteSchema, type BoardPostInput, type BoardDeleteInput, type InteractionResult } from '@virtual-workspace/shared';
import { boards } from './store.js';
import type { InteractionContext, SpaceClient } from '../context.js';

export function createBoardInteraction(context: InteractionContext) {
  let unsubscribe: (() => void) | undefined;
  function syncBoard() {
    const notes = context.worlds.flatMap(world => world.zones).filter(zone => zone.kind === 'board').flatMap(zone => boards.list(zone.resourceId));
    const ids = new Set(notes.map(note => note.id));
    for (const id of context.state.notes.keys()) if (!ids.has(id)) context.state.notes.delete(id);
    for (const note of notes) if (!context.state.notes.has(note.id)) context.state.notes.set(note.id, new BoardNote(note));
  }

  return {
    initialize() { syncBoard(); unsubscribe = boards.subscribe(syncBoard); },
    dispose() { unsubscribe?.(); },
    messages: {
      boardPost: { format: boardPostSchema, handler: async (client: SpaceClient, { resourceId, text }: BoardPostInput): Promise<InteractionResult> => {
        if (!await context.authorize(client)) return { ok: false, message: '身份已失效，请重新连接' };
        const error = context.check(client, 'board', resourceId);
        if (error) return { ok: false, message: error };
        const player = context.state.players.get(client.sessionId)!;
        const ok = boards.post(resourceId, player.userId, player.name, text, client.sessionId);
        return { ok, message: ok ? '留言已发布' : '留言板已满（100 条），请先删除自己的留言' };
      } },
      boardDelete: { format: boardDeleteSchema, handler: async (client: SpaceClient, { resourceId, id }: BoardDeleteInput): Promise<InteractionResult> => {
        const profile = await context.authorize(client);
        if (!profile) return { ok: false, message: '身份已失效，请重新连接' };
        const error = context.check(client, 'board', resourceId);
        if (error) return { ok: false, message: error };
        const ok = boards.delete(resourceId, id, profile.id, profile.role === 'admin');
        return { ok, message: ok ? '留言已删除' : '只有作者或管理员可以删除留言' };
      } },
    },
  };
}
