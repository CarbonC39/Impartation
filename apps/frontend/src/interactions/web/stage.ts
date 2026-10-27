import type { Room } from '@colyseus/sdk';
import { appearanceSchema, type SpaceProtocol } from '@impartation/shared';
import { drawAppearancePreview } from '../../appearancePreview';
import { avatarDefinition } from '../../characters';
import { readJsonPreference, readPreference, writePreference } from '../../preferences';
import { element } from '../panel';

const LAYOUT_KEY = 'virtual-workspace-tool-desk';
const VISIBLE_KEY = 'virtual-workspace-tool-desk-visible';
const EDGE = 8;
const MIN_WIDTH = 160;
const MAX_WIDTH = 800;
const SEATS = 4;
// Everyone at the desk uses the front-facing seated pose.
const SEATED_FRAME = avatarDefinition('mint').actions.sit.down;
// Character width as a share of the desk: large when alone, shrinking so a row of overlapping
// characters (each covering 0.82 of its width, plus 0.18 at the ends) fills at most 0.95 of the desk.
const seatScale = (seats: number) => Math.min(0.62, 0.95 / (0.82 * seats + 0.18));

type Layout = { left?: number; top?: number; width?: number };
type Rect = { left: number; top: number; width: number; height: number };

/**
 * Keys typed after clicking into an embedded page stay with that page. Grabbing the tool's own frame
 * hands the keyboard back to the map; the pointerdown handlers cancel the browser's own focus change.
 */
export function releaseToolFocus() {
  if (document.activeElement instanceof HTMLIFrameElement) document.activeElement.blur();
}

/**
 * A fixed-length desk above an open embedded tool, seating up to four people who have the same tool open,
 * in the order they opened it (the server's `webToolAt`), so everyone sees the same row: first in the
 * middle, then right, left, far right. Characters shrink as the row fills; a newcomer slides in from its
 * side while the others make room. Seated characters show typing dots while composing chat and bounce
 * while speaking. The desk can be hidden from the tool's title bar; it starts in the bottom-right corner,
 * dragging the body moves it and the top-left grip scales it around the bottom-right corner. Visibility
 * and layout are stored per browser.
 */
export class ToolStage {
  private root = element('tool-stage');
  private seats = element('tool-stage-seats');
  private toggle = element<HTMLButtonElement>('tool-stage-toggle');
  private layout: Layout = {};
  private visible = readPreference(VISIBLE_KEY) !== 'false';
  private open = false;
  private shown = '';
  private zoneId = '';
  private seated = new Map<string, HTMLElement>();
  private status?: number;
  private readonly refresh = () => this.render();

  constructor(private room: Room<SpaceProtocol>, private speaking: (sessionId: string) => boolean = () => false) {
    const saved = readJsonPreference(LAYOUT_KEY);
    if (saved && typeof saved === 'object') {
      for (const key of ['left', 'top', 'width'] as const) {
        const value = (saved as Record<string, unknown>)[key];
        if (typeof value === 'number' && Number.isFinite(value)) this.layout[key] = value;
      }
    }
    const grip = this.root.querySelector<HTMLElement>('.tool-stage-grip');
    if (!grip) throw new Error('Missing tool stage grip');
    this.track(this.root, (start, dx, dy) => {
      this.layout.left = start.left + dx;
      this.layout.top = start.top + dy;
    }, event => event.target !== grip);
    this.track(grip, (start, dx, dy) => {
      // Keep the bottom-right corner in place; the larger drag axis wins.
      const scaledY = dy * start.width / start.height;
      const width = clampWidth(start.width - (Math.abs(dx) > Math.abs(scaledY) ? dx : scaledY));
      this.layout.width = width;
      this.layout.left = start.left + start.width - width;
      this.layout.top = start.top + start.height - width * start.height / start.width;
    });
    this.toggle.addEventListener('click', () => {
      this.visible = !this.visible;
      writePreference(VISIBLE_KEY, String(this.visible));
      releaseToolFocus();
      this.toggle.blur(); // Return keyboard movement to the map.
      this.sync();
    });
    window.addEventListener('resize', () => { if (!this.root.hidden) this.apply(); });
    this.sync();
  }

  show(zoneId: string) {
    this.zoneId = zoneId;
    this.open = true;
    this.shown = '';
    this.send(true);
    this.room.onStateChange(this.refresh);
    this.status = window.setInterval(() => this.animate(), 100);
    this.render(true);
    this.sync();
  }

  hide() {
    if (this.open) this.send(false);
    this.open = false;
    this.room.onStateChange.remove(this.refresh);
    window.clearInterval(this.status);
    this.seats.replaceChildren();
    this.seated.clear();
    this.sync();
  }

  private sync() {
    this.root.hidden = !(this.open && this.visible);
    this.toggle.textContent = this.visible ? '隐藏小人' : '显示小人';
    this.toggle.setAttribute('aria-pressed', String(this.visible));
    if (!this.root.hidden) this.apply();
  }

  /** Typing and speaking change without a seat change, so they are polled while the tool is open. */
  private animate() {
    const players = this.room.state.players;
    for (const [id, seat] of this.seated) {
      const player = players?.get(id);
      const speaking = Boolean(player?.connected) && this.speaking(id);
      seat.classList.toggle('speaking', speaking);
      seat.classList.toggle('typing', Boolean(player?.connected && player.typing) && !speaking);
    }
  }

