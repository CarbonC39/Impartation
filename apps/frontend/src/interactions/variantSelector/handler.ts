import type { Room } from '@colyseus/sdk';
import type { SpaceProtocol, WorldMap, Zone } from '@virtual-workspace/shared';
import type { InteractionHandler } from '../dispatcher';
import { element } from '../panel';

// Display names for Tiled variant IDs; unknown IDs fall back to the raw name.
const variantLabels: Record<string, string> = { computer: '电脑', book: '书本', 'drawing-board': '画板' };

/** Claims come from the server action state; being near the anchor never opens choices. */
export class VariantSelectorInteraction implements InteractionHandler {
  private panel = element('variant-selector-panel');
  private choices = element('variant-choices');
  private feedback = element('variant-status');
  private cancel = element<HTMLButtonElement>('variant-cancel');
  private connected = true;
  private pending = false;
  private disposed = false;
  private controller = new AbortController();
  private contextKey?: string;
  private renderState = () => this.render();
  constructor(private room: Room<SpaceProtocol>, private world: () => WorldMap | undefined, private onClaimChanged: (claimed: boolean) => void) {
    room.onStateChange(this.renderState);
    this.choices.addEventListener('click', event => {
      const variant = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-variant]')?.dataset.variant;
      if (variant) void this.run(variant);
    }, { signal: this.controller.signal });
    this.cancel.addEventListener('click', () => { void this.run(); }, { signal: this.controller.signal });
    this.render();
  }
  private selector() {
    const player = this.room.state.players.get(this.room.sessionId);
    return player && this.world()?.selectors.find(item => item.id === player.actionTargetId && item.action === player.action &&
      this.room.state.worldObjects.get(player.mapId)?.objects.get(item.id)?.occupiedBy === this.room.sessionId);
  }
  private render() {
    const selector = this.selector();
    this.panel.hidden = !selector;
    this.onClaimChanged(Boolean(selector));
    const player = this.room.state.players.get(this.room.sessionId);
    const contextKey = selector && player ? JSON.stringify([player.mapId, selector.id, selector.variants]) : undefined;
    if (this.contextKey !== contextKey) {
      this.contextKey = contextKey;
      this.feedback.textContent = '';
      this.choices.replaceChildren();
      for (const variant of selector?.variants ?? []) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'secondary'; button.dataset.variant = variant; button.textContent = variantLabels[variant] ?? variant;
        this.choices.append(button);
      }
    }
    if (!selector || !player) return;
    const selected = this.room.state.worldObjects.get(player.mapId)?.objects.get(selector.targetObjectId)?.variant;
    for (const button of this.choices.querySelectorAll<HTMLButtonElement>('button[data-variant]')) {
      button.setAttribute('aria-pressed', String(button.dataset.variant === selected));
      button.disabled = !this.connected || this.pending || !player.connected || selected === button.dataset.variant;
    }
    this.cancel.disabled = !this.connected || this.pending || !player.connected;
  }
  private async run(variant?: string) {
    const selector = this.selector();
    if (!selector || !this.connected || this.pending || this.disposed) return;
    const contextKey = this.contextKey;
    this.pending = true; this.feedback.textContent = ''; this.render();
    try {
      const result = variant === undefined ? await this.room.request('cancelAction', {}) :
        await this.room.request('selectVariant', { selectorId: selector.id, variant });
      if (!this.disposed && this.contextKey === contextKey) this.feedback.textContent = result.message;
    } catch { if (!this.disposed && this.contextKey === contextKey) this.feedback.textContent = '操作失败，请检查连接后重试'; }
    finally { this.pending = false; if (!this.disposed) this.render(); }
  }
  setZone(_zone: Zone | undefined) {}
  setConnected(value: boolean) { this.connected = value; this.render(); }
  dispose() { this.disposed = true; this.controller.abort(); this.room.onStateChange.remove(this.renderState); this.panel.hidden = true; }
}
