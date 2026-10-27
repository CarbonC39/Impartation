import { InteractionRegistry, type Zone } from '@impartation/shared';

export type ZoneEntry = { id: string; label: string; icon: string; panelId?: string; pressed?: boolean; disabled?: boolean };
export interface InteractionHandler {
  setZone(zone: Zone | undefined): void;
  setConnected(value: boolean): void;
  dispose(): void;
  zoneEntries?(): ZoneEntry[];
  activateZoneEntry?(id: string): void;
  onZoneEntriesChanged?(listener: () => void): void;
}

/** Routes lifecycle events; the dispatcher has no interaction-specific branches. */
export class InteractionDispatcher implements InteractionHandler {
  private zones: Zone[] = [];
  private selected = new Map<InteractionHandler, Zone>();
  private connected = true;
  private buttons = new Map<string, { button: HTMLButtonElement; activate(): void }>();

  constructor(private registry: InteractionRegistry<InteractionHandler>, private entries?: HTMLElement) {
    for (const handler of new Set(registry.values())) handler.onZoneEntriesChanged?.(this.renderEntries);
    this.renderEntries();
  }
  private renderEntries = () => {
    if (!this.entries) return;
    const available = new Map<string, { entry: ZoneEntry; activate(): void }>();
    for (const handler of new Set(this.registry.values())) {
      const zones = this.zones.filter(zone => this.registry.get(zone.kind) === handler);
      for (const entry of handler.zoneEntries?.() ?? []) {
        if (zones.length <= 1) {
          available.set(entry.id, { entry, activate: () => handler.activateZoneEntry?.(entry.id) });
          continue;
        }
        // A handler owns one panel; each overlapping source gets an entry selecting its context.
        for (const zone of zones) {
          const id = JSON.stringify([entry.id, zone.id]);
          available.set(id, { entry: { ...entry, id, label: `${entry.label} · ${zone.id}`,
            pressed: this.selected.get(handler) === zone && entry.pressed }, activate: () => {
            if (this.selected.get(handler) !== zone) {
              handler.setZone(undefined);
              this.selected.set(handler, zone);
              handler.setZone(zone);
            }
            handler.activateZoneEntry?.(entry.id);
          } });
        }
      }
    }
    for (const [id, record] of this.buttons) {
      if (available.has(id)) continue;
      record.button.remove(); this.buttons.delete(id);
    }
    for (const [id, { entry, activate }] of available) {
      let record = this.buttons.get(id);
      if (!record) {
        const button = this.entries.ownerDocument.createElement('button');
        button.type = 'button'; button.className = 'map-state-icon'; button.dataset.zoneEntry = id;
        button.addEventListener('click', () => {
          this.buttons.get(id)?.activate();
          this.renderEntries(); button.blur();
        });
        record = { button, activate }; this.buttons.set(id, record); this.entries.append(button);
      }
      record.activate = activate;
      const button = record.button;
      button.textContent = entry.icon; button.title = entry.label; button.setAttribute('aria-label', entry.label);
      if (entry.panelId) {
        button.setAttribute('aria-controls', entry.panelId);
        button.setAttribute('aria-expanded', String(entry.pressed ?? false));
      } else {
        button.removeAttribute('aria-controls');
        button.removeAttribute('aria-expanded');
      }
      button.setAttribute('aria-pressed', String(entry.pressed ?? false)); button.disabled = entry.disabled ?? false;
    }
  };

  setZone(zone: Zone | undefined) { this.setZones(zone ? [zone] : []); }
  setZones(zones: Zone[]) {
    if (zones.length === this.zones.length && zones.every((zone, index) => zone === this.zones[index])) return;
    this.zones = zones;
    for (const handler of new Set(this.registry.values())) {
      const previous = this.selected.get(handler);
      const next = previous && zones.includes(previous) ? previous : zones.find(zone => this.registry.get(zone.kind) === handler);
      if (previous === next) continue;
      if (previous) handler.setZone(undefined);
      if (next) {
        this.selected.set(handler, next);
        handler.setConnected(this.connected);
        handler.setZone(next);
      } else this.selected.delete(handler);
    }
    this.renderEntries();
  }
  setConnected(value: boolean) {
    this.connected = value;
    for (const handler of new Set(this.registry.values())) handler.setConnected(value);
    this.renderEntries();
  }
  dispose() {
    for (const handler of new Set(this.registry.values())) handler.onZoneEntriesChanged?.(() => {});
    for (const record of this.buttons.values()) record.button.remove();
    this.buttons.clear();
    for (const handler of new Set(this.registry.values())) handler.dispose();
    this.selected.clear();
    this.zones = [];
  }
}
