import { defineServer, defineRoom } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { SpaceRoom } from './rooms/SpaceRoom.js';
import { db } from './db.js';

export const server = defineServer({
  transport: new WebSocketTransport(),
  rooms: { space: defineRoom(SpaceRoom) },
  express: app => {
    app.get('/health', (_req, res) => {
      db.prepare('SELECT 1').get();
      res.json({ status: 'ok' });
    });
  },
});
export default server;
