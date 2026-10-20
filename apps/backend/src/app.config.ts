import { defineServer, defineRoom } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { SpaceRoom } from './rooms/SpaceRoom.js';
import { db } from './db.js';
import express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './identity.js';
import { accountRoutes } from './account-routes.js';
import { config, voiceConfig } from './config.js';
import { worldRegistry, renderMaps, worldAssets } from './world.js';
import { loadWebTools } from './interactions/web/config.js';

const webTools = loadWebTools(config.EXTERNAL_TOOLS, worldRegistry.maps.map(map => map.world));

export const server = defineServer({
  transport: new WebSocketTransport(),
  rooms: { space: defineRoom(SpaceRoom).filterBy(['spaceId']) },
  express: app => {
    app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    const handleAuth = toNodeHandler(auth);
    const identityRoutes = new Map([
      ['/sign-in/username', 'POST'], ['/get-session', 'GET'], ['/sign-out', 'POST'],
      ['/reset-password', 'POST'],
    ]);
    app.all('/api/auth/*splat', (req, res) => {
      if (identityRoutes.get(req.path.slice('/api/auth'.length)) !== req.method) {
        res.status(404).json({ error: 'Unknown identity endpoint' });
        return;
      }
      return handleAuth(req, res);
    });
    app.use('/api', express.json({ limit: '16kb', strict: false }));
    app.get('/api/world', (_req, res) => { res.json(worldRegistry); });
    app.get('/api/voice-config', (_req, res) => { res.json(voiceConfig); });
    app.get('/api/maps/:id/map.json', (req, res) => {
      const map = renderMaps.get(req.params.id);
      if (!map) { res.sendStatus(404); return; }
      res.json(map);
    });
    app.get('/api/maps/:id/assets/:asset', (req, res) => {
      const file = worldAssets.get(`${req.params.id}/${req.params.asset}`);
      if (!file) { res.sendStatus(404); return; }
      res.sendFile(file);
    });
    app.get('/api/tools', (_req, res) => { res.json(webTools); });
    app.use('/api', accountRoutes);
    app.get('/health', (_req, res) => {
      db.prepare('SELECT 1').get();
      res.json({ status: 'ok' });
    });
    if (config.FRONTEND_DIST_PATH) app.use(express.static(config.FRONTEND_DIST_PATH));
  },
});
export default server;
