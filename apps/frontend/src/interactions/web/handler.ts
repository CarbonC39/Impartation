import type { Room } from '@colyseus/sdk';
import { webToolsSchema, type SpaceProtocol, type WebTool, type Zone } from '@impartation/shared';
import { zoneLabels } from '../labels';
import { element } from '../panel';
import { createPresentations, type PresentationRegistry } from './presentations';
import { releaseToolFocus, ToolStage } from './stage';

const MIN_TV_WIDTH = 360;
const MIN_TV_HEIGHT = 200;

/** Entering a web zone shows a small hint above it; only a click opens the tool. */
export class WebToolInteraction {
  private hint = element('tool-hint');
  private status = element('tool-status');
  private link = element<HTMLAnchorElement>('tool-open');
  private window = new TvWindow();
  private cleanupPresentation?: () => void;
  private controller = new AbortController();
  private current?: Zone;
  private tools: WebTool[] = [];
  private connected = true;
  private state: 'loading' | 'ready' | 'failed' = 'loading';
  private readonly openTool = (event: MouseEvent) => {
    event.preventDefault();
    this.link.blur(); // Return keyboard movement to the map.
    const zone = this.current;
    if (!this.connected || this.state !== 'ready' || zone?.kind !== 'web') return;
    const tool = this.tools.find(item => item.resourceId === zone.resourceId);
    if (!tool || ((tool.mode ?? 'external') === 'embed' && this.cleanupPresentation)) return;
    this.closePresentation();
    try {
      if ((tool.mode ?? 'external') === 'embed') {
        this.window.open(zoneLabels[zone.kind] ?? zone.kind, () => this.close());
        this.stage?.show();
      }
      this.cleanupPresentation = this.presentations.open(tool, this.window.screen, this.window.links);
      this.render();
    } catch (error) {
      this.window.close();
      this.status.textContent = error instanceof Error ? error.message : '展示方式不可用';
    }
  };

  private presentations: PresentationRegistry;
  private stage?: ToolStage;
  constructor(presentations?: PresentationRegistry, room?: Room<SpaceProtocol>, speaking?: (sessionId: string) => boolean) {
    this.presentations = presentations ?? createPresentations();
    if (room) this.stage = new ToolStage(room, speaking);
    this.link.addEventListener('click', this.openTool);
    void this.load();
  }

  setZone(zone: Zone | undefined) {
    if (this.current?.id === zone?.id) return;
    this.closePresentation();
    this.current = zone;
    this.render();
  }

  setConnected(value: boolean) {
    if (!value) this.closePresentation();
    this.connected = value;
    this.render();
  }

  dispose() {
    this.controller.abort();
    this.link.removeEventListener('click', this.openTool);
    this.closePresentation();
    this.window.dispose();
    this.current = undefined;
    this.render();
  }

  private close() {
    this.closePresentation();
    this.render();
  }

  private closePresentation() {
    this.cleanupPresentation?.();
    this.cleanupPresentation = undefined;
    this.stage?.hide();
    this.window.close();
  }

  private async load() {
    try {
      const response = await fetch('/api/tools', {
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok) throw new Error('Tool configuration unavailable');
      this.tools = webToolsSchema.parse(await response.json());
      this.state = 'ready';
    } catch { this.state = 'failed'; }
    if (!this.controller.signal.aborted) this.render();
  }

  private render() {
    this.link.hidden = true;
    this.link.removeAttribute('href');
    this.status.textContent = '';
    const zone = this.current;
    this.hint.hidden = !this.connected || !zone || zone.kind !== 'web';
    if (this.hint.hidden || !zone) return;
    if (this.state === 'loading') { this.status.textContent = '正在加载工具入口…'; return; }
    if (this.state === 'failed') { this.status.textContent = '工具入口加载失败，请重新进入空间重试'; return; }
    const tool = this.tools.find(item => item.resourceId === zone.resourceId);
    if (!tool) { this.status.textContent = '此区域尚未配置工具地址'; return; }
    const mode = tool.mode ?? 'external';
    const label = zoneLabels[zone.kind] ?? zone.kind;
    this.link.textContent = mode === 'external' ? `打开${label} ↗` : `打开${label}`;
    this.link.title = mode === 'external' ? '在新标签页打开；身份和权限由工具管理' : '在窗口中打开；离开区域时关闭。身份和权限由工具管理';
    this.link.href = tool.url;
    this.link.hidden = mode === 'embed' && !!this.cleanupPresentation;
  }
}

/**
 * Centered TV-style frame that hosts embedded tools: dragged by its title bar, resized from its top-left grip
 * (the bottom corners sit under the chat and the desk).
 */
class TvWindow {
  private root = element('tool-window');
  private heading = element('tool-heading');
  private backdrop = element('tool-backdrop');
  private grip = element('tool-resize');
  private bar = element('tool-drag');
  private closeButton = element<HTMLButtonElement>('tool-close');
  readonly screen = element('tool-screen');
  readonly links = element('tool-links');
  private offset = { x: 0, y: 0 };
  private drag?: { pointerId: number; x: number; y: number; originX: number; originY: number };
  private resizing?: { pointerId: number; x: number; y: number; width: number; height: number; originX: number; originY: number };
  private onClose?: () => void;
  private controller = new AbortController();

