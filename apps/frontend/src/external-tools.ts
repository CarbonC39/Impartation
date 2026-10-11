import { externalToolKindSchema, externalToolsSchema, type ExternalTool, type Zone } from '@virtual-workspace/shared';
import { zoneLabels } from './zone-labels';
import { createPresentations, type PresentationRegistry } from './presentations';

export class ExternalToolPanel {
  private panel = document.getElementById('tool-panel')!;
  private heading = document.getElementById('tool-heading')!;
  private status = document.getElementById('tool-status')!;
  private link = document.getElementById('tool-open') as HTMLAnchorElement;
  private presentationHost = document.createElement('div');
  private cleanupPresentation?: () => void;
  private controller = new AbortController();
  private current?: Zone;
  private tools: ExternalTool[] = [];
  private connected = true;
  private state: 'loading' | 'ready' | 'failed' = 'loading';

  private presentations: PresentationRegistry;
  constructor(presentations?: PresentationRegistry) {
    this.presentations = presentations ?? createPresentations(this.link);
    this.panel.append(this.presentationHost); void this.load();
  }

  setZone(zone: Zone | undefined) {
    if (this.current?.id === zone?.id) return;
    this.current = zone;
    this.render();
  }

  setConnected(value: boolean) { this.connected = value; this.render(); }

  dispose() {
    this.controller.abort();
    this.current = undefined;
    this.render();
    this.presentationHost.remove();
  }

  private async load() {
    try {
      const response = await fetch('/api/tools', {
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok) throw new Error('Tool configuration unavailable');
      this.tools = externalToolsSchema.parse(await response.json());
      this.state = 'ready';
    } catch { this.state = 'failed'; }
    if (!this.controller.signal.aborted) this.render();
  }

  private render() {
    this.cleanupPresentation?.();
    this.cleanupPresentation = undefined;
    this.presentationHost.replaceChildren();
    this.link.hidden = true;
    this.link.removeAttribute('href');
    const zone = this.current;
    this.panel.hidden = !this.connected || !zone || !externalToolKindSchema.safeParse(zone.kind).success;
    if (this.panel.hidden || !zone) return;
    this.heading.textContent = zoneLabels[zone.kind] ?? zone.kind;
    if (this.state === 'loading') { this.status.textContent = '正在加载工具入口…'; return; }
    if (this.state === 'failed') { this.status.textContent = '工具入口加载失败，请重新进入空间重试。'; return; }
    const tool = this.tools.find(item => item.resourceId === zone.resourceId && item.kind === zone.kind);
    if (!tool) { this.status.textContent = '此区域尚未配置工具地址。'; return; }
    this.status.textContent = (tool.mode ?? 'external') === 'external' ?
      '在新标签页打开；身份和权限由工具管理。' : '身份和权限由工具管理。';
    this.link.textContent = `打开${zoneLabels[zone.kind] ?? zone.kind}`;
    try { this.cleanupPresentation = this.presentations.open(tool, this.presentationHost); }
    catch (error) { this.status.textContent = error instanceof Error ? error.message : '展示方式不可用'; }
  }
}
