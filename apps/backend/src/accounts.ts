import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { DEFAULT_APPEARANCE } from '@virtual-workspace/shared';
import { config } from './config.js';
import { db } from './db.js';
import { auth, ensureProfile, identityEvents, passwordResetLink, profile, revokeUserSessions, setRole } from './identity.js';

export const accountInputSchema = z.object({
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_.]+$/).transform(value => value.toLowerCase()),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(24),
});
export const moderationActionSchema = z.enum(['promote', 'demote', 'suspend', 'unsuspend', 'delete', 'reset-password', 'kick']);
export type ModerationAction = z.infer<typeof moderationActionSchema>;

export function registrationAllowed(code?: string): boolean {
  if (config.REGISTRATION_MODE === 'admin') return false;
  if (config.REGISTRATION_MODE === 'open') return true;
  const expected = Buffer.from(config.REGISTRATION_CODE ?? '');
  const supplied = Buffer.from(code ?? '');
  return expected.length > 0 && expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function authSignUpBody(input: z.infer<typeof accountInputSchema>) {
  // The library requires a unique email; this undeliverable placeholder is never a login identifier.
  return { username: input.username, password: input.password, name: input.displayName, email: `${randomUUID()}@accounts.invalid` };
}

export async function createAccount(input: z.infer<typeof accountInputSchema>) {
  const value = accountInputSchema.parse(input);
  const created = await auth.api.signUpEmail({ body: authSignUpBody(value) });
  return ensureProfile(created.user.id, { name: value.displayName, avatar: 'mint', appearance: DEFAULT_APPEARANCE });
}

export function listAccounts() {
  const users = db.prepare('SELECT id, name, suspended FROM auth_user ORDER BY createdAt DESC').all() as { id: string; name: string; suspended: number }[];
  return users.map(user => ({ ...ensureProfile(user.id, { name: user.name || '成员', avatar: 'mint', appearance: (profile(user.id)?.appearance ?? DEFAULT_APPEARANCE) }), suspended: Boolean(user.suspended) }));
}

/** Queue makes local CLI moderation reach every active Space in the single backend deployment. */
export function disconnectAccount(userId: string) {
  const cutoff = Date.now();
  db.prepare('INSERT INTO moderation_commands (user_id, created_at) VALUES (?, ?)').run(userId, cutoff);
  identityEvents.emit('disconnect', userId, cutoff);
  db.prepare('DELETE FROM moderation_commands WHERE created_at < ?').run(cutoff - 86400_000);
}

export async function moderateAccount(userId: string, action: ModerationAction, actorId?: string): Promise<unknown> {
  const context = await auth.$context;
  const user = await context.internalAdapter.findUserById(userId);
  if (!user) throw new Error('Unknown account');
  if (actorId === userId && ['delete', 'suspend', 'demote'].includes(action)) throw new Error('Cannot delete, suspend or demote your own account');
  if (action === 'promote' || action === 'demote') {
    setRole(userId, action === 'promote' ? 'admin' : 'member');
  } else if (action === 'suspend') {
    await context.internalAdapter.updateUser(userId, { suspended: true });
    await revokeUserSessions(userId);
    disconnectAccount(userId);
  } else if (action === 'unsuspend') {
    await context.internalAdapter.updateUser(userId, { suspended: false });
  } else if (action === 'delete') {
    await context.internalAdapter.updateUser(userId, { suspended: true });
    await revokeUserSessions(userId);
    disconnectAccount(userId);
    // Public board content has no cascading auth foreign key and remains intact.
    db.prepare('DELETE FROM auth_verification WHERE value = ? AND identifier LIKE ?').run(userId, 'reset-password:%');
    await context.internalAdapter.deleteUser(userId);
    return { ok: true };
  } else if (action === 'reset-password') {
    return { url: await passwordResetLink(userId) };
  } else if (action === 'kick') {
    disconnectAccount(userId);
    return { ok: true };
  }
  const status = db.prepare('SELECT suspended FROM auth_user WHERE id = ?').get(userId) as { suspended: number };
  return { ...profile(userId), suspended: Boolean(status.suspended) };
}
