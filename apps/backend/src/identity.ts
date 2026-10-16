import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { anonymous } from 'better-auth/plugins/anonymous';
import { oneTimeToken } from 'better-auth/plugins/one-time-token';
import { appearanceSchema, DEFAULT_APPEARANCE, joinSchema, type JoinOptions } from '@virtual-workspace/shared';
import { config } from './config.js';
import { db } from './db.js';

// Credentials, cookies and cross-device token verification belong to Better Auth.
const identityOptions = {
  database: db,
  secret: config.IDENTITY_SECRET,
  baseURL: config.IDENTITY_BASE_URL,
  trustedOrigins: config.IDENTITY_TRUSTED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean),
  user: { modelName: 'auth_user' },
  account: { modelName: 'auth_account' },
  verification: { modelName: 'auth_verification' },
  session: { modelName: 'auth_session', expiresIn: 30 * 24 * 60 * 60, cookieCache: { enabled: false } },
  plugins: [anonymous({ disableDeleteAnonymousUser: true }), oneTimeToken({ storeToken: 'hashed', expiresIn: 3 })],
} satisfies BetterAuthOptions;
await (await getMigrations(identityOptions)).runMigrations();
export const auth = betterAuth(identityOptions);
// Finish the library's schema check before a short-lived CLI can close SQLite.
await (await auth.$context).checkSchema?.();

export type Identity = { userId: string; sessionId: string; token: string };
export type Profile = { id: string; name: string; avatar: JoinOptions['avatar']; appearance: JoinOptions['appearance']; role: 'member' | 'admin' };

function storedAppearance(value: unknown): Profile['appearance'] {
  const current = appearanceSchema.safeParse(value);
  if (current.success) return current.data;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_APPEARANCE;
  const old = value as Record<string, unknown>;
  const color = (key: string, palette: Record<string, string>, fallback: string) =>
    typeof old[key] === 'string' ? palette[old[key]] ?? fallback : fallback;
  const asset = (key: string, choices: Record<string, string>, fallback: string) =>
    typeof old[key] === 'string' ? choices[old[key]] ?? fallback : fallback;
  return appearanceSchema.parse({
    body: { assetId: 'base', color: color('skin', { light: '#ffffff', warm: '#f4d6bc', deep: '#c59478' }, '#ffffff') },
    face: { assetId: 'eyes', color: '#ffffff' },
    hair: { assetId: asset('hair', { short: 'hair1', long: 'hair2', bun: 'hair2' }, 'hair1'),
      color: color('hairColor', { dark: '#343344', brown: '#704b3c', blonde: '#efc75e', pink: '#dc7196' }, '#704b3c') },
    top: { assetId: asset('top', { tee: 't-shirt', sweater: 'shirt', overall: 'shirt' }, 't-shirt'),
      color: color('topColor', { coral: '#f07872', sunshine: '#f2c552', sky: '#64a9df', leaf: '#67ae80', lilac: '#aa82cf' }, '#64a9df') },
    bottom: { assetId: asset('bottom', { pants: 'pants', skirt: 'skirt', shorts: 'pants' }, 'pants'),
      color: color('bottomColor', { denim: '#587eaa', navy: '#354d71', plum: '#805a91', mint: '#6aa989' }, '#587eaa') },
    shoes: DEFAULT_APPEARANCE.shoes,
  });
}

export function profile(userId: string): Profile | undefined {
  const row = db.prepare('SELECT user_id AS id, name, avatar_id AS avatar, appearance_json AS appearanceJson, role FROM profiles WHERE user_id = ?')
    .get(userId) as { id: string; name: string; avatar: JoinOptions['avatar']; appearanceJson: string; role: Profile['role'] } | undefined;
  if (!row) return;
  let appearance: unknown = DEFAULT_APPEARANCE;
  try { appearance = JSON.parse(row.appearanceJson); } catch { /* Invalid legacy data uses defaults. */ }
  return { id: row.id, name: row.name, avatar: row.avatar, appearance: storedAppearance(appearance), role: row.role };
}

export function ensureProfile(userId: string, options: JoinOptions = { name: '访客', avatar: 'mint', appearance: DEFAULT_APPEARANCE }): Profile {
  const value = joinSchema.parse(options);
  db.prepare(`INSERT INTO profiles (user_id, name, avatar_id, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO NOTHING`).run(userId, value.name, value.avatar, Date.now());
  return profile(userId)!;
}

export function updateProfile(userId: string, options: JoinOptions): Profile {
  const value = joinSchema.parse(options);
  ensureProfile(userId, value);
  db.prepare('UPDATE profiles SET name = ?, avatar_id = ?, appearance_json = ?, updated_at = ? WHERE user_id = ?')
    .run(value.name, value.avatar, JSON.stringify(value.appearance), Date.now(), userId);
  return profile(userId)!;
}

export async function identityFromHeaders(headers: Headers, onCookies?: (cookies: string[]) => void): Promise<Identity | undefined> {
  const result = await auth.api.getSession({ headers, returnHeaders: true, query: { disableRefresh: !onCookies } });
  onCookies?.(result.headers.getSetCookie());
  const value = result.response;
  if (!value) return;
  return { userId: value.user.id, sessionId: value.session.id, token: value.session.token };
}

// Use the library's adapter for expiry and revocation checks, avoiding dependence on its SQL date encoding.
export async function activeProfile(identity: Identity): Promise<Profile | undefined> {
  const session = await (await auth.$context).internalAdapter.findSession(identity.token);
  if (!session || session.session.id !== identity.sessionId || session.user.id !== identity.userId ||
    session.session.expiresAt.getTime() <= Date.now()) return;
  return profile(identity.userId);
}

export function setRole(userId: string, role: Profile['role']): boolean {
  if (role !== 'member' && role !== 'admin') throw new Error('Role must be member or admin');
  if (!db.prepare('SELECT id FROM auth_user WHERE id = ?').get(userId)) return false;
  ensureProfile(userId);
  return db.prepare('UPDATE profiles SET role = ?, updated_at = ? WHERE user_id = ?').run(role, Date.now(), userId).changes === 1;
}
