import { Router } from 'express';
import { spaceIdSchema } from '@impartation/shared';
import { config } from './config.js';
import { activeProfile, identityFromHeaders } from './identity.js';
import { SpaceRoom } from './rooms/SpaceRoom.js';
import { spaceQueue } from './space-queue.js';
import { worldRegistry } from './world.js';

export const spaceQueueRoutes = Router();

function trustedOrigin(origin: string | undefined) {
  return origin !== undefined && config.IDENTITY_TRUSTED_ORIGINS.split(',').some(value => value.trim() === origin);
}

async function user(cookie: string | undefined) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  const identity = await identityFromHeaders(headers);
  return identity && await activeProfile(identity) ? identity : undefined;
}

spaceQueueRoutes.post('/space-queue', async (req, res) => {
  if (!trustedOrigin(req.headers.origin)) { res.sendStatus(403); return; }
  const parsed = spaceIdSchema.safeParse(req.body?.spaceId);
  if (!parsed.success || !worldRegistry.spaces.some(space => space.id === parsed.data)) { res.sendStatus(400); return; }
  const identity = await user(req.headers.cookie);
  if (!identity) { res.sendStatus(401); return; }
  if (SpaceRoom.ownsSeat(parsed.data, identity.userId)) {
    res.json({ skip: true });
    return;
  }
  try {
    res.json(spaceQueue.enqueue(parsed.data, identity.userId, identity.sessionId, SpaceRoom.isAvailable(parsed.data)));
  } catch { res.status(429).json({ error: 'Space queue is full' }); }
});

spaceQueueRoutes.get('/space-queue/:spaceId/:ticket', async (req, res) => {
  const spaceId = spaceIdSchema.safeParse(req.params.spaceId);
  if (!spaceId.success || typeof req.params.ticket !== 'string') { res.sendStatus(400); return; }
  const identity = await user(req.headers.cookie);
  if (!identity) { res.sendStatus(401); return; }
  const status = spaceQueue.status(spaceId.data, req.params.ticket, identity.userId, identity.sessionId,
    SpaceRoom.isAvailable(spaceId.data));
  if (!status) { res.sendStatus(410); return; }
  res.json(status);
});

spaceQueueRoutes.delete('/space-queue/:spaceId/:ticket', async (req, res) => {
  if (!trustedOrigin(req.headers.origin)) { res.sendStatus(403); return; }
  const spaceId = spaceIdSchema.safeParse(req.params.spaceId);
  if (!spaceId.success || typeof req.params.ticket !== 'string') { res.sendStatus(400); return; }
  const identity = await user(req.headers.cookie);
  if (!identity) { res.sendStatus(401); return; }
  spaceQueue.cancel(spaceId.data, req.params.ticket, identity.userId, identity.sessionId,
    SpaceRoom.isAvailable(spaceId.data));
  res.sendStatus(204);
});
