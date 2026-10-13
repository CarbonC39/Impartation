import type { Room } from '@colyseus/sdk';
import { standsOnSeat, type RegisteredMap, type Seat, type SpaceProtocol } from '@virtual-workspace/shared';
import { element } from './panel';

/** Handles seat activation separately from rectangular interaction zones. */
export class SeatInteractions {
  private world?: RegisteredMap;
  private pending = false;
  private disposed = false;
  private readonly renderState = () => this.refresh();
  private readonly click = () => {
    this.button.blur(); // Return keyboard movement to the map after mouse/touch activation.
    void this.activate();
  };

  constructor(
    private readonly room: Room<SpaceProtocol>,
    private readonly button: HTMLButtonElement,
    private readonly feedback: HTMLElement,
  ) {
    this.room.onStateChange(this.renderState);
    this.button.addEventListener('click', this.click);
    this.refresh();
  }

  setWorld(world: RegisteredMap | undefined) {
    this.world = world;
    this.feedback.textContent = '';
    this.refresh();
  }

  refresh() {
    const player = this.room.state?.players.get(this.room.sessionId);
    const connected = Boolean(player?.connected && this.room.connection.isOpen);
    const seat = this.world && player?.mapId === this.world.id
      ? this.world.world.seats.find(item => standsOnSeat(item, player))
      : undefined;
    const object = seat && this.room.state?.worldObjects.get(this.world?.id ?? '')?.objects.get(seat.id);
    const occupiedByOther = Boolean(object?.occupiedBy && object.occupiedBy !== this.room.sessionId);
    const canActivate = Boolean(seat && connected && player?.action !== 'sit' && !occupiedByOther);

    this.button.disabled = this.disposed || this.pending || !canActivate;
    this.button.textContent = player?.action === 'sit' ? '已坐下' : '坐下';
    this.button.setAttribute('aria-label', '坐到当前座位');
  }

  async activate() {
    if (this.disposed || this.pending) return;
    const player = this.room.state?.players.get(this.room.sessionId);
    const seat: Seat | undefined = this.world && player?.mapId === this.world.id
      ? this.world.world.seats.find(item => standsOnSeat(item, player))
      : undefined;
    const object = seat && this.world
      ? this.room.state?.worldObjects.get(this.world.id)?.objects.get(seat.id)
      : undefined;
    if (!seat || !player?.connected || !this.room.connection.isOpen || player.action === 'sit' ||
      (object?.occupiedBy && object.occupiedBy !== this.room.sessionId)) return;

    this.pending = true;
    this.feedback.textContent = '';
    this.refresh();
    try {
      const result = await this.room.request('activate', { objectId: seat.id });
      if (!this.disposed) this.feedback.textContent = result.message;
    } catch {
      if (!this.disposed) this.feedback.textContent = '座位操作失败，请检查连接后重试';
    } finally {
      this.pending = false;
      if (!this.disposed) this.refresh();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.room.onStateChange.remove(this.renderState);
    this.button.removeEventListener('click', this.click);
    this.button.disabled = true;
    this.button.textContent = '坐下';
  }
}

export function createSeatInteractions(room: Room<SpaceProtocol>) {
  return new SeatInteractions(
    room,
    element<HTMLButtonElement>('activate-object'),
    element('object-feedback'),
  );
}
