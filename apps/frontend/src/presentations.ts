import { InteractionRegistry, type ExternalTool, type PresentationMode } from '@virtual-workspace/shared';

export type Presentation = (tool: ExternalTool, host: HTMLElement) => () => void;

/** Presentation strategies are independent of interaction kinds and service protocols. */
export class PresentationRegistry {
  private strategies = new InteractionRegistry<Presentation>();
  private nativeHandlers = new InteractionRegistry<Presentation>();

  register(mode: PresentationMode, strategy: Presentation): this { this.strategies.register(mode, strategy); return this; }
  registerNative(kind: string, handler: Presentation): this { this.nativeHandlers.register(kind, handler); return this; }

  open(tool: ExternalTool, host: HTMLElement): () => void {
    const mode = tool.mode ?? 'external';
    const strategy = (mode === 'native' ? this.nativeHandlers.get(tool.kind) : undefined) ?? this.strategies.get(mode);
    if (strategy) return strategy(tool, host);
    if (tool.fallback === 'external') return this.open({ ...tool, mode: 'external', fallback: undefined }, host);
    throw new Error('此展示方式尚未注册');
  }
}

const external: Presentation = (tool, host) => {
  if (!tool.url) throw new Error('Missing external URL');
  const link = document.createElement('a');
  link.textContent = '打开工具'; link.href = tool.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  host.append(link);
  return () => link.remove();
};
const embed: Presentation = (tool, host) => {
  if (!tool.url) throw new Error('Missing embed URL');
  const frame = document.createElement('iframe');
  frame.title = tool.kind; frame.src = tool.url;
  frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups');
  frame.referrerPolicy = 'no-referrer'; frame.style.width = '100%'; frame.style.height = '400px';
  host.append(frame);
  const fallback = tool.fallback === 'external' ? external(tool, host) : undefined;
  return () => { frame.remove(); fallback?.(); };
};
export function createPresentations(existingLink?: HTMLAnchorElement) {
  const externalStrategy: Presentation = existingLink ? (tool, _host) => {
    if (!tool.url) throw new Error('Missing external URL');
    existingLink.href = tool.url; existingLink.hidden = false;
    return () => { existingLink.hidden = true; existingLink.removeAttribute('href'); };
  } : external;
  return new PresentationRegistry().register('external', externalStrategy).register('embed', embed);
}
