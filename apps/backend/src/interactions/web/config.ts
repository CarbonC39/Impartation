import { webToolsConfigSchema, type WebTool, type WorldMap } from '@virtual-workspace/shared';

/** Public launch destinations only; tool authorization stays with the tool. */
export function loadWebTools(raw: string, world: WorldMap | WorldMap[]): WebTool[] {
  const input: unknown = JSON.parse(raw);
  const entries = webToolsConfigSchema.parse(input);
  return Object.entries(entries).map(([resourceId, entry]) => {
    const zones = (Array.isArray(world) ? world : [world]).flatMap(map => map.zones).filter(zone => zone.resourceId === resourceId);
    if (!zones.length || zones.some(zone => zone.kind !== 'web')) {
      throw new Error(`Web tool ${resourceId} must match a web interaction resource`);
    }
    return { resourceId, ...entry };
  });
}
