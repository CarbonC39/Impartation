import { externalToolKindSchema, externalToolsSchema, type ExternalTool, type Zone } from '@virtual-workspace/shared';
import { zoneLabels } from './zone-labels';

export class ExternalToolPanel {
  private panel = document.getElementById('tool-panel')!;
  private heading = document.getElementById('tool-heading')!;
  private status = document.getElementById('tool-status')!;
  private link = document.getElementById('tool-open') as HTMLAnchorElement;
  private controller = new AbortController();
  private current?: Zone;
  private tools: ExternalTool[] = [];
  private state: 'loading' | 'ready' | 'failed' = 'loading';

  constructor() { void this.load(); }

  setZone(zone: Zone | undefined) {
    if (this.current?.id === zone?.id) return;
    this.current = zone;
    this.render();
  }

  dispose() {
    this.controller.abort();
    this.current = undefined;
    this.render();
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
    this.link.hidden = true;
    this.link.removeAttribute('href');
    const zone = this.current;
    this.panel.hidden = !zone || !externalToolKindSchema.safeParse(zone.kind).success;
    if (this.panel.hidden || !zone) return;
    this.heading.textContent = zoneLabels[zone.kind];
    if (this.state === 'loading') { this.status.textContent = '正在加载工具入口…'; return; }
    if (this.state === 'failed') { this.status.textContent = '工具入口加载失败，请重新进入空间重试。'; return; }
    const tool = this.tools.find(item => item.resourceId === zone.resourceId && item.kind === zone.kind);
    if (!tool) { this.status.textContent = '此区域尚未配置工具地址。'; return; }
    this.status.textContent = '在新标签页打开；身份和权限由工具管理。';
    this.link.textContent = `打开${zoneLabels[zone.kind]}`;
    this.link.href = tool.url;
    this.link.hidden = false;
  }
}
