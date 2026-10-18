import { APPEARANCE_ASSETS, APPEARANCE_LAYERS, appearanceSchema, type JoinOptions } from '@virtual-workspace/shared';
import { drawAppearancePreview } from './appearancePreview';
import { avatarDefinition } from './characters';
import { createColorPicker } from './colorPicker';

export type Appearance = JoinOptions['appearance'];
type Part = keyof Appearance;

const CATEGORY_LABELS: Record<Part, string> = { body: '身体', face: '面部', hair: '头发', top: '上衣', bottom: '下装', shoes: '鞋子', accessories: '配饰' };
const ITEM_LABELS: Record<string, string> = {
  walk: '基础身体', eyes: '圆圆眼',
  hair1: '波波头', hair2: '偏分', hair3: '直短发', hair4: '长直发', hair5: '中分', hair6: '高马尾', hair7: '双马尾', hair8: 'M字刘海', hair9: '斜刘海', hair10: '长卷发', hair11: '总裁背头',
  't-shirt': '短袖', shirt: '衬衫', school_uniform: '校服', suit: '西装', priest: '长袍', sweater: '毛衣',
  pants: '长裤', skirt: '裙子', shoes: '小皮鞋', accessories: '围巾', beanie: '毛线帽', glasses: '眼镜',
};
const NONE_LABELS: Partial<Record<Part, string>> = { top: '不穿', bottom: '不穿', shoes: '光脚', accessories: '不戴' };
/** Presets stay inside the soft range so random outfits always match the art. */
export const CANDY_COLORS = ['#fff6e6', '#f6e1c3', '#e3c29d', '#c6a184', '#a3827a', '#7d6a83',
  '#ffdbe5', '#f9bccf', '#ee9dba', '#f6bfa8', '#ffd3a3', '#fff0b0',
  '#dcf2cf', '#b4e3c8', '#a3d3cd', '#c3dcf5', '#a7bfea', '#9aa6da',
  '#ebe0fa', '#d0bff0', '#b39fdc', '#e0c9e6', '#bcaabf', '#f4f1f7'];
const SKIN_COLORS = ['#ffffff', '#fff3ea', '#fde4d3', '#f4cdb2', '#e2b394', '#c7987b', '#a77e68', '#efe8ff', '#e6f5ee', '#fff1f5', '#f3f0e4', '#ffe9d6'];
const EYE_COLORS = ['#3f3550', '#5a4b72', '#6e5747', '#4b6488', '#557a66', '#8b5a7b', '#7a4f4f', '#2f2a3a', '#6a6fa6', '#9a6f4f', '#4f7f86', '#835c99'];
const FACINGS = [{ key: 'down', label: '正面' }, { key: 'left', label: '左侧' }, { key: 'up', label: '背面' }, { key: 'right', label: '右侧' }] as const;
const HISTORY_LIMIT = 30;

export function itemLabel(id: string) { return ITEM_LABELS[id] ?? id; }
function presetsFor(part: Part) { return part === 'body' ? SKIN_COLORS : part === 'face' ? EYE_COLORS : CANDY_COLORS; }
const random = <T>(values: readonly T[]): T => values[Math.floor(Math.random() * values.length)]!;
const clone = (appearance: Appearance) => appearanceSchema.parse(structuredClone(appearance));

export type WardrobeElements = {
  preview: HTMLCanvasElement; facingLabel: HTMLElement; nameTag: HTMLElement; nameInput: HTMLInputElement;
  turnLeft: HTMLButtonElement; turnRight: HTMLButtonElement; sit: HTMLButtonElement; undo: HTMLButtonElement; randomize: HTMLButtonElement;
  tabs: HTMLButtonElement[]; items: HTMLElement; swatches: HTMLElement; swatchTitle: HTMLElement; picker: HTMLElement; colorTitle: HTMLElement;
  onError(message: string): void;
};

export class Wardrobe {
  private appearance: Appearance = clone(appearanceSchema.parse({}));
  private part: Part = 'hair';
  private facing = 0;
  private sitting = false;
  private history: Appearance[] = [];
  private lastGroup = '';
  private lastChange = 0;
  private picker;
  private itemCanvases = new Map<string, HTMLCanvasElement>();

  constructor(private readonly ui: WardrobeElements) {
    this.picker = createColorPicker('自由取色', this.appearance[this.part].color, hex => this.change({ color: hex }, `color:${this.part}`));
    ui.picker.replaceChildren(this.picker.root);
    ui.tabs.forEach(tab => tab.addEventListener('click', () => {
      const part = tab.dataset.appearanceCategory;
      if (part && part in APPEARANCE_ASSETS) this.selectPart(part as Part);
    }));
    ui.turnLeft.addEventListener('click', () => { this.facing = (this.facing + 1) % 4; this.drawPreview(); });
    ui.turnRight.addEventListener('click', () => { this.facing = (this.facing + 3) % 4; this.drawPreview(); });
    ui.sit.addEventListener('click', () => { this.sitting = !this.sitting; ui.sit.setAttribute('aria-pressed', String(this.sitting)); this.drawPreview(); });
    ui.undo.addEventListener('click', () => {
      const previous = this.history.pop();
      if (!previous) return;
      this.appearance = previous;
      this.lastGroup = '';
      this.render();
    });
    ui.randomize.addEventListener('click', () => {
      const next = Object.fromEntries(APPEARANCE_LAYERS.map(part => {
        const assets: readonly string[] = APPEARANCE_ASSETS[part];
        const worn = assets.filter(id => id !== 'none');
        const assetId = assets.includes('none') && Math.random() < 0.2 ? 'none' : random(worn.length ? worn : assets);
        return [part, { assetId, color: random(part === 'body' ? SKIN_COLORS.slice(0, 7) : presetsFor(part)) }];
      }));
      this.replace(appearanceSchema.parse(next));
    });
    ui.nameInput.addEventListener('input', () => this.renderName());
    this.render();
  }

