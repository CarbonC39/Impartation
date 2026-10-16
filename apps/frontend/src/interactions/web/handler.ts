import { webToolsSchema, type WebTool, type Zone } from '@virtual-workspace/shared';
import { zoneLabels } from '../labels';
import { createPresentations, type PresentationRegistry } from './presentations';

export class WebToolInteraction {
  private panel = document.getElementById('tool-panel')!;
  private heading = document.getElementById('tool-heading')!;
  private status = document.getElementById('tool-status')!;
  private link = document.getElementById('tool-open') as HTMLAnchorElement;
  private presentationHost = document.createElement('div');
  private cleanupPresentation?: () => void;
  private controller = new AbortController();
  private current?: Zone;
  private tools: WebTool[] = [];
  private connected = true;
  private state: 'loading' | 'ready' | 'failed' = 'loading';
  private readonly openTool = (event: MouseEvent) => {
    event.preventDefault();
    const zone = this.current;
    if (!this.connected || this.state !== 'ready' || zone?.kind !== 'web') return;
    const tool = this.tools.find(item => item.resourceId === zone.resourceId);
    if (!tool || ((tool.mode ?? 'external') === 'embed' && this.cleanupPresentation)) return;
    this.closePresentation();
    try {
      this.cleanupPresentation = this.presentations.open(tool, this.presentationHost);
      this.render();
    } catch (error) {
      this.status.textContent = error instanceof Error ? error.message : '展示方式不可用';
    }
  };

  private presentations: PresentationRegistry;
  constructor(presentations?: PresentationRegistry) {
    this.presentations = presentations ?? createPresentations();
    this.link.addEventListener('click', this.openTool);
    this.panel.append(this.presentationHost); void this.load();
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
    this.current = undefined;
    this.render();
    this.presentationHost.remove();
  }

  private closePresentation() {
    this.cleanupPresentation?.();
    this.cleanupPresentation = undefined;
    this.presentationHost.replaceChildren();
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
    const zone = this.current;
    this.panel.hidden = !this.connected || !zone || zone.kind !== 'web';
    if (this.panel.hidden || !zone) return;
    this.heading.textContent = zoneLabels[zone.kind] ?? zone.kind;
    if (this.state === 'loading') { this.status.textContent = '正在加载工具入口…'; return; }
    if (this.state === 'failed') { this.status.textContent = '工具入口加载失败，请重新进入空间重试。'; return; }
    const tool = this.tools.find(item => item.resourceId === zone.resourceId);
    if (!tool) { this.status.textContent = '此区域尚未配置工具地址。'; return; }
    const mode = tool.mode ?? 'external';
    this.status.textContent = mode === 'external' ?
      '点击打开后将在新标签页启动；身份和权限由工具管理。' :
      this.cleanupPresentation ? '嵌入页面已打开；离开区域时关闭。身份和权限由工具管理。' :
        '点击打开后将在此处嵌入页面；身份和权限由工具管理。';
    this.link.textContent = `打开${zoneLabels[zone.kind] ?? zone.kind}`;
    this.link.href = tool.url;
    this.link.hidden = mode === 'embed' && !!this.cleanupPresentation;
  }
}
