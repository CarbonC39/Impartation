import type { Room } from '@colyseus/sdk';
import { activateActionSchema, type ActivateActionInput, type InteractionResult, type SpaceProtocol } from '@virtual-workspace/shared';
import { element } from './panel';

/** Character abilities work in place; the server supplies any matching map context. */
export class CharacterActions {
  private pending = false;
  private disposed = false;
  private readonly renderState = () => this.refresh();
  private readonly click = () => {
    this.button.blur(); // Return keyboard movement to the map after mouse/touch activation.
    void this.activate();
  };

  constructor(
    private readonly room: Room<SpaceProtocol>,
    private readonly button: HTMLButtonElement,
    private readonly animated: HTMLInputElement,
    private readonly feedback: HTMLElement,
  ) {
    this.room.onStateChange(this.renderState);
    this.button.addEventListener('click', this.click);
    this.animated.addEventListener('change', this.renderState);
    this.refresh();
  }

  refresh() {
    const player = this.room.state?.players.get(this.room.sessionId);
    const connected = Boolean(player?.connected && this.room.connection.isOpen);
    const sameAction = player?.action === 'sit' && player.actionAnimated === this.animated.checked;

    this.button.disabled = this.disposed || this.pending || !connected || sameAction;
    this.animated.disabled = this.disposed || this.pending || !connected;
    this.button.textContent = player?.action === 'sit' ? '已坐下' : '坐下';
    this.button.setAttribute('aria-label', '坐下');
  }

  async activate() {
    return this.activateAction({ action: 'sit', animated: this.animated.checked });
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
    this.button.removeEventListener('click', this.click);
    this.animated.removeEventListener('change', this.renderState);
    this.button.disabled = true;
    this.button.textContent = '坐下';
    this.animated.disabled = true;
  }
}

export function createCharacterActions(room: Room<SpaceProtocol>) {
  return new CharacterActions(
    room,
    element<HTMLButtonElement>('activate-object'),
    element<HTMLInputElement>('action-animated'),
    element('object-feedback'),
  );
}
