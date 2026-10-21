import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

type JsonObject = Record<string, unknown>;
type TiledProperty = { name: string; type?: string; propertytype?: string; value?: unknown };
type PropertyType = { name: string; type: string; members?: TiledProperty[]; values?: string[]; storageType?: string };

const recordSchema = z.record(z.string(), z.unknown());
const propertySchema = z.object({ name: z.string().min(1), type: z.string().optional(), propertytype: z.string().optional(), value: z.unknown().optional() }).passthrough();
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const record = (value: unknown, message: string): JsonObject => {
  const result = recordSchema.safeParse(value);
  if (!result.success) throw new Error(message);
  return result.data;
};
const own = (value: JsonObject, key: string): boolean => Object.hasOwn(value, key);
const tiledPropertyType = (property: TiledProperty): string => property.type ?? 'string';

function readJson(path: string, kind: string): JsonObject {
  try {
    return record(JSON.parse(readFileSync(path, 'utf8')) as unknown, `Invalid Tiled ${kind}: ${path}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid Tiled')) throw error;
    throw new Error(`Unable to read Tiled ${kind} ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveReference(baseFile: string, reference: string, kind: string): string {
  if (!reference.trim()) throw new Error(`Tiled ${kind} path must not be empty`);
  const path = resolve(dirname(baseFile), reference);
  return path;
}

function parseProperties(value: unknown, context: string): TiledProperty[] {
  const properties = z.array(propertySchema).safeParse(value ?? []);
  if (!properties.success) throw new Error(`Invalid Tiled properties on ${context}: ${properties.error.message}`);
  const seen = new Set<string>();
  for (const property of properties.data) {
    if (seen.has(property.name)) throw new Error(`Duplicate Tiled property "${property.name}" on ${context}`);
    seen.add(property.name);
  }
  return properties.data;
}

function mergeProperties(classes: Map<string, PropertyType>, context: string, ...groups: TiledProperty[][]): TiledProperty[] {
  const merged = new Map<string, TiledProperty>();
  for (const group of groups) for (const property of group) {
    const previous = merged.get(property.name);
    if (previous && tiledPropertyType(property) === 'class' && tiledPropertyType(previous) === 'class'
      && previous.propertytype === property.propertytype) {
      merged.set(property.name, { ...property, value: mergeTypedValue(previous.value, property.value, 'class', property.propertytype,
        classes, `${context}.${property.name}`, []) });
    } else merged.set(property.name, property);
  }
  return [...merged.values()];
}

function mergeTypedValue(defaultValue: unknown, overrideValue: unknown, type: string, propertytype: string | undefined,
                         classes: Map<string, PropertyType>, context: string, path: string[]): unknown {
  if (type !== 'class') return overrideValue;
  const base = defaultValue === undefined ? {} : record(defaultValue, `Invalid class defaults on ${context}`);
  const override = overrideValue === undefined ? {} : record(overrideValue, `Invalid class value on ${context}`);
  return normalizeClassValue({ name: context, type: 'class', ...(propertytype === undefined ? {} : { propertytype }),
    value: mergeClassObjects(base, override, propertytype, classes, context, path) }, classes, context, path).value;
}

function mergeClassObjects(base: JsonObject, override: JsonObject, propertytype: string | undefined,
                           classes: Map<string, PropertyType>, context: string, path: string[]): JsonObject {
  const definition = propertytype ? classes.get(propertytype) : undefined;
  const merged: JsonObject = { ...base, ...override };
  for (const member of definition?.members ?? []) {
    if (tiledPropertyType(member) !== 'class' || !member.propertytype) continue;
    const baseValue = base[member.name];
    const overrideValue = override[member.name];
    if (baseValue === undefined && overrideValue === undefined) continue;
    const nestedBase = baseValue === undefined ? {} : record(baseValue, `Invalid class defaults on ${context}.${member.name}`);
    const nestedOverride = overrideValue === undefined ? {} : record(overrideValue, `Invalid class value on ${context}.${member.name}`);
    merged[member.name] = mergeClassObjects(nestedBase, nestedOverride, member.propertytype, classes, `${context}.${member.name}`, path);
  }
  return merged;
}

function defaultClassValue(propertyType: PropertyType, classes: Map<string, PropertyType>, context: string, path: string[]): JsonObject {
  if (path.includes(propertyType.name)) throw new Error(`Cyclic Tiled custom class definition: ${[...path, propertyType.name].join(' -> ')}`);
  const nextPath = [...path, propertyType.name];
  const value: JsonObject = {};
  for (const member of propertyType.members ?? []) {
    const type = tiledPropertyType(member);
    const nestedDefinition = type === 'class' && member.propertytype ? classes.get(member.propertytype) : undefined;
    const nestedDefaults = nestedDefinition ? defaultClassValue(nestedDefinition, classes, `${context}.${member.name}`, nextPath) : undefined;
    value[member.name] = type === 'class'
      ? mergeTypedValue(nestedDefaults, member.value, type, member.propertytype, classes, `${context}.${member.name}`, nextPath)
      : member.value;
    validateTypedValue(value[member.name], type, member.propertytype, classes, `${context}.${member.name}`, nextPath);
  }
  return value;
}

function validateTypedValue(value: unknown, type: string, propertytype: string | undefined, classes: Map<string, PropertyType>, context: string, path: string[]): void {
  const fail = () => { throw new Error(`Invalid Tiled ${type} value on ${context}`); };
  switch (type) {
    case 'string': case 'file':
      if (typeof value !== 'string') fail();
      return;
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) fail();
      return;
    case 'float':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail();
      return;
    case 'bool':
      if (typeof value !== 'boolean') fail();
      return;
    case 'color':
      if (typeof value !== 'string' || !/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) fail();
      return;
    case 'object':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2147483647) fail();
      return;
    case 'class': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
      const definition = propertytype ? classes.get(propertytype) : undefined;
      if (definition && definition.type !== 'class') throw new Error(`Tiled property type "${propertytype}" is not a class on ${context}`);
      if (definition) {
        const classValue = record(value, `Invalid class value on ${context}`);
        for (const [name, child] of Object.entries(classValue)) {
          const member = definition.members?.find(candidate => candidate.name === name);
          if (member) validateTypedValue(child, tiledPropertyType(member), member.propertytype, classes, `${context}.${name}`, path);
        }
      }
      return;
    }
    case 'list':
      if (!Array.isArray(value)) fail();
      for (const [index, rawItem] of (value as unknown[]).entries()) {
        const item = record(rawItem, `Invalid Tiled list item on ${context}[${index}]`);
        const itemType = typeof item.type === 'string' ? item.type : undefined;
        if (!itemType) throw new Error(`Tiled list item type is required on ${context}[${index}]`);
        validateTypedValue(item.value, itemType, typeof item.propertytype === 'string' ? item.propertytype : undefined, classes, `${context}[${index}]`, path);
      }
      return;
    default:
      throw new Error(`Unsupported Tiled property type "${type}" on ${context}`);
  }
}

