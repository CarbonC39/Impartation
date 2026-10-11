import type { Room } from '@colyseus/sdk';
import type { SpaceProtocol, Zone } from '@virtual-workspace/shared';
import type { InteractionHandler } from '../dispatcher';

/** A Portal sends only the zone ID; destination and position come from the server. */
export class PortalInteraction implements InteractionHandler {
  private current?: Zone;
  private connected = true;
  private attempted?: Zone;
  private disposed = false;
  constructor(private room: Room<SpaceProtocol>) {}
  setZone(zone: Zone | undefined) {
    if (this.current !== zone) this.attempted = undefined;
    this.current = zone;
    this.enter();
  }
  setConnected(value: boolean) { this.connected = value; this.enter(); }
  dispose() { this.disposed = true; this.current = undefined; }
  private enter() {
    const zone = this.current;
    if (!zone || !this.connected || this.disposed || this.attempted === zone) return;
    this.attempted = zone;
    void this.room.request('portal', { zoneId: zone.id }).then(result => {
      if (!result.ok && !this.disposed && this.current === zone) document.getElementById('feature-status')!.textContent = result.message;
    }).catch(() => {
      if (!this.disposed && this.current === zone) document.getElementById('feature-status')!.textContent = '地图切换失败，请重新进入传送区';
    });
  }
}
