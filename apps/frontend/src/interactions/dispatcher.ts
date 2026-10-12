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

  constructor(private registry: InteractionRegistry<InteractionHandler>) {}

  setZone(zone: Zone | undefined) {
    if (this.zone === zone) return;
    this.active?.setZone(undefined);
    this.zone = zone;
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