function normalizeClassValue(property: TiledProperty, classes: Map<string, PropertyType>, context: string, path: string[] = []): TiledProperty {
  if (tiledPropertyType(property) !== 'class') {
    if (property.type !== undefined) validateTypedValue(property.value, property.type, property.propertytype, classes, context, path);
    return property;
  }
  const definition = property.propertytype ? classes.get(property.propertytype) : undefined;
  const supplied = record(property.value ?? {}, `Invalid nested class property "${property.name}" on ${context}`);
  if (!definition || definition.type !== 'class') {
    validateTypedValue(supplied, 'class', undefined, classes, context, path);
    return { ...property, value: supplied };
  }
  if (path.includes(definition.name)) throw new Error(`Cyclic Tiled custom class definition: ${[...path, definition.name].join(' -> ')}`);
  const nextPath = [...path, definition.name];
  const defaults = defaultClassValue(definition, classes, context, path);
  const merged: JsonObject = { ...defaults };
  for (const [name, value] of Object.entries(supplied)) {
    const member = definition.members?.find(candidate => candidate.name === name);
    if (!member) { merged[name] = value; continue; }
    const type = tiledPropertyType(member);
    merged[name] = mergeTypedValue(defaults[name], value, type, member.propertytype, classes, `${context}.${name}`, nextPath);
    validateTypedValue(merged[name], type, member.propertytype, classes, `${context}.${name}`, nextPath);
  }
  return { ...property, value: merged };
}

