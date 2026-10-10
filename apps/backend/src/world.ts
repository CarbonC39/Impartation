import { readFileSync } from 'node:fs';
import { parseWorldMap } from '@virtual-workspace/shared';
import { config } from './config.js';

export const world = parseWorldMap(JSON.parse(readFileSync(config.MAP_PATH, 'utf8')));
