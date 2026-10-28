import Phaser from 'phaser';

type Fragment = { image: Phaser.GameObjects.Image; crop: [number, number, number, number] };
type AnimatedTile = { tileset: Phaser.Tilemaps.Tileset; gid: number; displayed: number; fragments: Fragment[] };

/** Clip to world-space bands so overlapping layers keep Tiled order on both sides of a row boundary. */
export class YSortedTiles {
  private images: Phaser.GameObjects.Image[] = [];
  private animated: AnimatedTile[] = [];

  constructor(private scene: Phaser.Scene, private bandHeight: number) {}

  private frame(tileset: Phaser.Tilemaps.Tileset, gid: number) {
    const coordinates = tileset.getTileTextureCoordinates(gid);
    if (!tileset.image || !coordinates || !('x' in coordinates) || !('y' in coordinates)
      || typeof coordinates.x !== 'number' || typeof coordinates.y !== 'number')
      throw new Error(`Unable to render Y-sorted tile: ${gid}`);
    const texture = this.scene.textures.get(tileset.image.key);
    const name = `y-sort:${tileset.firstgid}:${gid}`;
    if (!texture.has(name)) texture.add(name, 0, coordinates.x, coordinates.y, tileset.tileWidth, tileset.tileHeight);
    return { texture: texture.key, name };
  }

  add(layer: Phaser.Tilemaps.LayerData, tilesets: Phaser.Tilemaps.Tileset[], order: number, sortOffsetY: number) {
    for (const [row, cells] of layer.data.entries()) for (const [column, tile] of cells.entries()) {
      if (!tile || tile.index < 0) continue;
      const tileset = tilesets.find(set => set.containsTileIndex(tile.index));
      if (!tileset) throw new Error(`Missing tileset for Y-sorted tile: ${tile.index}`);
      const width = tileset.tileWidth;
      const height = tileset.tileHeight;
      const cx = layer.x + column * layer.tileWidth + width / 2 + tileset.tileOffset.x;
      const cy = layer.y + (row + 1) * layer.tileHeight - height / 2 + tileset.tileOffset.y;
      // Tiled flip flags only produce quarter-turn rotations. Crop coordinates are in
      // the displayed image before rotation; Phaser handles mirrored UVs for flipX/Y.
      const sin = Math.round(Math.sin(tile.rotation));
      const cos = Math.round(Math.cos(tile.rotation));
      const halfHeight = (Math.abs(sin) * width + Math.abs(cos) * height) / 2;
      const first = Math.floor((cy - halfHeight) / this.bandHeight);
      const last = Math.ceil((cy + halfHeight) / this.bandHeight) - 1;
      const fragments: Fragment[] = [];
      const frame = this.frame(tileset, tile.index);
      for (let band = first; band <= last; band++) {
        const top = Math.max(cy - halfHeight, band * this.bandHeight);
        const bottom = Math.min(cy + halfHeight, (band + 1) * this.bandHeight);
        const crop: Fragment['crop'] = cos !== 0
          ? [0, (cos > 0 ? top - cy : cy - bottom) + height / 2, width, bottom - top]
          : [(sin > 0 ? top - cy : cy - bottom) + width / 2, 0, bottom - top, height];
        const image = this.scene.add.image(cx, cy, frame.texture, frame.name)
          .setName(`__ySort_${layer.name}_${row}_${column}_${band}`)
          .setRotation(tile.rotation).setFlip(tile.flipX, tile.flipY)
          .setAlpha(layer.alpha * tile.alpha).setVisible(layer.visible && tile.visible)
          .setTint(tile.tint).setCrop(...crop)
          .setDepth((band + 1) * this.bandHeight + sortOffsetY + order * 0.001);
        this.images.push(image);
        fragments.push({ image, crop });
      }
      const data: unknown = tileset.getTileData(tile.index);
      if (data && typeof data === 'object' && 'animation' in data)
        this.animated.push({ tileset, gid: tile.index, displayed: tile.index, fragments });
    }
  }

  update(elapsed: number) {
    for (const tile of this.animated) {
      const gid = tile.tileset.getAnimatedTileId(tile.gid, elapsed) ?? tile.gid;
      if (gid === tile.displayed) continue;
      const frame = this.frame(tile.tileset, gid);
      for (const { image, crop } of tile.fragments) image.setTexture(frame.texture, frame.name).setCrop(...crop);
      tile.displayed = gid;
    }
  }

  destroy() {
    for (const image of this.images) image.destroy();
    this.images = [];
    this.animated = [];
  }
}