  get value(): Appearance { return clone(this.appearance); }

  /** Replaces the whole outfit (profile load, slot, randomize); undo can step back to the previous one. */
  replace(appearance: Appearance, remember = true) {
    if (remember) this.remember();
    this.appearance = clone(appearance);
    this.lastGroup = '';
    this.render();
  }

  renderName() { this.ui.nameTag.textContent = this.ui.nameInput.value.trim() || '小访客'; }

  private remember() {
    this.history.push(clone(this.appearance));
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
  }

  /** Continuous drags on one control collapse into a single undo step. */
  private change(change: Partial<Appearance[Part]>, group: string) {
    const now = performance.now();
    if (group !== this.lastGroup || now - this.lastChange > 800) this.remember();
    this.lastGroup = group; this.lastChange = now;
    this.appearance = appearanceSchema.parse({ ...this.appearance, [this.part]: { ...this.appearance[this.part], ...change } });
    this.render(false);
  }

  private selectPart(part: Part) {
    this.part = part;
    this.lastGroup = '';
    this.picker.setValue(this.appearance[part].color);
    this.renderItems();
    this.render();
  }

  private render(syncPicker = true) {
    const ui = this.ui;
    ui.tabs.forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.appearanceCategory === this.part)));
    ui.undo.disabled = this.history.length === 0;
    if (syncPicker) this.picker.setValue(this.appearance[this.part].color);
    ui.colorTitle.textContent = `颜色 · ${CATEGORY_LABELS[this.part]}`;
    ui.swatchTitle.textContent = this.part === 'body' ? '肤色预设' : this.part === 'face' ? '眼睛颜色预设' : '糖果色卡';
    if (!this.itemCanvases.size || ui.items.dataset.part !== this.part) this.renderItems();
    this.renderSwatches();
    this.drawPreview();
    this.drawItems();
    this.renderName();
  }

  private renderItems() {
    this.itemCanvases.clear();
    this.ui.items.dataset.part = this.part;
    this.ui.items.setAttribute('aria-label', CATEGORY_LABELS[this.part]);
    const frame = avatarDefinition('mint');
    this.ui.items.replaceChildren(...APPEARANCE_ASSETS[this.part].map(id => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'item-card';
      button.dataset.appearanceItem = id;
      const cell = document.createElement('span');
      cell.className = 'item-cell';
      const canvas = document.createElement('canvas');
      canvas.width = frame.frameWidth; canvas.height = frame.frameHeight;
      canvas.setAttribute('aria-hidden', 'true');
      cell.append(canvas);
      const label = document.createElement('span');
      label.textContent = id === 'none' ? NONE_LABELS[this.part] ?? '无' : itemLabel(id);
      button.append(cell, label);
      button.addEventListener('click', () => {
        if (this.appearance[this.part].assetId === id) return;
        this.change({ assetId: id } as Partial<Appearance[Part]>, `asset:${this.part}:${id}`);
        this.lastGroup = '';
      });
      this.itemCanvases.set(id, canvas);
      return button;
    }));
  }

  private renderSwatches() {
    const current = this.appearance[this.part].color.toLowerCase();
    this.ui.swatches.replaceChildren(...presetsFor(this.part).map(hex => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.style.background = hex;
      button.setAttribute('aria-label', `颜色 ${hex}`);
      button.setAttribute('aria-pressed', String(hex === current));
      button.addEventListener('click', () => { this.change({ color: hex }, `preset:${this.part}:${hex}`); this.picker.setValue(hex); });
      return button;
    }));
  }

  private drawPreview() {
    const facing = FACINGS[this.facing]!;
    const avatar = avatarDefinition('mint');
    const frame = this.sitting ? avatar.actions.sit[facing.key] : avatar.idle[facing.key];
    this.ui.facingLabel.textContent = facing.label + (this.sitting ? ' · 坐姿' : '');
    void drawAppearancePreview(this.ui.preview, this.appearance, frame).catch(error => this.ui.onError(error instanceof Error ? error.message : String(error)));
  }

  private drawItems() {
    for (const [id, canvas] of this.itemCanvases) {
      const button = canvas.closest('button');
      const worn = this.appearance[this.part].assetId === id;
      button?.setAttribute('aria-pressed', String(worn));
      const outfit = appearanceSchema.parse({ ...this.appearance, [this.part]: { ...this.appearance[this.part], assetId: id } });
      void drawAppearancePreview(canvas, outfit).catch(() => { /* The main preview reports load failures. */ });
    }
  }
}
