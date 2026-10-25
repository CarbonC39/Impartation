import type { Zone } from '@impartation/shared';
import type { InteractionHandler } from '../dispatcher';
import { element } from '../panel';

/** The scene entrance opens the existing editor and profile save flow. */
export class WardrobeInteraction implements InteractionHandler {
  private panel = element('wardrobe-panel');
  private button = element<HTMLButtonElement>('wardrobe-open');
  private current?: Zone;
  private connected = true;
  private openPanel = false;
  private controller = new AbortController();
  constructor(open: () => void) {
    this.button.addEventListener('click', () => { if (this.connected && this.current) open(); }, { signal: this.controller.signal });
  }
  setZone(zone: Zone | undefined) { this.current = zone; if (!zone) this.openPanel = false; this.panel.hidden = !zone || !this.openPanel; }
  zoneEntries() { return this.current ? [{ id: 'wardrobe', label: '更衣处', icon: '♙', pressed: this.openPanel, disabled: !this.connected }] : []; }
  activateZoneEntry(id: string) {
    if (id !== 'wardrobe' || !this.current || !this.connected) return;
    this.openPanel = !this.openPanel;
    this.panel.hidden = !this.openPanel;
  }
  setConnected(value: boolean) { this.connected = value; this.button.disabled = !value; }
  dispose() { this.controller.abort(); this.setZone(undefined); }
}
