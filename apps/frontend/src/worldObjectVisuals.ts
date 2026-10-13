import Phaser from 'phaser';
import type { MapObjectState, WorldMap } from '@virtual-workspace/shared';

type OverlayDefinition = {
  width: number; height: number;
  variants: Record<string, { texture: string; url: string; tint?: number }>;
};
// Rendering choices are separate from Tiled semantics and synchronized object state.
// More overlay kinds/variants can be added here without changing interaction rules.
// Action points are invisible anchors. Furniture belongs to authored map visuals.
const overlays: Record<string, OverlayDefinition> = {};

export function preloadObjectVisuals(scene: Phaser.Scene) {
  const loaded = new Set<string>();
  for (const definition of Object.values(overlays)) for (const visual of Object.values(definition.variants)) {
    if (loaded.has(visual.texture)) continue;
    scene.load.svg(visual.texture, visual.url);
    loaded.add(visual.texture);
  }
}

/** Object sprites are keyed by authored IDs. No interaction depends on tile indices. */
export class WorldObjectVisuals {
  private sprites = new Map<string, Phaser.GameObjects.Image>();
  constructor(private scene: Phaser.Scene, private world: WorldMap) {}

  update(state: MapObjectState | undefined) {
    for (const object of [...this.world.zones, ...this.world.actions]) {
      const definition = overlays[object.kind];
      const visual = definition?.variants[state?.objects.get(object.id)?.variant ?? ''];
      let sprite = this.sprites.get(object.id);
      if (!definition || !visual) { sprite?.setVisible(false); continue; }
      if (!sprite) {
        sprite = this.scene.add.image(object.x, object.y, visual.texture).setOrigin(0.5, 1)
          .setDisplaySize(definition.width, definition.height).setDepth(object.y - 0.5);
        this.sprites.set(object.id, sprite);
      }
      sprite.setTexture(visual.texture).setDisplaySize(definition.width, definition.height)
        .setVisible(true).setTint(visual.tint ?? 0xffffff);
    }
  }

  destroy() {
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
  }
}
