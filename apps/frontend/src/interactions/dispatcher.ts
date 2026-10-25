import { InteractionRegistry, type Zone } from '@impartation/shared';

export type ZoneEntry = { id: string; label: string; icon: string; pressed?: boolean; disabled?: boolean };
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
  private active?: InteractionHandler;
  private zone?: Zone;
  private connected = true;
  private zoneSuspended = false;
  private entries = document.getElementById('zone-entries');
  private buttons = new Map<string, { button: HTMLButtonElement; handler: InteractionHandler }>();

  constructor(private registry: InteractionRegistry<InteractionHandler>) {
    for (const handler of new Set(registry.values())) handler.onZoneEntriesChanged?.(this.renderEntries);
    this.renderEntries();
  }
  private renderEntries = () => {
    if (!this.entries) return;
    const available = new Map<string, { entry: ZoneEntry; handler: InteractionHandler }>();
    for (const handler of new Set(this.registry.values()))
      for (const entry of handler.zoneEntries?.() ?? []) available.set(entry.id, { entry, handler });
    for (const [id, record] of this.buttons) {
      if (available.has(id)) continue;
      record.button.remove(); this.buttons.delete(id);
    }
    for (const [id, { entry, handler }] of available) {
      let record = this.buttons.get(id);
      if (!record) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'map-state-icon'; button.dataset.zoneEntry = id;
        button.addEventListener('click', () => {
          this.buttons.get(id)?.handler.activateZoneEntry?.(id);
          this.renderEntries(); button.blur();
        });
        record = { button, handler }; this.buttons.set(id, record); this.entries.append(button);
      }
      record.handler = handler;
      const button = record.button;
      button.textContent = entry.icon; button.title = entry.label; button.setAttribute('aria-label', entry.label);
      button.setAttribute('aria-pressed', String(entry.pressed ?? false)); button.disabled = entry.disabled ?? false;
    }
  };

  setZone(zone: Zone | undefined) {
    if (this.zone === zone) return;
    this.zone = zone;
    if (!this.zoneSuspended) this.presentZone(zone);
    this.renderEntries();
  }
  /** A claimed point interaction temporarily owns presentation; retain the current area. */
  setZoneSuspended(value: boolean) {
    if (this.zoneSuspended === value) return;
    this.zoneSuspended = value;
    this.presentZone(value ? undefined : this.zone);
    this.renderEntries();
  }
  private presentZone(zone: Zone | undefined) {
    this.active?.setZone(undefined);
    this.active = zone && this.registry.get(zone.kind);
    this.active?.setConnected(this.connected);
    this.active?.setZone(zone);
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
    this.active = undefined;
    this.zone = undefined;
  }
}
