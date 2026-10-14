/** Test-only Tiled world data. This module is deliberately outside shared's runtime exports. */
export type TiledProperty = {
  name: string;
  type: 'string' | 'float';
  value: string | number;
};

export type TiledObject = {
  id: number;
  name: string;
  class: string;
  x: number;
  y: number;
  width: number;
  height: number;
  point?: boolean;
  properties?: TiledProperty[];
};

type ObjectLayer = {
  id: number;
  name: 'spawns' | 'collisions' | 'interactions';
  type: 'objectgroup';
  objects: TiledObject[];
};

type TileLayer = {
  id: number;
  name: 'ground';
  type: 'tilelayer';
  width: number;
  height: number;
  data: number[];
};

export type TestMap = {
  type: 'map';
  orientation: 'orthogonal';
  infinite: false;
  width: number;
  height: number;
  tilewidth: 16;
  tileheight: 16;
  tilesets: [{
    firstgid: 1;
    name: 'basic';
    image: 'tiles.png';
    imagewidth: 96;
    imageheight: 96;
    tilewidth: 16;
    tileheight: 16;
    tilecount: 36;
    columns: 6;
  }];
  layers: [TileLayer, ObjectLayer, ObjectLayer, ObjectLayer];
};

const property = (name: string, value: string): TiledProperty => ({ name, type: 'string', value });
const zone = (id: number, name: string, kind: string, x: number, y: number, resourceId: string): TiledObject => ({
  id, name, class: kind, x, y, width: 160, height: 96,
  properties: [property('resourceId', resourceId)],
});

/** Return fresh, deterministic Tiled test data independent of assets/maps/lobby.tmj. */
export function createTestMap(): TestMap {
  const width = 48;
  const height = 32;
  return {
    type: 'map',
    orientation: 'orthogonal',
    infinite: false,
    width,
    height,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [{
      firstgid: 1,
      name: 'basic',
      image: 'tiles.png',
      imagewidth: 96,
      imageheight: 96,
      tilewidth: 16,
      tileheight: 16,
      tilecount: 36,
      columns: 6,
    }],
    layers: [
      { id: 1, name: 'ground', type: 'tilelayer', width, height, data: Array<number>(width * height).fill(1) },
      { id: 2, name: 'spawns', type: 'objectgroup', objects: [
        { id: 1, name: 'default', class: '', x: 352, y: 384, width: 0, height: 0, point: true },
      ] },
      { id: 3, name: 'collisions', type: 'objectgroup', objects: [
        { id: 2, name: 'center-wall', class: '', x: 320, y: 192, width: 96, height: 128 },
      ] },
      { id: 4, name: 'interactions', type: 'objectgroup', objects: [
        zone(3, 'lounge-screen', 'web', 64, 64, 'lounge-screen'),
        zone(4, 'shared-canvas', 'web', 480, 64, 'shared-canvas'),
        zone(5, 'message-wall', 'board', 480, 320, 'message-wall'),
        zone(6, 'focus-corner', 'pomodoro', 64, 320, 'focus-corner'),
        zone(7, 'shared-drawing', 'web', 64, 192, 'shared-drawing'),
        zone(8, 'shared-document', 'web', 480, 192, 'shared-document'),
        { id: 9, name: 'lobby-seat-1', class: 'action', x: 408, y: 392, width: 0, height: 0, point: true,
          properties: [property('action', 'sit'), property('facing', 'up'), property('linkedObjectId', 'desk-1')] },
        { id: 10, name: 'lobby-seat-2', class: 'action', x: 440, y: 392, width: 0, height: 0, point: true,
          properties: [property('action', 'sit'), property('facing', 'down')] },
      ] },
    ],
  };
}
