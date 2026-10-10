import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

process.env.DATABASE_PATH = ':memory:';
const { openDatabase, db } = await import('../src/db.js');
after(() => db.close());

test('SQLite migration is idempotent and data survives reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'virtual-space-db-'));
  const path = join(directory, 'world.sqlite');
  let database = openDatabase(path);
  try {
    assert.equal(database.pragma('user_version', { simple: true }), 1);
    assert.equal(database.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(database.pragma('foreign_keys', { simple: true }), 1);
    database.prepare('INSERT INTO profiles (user_id, avatar_id, updated_at) VALUES (?, ?, ?)').run('test-profile', 'violet', 123);
    database.close();
    database = openDatabase(path);
    assert.deepEqual(database.prepare('SELECT * FROM profiles').get(), {
      user_id: 'test-profile', avatar_id: 'violet', updated_at: 123,
    });
    assert.equal(database.pragma('user_version', { simple: true }), 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a database from a newer application is rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'virtual-space-new-db-'));
  const path = join(directory, 'world.sqlite');
  const database = openDatabase(path);
  database.pragma('user_version = 2');
  database.close();
  try { assert.throws(() => openDatabase(path), /newer/); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});
