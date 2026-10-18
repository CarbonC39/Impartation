import { readJsonPreference, writePreference } from './preferences';

const EDGE = 8;

/**
 * A control the player can move. The position is stored as the centre's viewport fraction, so it
 * survives rotation and window resizes, and it is always clamped fully on screen.
 */
export class FloatingPosition {
  private drag?: { pointerId: number; offsetX: number; offsetY: number };

  constructor(readonly element: HTMLElement, private key: string) {
    window.addEventListener('resize', () => this.apply());
  }

  /**
   * Starts following a pointer; `false` when another drag is already running. `from` is where the
   * pointer went down, when the drag only starts after it has already moved past a threshold.
   */
  begin(event: PointerEvent, from: { x: number; y: number } = { x: event.clientX, y: event.clientY }): boolean {
    if (this.drag) return false;
    const rect = this.element.getBoundingClientRect();
    this.drag = { pointerId: event.pointerId, offsetX: from.x - rect.left, offsetY: from.y - rect.top };
    try { this.element.setPointerCapture(event.pointerId); } catch { /* Pointer already released. */ }
    this.element.classList.add('dragging');
    return true;
  }

  move(event: PointerEvent): boolean {
    if (this.drag?.pointerId !== event.pointerId) return false;
    this.place(event.clientX - this.drag.offsetX, event.clientY - this.drag.offsetY);
    return true;
  }

  end(event: PointerEvent): boolean {
    if (this.drag?.pointerId !== event.pointerId) return false;
    this.drag = undefined;
    this.element.classList.remove('dragging');
    this.save();
    return true;
  }

  /** Re-clamps after a size change, keeping the same centre where possible. */
  apply() {
    const saved = this.saved();
    if (!saved) return;
    const rect = this.element.getBoundingClientRect();
    if (!rect.width) return; // Hidden (e.g. desktop layout): nothing to place.
    this.place(saved.x * window.innerWidth - rect.width / 2, saved.y * window.innerHeight - rect.height / 2);
  }

  reset() {
    writePreference(this.key, '');
    for (const property of ['left', 'top', 'right', 'bottom', 'transform']) this.element.style.removeProperty(property);
  }

  save() {
    const rect = this.element.getBoundingClientRect();
    if (!rect.width) return;
    writePreference(this.key, JSON.stringify({
      x: (rect.left + rect.width / 2) / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight,
    }));
  }

  private place(left: number, top: number) {
    const rect = this.element.getBoundingClientRect();
    const x = Math.min(Math.max(EDGE, left), Math.max(EDGE, window.innerWidth - rect.width - EDGE));
    const y = Math.min(Math.max(EDGE, top), Math.max(EDGE, window.innerHeight - rect.height - EDGE));
    Object.assign(this.element.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto', transform: 'none' });
  }

  private saved(): { x: number; y: number } | undefined {
    const value = readJsonPreference(this.key) as { x?: unknown; y?: unknown } | undefined;
    return typeof value?.x === 'number' && typeof value.y === 'number' ? { x: value.x, y: value.y } : undefined;
  }
}
