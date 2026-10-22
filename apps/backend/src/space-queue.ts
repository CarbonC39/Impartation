import { randomUUID } from 'node:crypto';

const WAITING_TTL_MS = 30_000;
const READY_TTL_MS = 20_000;
const MAX_WAITERS = 1_000;

type Entry = { ticket: string; userId: string; sessionId: string; touchedAt: number; readyUntil: number };
export type QueueStatus = { ticket: string; ahead: number; ready: boolean };

/** One process owns each Space. A ready ticket holds the next opening until it joins or expires. */
export class SpaceQueue {
  private entries = new Map<string, Entry[]>();

  private prune(spaceId: string, now = Date.now()) {
    const entries = this.entries.get(spaceId) ?? [];
    const live = entries.filter(entry => entry.readyUntil ? entry.readyUntil > now : entry.touchedAt + WAITING_TTL_MS > now);
    if (live.length) this.entries.set(spaceId, live);
    else this.entries.delete(spaceId);
    return live;
  }

  private advance(spaceId: string, available: boolean, now = Date.now()) {
    const entries = this.prune(spaceId, now);
    if (available && entries.length && !entries.some(entry => entry.readyUntil)) entries[0]!.readyUntil = now + READY_TTL_MS;
    return entries;
  }

  enqueue(spaceId: string, userId: string, sessionId: string, available: boolean): QueueStatus {
    const now = Date.now();
    let entries = this.prune(spaceId, now);
    // A later tab of the same account replaces its old queue screen.
    entries = entries.filter(entry => entry.userId !== userId);
    if (entries.length >= MAX_WAITERS) throw new Error('Queue is full');
    const entry: Entry = { ticket: randomUUID(), userId, sessionId, touchedAt: now, readyUntil: 0 };
    entries.push(entry);
    this.entries.set(spaceId, entries);
    this.advance(spaceId, available, now);
    return this.describe(entries, entry);
  }

  status(spaceId: string, ticket: string, userId: string, sessionId: string, available: boolean): QueueStatus | undefined {
    const now = Date.now();
    const entries = this.advance(spaceId, available, now);
    const entry = entries.find(value => value.ticket === ticket && value.userId === userId && value.sessionId === sessionId);
    if (!entry) return;
    if (!entry.readyUntil) entry.touchedAt = now;
    return this.describe(entries, entry);
  }

  cancel(spaceId: string, ticket: string, userId: string, sessionId: string, available: boolean) {
    const entries = this.prune(spaceId);
    const index = entries.findIndex(value => value.ticket === ticket && value.userId === userId && value.sessionId === sessionId);
    if (index < 0) return false;
    entries.splice(index, 1);
    this.advance(spaceId, available);
    return true;
  }

  /** Existing clients may replace their own seat; new clients must use the head's ready ticket. */
  mayJoin(spaceId: string, ticket: string | undefined, userId: string, sessionId: string, ownsSeat: boolean, available: boolean) {
    if (ownsSeat) return true;
    const entries = this.advance(spaceId, available);
    if (!entries.length) return true;
    return entries.some(entry => entry.ticket === ticket && entry.userId === userId && entry.sessionId === sessionId && entry.readyUntil > Date.now());
  }

  joined(spaceId: string, ticket: string | undefined, userId: string, available: boolean) {
    if (!ticket) return;
    const entries = this.prune(spaceId);
    const index = entries.findIndex(entry => entry.ticket === ticket && entry.userId === userId);
    if (index >= 0) entries.splice(index, 1);
    this.advance(spaceId, available);
  }

  seatChanged(spaceId: string, available: boolean) { this.advance(spaceId, available); }

  hasEntries(spaceId: string) { return this.prune(spaceId).length > 0; }

  private describe(entries: Entry[], entry: Entry): QueueStatus {
    return { ticket: entry.ticket, ahead: entries.indexOf(entry), ready: entry.readyUntil > 0 };
  }
}

export const spaceQueue = new SpaceQueue();
