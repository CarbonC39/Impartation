import { readJsonPreference, readPreference, writePreference } from './preferences';

const EDGE = 8;
const MIN_WIDTH = 220;
const MIN_HEIGHT = 120;

type Layout = { left?: number; top?: number; width?: number; height?: number };

/**
 * Lets an interaction panel be dragged by its heading, resized from its bottom-right corner and
 * collapsed to its heading, like the chat card. Panels stay in the default stack until first
 * dragged. Layout and collapsed state are stored per panel and browser, and re-clamped whenever
 * the panel is shown or the viewport changes.
 */
export class PanelLayout {
  private layout: Layout = {};
  private layoutKey: string;
  private collapsedKey: string;
  private toggle: HTMLButtonElement;

  constructor(private panel: HTMLElement) {
    const handle = panel.querySelector<HTMLElement>('.panel-heading');
    const grip = panel.querySelector<HTMLElement>('.panel-resize');
    const toggle = panel.querySelector<HTMLButtonElement>('.panel-toggle');
    if (!handle || !grip || !toggle) throw new Error(`Incomplete floating panel: ${panel.id}`);
    this.toggle = toggle;
    this.layoutKey = `virtual-workspace-panel-layout:${panel.id}`;
    this.collapsedKey = `virtual-workspace-panel-collapsed:${panel.id}`;
    const saved = readJsonPreference(this.layoutKey);
    if (saved && typeof saved === 'object') {
      for (const key of ['left', 'top', 'width', 'height'] as const) {
        const value = (saved as Record<string, unknown>)[key];
        if (typeof value === 'number' && Number.isFinite(value)) this.layout[key] = value;
      }
    }
    this.track(handle, (start, dx, dy) => {
      this.layout.left = start.left + dx;
      this.layout.top = start.top + dy;
    }, ['left', 'top'], event => !(event.target as HTMLElement).closest('button'));
    this.track(grip, (start, dx, dy) => {
      this.layout.width = start.width + dx;
      this.layout.height = start.height + dy;
    }, ['width', 'height']);
    handle.addEventListener('dblclick', event => {
      if (!(event.target as HTMLElement).closest('button')) this.reset();
    });
    toggle.addEventListener('click', () => {
      this.setCollapsed(!panel.classList.contains('collapsed'));
      toggle.blur(); // Return keyboard movement to the map.
    });
    this.setCollapsed(readPreference(this.collapsedKey) === 'true');
    // Hidden panels have no size, so clamp again each time an interaction shows one.
    new MutationObserver(() => { if (!panel.hidden) this.apply(); }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('resize', () => this.apply());
    this.apply();
  }

  reset() {
    this.layout = {};
    writePreference(this.layoutKey, '');
    this.panel.classList.remove('floating');
    for (const property of ['left', 'top', '--panel-width', '--panel-height']) this.panel.style.removeProperty(property);
  }

  private setCollapsed(collapsed: boolean) {
    this.panel.classList.toggle('collapsed', collapsed);
    const body = this.panel.querySelector<HTMLElement>('.panel-body');
    if (body) body.hidden = collapsed;
    const title = this.panel.querySelector('h2')?.firstChild?.textContent?.trim() ?? '';
    this.toggle.setAttribute('aria-expanded', String(!collapsed));
    this.toggle.setAttribute('aria-label', `${collapsed ? '展开' : '收起'}${title}`);
    this.toggle.textContent = collapsed ? '展开' : '收起';
    writePreference(this.collapsedKey, String(collapsed));
    this.apply();
  }

  private track(target: HTMLElement, update: (start: Required<Layout>, dx: number, dy: number) => void,
    pin: (keyof Layout)[], accept: (event: PointerEvent) => boolean = () => true) {
    let drag: { id: number; x: number; y: number; start: Required<Layout> } | undefined;
    target.addEventListener('pointerdown', event => {
      if (drag || event.button !== 0 || !accept(event)) return;
      event.preventDefault();
      const rect = this.panel.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: {
        left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      } };
      // Pin the values this gesture changes, so moves never mix stored and CSS-default anchors.
      for (const key of pin) this.layout[key] = drag.start[key];
      try { target.setPointerCapture(event.pointerId); } catch { /* Pointer already released. */ }
      this.panel.classList.add('adjusting');
    });
    target.addEventListener('pointermove', event => {
      if (drag?.id !== event.pointerId) return;
      update(drag.start, event.clientX - drag.x, event.clientY - drag.y);
      this.apply();
    });
    const end = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) return;
      drag = undefined;
      this.panel.classList.remove('adjusting');
      writePreference(this.layoutKey, JSON.stringify(this.layout));
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('lostpointercapture', end);
  }

  private apply() {
    const { innerWidth: viewWidth, innerHeight: viewHeight } = window;
    const style = this.panel.style;
    if (this.layout.width !== undefined) {
      this.layout.width = Math.round(Math.min(Math.max(MIN_WIDTH, this.layout.width), viewWidth - EDGE * 2));
      style.setProperty('--panel-width', `${this.layout.width}px`);
    }
    if (this.layout.height !== undefined) {
      this.layout.height = Math.round(Math.min(Math.max(MIN_HEIGHT, this.layout.height), viewHeight - EDGE * 2));
      style.setProperty('--panel-height', `${this.layout.height}px`);
    }
    if (this.layout.left === undefined || this.layout.top === undefined) return;
    this.panel.classList.add('floating');
    const rect = this.panel.getBoundingClientRect();
    if (!rect.width) return;
    this.layout.left = Math.round(Math.min(Math.max(EDGE, this.layout.left), Math.max(EDGE, viewWidth - rect.width - EDGE)));
    this.layout.top = Math.round(Math.min(Math.max(EDGE, this.layout.top), Math.max(EDGE, viewHeight - rect.height - EDGE)));
    Object.assign(style, { left: `${this.layout.left}px`, top: `${this.layout.top}px` });
  }
}
