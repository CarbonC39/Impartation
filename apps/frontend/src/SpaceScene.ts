import Phaser from 'phaser';
import type { Room } from '@colyseus/sdk';
import { APPEARANCE_ASSETS, APPEARANCE_LAYERS, ATTACHMENTS, TICK_MS, attachmentSource, attachmentSourceKey, type AttachmentId, type SpaceProtocol, type RegisteredMap, type MovementInput } from '@impartation/shared';
import { avatarDefinition, characterAppearance, characterFacing, characterFrame, layerAssetIds, layerAssets, tintNumber } from './characters';
import { WorldObjectVisuals } from './worldObjectVisuals';
import { CharacterStatus, preloadStatusTextures, prepareStatusTextures } from './characterStatus';
import { cameraZoom } from './cameraZoom';

type PlayerVisual = { sprite: Phaser.GameObjects.Sprite; layers: Phaser.GameObjects.Sprite[]; attachment: Phaser.GameObjects.Sprite; status: CharacterStatus;
  animation: string; elapsed: number };
type ChatBubble = { text: string; expiresAt: number };
export type SceneHooks = {
  connected(): boolean;
  zoneChanged(id: string): void;
  activate(): void;
  virtualInput(): MovementInput;
  /** Local display preference; read every frame so toggling needs no scene restart. */
  namesVisible(): boolean;
  /** Whether this browser currently hears the player talking (or is itself talking, unmuted). */
  speaking(sessionId: string): boolean;
};
const BUBBLE_MS = 5000;
const BUBBLE_CHARS = 60;
let privateAreaMaskSequence = 0;

export class SpaceScene extends Phaser.Scene {
  private sprites = new Map<string, PlayerVisual>();
  private objectVisuals?: WorldObjectVisuals;
  private attachmentSourceLayers = new Map<string, Phaser.Tilemaps.TilemapLayer | Phaser.Tilemaps.TilemapGPULayer>();
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private inputElapsed = 0;
  private lastInput = '';
  private bubbles = new Map<string, ChatBubble>();
  private tileWidth = 16;
  private tileHeight = 16;
  private privateAreaMask?: Phaser.GameObjects.Image;
  private privateAreaMaskCanvas?: Phaser.Textures.CanvasTexture;
  private privateAreaMaskTexture = '';
  private displayedPrivateArea = '';
  private privateAreaMaskTarget = 0;
  private animationElapsed = 0;
  private canvasTiles: { tile: Phaser.Tilemaps.Tile; gid: number; tileset: Phaser.Tilemaps.Tileset }[] = [];

