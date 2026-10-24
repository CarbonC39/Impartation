import { hexToHsv, hexToRgb, hsvToHex, rgbToHex, type Hsv } from '@impartation/shared';

const HEX = /^#[0-9a-fA-F]{6}$/;
type EyeDropperWindow = Window & { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } };

export type ColorPicker = { root: HTMLElement; setValue(hex: string): void };

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Saturation/value field, hue strip, RGB/HEX fields and an optional eyedropper. */
export function createColorPicker(label: string, initial: string, onChange: (hex: string) => void): ColorPicker {
  let value = initial.toLowerCase();
  let hsv: Hsv = hexToHsv(value);

  const root = make('div', 'picker');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', label);

  const field = make('div', 'picker-field');
  field.tabIndex = 0;
  field.setAttribute('role', 'slider');
  field.setAttribute('aria-label', `${label}：饱和度与明度`);
  const fieldKnob = make('span', 'picker-knob');
  field.append(fieldKnob);

  const row = make('div', 'picker-row');
  const swatch = make('span', 'picker-swatch');
  const hue = make('div', 'picker-hue');
  hue.tabIndex = 0;
  hue.setAttribute('role', 'slider');
  hue.setAttribute('aria-label', `${label}：色相`);
  hue.setAttribute('aria-valuemin', '0');
  hue.setAttribute('aria-valuemax', '360');
  const hueKnob = make('span', 'picker-hue-knob');
  hue.append(hueKnob);
  const eyeDropper = (window as EyeDropperWindow).EyeDropper;
  if (eyeDropper) {
    const dropper = make('button', 'picker-dropper');
    dropper.type = 'button';
    dropper.setAttribute('aria-label', '吸管取色');
    dropper.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path fill="currentColor" d="M7 0h2v1h1v2H9v1H8v1H7V4H6v1H5v1H4v1H3v1H2v1H1v1H0V9h1V8h1V7h1V6h1V5h1V4h1V3H5V2h1V1h1z"/></svg>';
    dropper.addEventListener('click', () => {
      void new eyeDropper().open().then(result => pickHex(result.sRGBHex)).catch(() => { /* Cancelled. */ });
    });
    row.append(dropper);
  }
  row.append(swatch, hue);

  const fields = make('div', 'picker-fields');
  const channels = (['R', 'G', 'B'] as const).map((name, index) => {
    const wrapper = make('label', undefined, name);
    const input = make('input');
    input.type = 'number'; input.min = '0'; input.max = '255'; input.inputMode = 'numeric';
    input.addEventListener('change', () => {
      const next = hexToRgb(value);
      const parsed = Number.parseInt(input.value, 10);
      if (Number.isNaN(parsed)) { render(); return; }
      next[index] = Math.min(255, Math.max(0, parsed));
      pickHex(rgbToHex(...next));
    });
    wrapper.prepend(input);
    fields.append(wrapper);
    return input;
  });
  const hexWrapper = make('label', undefined, 'HEX');
  const hexInput = make('input', 'picker-hex');
  hexInput.maxLength = 7; hexInput.spellcheck = false; hexInput.autocomplete = 'off';
  hexInput.addEventListener('change', () => {
    const text = hexInput.value.trim();
    const candidate = text.startsWith('#') ? text : `#${text}`;
    if (HEX.test(candidate)) pickHex(candidate); else render();
  });
  hexWrapper.prepend(hexInput);
  fields.append(hexWrapper);

  root.append(field, row, fields);

  function render() {
    field.style.setProperty('--picker-hue', String(Math.round(hsv.h)));
    fieldKnob.style.left = `${hsv.s * 100}%`;
    fieldKnob.style.top = `${(1 - hsv.v) * 100}%`;
    fieldKnob.style.background = value;
    field.setAttribute('aria-valuetext', `饱和度 ${Math.round(hsv.s * 100)}%，明度 ${Math.round(hsv.v * 100)}%`);
    hueKnob.style.left = `${hsv.h / 3.6}%`;
    hue.setAttribute('aria-valuenow', String(Math.round(hsv.h)));
    swatch.style.background = value;
    hexToRgb(value).forEach((channel, index) => { channels[index]!.value = String(channel); });
    if (document.activeElement !== hexInput) hexInput.value = value;
  }
  function commit(next: Hsv) {
    hsv = next;
    value = hsvToHex(hsv);
    render();
    onChange(value);
  }
  function pickHex(hex: string) {
    const next = hexToHsv(hex.toLowerCase());
    // Grey has no hue; keep the strip where the user left it.
    commit(next.s < 0.01 ? { ...next, h: hsv.h } : next);
  }
  function dragging(target: HTMLElement, apply: (x: number, y: number) => void) {
    const move = (event: PointerEvent) => {
      const rect = target.getBoundingClientRect();
      apply(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)));
    };
    target.addEventListener('pointerdown', event => {
      event.preventDefault();
      target.focus();
      target.setPointerCapture(event.pointerId);
      move(event);
    });
    target.addEventListener('pointermove', event => { if (target.hasPointerCapture(event.pointerId)) move(event); });
  }
  dragging(field, (x, y) => commit({ h: hsv.h, s: x, v: 1 - y }));
  dragging(hue, x => commit({ ...hsv, h: Math.min(359.9, x * 360) }));
  field.addEventListener('keydown', event => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    commit({ h: hsv.h, s: Math.min(1, Math.max(0, hsv.s + delta[0]!)), v: Math.min(1, Math.max(0, hsv.v + delta[1]!)) });
  });
  hue.addEventListener('keydown', event => {
    const step = event.shiftKey ? 15 : 3;
    const delta = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    commit({ ...hsv, h: (hsv.h + delta + 360) % 360 });
  });
  render();
  return {
    root,
    setValue(hex) {
      if (hex.toLowerCase() === value) return;
      value = hex.toLowerCase();
      const next = hexToHsv(value);
      hsv = next.s < 0.01 ? { ...next, h: hsv.h } : next;
      render();
    },
  };
}
