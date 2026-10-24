import type { Room } from '@colyseus/sdk';
import type { SpaceProtocol, InteractionResult, Zone } from '@impartation/shared';
import type { InteractionHandler } from './dispatcher';

export function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}

export abstract class PanelInteraction implements InteractionHandler {
  protected current?: Zone;
  protected connected = true;
  protected pending = false;
  protected disposed = false;
  protected controller = new AbortController();
  protected feedback = element('feature-status');
  private renderState = () => this.render();

  constructor(protected room: Room<SpaceProtocol>, private panel: HTMLElement) {
    room.onStateChange(this.renderState);
  }
  setZone(zone: Zone | undefined) {
    this.current = zone;
    this.panel.hidden = !zone;
    this.feedback.textContent = '';
    this.render();
  }
  setConnected(value: boolean) { this.connected = value; this.render(); }
  dispose() {
    this.disposed = true;
    this.controller.abort();
    this.room.onStateChange.remove(this.renderState);
    this.setZone(undefined);
  }
  protected abstract render(): void;
  protected async run(request: () => Promise<InteractionResult>, success?: () => void) {
    if (!this.connected || this.pending || this.disposed || !this.current) return;
    const zone = this.current;
    this.pending = true;
    this.render();
    try {
      const result = await request();
      if (this.disposed || this.current !== zone) return;
      this.feedback.textContent = result.message;
      if (result.ok) success?.();
    } catch {
      if (!this.disposed && this.current === zone) this.feedback.textContent = '操作失败，请检查连接后重试';
    } finally { this.pending = false; if (!this.disposed) this.render(); }
  }
}