  constructor(private room: Room<SpaceProtocol>, private mapEntry: RegisteredMap,
    private renderMap: { tilesets: { name: string; image?: string }[] }, private hooks: SceneHooks) {
    super('space');
  }
  /** Show a short-lived speech bubble; plain text only, so markup is never interpreted. */
  showBubble(sessionId: string, text: string) {
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
    for (const [id, asset] of Object.entries(ATTACHMENTS))
      this.load.spritesheet(`attachment:${id}`, asset.path, { frameWidth: avatar.frameWidth, frameHeight: avatar.frameHeight });
    preloadStatusTextures(this);
  }
  create() {
    prepareStatusTextures(this);
    const map = this.make.tilemap({ key: 'world' });
    this.tileWidth = map.tileWidth;
    this.tileHeight = map.tileHeight;
    const zoom = cameraZoom(this.tileWidth, this.tileHeight);
    this.cameras.main.setZoom(zoom);
    const tiles = this.renderMap.tilesets.flatMap((tileset, index) => {
      if (!tileset.image) return [];
      const result = map.addTilesetImage(tileset.name, `tiles-${index}`);
      return result ? [result] : [];
    });
    // Phaser 4 animates WebGL tile layers natively; its Canvas renderer needs frame indices.
    const trackCanvasAnimations = (rendered: Phaser.Tilemaps.TilemapLayer | Phaser.Tilemaps.TilemapGPULayer) => {
      if (this.game.renderer.type !== Phaser.CANVAS) return;
      rendered.forEachTile(tile => {
        const tileset = tiles.find(set => set.containsTileIndex(tile.index));
        const data: unknown = tileset?.getTileData(tile.index);
        if (tileset && data && typeof data === 'object' && 'animation' in data) this.canvasTiles.push({ tile, gid: tile.index, tileset });
      });
    };
    // Blank row layers are appended to map.layers, so only visit the authored layers.
    for (const [index, layer] of [...map.layers].entries()) {
      const enabled = (name: string) => layer.properties.some(property =>
        'name' in property && property.name === name && 'value' in property && property.value === true);
      if (enabled('ySort')) {
        for (const [row, cells] of layer.data.entries()) {
          if (!cells.some(tile => tile && tile.index >= 0)) continue;
          const sorted = map.createBlankLayer(`__ySort_${index}_${row}`, tiles,
            layer.x, layer.y + row * map.tileHeight, layer.width, 1);
          if (!sorted) throw new Error(`Unable to render Y-sorted Tiled layer: ${layer.name}`);
          for (const [column, tile] of cells.entries()) {
            if (tile && tile.index >= 0) sorted.putTileAt(tile, column, 0, false);
          }
          sorted.setAlpha(layer.alpha).setVisible(layer.visible)
            .setDepth(layer.y + (row + 1) * map.tileHeight + index * 0.001);
          trackCanvasAnimations(sorted);
        }
        continue;
      }
      const rendered = map.createLayer(layer.name, tiles);
      if (!rendered) throw new Error(`Unable to render Tiled layer: ${layer.name}`);
      trackCanvasAnimations(rendered);
      // Tiled custom properties survive Phaser's tile layer parser, including grouped layers.
      if (enabled('abovePlayers')) {
        rendered.setDepth(this.mapEntry.world.height + 3 + index);
      }
    }
    for (const zone of this.mapEntry.world.zones) {
      if (zone.kind !== 'attachment') continue;
      const { visualGid, visualX, visualY } = attachmentSource(zone);
      if (visualGid === undefined || visualX === undefined || visualY === undefined) continue;
      const visual = map.createBlankLayer(`__attachment_${zone.id}`, tiles, 0, 0, map.width, map.height);
      if (!visual) throw new Error(`Unable to render attachment source: ${zone.id}`);
      visual.putTileAt(visualGid, visualX / map.tileWidth, visualY / map.tileHeight);
      visual.setDepth(0.01);
      trackCanvasAnimations(visual);
      this.attachmentSourceLayers.set(zone.id, visual);
    }
    this.privateAreaMaskTexture = `private-area-mask:${this.mapEntry.id}:${++privateAreaMaskSequence}`;
    this.objectVisuals = new WorldObjectVisuals(this, this.mapEntry.world, tiles);
    this.cameras.main.setBounds(0, 0, this.mapEntry.world.width, this.mapEntry.world.height);
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT,E', false) as Record<string, Phaser.Input.Keyboard.Key>;
    const canvas = this.game.canvas;
    canvas.tabIndex = 0;
    canvas.dataset.mapId = this.mapEntry.id;
    const focusCanvas = () => canvas.focus();
    canvas.addEventListener('pointerdown', focusCanvas);
    const stop = () => {
      if (this.hooks.connected() && this.room.connection.isOpen) this.room.send('input', { x: 0, y: 0 });
    };
    window.addEventListener('blur', stop);
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', visibility);
    this.events.once('shutdown', () => {
      this.objectVisuals?.destroy();
      this.privateAreaMask?.destroy();
      this.privateAreaMask = undefined;
      this.privateAreaMaskCanvas = undefined;
      if (this.privateAreaMaskTexture && this.textures.exists(this.privateAreaMaskTexture)) this.textures.remove(this.privateAreaMaskTexture);
      this.attachmentSourceLayers.clear();
      this.canvasTiles = [];
      canvas.removeEventListener('pointerdown', focusCanvas);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', visibility);
    });
  }
  refreshCameraZoom() {
    const zoom = cameraZoom(this.tileWidth, this.tileHeight);
    this.cameras.main.setZoom(zoom);
    for (const sprite of this.sprites.values()) sprite.status.setZoom(zoom);
  }
  stopInput() {
    this.input?.keyboard?.resetKeys();
    this.lastInput = '';
    this.inputElapsed = 0;
  }
  update(time: number, delta: number) {
    this.animationElapsed += delta;
    for (const { tile, gid, tileset } of this.canvasTiles) tile.index = tileset.getAnimatedTileId(gid, this.animationElapsed) ?? gid;
    const players = this.room.state?.players;
    if (!players) return;
    this.objectVisuals?.update(this.room.state.worldObjects.get(this.mapEntry.id), this.animationElapsed);
    for (const [sourceId, layer] of this.attachmentSourceLayers)
      layer.setVisible(!this.room.state.attachmentSources.get(attachmentSourceKey(this.mapEntry.id, sourceId))?.holder);
    const namesVisible = this.hooks.namesVisible();
    for (const [id, player] of players) {
      if (player.mapId !== this.mapEntry.id) continue;
      let sprite = this.sprites.get(id);
      if (!sprite) {
        const avatar = avatarDefinition(player.avatar);
        const layers = APPEARANCE_LAYERS.map(() => this.add.sprite(player.x, player.y, APPEARANCE_ASSETS.body[0])
          .setOrigin(avatar.groundAnchor.x / avatar.frameWidth, avatar.groundAnchor.y / avatar.frameHeight));
        const character = layers[0]!.setName(id);
        const attachment = this.add.sprite(player.x, player.y, APPEARANCE_ASSETS.body[0])
          .setOrigin(avatar.groundAnchor.x / avatar.frameWidth, avatar.groundAnchor.y / avatar.frameHeight).setVisible(false);
        if (id === this.room.sessionId) this.cameras.main.startFollow(character, true);
        const status = new CharacterStatus(this, id, id === this.room.sessionId, this.cameras.main.zoom);
        sprite = { sprite: character, layers, attachment, status, animation: '', elapsed: 0 };
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
      const attachmentId = player.attachmentId as AttachmentId;
      const asset = ATTACHMENTS[attachmentId];
      sprite.attachment.setVisible(Boolean(asset));
      if (asset) sprite.attachment.setTexture(`attachment:${attachmentId}`, renderedFrame)
        .setPosition(sprite.sprite.x, sprite.sprite.y).setAlpha(player.connected ? 1 : 0.35)
        .setDepth(sprite.sprite.y + APPEARANCE_LAYERS.length * 0.001);
      sprite.status.update(sprite.sprite.x, sprite.sprite.y + 1, sprite.sprite.y - avatar.groundAnchor.y - 1, {
        name: player.name, nameVisible: namesVisible, connected: player.connected,
        bubble: this.bubbles.get(id)?.text,
        typing: player.connected && player.typing && id !== this.room.sessionId,
        speaking: player.connected && this.hooks.speaking(id),
      }, time, this.mapEntry.world.height + 1);
    }
    const now = performance.now();
    for (const [id, bubble] of this.bubbles) {
      const visible = players.get(id)?.mapId === this.mapEntry.id;
      if (bubble.expiresAt <= now || !visible) this.bubbles.delete(id);
    }
    for (const [id, sprite] of this.sprites) {
      if (!players.has(id) || players.get(id)?.mapId !== this.mapEntry.id) {
        for (const layer of sprite.layers) layer.destroy();
        sprite.attachment.destroy();
        sprite.status.destroy();
        this.sprites.delete(id);
        this.bubbles.delete(id);
      }
    }
    const ownPlayer = players.get(this.room.sessionId);
    const zoneId = ownPlayer?.mapId === this.mapEntry.id ? ownPlayer.zoneId : '';
    this.hooks.zoneChanged(zoneId);
    this.updatePrivateAreaMask(ownPlayer?.mapId === this.mapEntry.id ? ownPlayer.privateAreaId : '', delta);
    const activatePressed = Phaser.Input.Keyboard.JustDown(this.keys.E);
    // Never queue movement during automatic reconnection.
    if (!this.hooks.connected() || !ownPlayer?.connected || ownPlayer.mapId !== this.mapEntry.id || !this.room.connection.isOpen) {
      this.lastInput = ''; this.inputElapsed = 0; this.input.keyboard?.resetKeys(); return;
    }
    const focused = document.activeElement;
    const typing = focused instanceof HTMLElement &&
      (['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName) || focused.isContentEditable) &&
      !(focused instanceof HTMLInputElement && focused.type === 'checkbox');
    const touchInput = document.hidden ? { x: 0, y: 0 } : this.hooks.virtualInput();
    const keyboard = document.body.classList.contains('map-open') && !document.hidden && document.hasFocus() && !typing;
    const active = keyboard || (!document.hidden && (touchInput.x !== 0 || touchInput.y !== 0));
    if (keyboard && activatePressed) this.hooks.activate();
    const key = (letter: string, arrow: string) => keyboard && (this.keys[letter]!.isDown || this.keys[arrow]!.isDown);
    const input: MovementInput = active ? {
      x: Phaser.Math.Clamp(Number(key('D', 'RIGHT')) - Number(key('A', 'LEFT')) + touchInput.x, -1, 1),
      y: Phaser.Math.Clamp(Number(key('S', 'DOWN')) - Number(key('W', 'UP')) + touchInput.y, -1, 1),
    } : { x: 0, y: 0 };
    this.inputElapsed += delta;
    const serialized = JSON.stringify(input);
    if (serialized !== this.lastInput || this.inputElapsed >= 100) {
      this.room.send('input', input);
      this.lastInput = serialized;
      this.inputElapsed = 0;
    }
  }
  private updatePrivateAreaMask(privateAreaId: string, delta: number) {
    if (privateAreaId !== this.displayedPrivateArea) {
      this.displayedPrivateArea = privateAreaId;
      const area = privateAreaId && this.mapEntry.world.zones.find(zone => zone.kind === 'privateArea' && zone.id === privateAreaId);
      if (!area) {
        this.privateAreaMaskTarget = 0;
      } else {
        this.privateAreaMaskCanvas ??= this.textures.createCanvas(this.privateAreaMaskTexture,
          this.mapEntry.world.width, this.mapEntry.world.height) ?? undefined;
        const texture = this.privateAreaMaskCanvas;
        if (!texture) {
          this.privateAreaMaskTarget = 0;
        } else {
          const context = texture.getContext();
          context.clearRect(0, 0, this.mapEntry.world.width, this.mapEntry.world.height);
          context.fillStyle = 'rgba(0, 0, 0, 0.48)';
          context.beginPath();
          context.rect(0, 0, this.mapEntry.world.width, this.mapEntry.world.height);
          if (area.polygon) {
            context.moveTo(area.polygon[0]!.x, area.polygon[0]!.y);
            for (const point of area.polygon.slice(1)) context.lineTo(point.x, point.y);
            context.closePath();
          } else {
            context.rect(area.x, area.y, area.width, area.height);
          }
          context.fill('evenodd');
          texture.refresh();
          this.privateAreaMask ??= this.add.image(0, 0, this.privateAreaMaskTexture).setName('private-area-mask')
            .setOrigin(0).setDepth(Number.MAX_SAFE_INTEGER).setAlpha(0);
          this.privateAreaMask.setVisible(true);
          this.privateAreaMaskTarget = 1;
        }
      }
    }
    const mask = this.privateAreaMask;
    if (!mask || mask.alpha === this.privateAreaMaskTarget) return;
    const distance = this.privateAreaMaskTarget - mask.alpha;
    const step = delta / 240;
    const alpha = Math.abs(distance) <= step ? this.privateAreaMaskTarget : mask.alpha + Math.sign(distance) * step;
    mask.setAlpha(alpha);
    if (alpha === 0) mask.setVisible(false);
  }
}
