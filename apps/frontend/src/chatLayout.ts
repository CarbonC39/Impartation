import { readJsonPreference, writePreference } from './preferences';

const LAYOUT_KEY = 'virtual-workspace-chat-layout';
const EDGE = 8;
const MIN_WIDTH = 200;
const MIN_LOG = 60;

type Layout = { left?: number; bottom?: number; width?: number; height?: number };

/**
 * Lets the chat overlay be dragged by its heading and resized from its top-right corner.
 * The card keeps its bottom edge when resized, matching its default bottom anchoring.
 * Layout is stored per browser and re-clamped to the viewport on resize.
 */
export class ChatLayout {
  private layout: Layout = {};

  constructor(private card: HTMLElement, private handle: HTMLElement, private grip: HTMLElement, private log: HTMLElement) {
    const saved = readJsonPreference(LAYOUT_KEY);
    if (saved && typeof saved === 'object') {
      for (const key of ['left', 'bottom', 'width', 'height'] as const) {
        const value = (saved as Record<string, unknown>)[key];
        if (typeof value === 'number' && Number.isFinite(value)) this.layout[key] = value;
      }
    }
    this.track(handle, (start, dx, dy) => {
      this.layout.left = start.left + dx;
      this.layout.bottom = start.bottom - dy;
    }, event => !(event.target as HTMLElement).closest('button'));
    this.track(grip, (start, dx, dy) => {
      this.layout.width = start.width + dx;
      this.layout.height = start.height - dy;
    });
    handle.addEventListener('dblclick', event => {
      if (!(event.target as HTMLElement).closest('button')) this.reset();
    });
    window.addEventListener('resize', () => this.apply());
    this.apply();
  }

  reset() {
    this.layout = {};
    writePreference(LAYOUT_KEY, '');
    for (const property of ['left', 'bottom', 'right', 'top']) this.card.style.removeProperty(property);
    this.card.style.removeProperty('--chat-width');
    this.card.style.removeProperty('--chat-height');
  }

  /** Re-apply once the map screen is visible, since hidden elements have no size. */
  refresh() { this.apply(); }

  private track(target: HTMLElement, update: (start: Required<Layout>, dx: number, dy: number) => void,
    accept: (event: PointerEvent) => boolean = () => true) {
    let drag: { id: number; x: number; y: number; start: Required<Layout> } | undefined;
    target.addEventListener('pointerdown', event => {
      if (drag || event.button !== 0 || !accept(event)) return;
      event.preventDefault();
      const rect = this.card.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: {
        left: rect.left, bottom: window.innerHeight - rect.bottom, width: rect.width, height: this.log.getBoundingClientRect().height,
      } };
      // Pin every value, so later moves never mix stored and CSS-default anchors.
      this.layout = { ...drag.start };
      try { target.setPointerCapture(event.pointerId); } catch { /* Pointer already released. */ }
      this.card.classList.add('adjusting');
    });
    target.addEventListener('pointermove', event => {
      if (drag?.id !== event.pointerId) return;
      update(drag.start, event.clientX - drag.x, event.clientY - drag.y);
      this.apply();
    });
    const end = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) return;
      drag = undefined;
      this.card.classList.remove('adjusting');
      writePreference(LAYOUT_KEY, JSON.stringify(this.layout));
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('lostpointercapture', end);
  }

  private apply() {
    const { innerWidth: viewWidth, innerHeight: viewHeight } = window;
    const style = this.card.style;
    if (this.layout.width !== undefined) {
      this.layout.width = Math.round(Math.min(Math.max(MIN_WIDTH, this.layout.width), viewWidth - EDGE * 2));
      style.setProperty('--chat-width', `${this.layout.width}px`);
    }
    if (this.layout.height !== undefined) {
      this.layout.height = Math.round(Math.min(Math.max(MIN_LOG, this.layout.height), viewHeight * 0.7));
      style.setProperty('--chat-height', `${this.layout.height}px`);
    }
    if (this.layout.left === undefined || this.layout.bottom === undefined) return;
    const rect = this.card.getBoundingClientRect();
    if (!rect.width) return;
    this.layout.left = Math.round(Math.min(Math.max(EDGE, this.layout.left), Math.max(EDGE, viewWidth - rect.width - EDGE)));
    this.layout.bottom = Math.round(Math.min(Math.max(EDGE, this.layout.bottom), Math.max(EDGE, viewHeight - rect.height - EDGE)));
    Object.assign(style, { left: `${this.layout.left}px`, bottom: `${this.layout.bottom}px`, right: 'auto', top: 'auto' });
  }
}