function normalizeProperties(host: JsonObject, inherited: TiledProperty[], classes: Map<string, PropertyType>, context: string): JsonObject {
  const hostClass = typeof host.class === 'string' && host.class.length > 0 ? host.class : typeof host.type === 'string' ? host.type : '';
  const classDefinition = hostClass ? classes.get(hostClass) : undefined;
  const classDefaults = classDefinition ? defaultClassValue(classDefinition, classes, context, []) : {};
  const explicit = parseProperties(host.properties, context);
  const defaults = Object.entries(classDefaults).map(([name, value]) => {
    const member = classDefinition?.members?.find(candidate => candidate.name === name);
    return { name, ...(member?.type === undefined ? {} : { type: member.type }), ...(member?.propertytype === undefined ? {} : { propertytype: member.propertytype }), value };
  });
  const typed = mergeProperties(classes, context, defaults, inherited, explicit).map(property => normalizeClassValue(property, classes, `${context}.${property.name}`));
  return { ...host, properties: typed, typedProperties: Object.fromEntries(typed.map(property => [property.name, {
    type: tiledPropertyType(property), ...(property.propertytype === undefined ? {} : { propertytype: property.propertytype }), value: property.value,
  }])) };
}

type TilesetLocation = { firstgid: number; source?: string; data: JsonObject; sourcePath?: string };

function loadCustomClasses(projectPath?: string): Map<string, PropertyType> {
  const classes = new Map<string, PropertyType>();
  if (!projectPath) return classes;
  const project = readJson(projectPath, 'project');
  const projectTypes = z.array(z.object({ name: z.string(), type: z.string(), members: z.array(propertySchema).optional(), values: z.array(z.string()).optional(), storageType: z.string().optional() }).passthrough()).parse(project.propertyTypes ?? []);
  for (const type of projectTypes) classes.set(type.name, type);
  return classes;
}

function normalizeTilesetData(input: JsonObject, classes: Map<string, PropertyType>, context: string): JsonObject {
  const data = normalizeProperties({ ...input }, [], classes, `tileset ${String(input.name ?? context)}`);
  if (Array.isArray(data.tiles)) data.tiles = data.tiles.map(rawTile => {
    const tile = record(rawTile, `Invalid tile in tileset ${context}`);
    const normalized = normalizeProperties({ ...tile }, [], classes, `tileset ${String(input.name ?? context)} tile ${String(tile.id ?? '')}`);
    if (tile.objectgroup !== undefined) {
      const group = record(tile.objectgroup, `Invalid tile objectgroup in tileset ${context}`);
      const objectgroup = normalizeProperties({ ...group }, [], classes, `tileset ${String(input.name ?? context)} tile ${String(tile.id ?? '')} objectgroup`);
      if (Array.isArray(group.objects)) objectgroup.objects = group.objects.map(rawObject => normalizeProperties(record(rawObject, `Invalid collision object in tileset ${context}`), [], classes, `tileset ${String(input.name ?? context)} collision object`));
      normalized.objectgroup = objectgroup;
    }
    return normalized;
  });
  return data;
}

/** Apply project defaults and type checks to an external or embedded Tiled JSON tileset. */
export function normalizeTiledTileset(raw: unknown, sourcePath: string, projectPath?: string): JsonObject {
  const data = record(raw, `Invalid Tiled tileset: ${sourcePath}`);
  return normalizeTilesetData(data, loadCustomClasses(projectPath), sourcePath);
}