  constructor() {
    const options = { signal: this.controller.signal };
    this.closeButton.addEventListener('click', () => this.onClose?.(), options);
    this.root.addEventListener('keydown', event => { if (event.key === 'Escape') this.onClose?.(); }, options);
    this.bar.addEventListener('pointerdown', event => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button, a')) return;
      event.preventDefault();
      releaseToolFocus();
      this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: this.offset.x, originY: this.offset.y };
      this.bar.setPointerCapture(event.pointerId);
      this.root.classList.add('dragging');
    }, options);
    this.bar.addEventListener('pointermove', event => {
      if (this.drag?.pointerId !== event.pointerId) return;
      this.move(this.drag.originX + event.clientX - this.drag.x, this.drag.originY + event.clientY - this.drag.y);
    }, options);
    const end = (event: PointerEvent) => {
      if (this.drag?.pointerId !== event.pointerId) return;
      this.drag = undefined;
      this.root.classList.remove('dragging');
    };
    this.bar.addEventListener('pointerup', end, options);
    this.bar.addEventListener('pointercancel', end, options);
    this.grip.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      releaseToolFocus();
      const screen = this.screen.getBoundingClientRect();
      this.resizing = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        width: this.root.getBoundingClientRect().width, height: screen.height, originX: this.offset.x, originY: this.offset.y };
      this.grip.setPointerCapture(event.pointerId);
      document.body.classList.add('tool-adjusting');
    }, options);
    this.grip.addEventListener('pointermove', event => {
      const start = this.resizing;
      if (start?.pointerId !== event.pointerId) return;
      const width = Math.round(Math.min(window.innerWidth - 16, Math.max(MIN_TV_WIDTH, start.width - (event.clientX - start.x))));
      const height = Math.round(Math.min(window.innerHeight - 140, Math.max(MIN_TV_HEIGHT, start.height - (event.clientY - start.y))));
      this.root.style.setProperty('--tv-width', `${width}px`);
      this.root.style.setProperty('--tv-screen-height', `${height}px`);
      // The frame is centered, so shift it by half the growth to keep the bottom-right corner in place.
      this.move(start.originX - (width - start.width) / 2, start.originY - (height - start.height) / 2);
    }, options);
    const endResize = (event: PointerEvent) => {
      if (this.resizing?.pointerId !== event.pointerId) return;
      this.resizing = undefined;
      document.body.classList.remove('tool-adjusting');
    };
    this.grip.addEventListener('pointerup', endResize, options);
    this.grip.addEventListener('pointercancel', endResize, options);
    this.grip.addEventListener('lostpointercapture', endResize, options);
    window.addEventListener('resize', () => { if (!this.root.hidden) this.move(this.offset.x, this.offset.y); }, options);
  }

  open(title: string, onClose: () => void) {
    this.heading.textContent = title;
    this.onClose = onClose;
    this.root.hidden = false;
    this.backdrop.hidden = false;
    document.body.classList.add('tool-open');
    this.move(0, 0);
  }

  close() {
    this.onClose = undefined;
    this.drag = undefined;
    this.root.classList.remove('dragging');
    this.resizing = undefined;
    document.body.classList.remove('tool-open', 'tool-adjusting');
    this.root.hidden = true;
    this.backdrop.hidden = true;
    this.screen.replaceChildren();
    this.links.replaceChildren();
  }

  dispose() { this.close(); this.controller.abort(); }

  /** Offsets are relative to the centered position; keep the title bar reachable. */
  private move(x: number, y: number) {
    const rect = this.root.getBoundingClientRect();
    const maxX = Math.max(0, (window.innerWidth + rect.width) / 2 - 80);
    const maxY = Math.max(0, (window.innerHeight - rect.height) / 2 + rect.height - 40);
    const minY = (rect.height - window.innerHeight) / 2;
    this.offset = { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(minY, y)) };
    this.root.style.setProperty('--drag-x', `${this.offset.x}px`);
    this.root.style.setProperty('--drag-y', `${this.offset.y}px`);
  }
}
