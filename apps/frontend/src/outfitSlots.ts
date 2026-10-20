import { appearanceSchema } from '@virtual-workspace/shared';
import { z } from 'zod';
import { drawAppearancePreview } from './appearancePreview';
import { avatarDefinition } from './characters';
import { readJsonPreference, writePreference } from './preferences';
import type { Appearance } from './wardrobe';

const SLOT_COUNT = 3;
const STORAGE_KEY = 'virtual-workspace-outfits';
const slotSchema = z.object({ name: z.string().trim().min(1).max(12), appearance: appearanceSchema }).nullable();
type Slot = z.infer<typeof slotSchema>;

function loadSlots(): Slot[] {
  const stored = readJsonPreference(STORAGE_KEY);
  const list = Array.isArray(stored) ? stored : [];
  return Array.from({ length: SLOT_COUNT }, (_, index) => {
    const parsed = slotSchema.safeParse(list[index] ?? null);
    return parsed.success ? parsed.data : null;
  });
}

export type OutfitSlotHooks = {
  current(): Appearance;
  wear(appearance: Appearance): void;
  /** Called after a slot is written; the caller may also persist the outfit to the profile. */
  saved(name: string): Promise<string | undefined>;
};

/** Three named outfits kept in this browser. Empty slots save directly; full slots need a second click to overwrite. */
export function mountOutfitSlots(dialog: HTMLDialogElement, list: HTMLElement, status: HTMLElement, hooks: OutfitSlotHooks) {
  let slots = loadSlots();
  let confirming = -1;
  const drafts = slots.map(slot => slot?.name ?? '');
  const frame = avatarDefinition('mint');

  function persist() { writePreference(STORAGE_KEY, JSON.stringify(slots)); }

  function render() {
    list.replaceChildren(...slots.map((slot, index) => {
      const card = document.createElement('li');
      card.className = 'slot-card';
      card.dataset.filled = String(Boolean(slot));
      const cell = document.createElement('div');
      cell.className = 'slot-cell';
      const number = document.createElement('span');
      number.className = 'slot-number';
      number.textContent = String(index + 1);
      cell.append(number);
      if (slot) {
        const canvas = document.createElement('canvas');
        canvas.width = frame.frameWidth; canvas.height = frame.frameHeight;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `槽位 ${index + 1} 的造型预览`);
        cell.append(canvas);
        void drawAppearancePreview(canvas, slot.appearance).catch(() => {});
      } else {
        const empty = document.createElement('span');
        empty.className = 'slot-empty';
        empty.textContent = '空槽位';
        cell.append(empty);
      }
      const label = document.createElement('label');
      label.textContent = '造型名';
      const input = document.createElement('input');
      input.maxLength = 12;
      input.placeholder = `造型 ${index + 1}`;
      input.value = drafts[index] ?? '';
      input.addEventListener('input', () => {
        drafts[index] = input.value;
        const name = input.value.trim();
        if (slot && name) { slots[index] = { ...slot, name }; persist(); }
      });
      label.append(input);
      const actions = document.createElement('div');
      actions.className = 'slot-actions';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = slot ? (confirming === index ? 'danger' : 'secondary') : 'primary';
      save.textContent = !slot ? '存到这里' : confirming === index ? '确认覆盖？' : '覆盖';
      save.addEventListener('click', () => void saveTo(index));
      actions.append(save);
      if (slot) {
        const wear = document.createElement('button');
        wear.type = 'button';
        wear.className = 'secondary';
        wear.textContent = '穿上';
        wear.addEventListener('click', () => { hooks.wear(slot.appearance); dialog.close(); });
        actions.append(wear);
      }
      card.append(cell, label, actions);
      return card;
    }));
  }

  async function saveTo(index: number) {
    if (slots[index] && confirming !== index) { confirming = index; status.textContent = ''; render(); return; }
    const name = (drafts[index] ?? '').trim() || `造型 ${index + 1}`;
    drafts[index] = name;
    slots[index] = { name, appearance: hooks.current() };
    confirming = -1;
    persist();
    render();
    status.textContent = `已存到槽位 ${index + 1}「${name}」`;
    const extra = await hooks.saved(name);
    if (extra) status.textContent += `，${extra}`;
  }

  dialog.addEventListener('close', () => { confirming = -1; });
  return {
    open() {
      slots = loadSlots();
      slots.forEach((slot, index) => { if (slot) drafts[index] = slot.name; });
      confirming = -1;
      status.textContent = '';
      render();
      dialog.showModal();
    },
    hasSaved: () => loadSlots().some(Boolean),
  };
}