function parseMapTilesets(map: JsonObject, mapPath: string, classes: Map<string, PropertyType>): TilesetLocation[] {
  return z.array(z.object({ firstgid: z.number().int().positive(), source: z.string().optional() }).passthrough()).parse(map.tilesets ?? []).map(reference => {
    const sourcePath = reference.source ? resolveReference(mapPath, reference.source, 'tileset') : undefined;
    const rawData = sourcePath ? readJson(sourcePath, 'tileset') : record(reference, 'Invalid embedded Tiled tileset');
    const data = normalizeTilesetData(rawData, classes, sourcePath ?? mapPath);
    if (typeof data.image === 'string') {
      const tilecount = z.number().int().positive().safeParse(data.tilecount);
      if (Array.isArray(data.tiles)) for (const rawTile of data.tiles) {
        const tile = record(rawTile, `Invalid tile in atlas tileset ${String(data.name ?? sourcePath ?? '')}`);
        if (tile.animation === undefined) continue;
        const frames = z.array(z.object({ tileid: z.number().int().nonnegative(), duration: z.number().finite().int().positive() })).min(1)
          .safeParse(tile.animation);
        if (!frames.success || !tilecount.success || frames.data.some(frame => frame.tileid >= tilecount.data)) {
          throw new Error(`Invalid atlas animation in tileset ${String(data.name ?? sourcePath ?? '')} tile ${String(tile.id ?? '')}`);
        }
      }
    }
    return { firstgid: reference.firstgid, source: reference.source, ...(sourcePath === undefined ? {} : { sourcePath }), data };
  });
}

function remapTemplateGid(gid: unknown, template: JsonObject, templatePath: string, mapTilesets: TilesetLocation[]): unknown {
  if (typeof gid !== 'number' || gid === 0) return gid;
  const templateTileset = template.tileset === undefined ? undefined : record(template.tileset, `Invalid tileset in template ${templatePath}`);
  if (!templateTileset || typeof templateTileset.source !== 'string') throw new Error(`Template tile object ${templatePath} has a GID but no external tileset reference`);
  const templateTilesetPath = resolveReference(templatePath, templateTileset.source, 'template tileset');
  const templateFirstgid = typeof templateTileset.firstgid === 'number' ? templateTileset.firstgid : 1;
  const localGid = gid & 0x0fffffff;
  const tileId = localGid - templateFirstgid;
  if (tileId < 0) throw new Error(`Template tile GID ${gid} is below its tileset firstgid in ${templatePath}`);
  const matching = mapTilesets.filter(tileset => tileset.sourcePath === templateTilesetPath);
  if (matching.length !== 1) throw new Error(`Template tileset ${templateTileset.source} in ${templatePath} must match exactly one map tileset`);
  const mapped = matching[0]!.firstgid + tileId;
  const flipFlags = gid - localGid;
  return flipFlags + mapped;
}

