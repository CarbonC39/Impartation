import Phaser from 'phaser';
import type { Room } from '@colyseus/sdk';
import { PLAYER_RADIUS, TICK_MS, type SpaceProtocol, type RegisteredMap, type MovementInput } from '@virtual-workspace/shared';
import { zoneLabels } from './interactions/labels';

const colors: Record<string, number> = { mint: 0x88dbb4, amber: 0xefbd65, violet: 0xbb9de8 };

type Sprite = { circle: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text };

export class SpaceScene extends Phaser.Scene {
  private sprites = new Map<string, Sprite>();
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private inputElapsed = 0;
  private lastInput = '';

  constructor(private room: Room<SpaceProtocol>, private mapEntry: RegisteredMap,
    private renderMap: { tilesets: { name: string; image?: string }[] }, private zoneChanged: (id: string) => void,
    private virtualInput: () => MovementInput = () => ({ x: 0, y: 0 })) {
    super('space');
  }
  preload() {
    this.cache.tilemap.add('world', { format: Phaser.Tilemaps.Formats.TILED_JSON, data: this.renderMap });
    for (const [index, tileset] of this.renderMap.tilesets.entries()) {
      if (tileset.image) this.load.image(`tiles-${index}`, tileset.image);
    }
  }
  create() {
    const map = this.make.tilemap({ key: 'world' });
    const tiles = this.renderMap.tilesets.flatMap((tileset, index) => {
      if (!tileset.image) return [];
      const result = map.addTilesetImage(tileset.name, `tiles-${index}`);
      return result ? [result] : [];
    });
    for (const layer of map.layers) {
      if (!map.createLayer(layer.name, tiles)) throw new Error(`Unable to render Tiled layer: ${layer.name}`);
    }
    for (const zone of this.mapEntry.world.zones) {
      this.add.rectangle(zone.x, zone.y, zone.width, zone.height, 0xd5d080, 0.15)
        .setOrigin(0).setStrokeStyle(1, 0xd5d080, 0.6);
      this.add.text(zone.x + 8, zone.y + 8, zoneLabels[zone.kind] ?? zone.kind, { fontSize: '14px', color: '#eeefd9' });
    }
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>;
    const canvas = this.game.canvas;
    canvas.tabIndex = 0;
    canvas.dataset.mapId = this.mapEntry.id;
    const focusCanvas = () => canvas.focus();
    canvas.addEventListener('pointerdown', focusCanvas);
    const stop = () => {
      if (this.room.connection.isOpen) this.room.send('input', { x: 0, y: 0 });
    };
    window.addEventListener('blur', stop);
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', visibility);
    this.events.once('shutdown', () => {
      canvas.removeEventListener('pointerdown', focusCanvas);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', visibility);
    });
  }
  update(_time: number, delta: number) {
    const players = this.room.state?.players;
    if (!players) return;
    for (const [id, player] of players) {
      if (player.mapId !== this.mapEntry.id) continue;
      let sprite = this.sprites.get(id);
      if (!sprite) {
        const circle = this.add.circle(player.x, player.y, PLAYER_RADIUS, colors[player.avatar] ?? colors.mint);
        if (id === this.room.sessionId) circle.setStrokeStyle(2, 0xffffff);
        const label = this.add.text(player.x, player.y - 22, player.name, { fontSize: '12px', color: '#ffffff' }).setOrigin(0.5);
        sprite = { circle, label };
        this.sprites.set(id, sprite);
      }
      const blend = Math.min(1, delta / TICK_MS);
      sprite.circle.x = Phaser.Math.Linear(sprite.circle.x, player.x, blend);
      sprite.circle.y = Phaser.Math.Linear(sprite.circle.y, player.y, blend);
      sprite.circle.setAlpha(player.connected ? 1 : 0.35);
      sprite.circle.setFillStyle(colors[player.avatar] ?? colors.mint);
      if (sprite.label.text !== player.name) sprite.label.setText(player.name);
      sprite.label.setPosition(sprite.circle.x, sprite.circle.y - 22);
    }
    for (const [id, sprite] of this.sprites) {
      if (!players.has(id) || players.get(id)?.mapId !== this.mapEntry.id) { sprite.circle.destroy(); sprite.label.destroy(); this.sprites.delete(id); }
    }
    const ownPlayer = players.get(this.room.sessionId);
    this.zoneChanged(ownPlayer?.mapId === this.mapEntry.id ? ownPlayer.zoneId : '');
    // Never queue movement during automatic reconnection.
    if (!ownPlayer?.connected || ownPlayer.mapId !== this.mapEntry.id || !this.room.connection.isOpen) { this.lastInput = ''; return; }
    const typing = document.activeElement instanceof HTMLElement &&
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    const touchInput = document.hidden ? { x: 0, y: 0 } : this.virtualInput();
    const active = !document.hidden && ((document.hasFocus() && !typing) || touchInput.x !== 0 || touchInput.y !== 0);
    const input: MovementInput = active ? {
      x: Phaser.Math.Clamp(Number(this.keys.D.isDown || this.keys.RIGHT.isDown) - Number(this.keys.A.isDown || this.keys.LEFT.isDown) + touchInput.x, -1, 1),
      y: Phaser.Math.Clamp(Number(this.keys.S.isDown || this.keys.DOWN.isDown) - Number(this.keys.W.isDown || this.keys.UP.isDown) + touchInput.y, -1, 1),
    } : { x: 0, y: 0 };
    this.inputElapsed += delta;
    const serialized = JSON.stringify(input);
    if (serialized !== this.lastInput || this.inputElapsed >= 100) {
      this.room.send('input', input);
      this.lastInput = serialized;
      this.inputElapsed = 0;
    }
  }
}
