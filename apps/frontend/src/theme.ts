import { hexToRgb, rgbToHex } from '@impartation/shared';
import { createColorPicker } from './colorPicker';
import { readJsonPreference, readPreference, writePreference } from './preferences';

type Palette = { bg: string; dot: string; panel: string; line: string; ink: string; ink2: string; drop: string; soft: string;
  cell: string; sel: string; selInk: string; accent: string; accentInk: string; field: string };
type CustomColors = { bg: string; panel: string; line: string; accent: string };

const PRESETS = {
  lavender: { label: '薰衣草', bg: '#f3ecfb', dot: '#e2d6f3', panel: '#fffaf3', line: '#8b7aa6', ink: '#5a4b72', ink2: '#6e6187', drop: '#d3c4ea', soft: '#e9defa', cell: '#f1eafb', sel: '#ffd3e1', selInk: '#5a4b72', accent: '#ffb3cb', accentInk: '#4a3d60', field: '#ffffff' },
  mint: { label: '薄荷苏打', bg: '#eaf6ef', dot: '#d5eadf', panel: '#fffdf7', line: '#7f9a8c', ink: '#3f5449', ink2: '#56695f', drop: '#c9e2d4', soft: '#d9efe3', cell: '#e6f3ec', sel: '#ffe0c2', selInk: '#4f4038', accent: '#ffc79e', accentInk: '#4f3a2c', field: '#ffffff' },
  peach: { label: '蜜桃乌龙', bg: '#fdf0e8', dot: '#f3ddd0', panel: '#fffcf7', line: '#a8857a', ink: '#5e4640', ink2: '#755b54', drop: '#ecd3c6', soft: '#fbe0d3', cell: '#fbebe2', sel: '#ffe9a8', selInk: '#5e4640', accent: '#ffb4a2', accentInk: '#4f3530', field: '#ffffff' },
  sky: { label: '晴空', bg: '#eaf2fb', dot: '#d6e3f3', panel: '#fffefa', line: '#7f91ad', ink: '#3f4c66', ink2: '#58657e', drop: '#cad8ec', soft: '#dbe7f7', cell: '#e7eff9', sel: '#ffdde8', selInk: '#4a3d55', accent: '#f9b8cc', accentInk: '#46344a', field: '#ffffff' },
  milktea: { label: '奶茶', bg: '#f4efe8', dot: '#e5ddd1', panel: '#fffdf9', line: '#9a8b7d', ink: '#4d433b', ink2: '#665a50', drop: '#ddd2c5', soft: '#ebe3d8', cell: '#efe9e0', sel: '#e3efdc', selInk: '#3f4a3a', accent: '#e9c39b', accentInk: '#45362a', field: '#ffffff' },
  night: { label: '夜间', bg: '#2b2737', dot: '#363145', panel: '#37324a', line: '#8b7aa6', ink: '#f1eaff', ink2: '#cfc5e2', drop: '#1c1925', soft: '#463f5e', cell: '#403a55', sel: '#6d4f6c', selInk: '#fff4f8', accent: '#f2a7c3', accentInk: '#3a2a40', field: '#2a2636' },
} as const satisfies Record<string, Palette & { label: string }>;
type PresetId = keyof typeof PRESETS;
type ThemeId = PresetId | 'custom';
const PRESET_IDS = Object.keys(PRESETS) as PresetId[];
const CUSTOM_SLOTS = [['bg', '底色'], ['panel', '面板'], ['line', '描边'], ['accent', '按钮']] as const;
const THEME_KEY = 'virtual-workspace-theme';
const CUSTOM_KEY = 'virtual-workspace-theme-custom';
const HEX = /^#[0-9a-f]{6}$/i;