function expandTemplateObject(object: JsonObject, objectFile: string, mapTilesets: TilesetLocation[], classes: Map<string, PropertyType>, stack: string[], gidSpace?: JsonObject): JsonObject {
  let templateObject: JsonObject | undefined;
  let templatePath: string | undefined;
  if (typeof object.template === 'string') {
    if (object.template.toLowerCase().endsWith('.tx')) throw new Error(`XML Tiled templates are not supported: ${object.template}`);
    templatePath = resolveReference(objectFile, object.template, 'template');
    if (stack.includes(templatePath)) throw new Error(`Cyclic Tiled templates: ${[...stack, templatePath].join(' -> ')}`);
    const template = readJson(templatePath, 'template');
    if (template.type !== 'template' || template.object === undefined) throw new Error(`Invalid JSON object template ${templatePath}`);
    templateObject = expandTemplateObject(record(template.object, `Invalid object in template ${templatePath}`), templatePath,
      mapTilesets, classes, [...stack, templatePath], template);
  }
  const instanceProperties = parseProperties(object.properties, `object ${String(object.id ?? object.name ?? '')}`);
  const templateProperties = templateObject ? parseProperties(templateObject.properties, `template ${templatePath ?? objectFile}`) : [];
  const merged: JsonObject = { ...(templateObject ?? {}), ...object };
  delete merged.template;
  if (templateObject) merged.properties = mergeProperties(classes, `template ${templatePath ?? objectFile}`, templateProperties, instanceProperties);
  const instanceClass = typeof object.class === 'string' && object.class.length > 0 ? object.class
    : typeof object.type === 'string' && object.type.length > 0 ? object.type : undefined;
  const templateClass = typeof templateObject?.class === 'string' && templateObject.class.length > 0 ? templateObject.class
    : typeof templateObject?.type === 'string' && templateObject.type.length > 0 ? templateObject.type : undefined;
  const effectiveClass = instanceClass ?? templateClass;
  if (effectiveClass !== undefined) {
    merged.class = effectiveClass;
    delete merged.type;
  }
  // A GID explicitly stored in a template file belongs to that template's tileset space.
  // A GID explicitly stored by a map instance already belongs to the map's GID space.
  if (own(object, 'gid') && gidSpace) merged.gid = remapTemplateGid(object.gid, gidSpace, objectFile, mapTilesets);
  return merged;
}

function allObjects(layers: unknown[], visit: (object: JsonObject) => void): void {
  for (const rawLayer of layers) {
    const layer = record(rawLayer, 'Invalid Tiled layer');
    if (Array.isArray(layer.objects)) for (const rawObject of layer.objects) visit(record(rawObject, 'Invalid Tiled object'));
    if (Array.isArray(layer.layers)) allObjects(layer.layers, visit);
  }
}

function normalizeLayerTree(layers: unknown[], mapPath: string, mapTilesets: TilesetLocation[], classes: Map<string, PropertyType>): unknown[] {
  return layers.map(rawLayer => {
    let layer = normalizeProperties(record(rawLayer, 'Invalid Tiled layer'), [], classes, `layer ${String(record(rawLayer, 'Invalid Tiled layer').name ?? '')}`);
    if (Array.isArray(layer.objects)) layer.objects = layer.objects.map(rawObject => {
      let object = expandTemplateObject(record(rawObject, 'Invalid Tiled object'), mapPath, mapTilesets, classes, []);
      const gidResult = z.number().int().nonnegative().max(0xffffffff).safeParse(object.gid);
      if (object.gid !== undefined && !gidResult.success) throw new Error(`Invalid tile object GID on object ${String(object.id ?? object.name ?? '')}`);
      const gid = gidResult.success ? gidResult.data : 0;
      const tileGid = gid & 0x0fffffff;
      const tileset = tileGid === 0 ? undefined : [...mapTilesets].filter(candidate => candidate.firstgid <= tileGid).sort((a, b) => b.firstgid - a.firstgid)[0];
      const localId = tileset ? tileGid - tileset.firstgid : -1;
      const tileArray = z.array(z.object({ id: z.number().int().nonnegative(), class: z.string().optional(), type: z.string().optional(), properties: z.array(propertySchema).optional() }).passthrough()).safeParse(tileset?.data.tiles ?? []);
      const tile = tileArray.success ? tileArray.data.find(candidate => candidate.id === localId) : undefined;
      const inherited = tile ? parseProperties(tile.properties, `tileset tile ${localId}`) : [];
      const tileClass = typeof tile?.class === 'string' && tile.class.length > 0 ? tile.class : tile?.type;
      const objectClass = typeof object.class === 'string' && object.class.length > 0 ? object.class
        : typeof object.type === 'string' && object.type.length > 0 ? object.type : undefined;
      if (!objectClass && tileClass) object = { ...object, class: tileClass };
      object = normalizeProperties(object, inherited, classes, `object ${String(object.id ?? object.name ?? '')}`);
      return object;
    });
    if (Array.isArray(layer.layers)) layer.layers = normalizeLayerTree(layer.layers, mapPath, mapTilesets, classes);
    return layer;
  });
}