  /** Re-lays the row only when the seated people or their outfits change, not on every movement tick. */
  private render(initial = false) {
    const players = this.room.state.players;
    const own = players?.get(this.room.sessionId);
    if (!own) return;
    // The own character is seated even before the server confirms its opening time.
    const openedAt = (id: string) => players.get(id)?.webToolAt || (id === this.room.sessionId ? Number.MAX_SAFE_INTEGER : 0);
    const present: string[] = [this.room.sessionId];
    players.forEach((player, id) => {
      if (id !== this.room.sessionId && player.connected && player.mapId === own.mapId && this.zoneId
        && player.webToolZone === this.zoneId) present.push(id);
    });
    present.sort((a, b) => openedAt(a) - openedAt(b) || a.localeCompare(b));
    const arrival = present.slice(0, SEATS);
    if (!arrival.includes(this.room.sessionId)) arrival[SEATS - 1] = this.room.sessionId;
    const row: string[] = [];
    arrival.forEach((id, index) => { if (index % 2) row.push(id); else row.unshift(id); });
    const key = row.map(id => `${id}:${players.get(id)?.appearance}`).join('|');
    if (key === this.shown) return;
    this.shown = key;
    for (const [id, seat] of this.seated) if (!row.includes(id)) { seat.remove(); this.seated.delete(id); }
    // Seats stay in the DOM and are placed with `order`, so their size transitions keep running.
    row.forEach((id, position) => {
      let seat = this.seated.get(id);
      if (!seat) {
        seat = document.createElement('span');
        seat.className = 'tool-stage-seat';
        seat.dataset.session = id;
        if (!initial) {
          // Left-hand seats (the third arrival) slide in from the left, the others from the right.
          seat.classList.add('entering');
          seat.style.setProperty('--enter-from', arrival.indexOf(id) === 2 ? '-1' : '1');
          seat.addEventListener('animationend', () => seat!.classList.remove('entering'), { once: true });
        }
        const canvas = document.createElement('canvas');
        canvas.width = 16; canvas.height = 24;
        seat.append(canvas);
        this.seats.append(seat);
        this.seated.set(id, seat);
      }
      seat.style.order = String(position);
      // Earlier arrivals sit nearer the middle and draw in front, so neighbours tuck slightly behind.
      seat.style.zIndex = String(SEATS - arrival.indexOf(id));
      const outfit = players.get(id)?.appearance ?? '{}';
      if (seat.dataset.outfit === outfit) return;
      seat.dataset.outfit = outfit;
      const canvas = seat.querySelector('canvas')!;
      try {
        void drawAppearancePreview(canvas, appearanceSchema.parse(JSON.parse(outfit)), SEATED_FRAME).catch(() => { canvas.hidden = true; });
      } catch { canvas.hidden = true; }
    });
    this.root.style.setProperty('--seat-scale', String(seatScale(row.length)));
    if (!this.root.hidden) this.apply();
  }

  private send(open: boolean) {
    if (this.room.connection.isOpen) this.room.send('webTool', { open, zoneId: this.zoneId });
  }

  private track(target: HTMLElement, update: (start: Rect, dx: number, dy: number) => void,
    accept: (event: PointerEvent) => boolean = () => true) {
    let drag: { id: number; x: number; y: number; start: Rect } | undefined;
    target.addEventListener('pointerdown', event => {
      if (drag || event.button !== 0 || !accept(event)) return;
      event.preventDefault();
      event.stopPropagation();
      releaseToolFocus();
      const rect = this.root.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
      try { target.setPointerCapture(event.pointerId); } catch { /* Pointer already released. */ }
      this.root.classList.add('adjusting');
      document.body.classList.add('tool-adjusting');
    });
    target.addEventListener('pointermove', event => {
      if (drag?.id !== event.pointerId) return;
      update(drag.start, event.clientX - drag.x, event.clientY - drag.y);
      this.apply();
    });
    const end = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) return;
      drag = undefined;
      this.root.classList.remove('adjusting');
      document.body.classList.remove('tool-adjusting');
      writePreference(LAYOUT_KEY, JSON.stringify(this.layout));
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('lostpointercapture', end);
  }

  /** Until first dragged the stage keeps its CSS bottom-right anchor; afterwards it stays on screen. */
  private apply() {
    const style = this.root.style;
    if (this.layout.width !== undefined) {
      this.layout.width = Math.round(clampWidth(this.layout.width));
      style.setProperty('--stage-width', `${this.layout.width}px`);
    }
    if (this.layout.left === undefined || this.layout.top === undefined) return;
    const rect = this.root.getBoundingClientRect();
    this.layout.left = Math.round(Math.min(Math.max(EDGE, this.layout.left), Math.max(EDGE, window.innerWidth - rect.width - EDGE)));
    this.layout.top = Math.round(Math.min(Math.max(EDGE, this.layout.top), Math.max(EDGE, window.innerHeight - rect.height - EDGE)));
    Object.assign(style, { left: `${this.layout.left}px`, top: `${this.layout.top}px`, right: 'auto', bottom: 'auto' });
  }
}

function clampWidth(width: number) { return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)); }