function mix(a: string, b: string, amount: number) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex(...x.map((channel, index) => channel + (y[index]! - channel) * amount) as [number, number, number]);
}
function luminance(hex: string) {
  const linear = (channel: number) => { const c = channel / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = hexToRgb(hex).map(linear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Derives the full palette from the four user-picked colors, keeping text readable on light or dark grounds. */
function customPalette(colors: CustomColors): Palette {
  const dark = luminance(colors.bg) < 0.2;
  const ink = dark ? mix(colors.line, '#ffffff', 0.85) : mix(colors.line, '#1e1828', 0.62);
  return {
    ...colors, ink, ink2: dark ? mix(colors.line, '#ffffff', 0.62) : mix(colors.line, '#1e1828', 0.42),
    dot: mix(colors.bg, colors.line, 0.12), drop: dark ? mix(colors.bg, '#000000', 0.35) : mix(colors.bg, colors.line, 0.3),
    soft: mix(colors.panel, colors.line, 0.16), cell: mix(colors.bg, colors.panel, 0.5), sel: mix(colors.accent, colors.panel, 0.45), selInk: ink,
    accentInk: contrast('#ffffff', colors.accent) >= contrast('#2a2233', colors.accent) ? '#ffffff' : mix(colors.accent, '#1e1828', 0.78),
    field: dark ? mix(colors.panel, '#000000', 0.2) : '#ffffff',
  };
}

function readCustom(): CustomColors {
  const stored = readJsonPreference(CUSTOM_KEY);
  const base = PRESETS.lavender;
  const fallback = { bg: base.bg, panel: base.panel, line: base.line, accent: base.accent };
  if (!stored || typeof stored !== 'object') return fallback;
  const record = stored as Record<string, unknown>;
  const pick = (key: keyof CustomColors) => typeof record[key] === 'string' && HEX.test(record[key]) ? record[key] : fallback[key];
  return { bg: pick('bg'), panel: pick('panel'), line: pick('line'), accent: pick('accent') };
}

let current: ThemeId = (() => {
  const stored = readPreference(THEME_KEY);
  return stored === 'custom' || PRESET_IDS.includes(stored as PresetId) ? stored as ThemeId : 'lavender';
})();
let custom = readCustom();
const listeners = new Set<() => void>();

function palette(id: ThemeId): Palette { return id === 'custom' ? customPalette(custom) : PRESETS[id]; }
function apply() {
  const colors = palette(current);
  const root = document.documentElement;
  const names: Record<keyof Palette, string> = { bg: '--bg', dot: '--dot', panel: '--panel', line: '--line', ink: '--ink', ink2: '--ink2',
    drop: '--drop', soft: '--soft', cell: '--cell', sel: '--sel', selInk: '--sel-ink', accent: '--accent', accentInk: '--accent-ink', field: '--field' };
  for (const [key, property] of Object.entries(names)) root.style.setProperty(property, colors[key as keyof Palette]);
  root.dataset.theme = current;
  root.style.colorScheme = luminance(colors.bg) < 0.2 ? 'dark' : 'light';
  listeners.forEach(listener => listener());
}
function setTheme(id: ThemeId) {
  current = id;
  writePreference(THEME_KEY, id);
  apply();
}
apply();

function dots(colors: Palette) {
  const holder = document.createElement('span');
  holder.className = 'theme-dots';
  holder.setAttribute('aria-hidden', 'true');
  for (const color of [colors.bg, colors.panel, colors.line, colors.accent]) {
    const dot = document.createElement('span');
    dot.style.background = color;
    holder.append(dot);
  }
  return holder;
}

/** Presets plus a custom theme built from four picked colors; mounted once and shared by the start and wardrobe screens. */
export function mountThemePanel(toggle: HTMLButtonElement, panel: HTMLElement) {
  const presets = document.createElement('div');
  presets.className = 'theme-presets';
  const slots = document.createElement('div');
  slots.className = 'theme-custom-slots';
  const customArea = document.createElement('div');
  customArea.className = 'theme-custom';
  const hint = document.createElement('p');
  hint.className = 'theme-contrast';
  hint.setAttribute('role', 'status');
  let editing: keyof CustomColors = 'accent';
  const picker = createColorPicker('自定义界面颜色', custom[editing], hex => {
    custom = { ...custom, [editing]: hex };
    writePreference(CUSTOM_KEY, JSON.stringify(custom));
    setTheme('custom');
  });
  const pickerTitle = document.createElement('p');
  pickerTitle.className = 'theme-picker-title';
  const pickerColumn = document.createElement('div');
  pickerColumn.className = 'theme-picker-column';
  pickerColumn.append(pickerTitle, picker.root);
  const options = document.createElement('div');
  options.className = 'theme-options';
  const heading = document.createElement('h2');
  heading.textContent = '界面配色';
  customArea.append(slots, hint);
  options.append(heading, presets, customArea);
  panel.replaceChildren(options, pickerColumn);

  function render() {
    presets.replaceChildren(...[...PRESET_IDS, 'custom' as const].map(id => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-option';
      button.setAttribute('aria-pressed', String(id === current));
      button.append(dots(palette(id)), document.createTextNode(id === 'custom' ? '自定义' : PRESETS[id].label));
      button.addEventListener('click', () => setTheme(id));
      return button;
    }));
    const isCustom = current === 'custom';
    customArea.hidden = !isCustom;
    pickerColumn.hidden = !isCustom;
    slots.replaceChildren(...CUSTOM_SLOTS.map(([key, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-slot';
      button.setAttribute('aria-pressed', String(key === editing));
      const chip = document.createElement('span');
      chip.className = 'theme-slot-chip';
      chip.style.background = custom[key];
      const code = document.createElement('small');
      code.textContent = custom[key];
      button.append(chip, document.createTextNode(label), code);
      button.addEventListener('click', () => { editing = key; picker.setValue(custom[key]); render(); });
      return button;
    }));
    pickerTitle.textContent = `正在改：${CUSTOM_SLOTS.find(([key]) => key === editing)![1]}`;
    const colors = palette('custom');
    const low = contrast(colors.ink, colors.panel) < 4.5 || contrast(colors.accentInk, colors.accent) < 4.5;
    hint.hidden = !low;
    hint.textContent = low ? '文字对比度偏低，可能看不清：试试把面板调浅、描边调深，或换个按钮色' : '';
    toggle.querySelector('.theme-dots')?.replaceWith(dots(palette(current)));
  }
  listeners.add(render);
  render();
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  });
}
