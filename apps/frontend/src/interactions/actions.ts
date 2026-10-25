import type { Room } from '@colyseus/sdk';
import { activateActionSchema, CHARACTER_ACTIONS, CHARACTER_ACTION_NAMES, isCharacterAction, findActionAnchor, actionFacingMatches,
  type ActivateActionInput, type CharacterActionName, type InteractionResult, type SpaceProtocol, type WorldMap } from '@impartation/shared';
import { characterAppearance, characterFacing, characterFrame } from '../characters';
import { drawAppearancePreview } from '../appearancePreview';
import { element } from './panel';

/** Character abilities from the shared catalog. The server resolves anchors and validates the request. */
export class CharacterActions {
  private connected = true;
  private pending = false;
  private disposed = false;
  private selected: CharacterActionName = CHARACTER_ACTION_NAMES[0];
  private selectedAnimated = false;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly drawnFrames = new Map<string, string>();
  private frame = 0;
  private readonly renderState = () => this.refresh();
  private readonly click = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    const action = button?.dataset.action;
    if (!button || !action || !isCharacterAction(action)) return;
    button.blur();
    this.selected = action;
    this.selectedAnimated = button.dataset.animated === 'true';
    void this.activateAction({ action, animated: this.selectedAnimated });
  };
  private readonly faceClick = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-facing]');
    const facing = button?.dataset.facing;
    if (!button || (facing !== 'up' && facing !== 'down' && facing !== 'left' && facing !== 'right')) return;
    button.blur();
    const player = this.room.state?.players.get(this.room.sessionId);
    if (this.connected && player?.connected && this.room.connection.isOpen) this.room.send('face', facing);
  };
  private readonly toggleClick = () => {
    const collapsed = this.body.hidden;
    this.body.hidden = !collapsed;
    this.toggle.setAttribute('aria-expanded', String(collapsed));
    this.toggle.textContent = collapsed ? '收起' : '展开';
    this.list.closest('.positional-controls')?.classList.toggle('collapsed', !collapsed);
    if (collapsed) this.startPreview(); else this.stopPreview();
    this.toggle.blur();
  };

  private readonly body = element('action-panel-body');
  private readonly toggle = element<HTMLButtonElement>('action-panel-toggle');
  private readonly facing = element('facing-controls');

  constructor(
    private readonly room: Room<SpaceProtocol>,
    private readonly world: () => WorldMap | undefined,
    private readonly list: HTMLElement,
    private readonly feedback: HTMLElement,
  ) {
    for (const action of CHARACTER_ACTION_NAMES) {
      for (const animated of [false, true]) {
        if (animated && !CHARACTER_ACTIONS[action].animated) continue;
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'action-option secondary';
        button.dataset.action = action; button.dataset.animated = String(animated);
        button.setAttribute('aria-label', `${CHARACTER_ACTIONS[action].label}${animated ? '动画' : ''}`);
        const canvas = document.createElement('canvas');
        canvas.width = 16; canvas.height = 24; canvas.className = 'action-preview'; canvas.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span'); label.textContent = animated ? `${CHARACTER_ACTIONS[action].label}（动画）` : CHARACTER_ACTIONS[action].label;
        button.append(canvas, label);
        this.buttons.set(`${action}:${animated}`, button);
      }
    }
    this.list.replaceChildren(...this.buttons.values());
    this.room.onStateChange(this.renderState);
    this.list.addEventListener('click', this.click);
    this.facing.addEventListener('click', this.faceClick);
    this.toggle.addEventListener('click', this.toggleClick);
    this.refresh(); this.startPreview();
  }

  private keyAction(): CharacterActionName {
    const player = this.room.state?.players.get(this.room.sessionId);
    const world = this.world();
    const anchor = player && world && findActionAnchor(world, player);
    return anchor && isCharacterAction(anchor.action) ? anchor.action : this.selected;
  }
  private drawPreviews() {
    if (this.disposed || this.body.hidden) return;
    const player = this.room.state?.players.get(this.room.sessionId);
    if (!player) return;
    const appearance = characterAppearance(player.appearance);
    const elapsed = performance.now();
    for (const [key, button] of this.buttons) {
      const [action, mode] = key.split(':');
      const canvas = button.querySelector('canvas');
      if (!canvas || !action) continue;
      const animated = mode === 'true';
      const frame = characterFrame(player.avatar, characterFacing(player.facing), 'idle', action, animated, elapsed);
      const signature = `${player.avatar}:${player.appearance}:${player.facing}:${frame}`;
      if (this.drawnFrames.get(key) === signature) continue;
      this.drawnFrames.set(key, signature);
      void drawAppearancePreview(canvas, appearance, frame);
    }
  }
  private startPreview() {
    if (this.disposed || this.body.hidden || this.frame) return;
    const tick = () => { this.frame = 0; if (this.disposed || this.body.hidden) return; this.drawPreviews(); this.frame = requestAnimationFrame(tick); };
    this.drawPreviews(); this.frame = requestAnimationFrame(tick);
  }
  private stopPreview() { if (this.frame) cancelAnimationFrame(this.frame); this.frame = 0; }
  refresh() {
    const player = this.room.state?.players.get(this.room.sessionId);
    const connected = Boolean(this.connected && player?.connected && this.room.connection.isOpen);
    const keyAction = this.keyAction(); const world = this.world();
    for (const [key, button] of this.buttons) {
      const [action, mode] = key.split(':');
      if (!action || !isCharacterAction(action)) continue;
      const definition = CHARACTER_ACTIONS[action]; const animated = mode === 'true';
      const active = player?.action === action;
      const same = active && player.actionAnimated === animated;
      button.disabled = this.disposed || this.pending || !connected || same;
      const anchor = player && world && findActionAnchor(world, player, action);
      const labels = { up: '上', down: '下', left: '左', right: '右' } as const;
      const required = anchor?.facing && player && !actionFacingMatches(anchor, player.facing) ? `（朝${labels[anchor.facing]}可对齐）` : '';
      button.title = `${definition.label}${animated ? '（动画）' : ''}${anchor ? `；目标：${'name' in anchor ? anchor.name : anchor.id}${required}` : ''}`;
      button.setAttribute('aria-pressed', String(active && player.actionAnimated === animated));
      const keyboardMode = action === this.selected ? this.selectedAnimated : false;
      if (action === keyAction && animated === keyboardMode) button.dataset.key = 'E'; else delete button.dataset.key;
    }
    for (const button of this.facing.querySelectorAll<HTMLButtonElement>('button[data-facing]')) {
      button.disabled = !connected;
      button.setAttribute('aria-pressed', String(button.dataset.facing === player?.facing));
    }
  }
  async activate() {
    const action = this.keyAction();
    return this.activateAction({ action, animated: action === this.selected ? this.selectedAnimated : false });
  }
  async activateAction(input: ActivateActionInput): Promise<InteractionResult> {
    const player = this.room.state?.players.get(this.room.sessionId);
    if (!this.connected || this.disposed || this.pending || !player?.connected || !this.room.connection.isOpen) return { ok: false, message: '角色尚未连接或已有动作请求等待中' };
    const parsed = activateActionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: '动作参数无效' };
    this.pending = true; this.feedback.textContent = ''; this.refresh();
    try {
      const result = await this.room.request('activateAction', parsed.data);
      if (!this.disposed) this.feedback.textContent = result.message;
      return result;
    } catch {
      const result = { ok: false, message: '动作操作失败，请检查连接后重试' };
      if (!this.disposed) this.feedback.textContent = result.message;
      return result;
    } finally { this.pending = false; if (!this.disposed) this.refresh(); }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.stopPreview(); this.room.onStateChange.remove(this.renderState);
    this.list.removeEventListener('click', this.click); this.facing.removeEventListener('click', this.faceClick); this.toggle.removeEventListener('click', this.toggleClick);
    for (const button of this.buttons.values()) button.disabled = true;
  }
  setConnected(value: boolean) { this.connected = value; this.refresh(); }
}

export function createCharacterActions(room: Room<SpaceProtocol>, world: () => WorldMap | undefined) {
  return new CharacterActions(room, world, element('action-list'), element('object-feedback'));
}
