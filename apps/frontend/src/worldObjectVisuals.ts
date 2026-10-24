import Phaser from 'phaser';
import type { MapObjectState, WorldMap } from '@impartation/shared';

/** Object sprites are keyed by authored IDs. No interaction depends on tile indices. */
export class WorldObjectVisuals {
  private sprites = new Map<string, Phaser.GameObjects.Image>();
  constructor(private scene: Phaser.Scene, private world: WorldMap, private tilesets: Phaser.Tilemaps.Tileset[]) {}

  update(state: MapObjectState | undefined, elapsed = 0) {
    for (const target of this.world.variantTargets) {
      const object = state?.objects.get(target.id);
      const variant = object?.variant;
      const baseGid = object?.variantCleared ? 0 : variant ? target.variants[variant] ?? target.gid : target.gid;
      const existing = this.sprites.get(target.id);
      existing?.setVisible(false);
      if (baseGid === 0) continue;
      const tileset = this.tilesets.find(set => baseGid >= set.firstgid && baseGid < set.firstgid + set.total);
      const gid = tileset?.getAnimatedTileId(baseGid, elapsed) ?? baseGid;
      const coordinates = tileset?.getTileTextureCoordinates(gid);
      if (!tileset?.image || !coordinates || !('x' in coordinates) || !('y' in coordinates) ||
        typeof coordinates.x !== 'number' || typeof coordinates.y !== 'number') continue;
      const texture = this.scene.textures.get(tileset.image.key);
      const frame = `world-variant-${gid}`;
      if (!texture.has(frame)) texture.add(frame, 0, coordinates.x, coordinates.y, tileset.tileWidth, tileset.tileHeight);
      let sprite = this.sprites.get(target.id);
      if (!sprite) {
        sprite = this.scene.add.image(target.x, target.y + target.height, texture.key, frame).setOrigin(0, 1);
        this.sprites.set(target.id, sprite);
      }
      // Above a Y-sorted tile row with the same bottom edge, below the next row.
      sprite.setVisible(true).setTexture(texture.key, frame).setDisplaySize(target.width, target.height).setDepth(target.y + target.height + 0.5);
    }
  }

  destroy() {
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
  }
}
