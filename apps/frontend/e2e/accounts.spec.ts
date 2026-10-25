import { test, expect, type Page, type Dialog } from '@playwright/test';
import { DEFAULT_APPEARANCE } from '@impartation/shared';

const password = 'account-test-password';
let sequence = 0;
function username() { return `acct${Date.now().toString(36)}${(++sequence).toString(36)}`; }

async function registerForPage(page: Page, displayName: string) {
  const credentials = { username: username(), password, displayName };
  const origin = test.info().project.use.baseURL!;
  const response = await page.request.post(new URL('/api/register', origin).toString(), { headers: { Origin: origin }, data: credentials });
  expect(response.status()).toBe(200);
  return { ...credentials, profile: await response.json() as {
    id: string; username: string; name: string; displayName: string; avatar: 'mint' | 'amber' | 'violet';
    appearance: typeof DEFAULT_APPEARANCE; currentAppearance: typeof DEFAULT_APPEARANCE; role: 'member' | 'admin';
  } };
}

async function acceptNextConfirmation(page: Page, action: () => Promise<void>): Promise<string> {
  const dialogEvent = page.waitForEvent('dialog');
  const click = action();
  const dialog: Dialog = await dialogEvent;
  const message = dialog.message();
  await dialog.accept();
  await click;
  return message;
}

test('account holder changes password, is signed out, and can sign in with the new password', async ({ page }) => {
  const account = await registerForPage(page, '密码修改测试');
  await page.goto('/');
  await expect(page.locator('#account-status')).toContainText(`@${account.username}`);
  await page.locator('#open-password').click();
  await page.locator('#password-form [name="currentPassword"]').fill(password);
  await page.locator('#password-form [name="newPassword"]').fill('account-test-password-updated');
  await page.locator('#password-form [name="confirmPassword"]').fill('account-test-password-updated');
  await page.locator('#password-form button[type="submit"]').click();
  await expect(page.locator('#password-feedback')).toContainText('所有会话已退出');
  await expect(page.locator('#account-status')).toBeHidden({ timeout: 5000 });
  await page.goto('/login');
  await page.locator('#sign-in-form [name="username"]').fill(account.username);
  await page.locator('#sign-in-form [name="password"]').fill(password);
  await page.locator('#sign-in-form button[type="submit"]').click();
  await expect(page.locator('#account-feedback')).not.toBeEmpty();
  await page.locator('#sign-in-form [name="password"]').fill('account-test-password-updated');
  await page.locator('#sign-in-form button[type="submit"]').click();
  await expect(page.locator('#account-status')).toContainText(`@${account.username}`);
});

test('reset fragment is removed immediately and resetting another account keeps the current login', async ({ page }) => {
  const account = await registerForPage(page, '重置链接测试');
  let resetBody: unknown;
  await page.route('**/api/auth/reset-password', async route => {
    resetBody = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/#reset-password=one-time-secret');
  await expect(page.locator('#reset-password-panel')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
  await expect(page.locator('#account-status')).toBeHidden();
  await page.locator('#reset-password-form [name="newPassword"]').fill('reset-password-updated');
  await page.locator('#reset-password-form [name="confirmPassword"]').fill('reset-password-updated');
  await page.locator('#reset-password-form button[type="submit"]').click();
  await expect(page.locator('#reset-password-feedback')).toHaveText('密码已重置，请登录。');
  expect(resetBody).toEqual({ token: 'one-time-secret', newPassword: 'reset-password-updated' });
  await expect(page.locator('#account-status')).toContainText(`@${account.username}`);
  await expect(page.locator('#account-actions')).toBeVisible();
});

test('admin panel confirms moderation, protects the current account, and displays reset links', async ({ page }) => {
  const account = await registerForPage(page, '管理面板测试');
  const admin = { ...account.profile, role: 'admin' as const, username: account.username };
  type FixtureUser = Omit<typeof admin, 'role'> & { role: 'member' | 'admin'; suspended: boolean };
  const adminUser: FixtureUser = { ...admin, suspended: false };
  let target: FixtureUser = {
    ...admin, id: 'member-target', username: 'target.member', name: '同名显示', displayName: '同名显示',
    role: 'member' as const, suspended: false,
  };
  await page.route('**/api/me', route => route.request().method() === 'GET'
    ? route.fulfill({ json: admin }) : route.continue());
  await page.route('**/api/admin/users', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: [adminUser, target] }); return; }
    const input = route.request().postDataJSON() as { username: string; displayName: string; password: string };
    await route.fulfill({ json: { ...admin, id: `created-${input.username}`, username: input.username, name: input.displayName,
      displayName: input.displayName, role: 'member', suspended: false } });
  });
  await page.route('**/api/admin/users/**', async route => {
    const url = new URL(route.request().url());
    const action = url.pathname.split('/').at(-1);
    if (action === 'reset-password') {
      await route.fulfill({ json: { url: `${url.origin}/login#reset-password=temporary-token` } });
    } else if (action === 'kick' || action === 'delete') {
      await route.fulfill({ json: { ok: true } });
    } else {
      target = { ...target, role: action === 'promote' ? 'admin' : action === 'demote' ? 'member' : target.role,
        suspended: action === 'suspend' ? true : action === 'unsuspend' ? false : target.suspended };
      await route.fulfill({ json: target });
    }
  });
  await page.goto('/');
  await expect(page.locator('#account-status')).toContainText(`@${account.username} · 管理员`);
  await page.locator('#open-admin').click();
  const memberRow = page.locator('#admin-users .admin-user').filter({ hasText: 'target.member' });
  let prompt = await acceptNextConfirmation(page, () => memberRow.getByRole('button', { name: '设为管理员' }).click());
  expect(prompt).toContain('提升');
  await expect(memberRow).toContainText('管理员');
  prompt = await acceptNextConfirmation(page, () => memberRow.getByRole('button', { name: '冻结' }).click());
  expect(prompt).toContain('退出所有设备上的会话');
  await expect(memberRow).toContainText('已冻结');
  prompt = await acceptNextConfirmation(page, () => memberRow.getByRole('button', { name: '生成重置链接' }).click());
  expect(prompt).toContain('生成链接不会退出其当前会话');
  expect(prompt).toContain('完成密码重置后才会撤销全部会话');
  await expect(page.locator('#admin-feedback a')).toHaveAttribute('href', /\/login#reset-password=temporary-token/);
  const selfRow = page.locator('#admin-users .admin-user').filter({ hasText: `@${account.username}` });
  await expect(selfRow.getByRole('button', { name: '删除' })).toHaveCount(0);
  await expect(selfRow.getByRole('button', { name: '冻结' })).toHaveCount(0);
  await expect(selfRow.getByRole('button', { name: '降为成员' })).toHaveCount(0);
  await page.locator('#admin-create-form [name="username"]').fill('created.member');
  await page.locator('#admin-create-form [name="displayName"]').fill('同名显示');
  await page.locator('#admin-create-form [name="password"]').fill('new-member-password');
  await page.locator('#admin-create-form button[type="submit"]').click();
  await expect(page.locator('#admin-feedback')).toHaveText('账号已创建。');
  await expect(page.locator('#account-status')).toContainText(`@${account.username} · 管理员`);
});
