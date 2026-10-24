import { savedOutfitsSchema, type SavedOutfits } from '@impartation/shared';
import { drawAppearancePreview } from './appearancePreview';
import { avatarDefinition } from './characters';
import type { Appearance } from './wardrobe';
import { accountHeaders } from './identity';

const SLOT_COUNT = 3;
type Slot = SavedOutfits[number];

export type OutfitSlotHooks = {
  current(): Appearance;
  wear(appearance: Appearance): void;
  /** Called after a slot is written; the caller may also persist the outfit as the current profile appearance. */
  saved(name: string): Promise<string | undefined>;
};

async function loadSlots(): Promise<SavedOutfits> {
  const response = await fetch('/api/me/outfits', { credentials: 'include', headers: accountHeaders() });
  if (!response.ok) throw new Error(`读取造型失败（${response.status}）`);
  return savedOutfitsSchema.parse(await response.json());
}

async function writeSlot(index: number, slot: Slot): Promise<void> {
  const response = await fetch(`/api/me/outfits/${index}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...accountHeaders() },
    body: JSON.stringify(slot),
  });
  if (!response.ok) throw new Error(`保存造型失败（${response.status}）`);
}

/** Three named outfits kept on the account. Empty slots save directly; full slots need a second click to overwrite. */
export function mountOutfitSlots(dialog: HTMLDialogElement, list: HTMLElement, status: HTMLElement, hooks: OutfitSlotHooks) {
  let slots: SavedOutfits = [null, null, null];
  let drafts = ['', '', ''];
  let confirming = -1;
  let loading = false;
  let loaded = false;
  let requestId = 0;
  const busy = new Set<number>();
  const frame = avatarDefinition('mint');

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
        canvas.width = frame.frameWidth;
        canvas.height = frame.frameHeight;
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
      input.disabled = loading || !loaded || busy.has(index);
      input.addEventListener('input', () => { drafts[index] = input.value; });
      input.addEventListener('change', () => { void renameSlot(index); });
      label.append(input);
      const actions = document.createElement('div');
      actions.className = 'slot-actions';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = slot ? (confirming === index ? 'danger' : 'secondary') : 'primary';
      save.textContent = !slot ? '存到这里' : confirming === index ? '确认覆盖？' : '覆盖';
      save.disabled = loading || !loaded || busy.has(index);
      save.addEventListener('click', () => void saveTo(index));
      actions.append(save);
      if (slot) {
        const wear = document.createElement('button');
        wear.type = 'button';
        wear.className = 'secondary';
        wear.textContent = '穿上';
        wear.disabled = loading || !loaded || busy.has(index);
        wear.addEventListener('click', () => { hooks.wear(slot.appearance); dialog.close(); });
        actions.append(wear);
      }
      card.append(cell, label, actions);
      return card;
    }));
  }

  async function renameSlot(index: number) {
    const generation = requestId;
    const previous = slots[index];
    const name = (drafts[index] ?? '').trim();
    if (!previous || !name || name === previous.name || busy.has(index)) return;
    const renamed = { ...previous, name };
    busy.add(index);
    status.textContent = '';
    render();
    try {
      await writeSlot(index, renamed);
      if (generation !== requestId) return;
      slots[index] = renamed;
      drafts[index] = name;
      status.textContent = `已更新槽位 ${index + 1}「${name}」`;
    } catch (error) {
      if (generation !== requestId) return;
      drafts[index] = previous.name;
      status.textContent = `改名失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy.delete(index);
      render();
    }
  }

  async function saveTo(index: number) {
    const generation = requestId;
    if (!loaded || loading || busy.has(index)) return;
    if (slots[index] && confirming !== index) {
      confirming = index;
      status.textContent = '';
      render();
      return;
    }
    const name = (drafts[index] ?? '').trim() || `造型 ${index + 1}`;
    const outfit = { name, appearance: hooks.current() };
    busy.add(index);
    confirming = -1;
    status.textContent = '';
    render();
    try {
      await writeSlot(index, outfit);
      if (generation !== requestId) return;
      slots[index] = outfit;
      drafts[index] = name;
      render();
      status.textContent = `已存到槽位 ${index + 1}「${name}」`;
      const extra = await hooks.saved(name);
      if (extra && generation === requestId) status.textContent += `，${extra}`;
    } catch (error) {
      if (generation !== requestId) return;
      status.textContent = `保存失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy.delete(index);
      render();
    }
  }

  dialog.addEventListener('close', () => {
    confirming = -1;
    requestId++;
  });
  return {
    open() {
      const currentRequest = ++requestId;
      slots = [null, null, null];
      drafts = ['', '', ''];
      confirming = -1;
      loading = true;
      loaded = false;
      status.textContent = '正在读取账号造型…';
      render();
      dialog.showModal();
      void loadSlots().then(value => {
        if (currentRequest !== requestId) return;
        slots = value;
        drafts = value.map(slot => slot?.name ?? '');
        loaded = true;
        status.textContent = '';
      }).catch(error => {
        if (currentRequest !== requestId) return;
        status.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`;
      }).finally(() => {
        if (currentRequest !== requestId) return;
        loading = false;
        render();
      });
    },
    /** Whether this account already has a saved outfit; false when the slots cannot be read (e.g. signed out). */
    hasSaved: () => loadSlots().then(list => list.some(Boolean), () => false),
  };
}
