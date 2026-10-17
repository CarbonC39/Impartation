import Phaser from 'phaser';
import type { Room } from '@colyseus/sdk';
import { APPEARANCE_ASSETS, APPEARANCE_LAYERS, TICK_MS, type SpaceProtocol, type RegisteredMap, type MovementInput } from '@virtual-workspace/shared';
import { zoneLabels } from './interactions/labels';
import { avatarDefinition, characterAppearance, characterFacing, characterFrame, layerAssetIds, layerAssets, tintNumber } from './characters';
import { preloadObjectVisuals, WorldObjectVisuals } from './worldObjectVisuals';

type PlayerVisual = { sprite: Phaser.GameObjects.Sprite; layers: Phaser.GameObjects.Sprite[];
  label: Phaser.GameObjects.Text; animation: string; elapsed: number };
type ChatBubble = { text: string; expiresAt: number; view?: Phaser.GameObjects.Text };
export type ScreenPoint = { x: number; y: number };
export type SceneHooks = {
  zoneChanged(id: string): void;
  /** Screen position (canvas pixels) of the top edge of the player's current zone. */
  zoneAnchor(point: ScreenPoint | undefined): void;
  activate(): void;
  virtualInput(): MovementInput;
};
const BUBBLE_MS = 5000;
const BUBBLE_CHARS = 60;

export class SpaceScene extends Phaser.Scene {
  private sprites = new Map<string, PlayerVisual>();
  private objectVisuals?: WorldObjectVisuals;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private inputElapsed = 0;
  private lastInput = '';
  private bubbles = new Map<string, ChatBubble>();
  private lastAnchor = '';

