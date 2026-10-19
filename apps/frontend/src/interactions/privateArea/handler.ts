import type { Room } from '@colyseus/sdk';
import type { PrivateAreaOperationInput, SpaceProtocol, Zone } from '@virtual-workspace/shared';
import type { InteractionHandler } from '../dispatcher';
import { element } from '../panel';

/**
 * State patches arrive many times a second. Rebuilding an open <select> on every patch fights the
 * user's pointer and can hang the native popup, so options change only when their content does.
 */
function setOptions(select: HTMLSelectElement, options: [value: string, label: string][]) {
  const current = [...select.options];
  if (current.length === options.length && current.every((option, index) =>
    option.value === options[index]![0] && option.text === options[index]![1])) return;
  const selected = select.value;
  select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
  if (options.some(([value]) => value === selected)) select.value = selected;
}

export class PrivateAreaInteraction implements InteractionHandler {
  private panel = element('private-area-panel');
  private areas = element<HTMLSelectElement>('private-area-select');
  private members = element('private-area-members');
  private players = element<HTMLSelectElement>('private-area-player');
  private lock = element<HTMLButtonElement>('private-area-lock');
  private add = element<HTMLButtonElement>('private-area-add');
  private status = element('private-area-status');
  private connected = true;
  private pending = false;
  private disposed = false;
  private selected = '';
  private controller = new AbortController();
  private renderState = () => this.render();
  constructor(private room: Room<SpaceProtocol>) {
    room.onStateChange(this.renderState);
    this.areas.addEventListener('change', () => { this.selected = this.areas.value; this.render(); }, { signal: this.controller.signal });
    this.lock.addEventListener('click', () => {
      const player = room.state.players.get(room.sessionId);
      const area = player && room.state.privateAreas.get(player.mapId)?.areas.get(this.selected);
      if (area) void this.run({ areaId: this.selected, operation: 'lock', locked: !area.locked });
    }, { signal: this.controller.signal });
    this.add.addEventListener('click', () => { void this.run({ areaId: this.selected, operation: 'addMember', playerId: this.players.value }); },
      { signal: this.controller.signal });
    this.render();
  }
  private render() {
    const player = this.room.state.players.get(this.room.sessionId);
    const areas = player && this.room.state.privateAreas.get(player.mapId)?.areas;
    const memberships = [...(areas?.entries() ?? [])].filter(([, area]) => area.members.has(this.room.sessionId));
    this.panel.hidden = !memberships.length;
    if (!memberships.length) { this.selected = ''; return; }
    if (!memberships.some(([id]) => id === this.selected)) this.selected = player?.privateAreaId || memberships[0]![0];
    setOptions(this.areas, memberships.map(([id, area]) => [id, `区域 ${id}${area.locked ? ' · 已锁定' : ' · 开放'}`]));
    if (this.areas.value !== this.selected) this.areas.value = this.selected;
    const state = areas!.get(this.selected)!;
    const members = `成员：${[...state.members.keys()].map(id => this.room.state.players.get(id)?.name ?? id).join('、')}`;
    if (this.members.textContent !== members) this.members.textContent = members;
    setOptions(this.players, [...this.room.state.players.entries()]
      .filter(([id, other]) => other.connected && !state.members.has(id)).map(([id, other]) => [id, other.name]));
    const lockText = state.locked ? '解锁' : '锁定';
    if (this.lock.textContent !== lockText) this.lock.textContent = lockText;
    this.lock.disabled = !this.connected || !player?.connected || this.pending;
    this.add.disabled = this.lock.disabled || !this.players.options.length;
    this.areas.disabled = this.pending;
  }
  private async run(input: PrivateAreaOperationInput) {
    if (!this.connected || this.pending || this.disposed) return;
    this.pending = true; this.status.textContent = ''; this.render();
    try { const result = await this.room.request('privateArea', input); if (!this.disposed) this.status.textContent = result.message; }
    catch { if (!this.disposed) this.status.textContent = '操作失败，请检查连接后重试'; }
    finally { this.pending = false; if (!this.disposed) this.render(); }
  }
  setZone(_zone: Zone | undefined) {}
  setConnected(value: boolean) { this.connected = value; this.render(); }
  dispose() { this.disposed = true; this.controller.abort(); this.room.onStateChange.remove(this.renderState); this.panel.hidden = true; }
}
