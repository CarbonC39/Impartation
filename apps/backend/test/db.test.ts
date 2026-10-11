import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

process.env.DATABASE_PATH = ':memory:';
const { openDatabase, db } = await import('../src/db.js');
const { BoardStore } = await import('../src/interactions/board/store.js');
after(() => db.close());

test('SQLite migration is idempotent and data survives reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'virtual-space-db-'));
  const path = join(directory, 'world.sqlite');
  let database = openDatabase(path);
  try {
    assert.equal(database.pragma('user_version', { simple: true }), 3);
    assert.equal(database.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(database.pragma('foreign_keys', { simple: true }), 1);
    database.prepare('INSERT INTO profiles (user_id, avatar_id, updated_at) VALUES (?, ?, ?)').run('test-profile', 'violet', 123);
    assert.equal(new BoardStore(database).post('message-wall', 'guest-session', '访客', '<b>saved</b>'), true);
    database.close();
    database = openDatabase(path);
    assert.deepEqual(database.prepare('SELECT * FROM profiles').get(), {
      user_id: 'test-profile', avatar_id: 'violet', updated_at: 123, name: '', role: 'member',
    });
    assert.equal(database.pragma('user_version', { simple: true }), 3);
    const notes = new BoardStore(database).list('message-wall');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].text, '<b>saved</b>');
    assert.equal(notes[0].authorUserId, 'guest-session');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a database from a newer application is rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'virtual-space-new-db-'));
  const path = join(directory, 'world.sqlite');
  const database = openDatabase(path);
  database.pragma('user_version = 4');
  database.close();
  try { assert.throws(() => openDatabase(path), /newer/); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});

test('version 1 databases migrate without losing existing profiles', () => {
  // Exercise an actual on-disk v1 reopen, rather than changing the running connection.
  const directory = mkdtempSync(join(tmpdir(), 'virtual-space-v1-db-'));
  const path = join(directory, 'world.sqlite');
  try {
    const old = new Database(path);
    old.exec("CREATE TABLE profiles (user_id TEXT PRIMARY KEY, avatar_id TEXT NOT NULL DEFAULT 'mint', updated_at INTEGER NOT NULL)");
    old.pragma('user_version = 1');
    old.prepare('INSERT INTO profiles VALUES (?, ?, ?)').run('existing', 'mint', 123);
    old.close();
    const upgraded = openDatabase(path);
    try {
      assert.equal(upgraded.pragma('user_version', { simple: true }), 3);
      assert.deepEqual(upgraded.prepare('SELECT user_id FROM profiles').get(), { user_id: 'existing' });
      assert.equal(new BoardStore(upgraded).post('wall', 'guest', 'Guest', 'works'), true);
    } finally { upgraded.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('version 2 migration preserves legacy notes without assigning them to a new identity', () => {
  const directory = mkdtempSync(join(tmpdir(), 'virtual-space-v2-db-'));
  const path = join(directory, 'world.sqlite');
  try {
    const old = new Database(path);
    old.exec(`CREATE TABLE profiles (user_id TEXT PRIMARY KEY, avatar_id TEXT NOT NULL DEFAULT 'mint', updated_at INTEGER NOT NULL);
      CREATE TABLE board_notes (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, author_session_id TEXT NOT NULL,
        name TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL);
      INSERT INTO board_notes VALUES ('legacy', 'wall', 'old-session', 'Legacy', 'preserved', 123);
      PRAGMA user_version = 2;`);
    old.close();
    const upgraded = openDatabase(path);
    try {
      const store = new BoardStore(upgraded);
      assert.deepEqual(store.list('wall')[0], { id: 'legacy', resourceId: 'wall', authorSessionId: 'old-session',
        authorUserId: '', name: 'Legacy', text: 'preserved', createdAt: 123 });
      assert.equal(store.delete('wall', 'legacy', 'old-session'), false);
      assert.equal(store.delete('wall', 'legacy', 'admin-user', true), true);
      assert.throws(() => upgraded.prepare('INSERT INTO profiles (user_id, updated_at, role) VALUES (?, ?, ?)').run('bad-role', 123, 'owner'));
    } finally { upgraded.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('boards enforce capacity, resource separation, identity ownership and unsubscribe', () => {
  const database = openDatabase(':memory:');
  try {
    const store = new BoardStore(database);
    let changes = 0;
    const unsubscribe = store.subscribe(() => changes++);
    for (let i = 0; i < 100; i++) assert.equal(store.post('wall', 'alice', 'Alice', `note ${i}`), true);
    assert.equal(store.post('wall', 'alice', 'Alice', 'full'), false);
    assert.equal(store.post('other-wall', 'bob', 'Bob', 'other resource'), true);
    const note = store.list('wall')[0];
    assert.equal(store.delete('wall', note.id, 'bob'), false);
    assert.equal(store.delete('other-wall', note.id, 'alice'), false);
    assert.equal(store.delete('wall', note.id, 'alice'), true);
    assert.equal(changes, 102);
    unsubscribe();
    assert.equal(store.post('wall', 'alice', 'Alice', 'free seat'), true);
    assert.equal(changes, 102);
    assert.equal(store.list('wall').length, 100);
    assert.equal(store.list('other-wall').length, 1);
  } finally { database.close(); }
});
