import { externalToolsConfigSchema, type ExternalTool, type WorldMap } from '@virtual-workspace/shared';

/** Public launch destinations only; tool authorization stays with the tool. */
export function loadExternalTools(raw: string, world: WorldMap): ExternalTool[] {
  const input: unknown = JSON.parse(raw);
  const entries = externalToolsConfigSchema.parse(input);
  return Object.entries(entries).map(([resourceId, entry]) => {
    const zones = world.zones.filter(zone => zone.resourceId === resourceId);
    if (!zones.length || zones.some(zone => zone.kind !== entry.kind)) {
      throw new Error(`External tool ${resourceId} must match a map resource of kind ${entry.kind}`);
    }
    return { resourceId, ...entry };
  });
}
