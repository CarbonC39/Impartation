import type { MovementInput } from '@virtual-workspace/shared';
import { readJsonPreference, writePreference } from './preferences';

const POSITION_KEY = 'virtual-workspace-touch-pad';
const EDGE = 8;
const DEAD_ZONE = 10;

type Position = { x: number; y: number };

/**
 * On-screen direction pad. One pointer drives the whole pad, so sliding a finger between keys
 * (including diagonals) changes direction without lifting. The centre tile is a grip that moves
 * the pad; its position is stored as a viewport fraction so it survives rotation.
 */
export class TouchPad {
  private input: MovementInput = { x: 0, y: 0 };
  private steering?: number;
  private dragging?: { pointerId: number; offsetX: number; offsetY: number };

  constructor(private root: HTMLElement, private grip: HTMLElement) {
    root.addEventListener('pointerdown', event => this.down(event));
    root.addEventListener('pointermove', event => this.move(event));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      root.addEventListener(type, event => this.up(event));
    }
    // Long-press menus, text selection and double-tap zoom must never start from the pad.
    for (const type of ['contextmenu', 'selectstart', 'dblclick'] as const) {
      root.addEventListener(type, event => event.preventDefault());
    }
    root.addEventListener('touchstart', event => event.preventDefault(), { passive: false });
    window.addEventListener('resize', () => this.applyPosition());
    this.applyPosition();
  }

  read(): MovementInput { return this.input; }

  clear() {
    this.steering = undefined;
    this.setInput({ x: 0, y: 0 });
  }

  resetPosition() {
    writePreference(POSITION_KEY, '');
    this.root.style.removeProperty('left');
    this.root.style.removeProperty('top');
    this.root.style.removeProperty('right');
    this.root.style.removeProperty('bottom');
  }

  private down(event: PointerEvent) {
    event.preventDefault();
    if (this.steering !== undefined || this.dragging) return;
    try { this.root.setPointerCapture(event.pointerId); } catch { /* Pointer already released. */ }
    if (this.grip.contains(event.target as Node)) {
      const rect = this.root.getBoundingClientRect();
      this.dragging = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      this.root.classList.add('dragging');
      return;
    }
    this.steering = event.pointerId;
    this.steer(event);
  }

  private move(event: PointerEvent) {
    if (this.dragging?.pointerId === event.pointerId) {
      this.place(event.clientX - this.dragging.offsetX, event.clientY - this.dragging.offsetY);
    } else if (this.steering === event.pointerId) this.steer(event);
  }

  private up(event: PointerEvent) {
    if (this.dragging?.pointerId === event.pointerId) {
      this.dragging = undefined;
      this.root.classList.remove('dragging');
      const rect = this.root.getBoundingClientRect();
      writePreference(POSITION_KEY, JSON.stringify({
        x: (rect.left + rect.width / 2) / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight,
      }));
    } else if (this.steering === event.pointerId) this.clear();
  }

  /** Eight 45° sectors around the grip centre; a small dead zone keeps the grip itself neutral. */
  private steer(event: PointerEvent) {
    const rect = this.grip.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < DEAD_ZONE) { this.setInput({ x: 0, y: 0 }); return; }
    const diagonal = Math.tan(Math.PI / 8);
    this.setInput({ x: ax >= ay * diagonal ? Math.sign(dx) : 0, y: ay >= ax * diagonal ? Math.sign(dy) : 0 });
  }

  private setInput(input: MovementInput) {
    this.input = input;
    for (const key of this.root.querySelectorAll<HTMLElement>('[data-move]')) {
      const move = key.dataset.move;
      const pressed = (move === 'left' && input.x < 0) || (move === 'right' && input.x > 0) ||
        (move === 'up' && input.y < 0) || (move === 'down' && input.y > 0);
      key.classList.toggle('pressed', pressed);
    }
  }

  private place(left: number, top: number) {
    const rect = this.root.getBoundingClientRect();
    const x = Math.min(Math.max(EDGE, left), Math.max(EDGE, window.innerWidth - rect.width - EDGE));
    const y = Math.min(Math.max(EDGE, top), Math.max(EDGE, window.innerHeight - rect.height - EDGE));
    Object.assign(this.root.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
  }

  private applyPosition() {
    const saved = readJsonPreference(POSITION_KEY) as Partial<Position> | undefined;
    if (typeof saved?.x !== 'number' || typeof saved.y !== 'number') return;
    const rect = this.root.getBoundingClientRect();
    if (!rect.width) return; // Hidden on desktop; nothing to place.
    this.place(saved.x * window.innerWidth - rect.width / 2, saved.y * window.innerHeight - rect.height / 2);
  }

  /** Re-apply the stored position once the pad becomes visible (it is display:none until the map opens). */
  refresh() { this.applyPosition(); }
}
