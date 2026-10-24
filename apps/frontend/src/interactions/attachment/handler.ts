import type { Room } from '@colyseus/sdk';
import { ATTACHMENTS, attachmentSource, attachmentSourceKey, type AttachmentId, type SpaceProtocol, type Zone } from '@impartation/shared';
import type { InteractionHandler } from '../dispatcher';
import { element } from '../panel';

export class AttachmentInteraction implements InteractionHandler {
  private panel = element('attachment-panel');
  private take = element<HTMLButtonElement>('attachment-take');
  private clear = element<HTMLButtonElement>('attachment-clear');
  private current = element('attachment-current');
  private availability = element('attachment-availability');
  private feedback = element('attachment-feedback');
  private zone?: Zone;
  private connected = true;
  private pending = false;
  private disposed = false;
  private controller = new AbortController();
  private renderState = () => this.render();

  constructor(private room: Room<SpaceProtocol>) {
    room.onStateChange(this.renderState);
    this.take.addEventListener('click', () => { void this.run('take'); }, { signal: this.controller.signal });
    this.clear.addEventListener('click', () => { void this.run('clear'); }, { signal: this.controller.signal });
    this.render();
  }
  private render() {
    const player = this.room.state.players.get(this.room.sessionId);
    const asset = ATTACHMENTS[player?.attachmentId as AttachmentId];
    this.current.textContent = `当前附着：${asset?.name ?? '无'}`;
    this.clear.disabled = !this.connected || this.pending || !player?.connected || !asset;
    this.panel.hidden = !this.zone;
    if (!this.zone || !player) return;
    const source = attachmentSource(this.zone);
    const holder = this.room.state.attachmentSources.get(attachmentSourceKey(player.mapId, this.zone.id))?.holder;
    const available = source.mode !== 'single-unique' || !holder || holder === this.room.sessionId;
    this.availability.textContent = available ? '可取用' : '已被取走，等待持有者清除';
    this.take.textContent = source.mode === 'multiple-unlimited-random' ? '随机取一件' : `取用${ATTACHMENTS[source.attachmentIds[0]!].name}`;
    this.take.disabled = !this.connected || this.pending || !player.connected || !available;
  }
  private async run(action: 'take' | 'clear') {
    if (!this.connected || this.pending || this.disposed || (action === 'take' && !this.zone)) return;
    this.pending = true;
    this.feedback.textContent = '';
    this.render();
    try {
      const result = action === 'take' ? await this.room.request('takeAttachment', { sourceId: this.zone!.id }) :
        await this.room.request('clearAttachment', {});
      if (!this.disposed) this.feedback.textContent = result.message;
    } catch {
      if (!this.disposed) this.feedback.textContent = '操作失败，请检查连接后重试';
    } finally { this.pending = false; if (!this.disposed) this.render(); }
  }
  setZone(zone: Zone | undefined) { this.zone = zone; this.feedback.textContent = ''; this.render(); }
  setConnected(value: boolean) { this.connected = value; this.render(); }
  dispose() { this.disposed = true; this.controller.abort(); this.room.onStateChange.remove(this.renderState); this.setZone(undefined); }
}
