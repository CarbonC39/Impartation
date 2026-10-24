import type { MovementInput } from '@impartation/shared';
import { FloatingPosition } from './floatingPosition';
import { readPreference, writePreference } from './preferences';

const POSITION_KEY = 'virtual-workspace-touch-pad';
const SCALE_KEY = 'virtual-workspace-touch-pad-scale';
const DEAD_ZONE = 10;
const DRAG_THRESHOLD = 6;
const DOUBLE_TAP_MS = 400;
const LONG_PRESS_MS = 500;
const HINT_MS = 2600;
export const PAD_SCALE_MIN = 0.7;
export const PAD_SCALE_MAX = 1.6;

type Grip = { pointerId: number; x: number; y: number; dragging: boolean; longPress?: number };

/**
 * On-screen direction pad. One pointer drives the whole pad, so sliding a finger between keys
 * (including diagonals) changes direction without lifting. The centre tile is a grip: drag it to
 * move the pad, tap or hold it for a hint, double-tap it to open the layout editor.
 * In layout editing the whole pad is a drag handle and never steers.
 */
export class TouchPad {
  readonly position: FloatingPosition;
  /** Called on a double tap of the grip. */
  onEditRequest?: () => void;
  private input: MovementInput = { x: 0, y: 0 };
  private steering?: number;
  private grip?: Grip;
  private lastTap = 0;
  private hintTimer?: number;
  private editing = false;

  constructor(private root: HTMLElement, private gripElement: HTMLElement, private hint: HTMLElement) {
    this.position = new FloatingPosition(root, POSITION_KEY);
    root.addEventListener('pointerdown', event => this.down(event));
    root.addEventListener('pointermove', event => this.move(event));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      root.addEventListener(type, event => this.up(event, type === 'pointerup'));
    }
    // Long-press menus, text selection and double-tap zoom must never start from the pad.
    for (const type of ['contextmenu', 'selectstart', 'dblclick'] as const) {
      root.addEventListener(type, event => event.preventDefault());
    }
    root.addEventListener('touchstart', event => event.preventDefault(), { passive: false });
    this.applyScale();
  }

  read(): MovementInput { return this.input; }

  clear() {
    this.steering = undefined;
    this.setInput({ x: 0, y: 0 });
  }

  get scale(): number {
    const value = Number(readPreference(SCALE_KEY));
    return Number.isFinite(value) && value >= PAD_SCALE_MIN && value <= PAD_SCALE_MAX ? value : 1;
  }

  setScale(value: number) {
    writePreference(SCALE_KEY, String(Math.min(PAD_SCALE_MAX, Math.max(PAD_SCALE_MIN, value))));
    this.applyScale();
  }

  setEditing(editing: boolean) {
    this.editing = editing;
    this.clear();
    this.hideHint();
  }

  /** Resets size and position to the layout defaults. */
  reset() {
    writePreference(SCALE_KEY, '');
    this.position.reset();
    this.applyScale();
  }

  /** Re-applies the stored size and position once the pad is visible (it is display:none until the map opens). */
  refresh() { this.applyScale(); }

  private applyScale() {
    this.root.style.setProperty('--pad-scale', String(this.scale));
    this.position.apply();
  }

  private down(event: PointerEvent) {
    event.preventDefault();
    if (this.editing) { this.position.begin(event); return; }
    if (this.steering !== undefined || this.grip) return;
    try { this.root.setPointerCapture(event.pointerId); } catch { /* Pointer already released. */ }
    if (this.gripElement.contains(event.target as Node)) {
      const grip: Grip = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
      grip.longPress = window.setTimeout(() => { if (this.grip === grip && !grip.dragging) this.showHint(); }, LONG_PRESS_MS);
      this.grip = grip;
      return;
    }
    this.steering = event.pointerId;
    this.steer(event);
  }

  private move(event: PointerEvent) {
    if (this.position.move(event)) return;
    const grip = this.grip;
    if (grip?.pointerId === event.pointerId && !grip.dragging &&
      Math.hypot(event.clientX - grip.x, event.clientY - grip.y) > DRAG_THRESHOLD) {
      grip.dragging = true;
      window.clearTimeout(grip.longPress);
      this.hideHint();
      this.position.begin(event, grip);
      this.position.move(event);
    } else if (this.steering === event.pointerId) this.steer(event);
  }

  private up(event: PointerEvent, released: boolean) {
    if (this.position.end(event)) {
      if (this.grip?.pointerId === event.pointerId) this.grip = undefined;
      return;
    }
    const grip = this.grip;
    if (grip?.pointerId === event.pointerId) {
      this.grip = undefined;
      window.clearTimeout(grip.longPress);
      if (released && !grip.dragging) this.tap();
    } else if (this.steering === event.pointerId) this.clear();
  }

  private tap() {
    const now = performance.now();
    if (now - this.lastTap < DOUBLE_TAP_MS) {
      this.lastTap = 0;
      this.hideHint();
      this.onEditRequest?.();
      return;
    }
    this.lastTap = now;
    this.showHint();
  }

  /** Shows the grip hint in the free space beside the pad. */
  private showHint() {
    const rect = this.root.getBoundingClientRect();
    this.hint.textContent = '拖动可移动方向键 · 双击调整大小和布局';
    this.hint.hidden = false;
    const hint = this.hint.getBoundingClientRect();
    const roomRight = window.innerWidth - rect.right;
    const left = roomRight >= hint.width + 16 ? rect.right + 8 : Math.max(8, rect.left - hint.width - 8);
    const top = Math.min(Math.max(8, rect.top + rect.height / 2 - hint.height / 2), window.innerHeight - hint.height - 8);
    Object.assign(this.hint.style, { left: `${left}px`, top: `${top}px` });
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hideHint(), HINT_MS);
  }

  private hideHint() {
    window.clearTimeout(this.hintTimer);
    this.hint.hidden = true;
  }

  /** Eight 45° sectors around the grip centre; a small dead zone keeps the grip itself neutral. */
  private steer(event: PointerEvent) {
    const rect = this.gripElement.getBoundingClientRect();
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
}
