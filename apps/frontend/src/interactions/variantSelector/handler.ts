import type { Room } from '@colyseus/sdk';
import type { SpaceProtocol, WorldMap, Zone } from '@impartation/shared';
import type { InteractionHandler } from '../dispatcher';
import { element } from '../panel';

// Display names for Tiled variant IDs; unknown IDs fall back to the raw name.
const variantLabels: Record<string, string> = { computer: '电脑', book: '书本', 'drawing-board': '画板', empty: '空白' };

/** Claims come from the server action state; being near the anchor never opens choices. */
export class VariantSelectorInteraction implements InteractionHandler {
  private panel = element('variant-selector-panel');
  private choices = element('variant-choices');
  private feedback = element('variant-status');
  private clear = element<HTMLButtonElement>('variant-clear');
  private connected = true;
  private pending = false;
  private disposed = false;
  private controller = new AbortController();
  private contextKey?: string;
  private open = false;
  private entriesChanged = () => {};
  private renderState = () => this.render();
  constructor(private room: Room<SpaceProtocol>, private world: () => WorldMap | undefined) {
    room.onStateChange(this.renderState);
    this.choices.addEventListener('click', event => {
      const variant = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-variant]')?.dataset.variant;
      if (variant) void this.run(variant);
    }, { signal: this.controller.signal });
    this.clear.addEventListener('click', () => { void this.run(null); }, { signal: this.controller.signal });
    this.render();
  }
  private selector() {
    const player = this.room.state.players.get(this.room.sessionId);
    return player && this.world()?.selectors.find(item => item.id === player.actionTargetId && item.action === player.action &&
      this.room.state.worldObjects.get(player.mapId)?.objects.get(item.id)?.occupiedBy === this.room.sessionId);
  }
  private render() {
    const selector = this.selector();
    const player = this.room.state.players.get(this.room.sessionId);
    const contextKey = selector && player ? JSON.stringify([player.mapId, selector.id, selector.variants]) : undefined;
    if (this.contextKey !== contextKey) {
      this.contextKey = contextKey;
      this.open = false;
      this.feedback.textContent = '';
      this.choices.replaceChildren();
      for (const variant of selector?.variants ?? []) {
        const button = document.createElement('button');
        const label = variantLabels[variant] ?? variant;
        button.type = 'button'; button.className = 'secondary'; button.dataset.variant = variant;
        button.textContent = label;
        button.title = label; button.setAttribute('aria-label', label);
        this.choices.append(button);
      }
    }
    this.panel.hidden = !selector || !this.open;
    this.entriesChanged();
    if (!selector || !player) return;
    const target = this.room.state.worldObjects.get(player.mapId)?.objects.get(selector.targetObjectId);
    const selected = target?.variant;
    const cleared = target?.variantCleared ?? false;
    for (const button of this.choices.querySelectorAll<HTMLButtonElement>('button[data-variant]')) {
      button.setAttribute('aria-pressed', String(!cleared && button.dataset.variant === selected));
      button.disabled = !this.connected || this.pending || !player.connected || (!cleared && selected === button.dataset.variant);
    }
    this.clear.setAttribute('aria-pressed', String(cleared));
    this.clear.disabled = !this.connected || this.pending || !player.connected || cleared;
  }
  private async run(variant: string | null) {
    const selector = this.selector();
    if (!selector || !this.connected || this.pending || this.disposed) return;
    const contextKey = this.contextKey;
    this.pending = true; this.feedback.textContent = ''; this.render();
    try {
      const result = await this.room.request('selectVariant', { selectorId: selector.id, variant });
      if (!this.disposed && this.contextKey === contextKey) this.feedback.textContent = result.message;
    } catch { if (!this.disposed && this.contextKey === contextKey) this.feedback.textContent = '操作失败，请检查连接后重试'; }
    finally { this.pending = false; if (!this.disposed) this.render(); }
  }
  setZone(_zone: Zone | undefined) {}
  zoneEntries() {
    return !this.disposed && this.selector() ? [{ id: 'variant-selector', label: '图块选择', icon: '▧', panelId: 'variant-selector-panel', pressed: this.open, disabled: !this.connected }] : [];
  }
  activateZoneEntry(id: string) {
    if (id !== 'variant-selector' || !this.selector() || !this.connected) return;
    this.open = !this.open;
    this.render();
  }
  onZoneEntriesChanged(listener: () => void) { this.entriesChanged = listener; }
  setConnected(value: boolean) { this.connected = value; this.render(); }
  dispose() { this.disposed = true; this.entriesChanged = () => {}; this.controller.abort(); this.room.onStateChange.remove(this.renderState); this.panel.hidden = true; }
}
