import { z } from 'zod';
import { appearanceSchema, avatarSchema, type JoinOptions } from '@virtual-workspace/shared';

const profileSchema = z.object({
  id: z.string(),
  username: z.string().nullable().optional(),
  displayName: z.string().optional(),
  name: z.string(),
  avatar: avatarSchema,
  appearance: appearanceSchema,
  currentAppearance: appearanceSchema.optional(),
  role: z.enum(['member', 'admin']),
});
export type Profile = z.infer<typeof profileSchema>;
export type RegistrationMode = 'open' | 'code' | 'admin';

let currentAccountId: string | undefined;

export function accountHeaders(): Record<string, string> {
  return currentAccountId ? { 'X-Account-Id': currentAccountId } : {};
}

async function request(path: string, method = 'GET', body?: unknown, bindAccount = true): Promise<Response> {
  const headers = new Headers(bindAccount ? accountHeaders() : undefined);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `操作失败（${response.status}）`;
    try {
      const payload: unknown = await response.json();
      const parsed = z.object({ message: z.string().optional(), error: z.string().optional() }).passthrough().parse(payload);
      message = parsed.message ?? parsed.error ?? message;
    } catch { /* Keep the status based error. */ }
    throw new Error(message);
  }
  return response;
}

export async function registrationMode(): Promise<RegistrationMode> {
  return z.object({ mode: z.enum(['open', 'code', 'admin']) }).parse(await (await request('/api/registration')).json()).mode;
}

export async function loadProfile(): Promise<Profile | undefined> {
  const response = await fetch('/api/me', { credentials: 'include' });
  if (response.status === 401) { currentAccountId = undefined; return undefined; }
  if (!response.ok) throw new Error(`无法读取身份（${response.status}）`);
  const profile = profileSchema.parse(await response.json());
  currentAccountId = profile.id;
  return profile;
}

export async function registerAccount(input: { username: string; password: string; displayName: string; registrationCode?: string }): Promise<Profile> {
  const profile = profileSchema.parse(await (await request('/api/register', 'POST', input, false)).json());
  currentAccountId = profile.id;
  return profile;
}

export async function signIn(input: { username: string; password: string }): Promise<Profile> {
  await request('/api/auth/sign-in/username', 'POST', input, false);
  const profile = await loadProfile();
  if (!profile) throw new Error('登录成功，但无法读取账号资料');
  return profile;
}

export async function signOut(): Promise<void> {
  await request('/api/auth/sign-out', 'POST', {});
  currentAccountId = undefined;
}

export async function saveProfile(options: JoinOptions): Promise<Profile> {
  const profile = profileSchema.parse(await (await request('/api/me', 'PATCH', options)).json());
  currentAccountId = profile.id;
  return profile;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await request('/api/me/password', 'POST', { currentPassword, newPassword });
  currentAccountId = undefined;
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await request('/api/auth/reset-password', 'POST', { token, newPassword });
}

const adminUserSchema = profileSchema.extend({ suspended: z.boolean() });
export type AdminUser = z.infer<typeof adminUserSchema>;

export async function listAdminUsers(): Promise<AdminUser[]> {
  return z.array(adminUserSchema).parse(await (await request('/api/admin/users')).json());
}

export async function createAdminUser(input: { username: string; password: string; displayName: string }): Promise<Profile> {
  return profileSchema.parse(await (await request('/api/admin/users', 'POST', input)).json());
}

export type AdminAction = 'promote' | 'demote' | 'suspend' | 'unsuspend' | 'delete' | 'reset-password' | 'kick';
export async function adminUserAction(id: string, action: AdminAction): Promise<AdminUser | { url: string } | { ok: true }> {
  const payload: unknown = await (await request(`/api/admin/users/${encodeURIComponent(id)}/${action}`, 'POST', { confirmed: true })).json();
  if (action === 'reset-password') return z.object({ url: z.string().min(1) }).parse(payload);
  if (action === 'delete' || action === 'kick') return z.object({ ok: z.literal(true) }).parse(payload);
  return adminUserSchema.parse(payload);
}