  constructor(private room: Room<SpaceProtocol>, private mapEntry: RegisteredMap,
    private renderMap: { tilesets: { name: string; image?: string }[] }, private hooks: SceneHooks) {
    super('space');
  }
  /** Show a short-lived speech bubble; plain text only, so markup is never interpreted. */
  showBubble(sessionId: string, text: string) {
    this.bubbles.get(sessionId)?.view?.destroy();
    const chars = [...text.replace(/\s+/g, ' ')];
    const clipped = chars.length > BUBBLE_CHARS ? `${chars.slice(0, BUBBLE_CHARS).join('')}…` : chars.join('');
    this.bubbles.set(sessionId, { text: clipped, expiresAt: performance.now() + BUBBLE_MS });
  }
  preload() {
    this.cache.tilemap.add('world', { format: Phaser.Tilemaps.Formats.TILED_JSON, data: this.renderMap });
    for (const [index, tileset] of this.renderMap.tilesets.entries()) {
      if (tileset.image) this.load.image(`tiles-${index}`, tileset.image);
    }
    const avatar = avatarDefinition('mint');
    for (const id of layerAssetIds) {
      this.load.spritesheet(id, layerAssets[id], { frameWidth: avatar.frameWidth, frameHeight: avatar.frameHeight });
    }
    preloadObjectVisuals(this);
  }
  create() {
    const map = this.make.tilemap({ key: 'world' });
    // A display preference, independent of tile dimensions and simulation units.
    const configuredZoom = Number(import.meta.env.VITE_CAMERA_ZOOM ?? 2);
    const zoom = Number.isFinite(configuredZoom) && configuredZoom > 0 ? configuredZoom : 2;
    this.cameras.main.setZoom(zoom);
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
      this.add.text(zone.x + 8, zone.y + 8, zoneLabels[zone.kind] ?? zone.kind, { fontSize: '14px', color: '#eeefd9' })
        .setScale(1 / zoom);
    }
    this.objectVisuals = new WorldObjectVisuals(this, this.mapEntry.world);
    this.cameras.main.setBounds(0, 0, this.mapEntry.world.width, this.mapEntry.world.height);
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT,E', false) as Record<string, Phaser.Input.Keyboard.Key>;
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
      this.objectVisuals?.destroy();
      this.hooks.zoneAnchor(undefined);
      canvas.removeEventListener('pointerdown', focusCanvas);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', visibility);
    });
  }
  update(_time: number, delta: number) {
    const players = this.room.state?.players;
    if (!players) return;
    this.objectVisuals?.update(this.room.state.worldObjects.get(this.mapEntry.id));
    for (const [id, player] of players) {
      if (player.mapId !== this.mapEntry.id) continue;
      let sprite = this.sprites.get(id);
      if (!sprite) {
        const avatar = avatarDefinition(player.avatar);
        const layers = APPEARANCE_LAYERS.map(() => this.add.sprite(player.x, player.y, APPEARANCE_ASSETS.body[0])
          .setOrigin(avatar.groundAnchor.x / avatar.frameWidth, avatar.groundAnchor.y / avatar.frameHeight));
        const character = layers[0]!.setName(id);
        if (id === this.room.sessionId) this.cameras.main.startFollow(character, true);
        const label = this.add.text(player.x, player.y - avatar.groundAnchor.y - 4, player.name,
          { fontSize: '12px', color: id === this.room.sessionId ? '#fff2a3' : '#ffffff' })
          .setOrigin(0.5, 1).setScale(1 / this.cameras.main.zoom);
        sprite = { sprite: character, layers, label, animation: '', elapsed: 0 };
        this.sprites.set(id, sprite);
      }
      const blend = Math.min(1, delta / TICK_MS);
      // Active actions snap to their ground anchor; walking interpolates patch positions.
      sprite.sprite.x = player.action !== 'none' ? player.x : Phaser.Math.Linear(sprite.sprite.x, player.x, blend);
      sprite.sprite.y = player.action !== 'none' ? player.y : Phaser.Math.Linear(sprite.sprite.y, player.y, blend);
      const avatar = avatarDefinition(player.avatar);
      const facing = characterFacing(player.facing);
      const motion = player.motion === 'walk' ? 'walk' : 'idle';
      const action = player.action;
      const animation = `${player.avatar}:${facing}:${motion}:${action}:${player.actionAnimated}`;
      sprite.elapsed = animation === sprite.animation ? sprite.elapsed + delta : 0;
      sprite.animation = animation;
      const frame = characterFrame(player.avatar, facing, motion, action, player.actionAnimated, sprite.elapsed);
      const renderedFrame = this.textures.get(APPEARANCE_ASSETS.body[0]).has(String(frame)) ? frame : avatar.idle[facing];
      const appearance = characterAppearance(player.appearance);
      for (const [index, layer] of APPEARANCE_LAYERS.entries()) {
        const part = appearance[layer];
        const layerSprite = sprite.layers[index]!;
        if (part.assetId === 'none') { layerSprite.setVisible(false); continue; }
        layerSprite.setVisible(true).setTexture(part.assetId, renderedFrame).setTint(tintNumber(part.color))
          .setPosition(sprite.sprite.x, sprite.sprite.y).setAlpha(player.connected ? 1 : 0.35)
          .setDepth(sprite.sprite.y + index * 0.001);
      }
      const name = action === 'sit' ? `${player.name} · 坐` : player.name;
      if (sprite.label.text !== name) sprite.label.setText(name);
      sprite.label.setPosition(sprite.sprite.x, sprite.sprite.y - avatar.groundAnchor.y - 4).setDepth(this.mapEntry.world.height + 1);
      this.updateBubble(id, sprite.label);
    }
    const now = performance.now();
    for (const [id, bubble] of this.bubbles) {
      const visible = players.get(id)?.mapId === this.mapEntry.id;
      if (bubble.expiresAt <= now || !visible) { bubble.view?.destroy(); this.bubbles.delete(id); }
    }
    for (const [id, sprite] of this.sprites) {
      if (!players.has(id) || players.get(id)?.mapId !== this.mapEntry.id) {
        for (const layer of sprite.layers) layer.destroy();
        sprite.label.destroy(); this.sprites.delete(id);
        this.bubbles.get(id)?.view?.destroy(); this.bubbles.delete(id);
      }
    }
    const ownPlayer = players.get(this.room.sessionId);
    const zoneId = ownPlayer?.mapId === this.mapEntry.id ? ownPlayer.zoneId : '';
    this.hooks.zoneChanged(zoneId);
    this.updateZoneAnchor(zoneId);
    const activatePressed = Phaser.Input.Keyboard.JustDown(this.keys.E);
    // Never queue movement during automatic reconnection.
    if (!ownPlayer?.connected || ownPlayer.mapId !== this.mapEntry.id || !this.room.connection.isOpen) { this.lastInput = ''; return; }
    const typing = document.activeElement instanceof HTMLElement &&
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) &&
      !(document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'checkbox');
    const touchInput = document.hidden ? { x: 0, y: 0 } : this.hooks.virtualInput();
    const active = !document.hidden && ((document.hasFocus() && !typing) || touchInput.x !== 0 || touchInput.y !== 0);
    if (active && !typing && activatePressed) this.hooks.activate();
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
  private updateBubble(id: string, label: Phaser.GameObjects.Text) {
    const bubble = this.bubbles.get(id);
    if (!bubble) return;
    bubble.view ??= this.add.text(0, 0, bubble.text, {
      fontSize: '12px', color: '#25384c', backgroundColor: '#fffdf4e6', padding: { x: 6, y: 3 },
      align: 'center', wordWrap: { width: 180, useAdvancedWrap: true },
    }).setOrigin(0.5, 1).setScale(1 / this.cameras.main.zoom);
    bubble.view.setPosition(label.x, label.y - label.displayHeight - 2).setDepth(this.mapEntry.world.height + 2);
  }
  private updateZoneAnchor(zoneId: string) {
    const zone = zoneId ? this.mapEntry.world.zones.find(item => item.id === zoneId) : undefined;
    const camera = this.cameras.main;
    const point = zone && {
      x: Math.round(Phaser.Math.Clamp((zone.x + zone.width / 2 - camera.worldView.x) * camera.zoom, 0, camera.width)),
      y: Math.round(Phaser.Math.Clamp((zone.y - camera.worldView.y) * camera.zoom, 0, camera.height)),
    };
    const key = point ? `${point.x},${point.y}` : '';
    if (key === this.lastAnchor) return;
    this.lastAnchor = key;
    this.hooks.zoneAnchor(point);
  }
}
