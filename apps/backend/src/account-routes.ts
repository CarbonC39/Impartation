import { Router, type Request, type Response, type NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import { joinSchema, savedOutfitSchema } from '@impartation/shared';
import { accountInputSchema, authSignUpBody, createAccount, listAccounts, moderateAccount, moderationActionSchema, registrationAllowed } from './accounts.js';
import { auth, ensureProfile, identityFromHeaders, profile, revokeUserSessions, updateProfile, type Identity } from './identity.js';
import { config } from './config.js';
import { db } from './db.js';
import { loadSavedOutfits, saveSavedOutfits } from './outfits.js';

export const accountRoutes = Router();
const origins = config.IDENTITY_TRUSTED_ORIGINS.split(',').map(value => value.trim());
accountRoutes.use((req, res, next) => {
  if (req.method !== 'GET' && (!req.is('application/json') || (req.headers.origin && !origins.includes(req.headers.origin)))) {
    res.status(403).json({ error: 'Untrusted account request' }); return;
  }
  next();
});
async function requireIdentity(req: Request, res: Response): Promise<Identity | undefined> {
  const identity = await identityFromHeaders(fromNodeHeaders(req.headers), cookies => {
    for (const cookie of cookies) res.append('Set-Cookie', cookie);
  });
  if (identity && req.get('X-Account-Id') && req.get('X-Account-Id') !== identity.userId) {
    res.status(409).json({ error: '账号已在其它标签页切换，请刷新后重试' }); return;
  }
  if (!identity) res.status(401).json({ error: '请先登录' });
  return identity;
}
async function requireAdmin(req: Request, res: Response) {
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  if (profile(identity.userId)?.role !== 'admin') { res.status(403).json({ error: '需要管理员权限' }); return; }
  return identity;
}
accountRoutes.get('/registration', (_req, res) => { res.json({ mode: config.REGISTRATION_MODE }); });
accountRoutes.post('/register', async (req, res) => {
  const input = accountInputSchema.extend({ registrationCode: z.string().optional() }).parse(req.body);
  if (!registrationAllowed(input.registrationCode)) { res.status(403).json({ error: '注册已关闭或注册码无效' }); return; }
  // Use the public library handler so its own HTTP rate limiter and validation still apply.
  const headers = fromNodeHeaders(req.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');
  const registered = await auth.handler(new Request(`${config.IDENTITY_BASE_URL.replace(/\/$/, '')}/api/auth/sign-up/email`, {
    method: 'POST', headers, body: JSON.stringify(authSignUpBody(input)),
  }));
  if (!registered.ok) { res.status(registered.status).json(await registered.json()); return; }
  const result = z.object({ user: z.object({ id: z.string() }) }).parse(await registered.json());
  const value = ensureProfile(result.user.id, { name: input.displayName, avatar: 'mint', appearance: joinSchema.parse({ name: input.displayName }).appearance });
  const signedIn = await auth.handler(new Request(`${config.IDENTITY_BASE_URL.replace(/\/$/, '')}/api/auth/sign-in/username`, {
    method: 'POST', headers, body: JSON.stringify({ username: input.username, password: input.password }),
  }));
  if (!signedIn.ok) { res.status(signedIn.status).json(await signedIn.json()); return; }
  for (const cookie of signedIn.headers.getSetCookie()) res.append('Set-Cookie', cookie);
  res.json(value);
});
accountRoutes.get('/me', async (req, res) => {
  const identity = await requireIdentity(req, res);
  if (identity) res.json(ensureProfile(identity.userId));
});
accountRoutes.patch('/me', async (req, res) => {
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  const old = ensureProfile(identity.userId);
  const body = z.object({ name: z.string().optional(), displayName: z.string().optional(), avatar: z.unknown().optional(), appearance: z.unknown().optional(), currentAppearance: z.unknown().optional() }).parse(req.body);
  const value = joinSchema.parse({ name: body.displayName ?? body.name ?? old.name, avatar: body.avatar ?? old.avatar, appearance: body.currentAppearance ?? body.appearance ?? old.appearance });
  res.json(updateProfile(identity.userId, value));
});
accountRoutes.post('/me/password', async (req, res) => {
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  const input = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(8).max(128) }).parse(req.body);
  await auth.api.changePassword({ headers: fromNodeHeaders(req.headers), body: { ...input, revokeOtherSessions: false } });
  await revokeUserSessions(identity.userId);
  // Better Auth clears this now-revoked browser's cookies as well.
  const result = await auth.api.signOut({ headers: fromNodeHeaders(req.headers), returnHeaders: true });
  for (const cookie of result.headers.getSetCookie()) res.append('Set-Cookie', cookie);
  res.json({ ok: true });
});
accountRoutes.get('/me/outfits', async (req, res) => {
  const identity = await requireIdentity(req, res);
  if (identity) res.json(loadSavedOutfits(identity.userId));
});
accountRoutes.put('/me/outfits/:index', async (req, res) => {
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  const index = z.enum(['0', '1', '2']).parse(req.params.index);
  const slot = savedOutfitSchema.nullable().parse(req.body);
  const result = db.transaction(() => {
    const slots = loadSavedOutfits(identity.userId);
    slots[Number(index)] = slot;
    return saveSavedOutfits(identity.userId, slots);
  })();
  res.json(result);
});
accountRoutes.get('/admin/users', async (req, res) => {
  if (await requireAdmin(req, res)) res.json(listAccounts());
});
accountRoutes.post('/admin/users', async (req, res) => {
  if (await requireAdmin(req, res)) res.json(await createAccount(accountInputSchema.parse(req.body)));
});
accountRoutes.post('/admin/users/:id/:action', async (req, res) => {
  const identity = await requireAdmin(req, res);
  if (!identity) return;
  const action = moderationActionSchema.parse(req.params.action);
  z.object({ confirmed: z.literal(true) }).parse(req.body);
  res.json(await moderateAccount(req.params.id, action, identity.userId));
});
accountRoutes.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const apiError = z.object({ statusCode: z.number(), message: z.string() }).safeParse(error);
  if (error instanceof z.ZodError) { res.status(400).json({ error: '输入无效' }); return; }
  if (apiError.success) { res.status(apiError.data.statusCode).json({ error: apiError.data.message }); return; }
  if (error instanceof Error && /Unknown account|Cannot delete/.test(error.message)) { res.status(400).json({ error: error.message }); return; }
  console.error('Account operation failed', error instanceof Error ? error.name : 'Unknown error');
  res.status(500).json({ error: '账号操作失败' });
});
