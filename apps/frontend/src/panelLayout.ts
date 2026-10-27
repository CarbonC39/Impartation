import { readJsonPreference, readPreference, writePreference } from './preferences';

const EDGE = 8;
const ANCHOR_GAP = 8;
const MIN_WIDTH = 220;
const MIN_HEIGHT = 120;

type Layout = { left?: number; top?: number; width?: number; height?: number };

/** Positions a panel below the entry button whose aria-controls names the panel. */
export class PanelAnchor {
  private frame = 0;
  private wasVisible = false;
  private observer: MutationObserver;
  private resizeObserver: ResizeObserver;

  constructor(
    private panel: HTMLElement,
    private onOpen: () => void = () => {},
    private shouldFollow: () => boolean = () => true,
  ) {
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    const topbar = panel.ownerDocument.querySelector('.map-topbar');
    if (topbar) this.observer.observe(topbar, {
      attributes: true, attributeFilter: ['hidden', 'class', 'style', 'aria-controls', 'aria-expanded'],
      childList: true, characterData: true, subtree: true,
    });
    window.addEventListener('resize', () => this.schedule());
    this.resizeObserver = new ResizeObserver(() => this.schedule());
    this.resizeObserver.observe(panel);
    if (topbar) this.resizeObserver.observe(topbar);
    const entries = panel.ownerDocument.querySelector('.zone-entries');
    if (entries) this.resizeObserver.observe(entries);
    this.schedule();
  }

  /** Apply the current anchor position immediately. Returns false if no entry is available. */
  place(): boolean {
    const anchor = this.findAnchor();
    if (!anchor) return false;
    const anchorRect = anchor.getBoundingClientRect();
    const toolbarBottom = anchor.closest('.map-topbar')?.getBoundingClientRect().bottom ?? anchorRect.bottom;
    this.panel.classList.add('anchored-panel');
    this.panel.style.left = `${Math.round(anchorRect.left)}px`;
    this.panel.style.top = `${Math.round(Math.max(anchorRect.bottom, toolbarBottom) + ANCHOR_GAP)}px`;
    this.clamp();
    return true;
  }

  private findAnchor(): HTMLElement | undefined {
    if (!this.panel.id) return undefined;
    const candidates = [...document.querySelectorAll<HTMLElement>('[aria-controls]')]
      .filter(candidate => candidate.getAttribute('aria-controls')?.split(/\s+/).includes(this.panel.id));
    return candidates.find(candidate => candidate.getAttribute('aria-expanded') === 'true') ?? candidates[0];
  }

  private schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.refresh();
    });
  }

  private refresh() {
    const visible = !this.panel.hidden;
    if (!visible) {
      this.wasVisible = false;
      return;
    }
    if (!this.wasVisible) {
      this.wasVisible = true;
      this.onOpen();
      this.place();
    } else if (this.shouldFollow()) {
      this.place();
    }
    this.clamp();
  }

  private clamp() {
    const rect = this.panel.getBoundingClientRect();
    if (!rect.width) return;
    const left = Math.round(Math.min(Math.max(EDGE, rect.left), Math.max(EDGE, window.innerWidth - rect.width - EDGE)));
    const top = Math.round(Math.min(Math.max(EDGE, rect.top), Math.max(EDGE, window.innerHeight - rect.height - EDGE)));
    this.panel.style.left = `${left}px`;
    this.panel.style.top = `${top}px`;
  }
}

/** Lets an interaction panel be dragged by its heading, resized from its bottom-right corner and
 * collapsed to its heading. Each opening returns it beneath its entry icon while retaining size. */
export class PanelLayout {
  private layout: Layout = {};
  private layoutKey: string;
  private collapsedKey: string;
  private toggle: HTMLButtonElement;
  private userPositioned = false;
  private anchor: PanelAnchor;

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
      // Old saved left/top values are intentionally ignored; size preferences remain useful.
      for (const key of ['width', 'height'] as const) {
        const value = (saved as Record<string, unknown>)[key];
        if (typeof value === 'number' && Number.isFinite(value)) this.layout[key] = value;
      }
    }
    this.anchor = new PanelAnchor(panel, () => {
      this.userPositioned = false;
    }, () => !this.userPositioned);
    this.track(handle, (start, dx, dy) => {
      this.layout.left = start.left + dx;
      this.layout.top = start.top + dy;
      this.userPositioned = true;
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
    window.addEventListener('resize', () => this.apply());
    this.apply();
  }

  reset() {
    this.layout = {};
    this.userPositioned = false;
    writePreference(this.layoutKey, '');
    this.panel.classList.remove('floating');
    for (const property of ['left', 'top', '--panel-width', '--panel-height']) this.panel.style.removeProperty(property);
    this.anchor.place();
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
    if (this.userPositioned && this.layout.left !== undefined && this.layout.top !== undefined) {
      this.panel.classList.add('floating');
      style.left = `${this.layout.left}px`;
      style.top = `${this.layout.top}px`;
    } else if (!this.panel.hidden) {
      this.anchor.place();
    }
    const rect = this.panel.getBoundingClientRect();
    if (!rect.width) return;
    const left = Math.round(Math.min(Math.max(EDGE, rect.left), Math.max(EDGE, viewWidth - rect.width - EDGE)));
    const top = Math.round(Math.min(Math.max(EDGE, rect.top), Math.max(EDGE, viewHeight - rect.height - EDGE)));
    if (this.userPositioned) {
      this.layout.left = left;
      this.layout.top = top;
    }
    style.left = `${left}px`;
    style.top = `${top}px`;
  }
}
