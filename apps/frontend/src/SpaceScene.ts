import Phaser from 'phaser';
import type { Room } from '@colyseus/sdk';
import type { SpaceRoom } from '@virtual-workspace/backend/rooms/SpaceRoom';
import { PLAYER_RADIUS, TICK_MS, type WorldMap, type MovementInput } from '@virtual-workspace/shared';

const colors: Record<string, number> = { mint: 0x88dbb4, amber: 0xefbd65, violet: 0xbb9de8 };

type Sprite = { circle: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text };

export class SpaceScene extends Phaser.Scene {
  private sprites = new Map<string, Sprite>();
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private inputElapsed = 0;
  private lastInput = '';

  constructor(private room: Room<SpaceRoom>, private world: WorldMap, private zoneChanged: (id: string) => void) {
    super('space');
  }
  preload() {
    this.load.tilemapTiledJSON('lobby', '/maps/lobby.tmj');
    this.load.image('tiles', '/maps/tiles.png');
  }
  create() {
    const map = this.make.tilemap({ key: 'lobby' });
    const tiles = map.addTilesetImage('basic', 'tiles');
    if (!tiles || !map.createLayer('ground', tiles)) throw new Error('Unable to render Tiled ground layer');
    for (const zone of this.world.zones) {
      this.add.rectangle(zone.x, zone.y, zone.width, zone.height, 0xd5d080, 0.15)
        .setOrigin(0).setStrokeStyle(1, 0xd5d080, 0.6);
      this.add.text(zone.x + 8, zone.y + 8, zone.kind, { fontSize: '14px', color: '#eeefd9' });
    }
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>;
    const stop = () => {
      if (this.room.connection.isOpen) this.room.send('input', { x: 0, y: 0 });
    };
    window.addEventListener('blur', stop);
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', visibility);
    this.events.once('shutdown', () => {
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', visibility);
    });
  }
  update(_time: number, delta: number) {
    const players = this.room.state?.players;
    if (!players) return;
    for (const [id, player] of players) {
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
      sprite.label.setPosition(sprite.circle.x, sprite.circle.y - 22);
    }
    for (const [id, sprite] of this.sprites) {
      if (!players.has(id)) { sprite.circle.destroy(); sprite.label.destroy(); this.sprites.delete(id); }
    }
    const ownPlayer = players.get(this.room.sessionId);
    this.zoneChanged(ownPlayer?.zoneId ?? '');
    // Never queue movement during automatic reconnection.
    if (!ownPlayer?.connected || !this.room.connection.isOpen) { this.lastInput = ''; return; }
    const typing = document.activeElement instanceof HTMLElement &&
      ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement.tagName);
    const active = !typing && document.hasFocus() && !document.hidden;
    const input: MovementInput = active ? {
      x: Number(this.keys.D.isDown || this.keys.RIGHT.isDown) - Number(this.keys.A.isDown || this.keys.LEFT.isDown),
      y: Number(this.keys.S.isDown || this.keys.DOWN.isDown) - Number(this.keys.W.isDown || this.keys.UP.isDown),
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
