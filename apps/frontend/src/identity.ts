import { z } from 'zod';
import { avatarSchema, type JoinOptions } from '@virtual-workspace/shared';

const profileSchema = z.object({ id: z.string(), name: z.string(), avatar: avatarSchema, role: z.enum(['member', 'admin']) });
export type Profile = z.infer<typeof profileSchema>;
async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, { method, credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`身份操作失败（${response.status}）`);
  return response;
}
export async function loadProfile(): Promise<Profile | undefined> {
  const response = await fetch('/api/me', { credentials: 'include' });
  if (response.status === 401) return;
  if (!response.ok) throw new Error('无法读取身份');
  return profileSchema.parse(await response.json());
}
export async function saveProfile(options: JoinOptions): Promise<Profile> {
  if (!await loadProfile()) await request('/api/auth/sign-in/anonymous', 'POST', {});
  return profileSchema.parse(await (await request('/api/me', 'PATCH', options)).json());
}
export async function generateBinding(): Promise<string> {
  return z.object({ token: z.string() }).parse(await (await request('/api/auth/one-time-token/generate')).json()).token;
}
export async function importBinding(token: string): Promise<Profile> {
  await request('/api/auth/one-time-token/verify', 'POST', { token });
  const value = await loadProfile();
  if (!value) throw new Error('身份绑定失败');
  return value;
}
