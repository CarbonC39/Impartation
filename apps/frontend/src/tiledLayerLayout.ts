import { z } from 'zod';

type Layer = {
  name: string; type: string; x: number; y: number; offsetx: number; offsety: number; layers: Layer[];
};
const layersSchema: z.ZodType<Layer[]> = z.array(z.object({
  name: z.string(), type: z.string(), x: z.number().finite().default(0), y: z.number().finite().default(0),
  offsetx: z.number().finite().default(0), offsety: z.number().finite().default(0),
  layers: z.lazy(() => layersSchema).default([]),
}));

/** Resolve tile-unit origins and cumulative pixel offsets into world coordinates. */
export function tiledLayerLayout(raw: unknown, tileWidth: number, tileHeight: number) {
  const result = new Map<string, { x: number; y: number }>();
  const visit = (layers: Layer[], prefix: string, x: number, y: number) => {
    for (const layer of layers) {
      const name = prefix + layer.name;
      const originX = layer.x * (layer.type === 'tilelayer' ? tileWidth : 1);
      const originY = layer.y * (layer.type === 'tilelayer' ? tileHeight : 1);
      const position = { x: x + originX + layer.offsetx, y: y + originY + layer.offsety };
      if (layer.type === 'group') visit(layer.layers, `${name}/`, position.x, position.y);
      if (layer.type === 'tilelayer') result.set(name, position);
    }
  };
  visit(layersSchema.parse(raw), '', 0, 0);
  return result;
}
