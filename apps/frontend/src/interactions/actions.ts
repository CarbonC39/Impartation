import type { Room } from '@colyseus/sdk';
import { activateActionSchema, CHARACTER_ACTIONS, CHARACTER_ACTION_NAMES, isCharacterAction, findActionAnchor, actionFacingMatches,
  type ActivateActionInput, type CharacterActionName, type InteractionResult, type SpaceProtocol, type WorldMap } from '@virtual-workspace/shared';
import { element } from './panel';

/**
 * Character abilities from the shared catalog. The server resolves anchors and validates the request;
 * the client only uses the map to pick which action E triggers and to label it.
 */
export class CharacterActions {
  private pending = false;
  private disposed = false;
  private selected: CharacterActionName = CHARACTER_ACTION_NAMES[0];
  private buttons = new Map<CharacterActionName, HTMLButtonElement>();
  private readonly renderState = () => this.refresh();
  private readonly click = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    const action = button?.dataset.action;
    if (!button || !action || !isCharacterAction(action)) return;
    button.blur(); // Return keyboard movement to the map after mouse/touch activation.
    this.selected = action;
    void this.activateAction({ action, animated: this.animatedFor(action) });
  };

  constructor(
    private readonly room: Room<SpaceProtocol>,
    private readonly world: () => WorldMap | undefined,
    private readonly list: HTMLElement,
    private readonly animated: HTMLInputElement,
    private readonly feedback: HTMLElement,
  ) {
    for (const action of CHARACTER_ACTION_NAMES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.dataset.action = action;
      button.setAttribute('aria-label', CHARACTER_ACTIONS[action].label);
      this.buttons.set(action, button);
    }
    this.list.replaceChildren(...this.buttons.values());
    this.room.onStateChange(this.renderState);
    this.list.addEventListener('click', this.click);
    this.animated.addEventListener('change', this.renderState);
    this.refresh();
  }

  /** E uses the nearest anchor whose tile overlaps the ground footprint. */
  private keyAction(): CharacterActionName {
    const player = this.room.state?.players.get(this.room.sessionId);
    const world = this.world();
    const anchor = player && world && findActionAnchor(world, player);
    return anchor && isCharacterAction(anchor.action) ? anchor.action : this.selected;
  }

  private animatedFor(action: CharacterActionName) {
    return CHARACTER_ACTIONS[action].animated && this.animated.checked;
  }

  refresh() {
    const player = this.room.state?.players.get(this.room.sessionId);
    const connected = Boolean(player?.connected && this.room.connection.isOpen);
    const keyAction = this.keyAction();
    const world = this.world();
    for (const [action, button] of this.buttons) {
      const definition = CHARACTER_ACTIONS[action];
      const active = player?.action === action;
      const same = active && player.actionAnimated === this.animatedFor(action);
      button.disabled = this.disposed || this.pending || !connected || same;
      const anchor = player && world && findActionAnchor(world, player, action);
      const labels = { up: '上', down: '下', left: '左', right: '右' } as const;
      const required = anchor?.facing && player && !actionFacingMatches(anchor, player.facing) ? `（朝${labels[anchor.facing]}可对齐）` : '';
      button.textContent = active ? definition.activeLabel : definition.label;
      button.title = anchor ? `目标：${'name' in anchor ? anchor.name : anchor.id}${required}` : definition.label;
      button.setAttribute('aria-pressed', String(active));
      if (action === keyAction) button.dataset.key = 'E';
      else delete button.dataset.key;
    }
    this.animated.disabled = this.disposed || this.pending || !connected || !CHARACTER_ACTIONS[keyAction].animated;
  }

  async activate() {
    const action = this.keyAction();
    return this.activateAction({ action, animated: this.animatedFor(action) });
  }

  async activateAction(input: ActivateActionInput): Promise<InteractionResult> {
    const player = this.room.state?.players.get(this.room.sessionId);
    if (this.disposed || this.pending || !player?.connected || !this.room.connection.isOpen) {
      return { ok: false, message: '角色尚未连接或已有动作请求等待中' };
    }
    const parsed = activateActionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: '动作参数无效' };

    this.pending = true;
    this.feedback.textContent = '';
    this.refresh();
    try {
      const result = await this.room.request('activateAction', parsed.data);
      if (!this.disposed) this.feedback.textContent = result.message;
      return result;
    } catch {
      const result = { ok: false, message: '动作操作失败，请检查连接后重试' };
      if (!this.disposed) this.feedback.textContent = result.message;
      return result;
    } finally {
      this.pending = false;
      if (!this.disposed) this.refresh();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.room.onStateChange.remove(this.renderState);
    this.list.removeEventListener('click', this.click);
    this.animated.removeEventListener('change', this.renderState);
    for (const button of this.buttons.values()) button.disabled = true;
    this.animated.disabled = true;
  }
}

export function createCharacterActions(room: Room<SpaceProtocol>, world: () => WorldMap | undefined) {
  return new CharacterActions(
    room,
    world,
    element('action-list'),
    element<HTMLInputElement>('action-animated'),
    element('object-feedback'),
  );
}
