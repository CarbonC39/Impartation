type QueueStatus = { ticket: string; ahead: number; ready: boolean };
type EnqueueResult = QueueStatus | { skip: true };

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(response.status === 401 ? '登录已失效，请重新登录' :
    response.status === 410 ? '排队已过期，请重新进入' : `排队服务暂不可用（${response.status}）`);
  return await response.json() as T;
}

/** A queue ticket belongs to this browser flow; closing it releases the place immediately. */
export class SpaceQueueClient {
  private ticket?: string;
  private cancelled = false;
  private poll?: AbortController;
  private wake?: () => void;

  constructor(private readonly spaceId: string, private readonly update: (ahead: number) => void) {}

  async wait(): Promise<string | undefined> {
    const response = await fetch('/api/space-queue', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spaceId: this.spaceId }),
      signal: AbortSignal.timeout(12_000) });
    const entry = await responseJson<EnqueueResult>(response);
    if ('skip' in entry) return;
    this.ticket = entry.ticket;
    if (this.cancelled) { this.release(); throw new Error('排队已取消'); }
    let status = entry;
    while (!status.ready) {
      this.update(status.ahead);
      await new Promise<void>(resolve => {
        const timer = window.setTimeout(resolve, 1000);
        this.wake = () => { window.clearTimeout(timer); resolve(); };
      });
      this.wake = undefined;
      if (this.cancelled) throw new Error('排队已取消');
      this.poll = new AbortController();
      const result = await fetch(`/api/space-queue/${encodeURIComponent(this.spaceId)}/${this.ticket}`,
        { credentials: 'same-origin', signal: AbortSignal.any([this.poll.signal, AbortSignal.timeout(12_000)]) });
      status = await responseJson<QueueStatus>(result);
      this.poll = undefined;
    }
    if (this.cancelled) throw new Error('排队已取消');
    return this.ticket;
  }

  cancel() {
    this.cancelled = true;
    this.poll?.abort();
    this.wake?.();
    this.release();
  }

  private release() {
    if (!this.ticket) return;
    const ticket = this.ticket;
    this.ticket = undefined;
    void fetch(`/api/space-queue/${encodeURIComponent(this.spaceId)}/${ticket}`,
      { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(() => {});
  }
}