function collectMapObjectIds(map: JsonObject): Set<number> {
  const ids = new Set<number>();
  allObjects(array(map.layers), object => {
    if (typeof object.id !== 'number' || !Number.isInteger(object.id) || object.id <= 0) return;
    if (ids.has(object.id)) throw new Error(`Duplicate Tiled object ID: ${object.id}`);
    ids.add(object.id);
  });
  return ids;
}

function validateObjectReferences(hosts: JsonObject[], classes: Map<string, PropertyType>, objectIds: Set<number>): void {
  const checkValue = (value: unknown, type: string, propertytype: string | undefined, context: string): void => {
    if (type === 'object') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`Tiled object reference on ${context} must be a non-negative object ID`);
      if (value !== 0 && !objectIds.has(value)) throw new Error(`Tiled object reference on ${context} points to missing object ${value}`);
      return;
    }
    if (type === 'class' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const definition = propertytype ? classes.get(propertytype) : undefined;
      for (const [name, child] of Object.entries(record(value, `Invalid class value on ${context}`))) {
        const member = definition?.members?.find(entry => entry.name === name);
        if (member) checkValue(child, tiledPropertyType(member), member.propertytype, `${context}.${name}`);
      }
      return;
    }
    if (type === 'list' && Array.isArray(value)) for (const [index, rawItem] of value.entries()) {
      const item = record(rawItem, `Invalid list item on ${context}[${index}]`);
      const itemType = typeof item.type === 'string' ? item.type : 'string';
      checkValue(item.value, itemType, typeof item.propertytype === 'string' ? item.propertytype : undefined, `${context}[${index}]`);
    }
  };
  for (const host of hosts) {
    const context = `${String(host.type ?? 'object')} ${String(host.id ?? host.name ?? '')}`;
    for (const property of parseProperties(host.properties, context)) checkValue(property.value, tiledPropertyType(property), property.propertytype, `${context}.${property.name}`);
  }
}

function mapPropertyHosts(map: JsonObject): JsonObject[] {
  const hosts: JsonObject[] = [map];
  const visitLayers = (layers: unknown[]) => {
    for (const rawLayer of layers) {
      const layer = record(rawLayer, 'Invalid Tiled layer');
      hosts.push(layer);
      for (const rawObject of array(layer.objects)) hosts.push(record(rawObject, 'Invalid Tiled object'));
      if (Array.isArray(layer.layers)) visitLayers(layer.layers);
    }
  };
  visitLayers(array(map.layers));
  return hosts;
}

/** Expand Tiled class defaults and JSON templates before the shared world semantic parser runs. */
export function normalizeTiledMap(raw: unknown, mapPath: string, projectPath?: string): JsonObject {
  const map = record(raw, `Invalid Tiled map: ${mapPath}`);
  if (!Array.isArray(map.layers)) throw new Error(`Tiled map ${mapPath} must contain a layers array`);
  const classes = loadCustomClasses(projectPath);
  const mapTilesets = parseMapTilesets(map, mapPath, classes);
  map.tilesets = mapTilesets.map(tileset => ({ ...tileset.data, firstgid: tileset.firstgid, ...(tileset.source === undefined ? {} : { source: tileset.source }) }));
  map.layers = normalizeLayerTree(map.layers, mapPath, mapTilesets, classes);
  const normalizedMap = normalizeProperties(map, [], classes, `map ${mapPath}`);
  Object.assign(map, normalizedMap);
  const hosts = mapPropertyHosts(map);
  validateObjectReferences(hosts, classes, collectMapObjectIds(map));
  return map;
}

export function resolveTiledProject(registryPath: string, project?: string): string | undefined {
  if (project === undefined) return undefined;
  if (isAbsolute(project)) throw new Error('Tiled project path must be relative to the map registry');
  return resolve(dirname(registryPath), project);
}
