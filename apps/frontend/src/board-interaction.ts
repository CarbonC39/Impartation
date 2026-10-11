import type { Room } from '@colyseus/sdk';
import { boardPostSchema, type SpaceProtocol, type Zone } from '@virtual-workspace/shared';
import { PanelInteraction, element } from './panel-interaction';

export class BoardInteraction extends PanelInteraction {
  private notes = element<HTMLOListElement>('board-notes');
  private text = element<HTMLTextAreaElement>('board-text');
  private post = element<HTMLButtonElement>('board-post');
  private notesKey = '';

  constructor(room: Room<SpaceProtocol>) {
    super(room, element('board-panel'));
    const options = { signal: this.controller.signal };
    element<HTMLFormElement>('board-form').addEventListener('submit', event => {
      event.preventDefault();
      if (!this.current || !this.connected || this.pending) return;
      const payload = boardPostSchema.safeParse({ resourceId: this.current.resourceId, text: this.text.value });
      if (!payload.success) { this.feedback.textContent = '请输入 1–500 字留言'; return; }
      void this.run(() => this.room.request('boardPost', payload.data), () => { this.text.value = ''; });
    }, options);
    this.notes.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement) || !target.dataset.noteId || !this.current) return;
      const payload = { resourceId: this.current.resourceId, id: target.dataset.noteId };
      void this.run(() => this.room.request('boardDelete', payload));
    }, options);
  }
  override setZone(zone: Zone | undefined) {
    this.text.value = '';
    super.setZone(zone);
  }
  override dispose() { super.dispose(); this.notes.replaceChildren(); }
  protected render() {
    this.text.disabled = !this.connected || this.pending;
    this.post.disabled = !this.connected || this.pending;
    if (this.current?.kind !== 'board' || !this.room.state?.notes) return;
    const notes = [...this.room.state.notes.entries()]
      .filter(([, note]) => note.resourceId === this.current?.resourceId)
      .sort(([a, x], [b, y]) => x.createdAt - y.createdAt || a.localeCompare(b));
    const player = this.room.state.players.get(this.room.sessionId);
    const key = JSON.stringify([this.current.resourceId, this.connected, this.pending, player?.userId, player?.role, notes.map(([id]) => id)]);
    if (key === this.notesKey) return;
    this.notesKey = key;
    const children = notes.map(([id, note]) => {
      const item = document.createElement('li');
      const meta = document.createElement('small');
      meta.textContent = `${note.name} · ${new Date(note.createdAt).toLocaleString()}`;
      const body = document.createElement('p');
      body.textContent = note.text;
      item.append(meta, body);
      if (player && (note.authorUserId === player.userId || player.role === 'admin')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = note.authorUserId === player.userId ? '删除我的留言' : '管理员删除';
        button.dataset.noteId = id;
        button.disabled = !this.connected || this.pending;
        item.append(button);
      }
      return item;
    });
    if (!children.length) {
      const empty = document.createElement('li');
      empty.textContent = '还没有留言，写下第一条吧。';
      children.push(empty);
    }
    this.notes.replaceChildren(...children);
    element('board-count').textContent = `${notes.length} / 100 条`;
  }

}
