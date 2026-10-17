import { InteractionRegistry, type WebTool, type PresentationMode } from '@virtual-workspace/shared';

/** `host` receives the page; `links` holds optional controls such as a manual external link. */
export type Presentation = (tool: WebTool, host: HTMLElement, links: HTMLElement) => () => void;

/** Web-tool presentation strategies selected by resource configuration. */
export class PresentationRegistry {
  private strategies = new InteractionRegistry<Presentation>();

  register(mode: PresentationMode, strategy: Presentation): this { this.strategies.register(mode, strategy); return this; }

  open(tool: WebTool, host: HTMLElement, links: HTMLElement): () => void {
    const mode = tool.mode ?? 'external';
    const strategy = this.strategies.get(mode);
    if (strategy) return strategy(tool, host, links);
    throw new Error('此展示方式尚未注册');
  }
}

const external: Presentation = tool => {
  if (!tool.url) throw new Error('Missing external URL');
  window.open(tool.url, '_blank', 'noopener,noreferrer');
  return () => {};
};
const embed: Presentation = (tool, host, links) => {
  if (!tool.url) throw new Error('Missing embed URL');
  const frame = document.createElement('iframe');
  frame.title = tool.resourceId; frame.src = tool.url;
  frame.setAttribute('sandbox', `allow-scripts allow-forms allow-popups${tool.allowSameOrigin ? ' allow-same-origin' : ''}`);
  frame.referrerPolicy = 'no-referrer';
  host.append(frame);
  const manualExternalOpen = tool.manualExternalOpen ?? (tool.fallback === 'external');
  let manualLink: HTMLAnchorElement | undefined;
  if (manualExternalOpen) {
    manualLink = document.createElement('a');
    manualLink.textContent = '手动在新标签页打开';
    manualLink.className = 'tv-link';
    manualLink.href = tool.url;
    manualLink.target = '_blank';
    manualLink.rel = 'noopener noreferrer';
    links.append(manualLink);
  }
  return () => { frame.remove(); manualLink?.remove(); };
};
export function createPresentations() {
  return new PresentationRegistry().register('external', external).register('embed', embed);
}
