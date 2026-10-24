import { occupancySchema, type Occupancy } from '@impartation/shared';

/** Poll occupancy only while the Space list can be seen. A generation guard keeps late responses from repainting stale UI. */
export class OccupancyPoller {
  private timer: number | undefined;
  private request: AbortController | undefined;
  private generation = 0;

  constructor(private readonly update: (occupancy: Occupancy | undefined) => void, private readonly active: () => boolean) {
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  start() {
    this.stopTimer();
    if (!this.active() || document.hidden) return;
    void this.refresh();
    this.timer = window.setInterval(() => { void this.refresh(); }, 5000);
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  stop() { this.stopTimer(); }

  private onVisibilityChange = () => {
    if (document.hidden || !this.active()) {
      this.stopTimer();
      return;
    }
    this.start();
  };

  private stopTimer() {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    this.generation++;
    this.request?.abort();
    this.request = undefined;
  }

  private async refresh() {
    if (!this.active() || document.hidden || this.request) return;
    const generation = this.generation;
    const request = new AbortController();
    this.request = request;
    try {
      const response = await fetch('/api/occupancy', { signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]) });
      if (!response.ok) throw new Error('occupancy unavailable');
      const data = occupancySchema.parse(await response.json());
      if (generation === this.generation && this.active() && !document.hidden) this.update(data);
    } catch {
      if (generation === this.generation && !request.signal.aborted) this.update(undefined);
    } finally {
      if (this.request === request) this.request = undefined;
    }
  }
}
