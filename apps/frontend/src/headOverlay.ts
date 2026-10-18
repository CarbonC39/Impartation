/**
 * HTML layer above the map canvas for per-character status: speech bubble, typing dots and the
 * speaking microphone. The canvas renders at CSS-pixel resolution, so canvas text is upscaled
 * (and blurred) on high-DPI screens; DOM text and SVG stay sharp at any device pixel ratio.
 */

// Material Symbols "mic" (filled), Apache License 2.0, https://fonts.google.com/icons
const MIC_ICON = '<svg viewBox="0 -960 960 960" aria-hidden="true"><path fill="currentColor" d="M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35Zm-40 280v-123q-104-14-172-93t-68-184h80q0 83 58.5 141.5T480-320q83 0 141.5-58.5T680-520h80q0 105-68 184t-172 93v123h-80Z"/></svg>';

export type HeadState = { bubble?: string; typing: boolean; speaking: boolean };
type View = { root: HTMLElement; bubble: HTMLElement; typing: HTMLElement; mic: HTMLElement; key: string; position: string };

export class HeadOverlay {
  private views = new Map<string, View>();

  constructor(private root: HTMLElement) {}

  /** Places a character's stack with its bottom centre at the given canvas pixel. */
  update(id: string, x: number, y: number, state: HeadState) {
    let view = this.views.get(id);
    if (!view) view = this.create(id);
    const key = `${state.bubble ?? ''}\u0000${state.typing}\u0000${state.speaking}`;
    if (key !== view.key) {
      view.key = key;
      view.bubble.hidden = !state.bubble;
      if (state.bubble && view.bubble.textContent !== state.bubble) view.bubble.textContent = state.bubble;
      view.typing.hidden = !state.typing;
      view.mic.hidden = !state.speaking;
      view.root.hidden = !state.bubble && !state.typing && !state.speaking;
    }
    const position = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    if (position !== view.position) { view.position = position; view.root.style.transform = position; }
  }

  remove(id: string) {
    this.views.get(id)?.root.remove();
    this.views.delete(id);
  }

  clear() {
    for (const id of [...this.views.keys()]) this.remove(id);
  }

  private create(id: string): View {
    const root = document.createElement('div');
    root.className = 'head-stack';
    root.dataset.sessionId = id;
    root.hidden = true;
    const bubble = document.createElement('p');
    bubble.className = 'head-bubble';
    bubble.hidden = true;
    const row = document.createElement('div');
    row.className = 'head-status';
    const typing = document.createElement('span');
    typing.className = 'head-typing';
    typing.hidden = true;
    typing.setAttribute('aria-label', '正在输入');
    typing.append(...[0, 1, 2].map(() => document.createElement('i')));
    const mic = document.createElement('span');
    mic.className = 'head-mic';
    mic.hidden = true;
    mic.setAttribute('aria-label', '正在说话');
    mic.innerHTML = MIC_ICON;
    row.append(mic, typing);
    root.append(bubble, row);
    this.root.append(root);
    const view = { root, bubble, typing, mic, key: '', position: '' };
    this.views.set(id, view);
    return view;
  }
}
