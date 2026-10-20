import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { rmSync } from 'node:fs';
import { DEFAULT_APPEARANCE } from '@virtual-workspace/shared';
import { createRoomWorldFixture } from './world-fixture.js';

process.env.DATABASE_PATH = ':memory:';
const fixture = createRoomWorldFixture();
process.env.MAP_REGISTRY_PATH = fixture.registryPath;
const { server } = await import('../src/app.config.js');
const { db } = await import('../src/db.js');
const { setRole } = await import('../src/identity.js');
const endpoint = 'http://127.0.0.1:2568';
const password = 'password1234';

type TestServer = typeof server;
type Account = { id: string; cookie: string; username: string; password: string };

function cookieOf(response: Response) {
  return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
}

async function register(displayName = '访客'): Promise<Account> {
  const username = `user_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const response = await fetch(endpoint + '/api/register', { method: 'POST', headers: { Origin: endpoint, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, displayName }) });
  assert.equal(response.status, 200, await response.clone().text());
  const profileResponse = await fetch(endpoint + '/api/me', { headers: { Cookie: cookieOf(response) } });
  assert.equal(profileResponse.status, 200);
  const profile = await profileResponse.json() as { id: string };
  return { id: profile.id, cookie: cookieOf(response), username, password };
}

async function login(username: string, passwordValue = password) {
  return fetch(endpoint + '/api/auth/sign-in/username', { method: 'POST', headers: { Origin: endpoint, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: passwordValue }) });
}

async function adminAction(admin: Account, userId: string, action: string) {
  return fetch(`${endpoint}/api/admin/users/${encodeURIComponent(userId)}/${action}`, { method: 'POST',
    headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) });
}

describe('formal accounts and administration', { timeout: 30000 }, () => {
  let harness: ColyseusTestServer<TestServer>;
  before(async () => { harness = await boot(server); });
  beforeEach(async () => {
    await harness.cleanup();
    db.prepare('DELETE FROM board_notes').run();
  });
  after(async () => {
    await harness.shutdown();
    db.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  });

  test('username uniqueness ignores case while display names may repeat', async () => {
    const first = await register('同名访客');
    const second = await register('同名访客');
    assert.notEqual(first.id, second.id);
    const duplicate = await fetch(endpoint + '/api/register', { method: 'POST', headers: { Origin: endpoint, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: first.username.toUpperCase(), password, displayName: '第三位' }) });
    assert.ok([400, 409].includes(duplicate.status), await duplicate.clone().text());
    assert.equal((await login(first.username.toUpperCase())).status, 200);
  });

  test('password change rejects the old password and revokes every session', async () => {
    const account = await register();
    const secondLogin = await login(account.username);
    assert.equal(secondLogin.status, 200);
    const secondCookie = cookieOf(secondLogin);
    const incorrectPassword = await fetch(endpoint + '/api/me/password', { method: 'POST', headers: { Cookie: account.cookie, Origin: endpoint, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'unused-password-1234' }) });
    assert.notEqual(incorrectPassword.status, 200);
    assert.equal((await fetch(endpoint + '/api/me', { headers: { Cookie: account.cookie } })).status, 200);
    assert.equal((await fetch(endpoint + '/api/me', { headers: { Cookie: secondCookie } })).status, 200);
    const changed = await fetch(endpoint + '/api/me/password', { method: 'POST', headers: { Cookie: account.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: password, newPassword: 'new-password-5678' }) });
    assert.equal(changed.status, 200, await changed.clone().text());
    assert.equal((await fetch(endpoint + '/api/me', { headers: { Cookie: account.cookie } })).status, 401);
    assert.equal((await fetch(endpoint + '/api/me', { headers: { Cookie: secondCookie } })).status, 401);
    assert.notEqual((await login(account.username, password)).status, 200);
    assert.equal((await login(account.username, 'new-password-5678')).status, 200);
  });

  test('three saved outfit slots belong to the account and are isolated from another account', async () => {
    const owner = await register();
    const other = await register();
    const outfit = { name: '玫瑰', appearance: { ...DEFAULT_APPEARANCE, top: { ...DEFAULT_APPEARANCE.top, color: '#aa3366' } } };
    const staleWrite = await fetch(endpoint + '/api/me/outfits/1', { method: 'PUT', headers: {
      Cookie: other.cookie, 'Content-Type': 'application/json', 'X-Account-Id': owner.id,
    }, body: JSON.stringify(outfit) });
    assert.equal(staleWrite.status, 409);
    const staleProfile = await fetch(endpoint + '/api/me', { method: 'PATCH', headers: {
      Cookie: other.cookie, 'Content-Type': 'application/json', 'X-Account-Id': owner.id,
    }, body: JSON.stringify({ displayName: 'Stale tab' }) });
    assert.equal(staleProfile.status, 409);
    const saved = await fetch(endpoint + '/api/me/outfits/1', { method: 'PUT', headers: { Cookie: owner.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(outfit) });
    assert.equal(saved.status, 200, await saved.clone().text());
    const ownSlots = await (await fetch(endpoint + '/api/me/outfits', { headers: { Cookie: owner.cookie } })).json() as unknown[];
    const otherSlots = await (await fetch(endpoint + '/api/me/outfits', { headers: { Cookie: other.cookie } })).json() as unknown[];
    assert.equal(ownSlots.length, 3);
    assert.deepEqual(ownSlots[1], outfit);
    assert.deepEqual(otherSlots, [null, null, null]);
    const invalidIndex = await fetch(endpoint + '/api/me/outfits/3', { method: 'PUT', headers: { Cookie: owner.cookie, 'Content-Type': 'application/json' }, body: 'null' });
    assert.equal(invalidIndex.status, 400);
    const invalidName = await fetch(endpoint + '/api/me/outfits/0', { method: 'PUT', headers: { Cookie: owner.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...outfit, name: '' }) });
    assert.equal(invalidName.status, 400);
    const invalidAsset = await fetch(endpoint + '/api/me/outfits/0', { method: 'PUT', headers: { Cookie: owner.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...outfit, appearance: { ...outfit.appearance, body: { ...outfit.appearance.body, assetId: 'unknown-costume' } } }) });
    assert.equal(invalidAsset.status, 400);
    const cleared = await fetch(endpoint + '/api/me/outfits/1', { method: 'PUT', headers: { Cookie: owner.cookie, 'Content-Type': 'application/json' }, body: 'null' });
    assert.equal(cleared.status, 200);
    assert.deepEqual(await (await fetch(endpoint + '/api/me/outfits', { headers: { Cookie: owner.cookie } })).json(), [null, null, null]);
  });

  test('members are rejected by admin routes; privileged actions preserve public notes on deletion', async () => {
    const admin = await register('管理员');
    const member = await register('普通成员');
    assert.equal(setRole(admin.id, 'admin'), true);
    const deniedList = await fetch(endpoint + '/api/admin/users', { headers: { Cookie: member.cookie } });
    assert.equal(deniedList.status, 403);
    assert.equal((await adminAction(member, admin.id, 'kick')).status, 403);
    const missingConfirmation = await fetch(`${endpoint}/api/admin/users/${member.id}/kick`, { method: 'POST',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(missingConfirmation.status, 400);
    assert.equal((await adminAction(admin, admin.id, 'delete')).status, 400);

    const listing = await fetch(endpoint + '/api/admin/users', { headers: { Cookie: admin.cookie } });
    assert.equal(listing.status, 200);
    const users = await listing.json() as { id: string; suspended: boolean }[];
    assert.ok(users.some(user => user.id === member.id && user.suspended === false));

    const created = await fetch(endpoint + '/api/admin/users', { method: 'POST', headers: { Cookie: admin.cookie, Origin: endpoint, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `managed_${randomUUID().replaceAll('-', '').slice(0, 12)}`, password, displayName: '受管理成员' }) });
    assert.equal(created.status, 200, await created.clone().text());
    const managed = await created.json() as { id: string; role: string; username: string };
    assert.equal(managed.role, 'member');

    assert.equal((await adminAction(admin, managed.id, 'promote')).status, 200);
    assert.equal((await adminAction(admin, managed.id, 'demote')).status, 200);
    assert.equal((await adminAction(admin, managed.id, 'suspend')).status, 200);
    assert.equal((await login(managed.username)).status, 403);
    assert.equal((await adminAction(admin, managed.id, 'unsuspend')).status, 200);

    const targetSession = await login(managed.username);
    assert.equal(targetSession.status, 200);
    const savedOutfit = await fetch(endpoint + '/api/me/outfits/0', { method: 'PUT', headers: { Cookie: cookieOf(targetSession), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '离场造型', appearance: DEFAULT_APPEARANCE }) });
    assert.equal(savedOutfit.status, 200);

    db.prepare('INSERT INTO board_notes (id, resource_id, author_session_id, name, text, created_at, author_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('kept-note', 'message-wall', 'managed-user', '受管理成员', '保留内容', Date.now(), managed.id);
    assert.equal((await adminAction(admin, managed.id, 'delete')).status, 200);
    assert.deepEqual(db.prepare('SELECT text, author_user_id AS authorUserId FROM board_notes WHERE id = ?').get('kept-note'),
      { text: '保留内容', authorUserId: managed.id });
    for (const table of ['auth_user', 'auth_account', 'auth_session', 'profiles', 'saved_outfits']) {
      const row = db.prepare(`SELECT count(*) AS count FROM ${table} WHERE ${table === 'auth_user' ? 'id' : table === 'auth_account' ? 'userId' : table === 'auth_session' ? 'userId' : 'user_id'} = ?`)
        .get(managed.id) as { count: number };
      assert.equal(row.count, 0, `${table} rows should be removed with the account`);
    }
  });

  test('admin reset link keeps current session until completion, then revokes every session', async () => {
    const admin = await register('管理员');
    const target = await register('重置目标');
    assert.equal(setRole(admin.id, 'admin'), true);
    const otherSession = await login(target.username);
    assert.equal(otherSession.status, 200);
    const reset = await adminAction(admin, target.id, 'reset-password');
    assert.equal(reset.status, 200, await reset.clone().text());
    const { url } = await reset.json() as { url: string };
    assert.equal((await fetch(endpoint + '/api/me', { headers: { Cookie: target.cookie } })).status, 200);
    assert.equal((await fetch(endpoint + '/api/me', { headers: { Cookie: cookieOf(otherSession) } })).status, 200);
    const token = decodeURIComponent(new URL(url).hash.replace(/^#reset-password=/, ''));
    const completed = await fetch(endpoint + '/api/auth/reset-password', { method: 'POST', headers: { Origin: endpoint, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: 'reset-password-9876' }) });
    assert.equal(completed.status, 200, await completed.clone().text());
    assert.equal((await fetch(endpoint + '/api/me', { headers: { Cookie: target.cookie } })).status, 401);
    assert.equal((await fetch(endpoint + '/api/me', { headers: { Cookie: cookieOf(otherSession) } })).status, 401);
    assert.notEqual((await login(target.username, password)).status, 200);
    assert.equal((await login(target.username, 'reset-password-9876')).status, 200);
    const replay = await fetch(endpoint + '/api/auth/reset-password', { method: 'POST', headers: { Origin: endpoint, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: 'another-password-1234' }) });
    assert.notEqual(replay.status, 200);

    const expiredReset = await adminAction(admin, target.id, 'reset-password');
    const expiredUrl = (await expiredReset.json() as { url: string }).url;
    const expiredToken = decodeURIComponent(new URL(expiredUrl).hash.replace(/^#reset-password=/, ''));
    db.prepare('UPDATE auth_verification SET expiresAt = ? WHERE identifier LIKE ?').run(new Date(Date.now() - 1000).toISOString(), 'reset-password:%');
    const expired = await fetch(endpoint + '/api/auth/reset-password', { method: 'POST', headers: { Origin: endpoint, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: expiredToken, newPassword: 'another-password-1234' }) });
    assert.notEqual(expired.status, 200);
  });
});
