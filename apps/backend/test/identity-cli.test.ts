import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';

process.env.DATABASE_PATH = ':memory:';
const { openDatabase, db } = await import('../src/db.js');
const { auth } = await import('../src/identity.js');
after(() => db.close());

test('local management command persists roles, lists identities and rejects invalid grants', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'virtual-space-cli-'));
  const path = join(directory, 'world.sqlite');
  const database = openDatabase(path);
  try {
    const options = { ...auth.options, database };
    await (await getMigrations(options)).runMigrations();
    const localAuth = betterAuth(options);
    const created = await localAuth.api.signInAnonymous({});
    const userId = created.user.id;
    const cwd = fileURLToPath(new URL('../../../', import.meta.url));
    const env = { ...process.env, DATABASE_PATH: path };
    const run = (...args: string[]) => execFileSync('npm', ['run', 'identity', '--', ...args], { cwd, env, encoding: 'utf8' });
    assert.match(run('role', userId, 'admin'), /admin/);
    assert.deepEqual(database.prepare('SELECT role FROM profiles WHERE user_id = ?').get(userId), { role: 'admin' });
    assert.match(run('list'), new RegExp(userId));
    assert.match(run('role', userId, 'member'), /member/);
    assert.deepEqual(database.prepare('SELECT role FROM profiles WHERE user_id = ?').get(userId), { role: 'member' });
    for (const args of [['role', 'missing', 'admin'], ['role', userId, 'owner'], ['role', userId, 'admin', 'extra']]) {
      const result = spawnSync('npm', ['run', 'identity', '--', ...args], { cwd, env, encoding: 'utf8' });
      assert.equal(result.status, 1, result.stderr);
    }
    assert.deepEqual(database.prepare('SELECT role FROM profiles WHERE user_id = ?').get(userId), { role: 'member' });
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});
