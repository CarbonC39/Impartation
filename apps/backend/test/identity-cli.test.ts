import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { getMigrations } from 'better-auth/db/migration';

process.env.DATABASE_PATH = ':memory:';
const { openDatabase, db } = await import('../src/db.js');
const { auth } = await import('../src/identity.js');
after(() => db.close());

test('local CLI manages accounts, protects passwords and requires explicit confirmation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'virtual-space-cli-'));
  const path = join(directory, 'world.sqlite');
  const database = openDatabase(path);
  try {
    const options = { ...auth.options, database };
    await (await getMigrations(options)).runMigrations();
    const cwd = fileURLToPath(new URL('../../../', import.meta.url));
    const env = { ...process.env, DATABASE_PATH: path };
    const run = (...args: string[]) => execFileSync(process.execPath, ['--import', 'tsx', 'apps/backend/src/identity-cli.ts', ...args], {
      cwd, env, encoding: 'utf8', timeout: 20_000,
    });
    const execute = (args: string[], input?: string) => spawnSync(process.execPath,
      ['--import', 'tsx', 'apps/backend/src/identity-cli.ts', ...args], {
      cwd, env, encoding: 'utf8', input, timeout: 20_000,
    });

    const password = `cli-secret-${Date.now()}`;
    const username = `cliuser${Date.now()}`;
    const create = execute(['create', username, 'CLI Display Name', '--password-stdin'], `${password}\n`);
    assert.equal(create.status, 0, create.stderr || create.error?.message);
    assert.match(create.stdout, new RegExp(username));
    assert.equal(create.stdout.includes(password), false);
    assert.equal(create.stderr.includes(password), false);
    const created = database.prepare('SELECT id, username FROM auth_user WHERE username = ?').get(username) as { id: string; username: string } | undefined;
    assert.ok(created);
    assert.deepEqual(database.prepare('SELECT name, role FROM profiles WHERE user_id = ?').get(created.id), { name: 'CLI Display Name', role: 'member' });

    assert.match(run('role', created.id, 'admin', '--yes'), /admin/);
    assert.deepEqual(database.prepare('SELECT role FROM profiles WHERE user_id = ?').get(created.id), { role: 'admin' });
    assert.match(run('list'), new RegExp(created.id));
    assert.match(run('role', created.id, 'member', '--yes'), /member/);
    assert.deepEqual(database.prepare('SELECT role FROM profiles WHERE user_id = ?').get(created.id), { role: 'member' });

    for (const args of [
      ['role', created.id, 'admin'], ['role', 'missing', 'admin', '--yes'],
      ['role', created.id, 'owner', '--yes'], ['role', created.id, 'admin', '--yes', 'extra'],
      ['suspend', created.id], ['delete', created.id, '--yes', 'extra'],
    ]) {
      const result = execute(args);
      assert.equal(result.status, 1, result.stderr);
    }

    assert.match(run('suspend', created.id, '--yes'), /suspend complete/);
    assert.deepEqual(database.prepare('SELECT suspended FROM auth_user WHERE id = ?').get(created.id), { suspended: 1 });
    assert.match(run('unsuspend', created.id, '--yes'), /unsuspend complete/);
    assert.deepEqual(database.prepare('SELECT suspended FROM auth_user WHERE id = ?').get(created.id), { suspended: 0 });

    const reset = run('reset-password', created.id, '--yes');
    assert.match(reset, /Password reset URL: .*#reset-password=/);
    assert.match(run('kick', created.id, '--yes'), /Disconnect command queued;.*within 1 second/);
    assert.equal((database.prepare('SELECT count(*) AS count FROM moderation_commands WHERE user_id = ?').get(created.id) as { count: number }).count, 2);
    assert.match(run('delete', created.id, '--yes'), /delete complete/);
    assert.equal(database.prepare('SELECT id FROM auth_user WHERE id = ?').get(created.id), undefined);
    assert.equal(database.prepare('SELECT user_id FROM profiles WHERE user_id = ?').get(created.id), undefined);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
