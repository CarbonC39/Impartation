import { InteractionRegistry, type Zone } from '@virtual-workspace/shared';

export interface InteractionHandler {
  setZone(zone: Zone | undefined): void;
  setConnected(value: boolean): void;
  dispose(): void;
}

/** Routes lifecycle events; the dispatcher has no interaction-specific branches. */
export class InteractionDispatcher implements InteractionHandler {
  private active?: InteractionHandler;
  private zone?: Zone;
  private connected = true;
  private zoneSuspended = false;

  constructor(private registry: InteractionRegistry<InteractionHandler>) {}

  setZone(zone: Zone | undefined) {
    if (this.zone === zone) return;
    this.zone = zone;
    if (!this.zoneSuspended) this.presentZone(zone);
  }
  /** A claimed point interaction temporarily owns presentation; retain the current area. */
  setZoneSuspended(value: boolean) {
    if (this.zoneSuspended === value) return;
    this.zoneSuspended = value;
    this.presentZone(value ? undefined : this.zone);
  }
  private presentZone(zone: Zone | undefined) {
    this.active?.setZone(undefined);
    this.active = zone && this.registry.get(zone.kind);
    this.active?.setConnected(this.connected);
    this.active?.setZone(zone);
  }
  setConnected(value: boolean) {
    this.connected = value;
    for (const handler of new Set(this.registry.values())) handler.setConnected(value);
  }
  dispose() {
    for (const handler of new Set(this.registry.values())) handler.dispose();
    this.active = undefined;
    this.zone = undefined;
  }
}
