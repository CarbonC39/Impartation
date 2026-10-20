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
    assert.equal(database.pragma('user_version', { simple: true }), 6);
    assert.equal(database.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(database.pragma('foreign_keys', { simple: true }), 1);
    database.prepare('INSERT INTO profiles (user_id, avatar_id, updated_at) VALUES (?, ?, ?)').run('test-profile', 'violet', 123);
    database.prepare('INSERT INTO saved_outfits (user_id, slots_json, updated_at) VALUES (?, ?, ?)')
      .run('without-auth-foreign-key', '[null,null,null]', 456);
    assert.equal(new BoardStore(database).post('message-wall', 'guest-session', '访客', '<b>saved</b>'), true);
    database.close();
    database = openDatabase(path);
    assert.deepEqual(database.prepare('SELECT * FROM profiles').get(), {
      user_id: 'test-profile', avatar_id: 'violet', updated_at: 123, name: '', role: 'member', appearance_json: '{}',
    });
    assert.equal(database.pragma('user_version', { simple: true }), 6);
    assert.deepEqual(database.prepare('SELECT user_id, slots_json, updated_at FROM saved_outfits').get(), {
      user_id: 'without-auth-foreign-key', slots_json: '[null,null,null]', updated_at: 456,
    });
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
  database.pragma('user_version = 7');
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
      assert.equal(upgraded.pragma('user_version', { simple: true }), 6);
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

test('version 4 notes migrate into main and do not appear in another Space', () => {
  const directory = mkdtempSync(join(tmpdir(), 'virtual-space-v4-db-'));
  const path = join(directory, 'world.sqlite');
  try {
    const old = new Database(path);
    old.exec(`CREATE TABLE profiles (
        user_id TEXT PRIMARY KEY, avatar_id TEXT NOT NULL DEFAULT 'mint', updated_at INTEGER NOT NULL,
        name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
        appearance_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE board_notes (
        id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, author_session_id TEXT NOT NULL,
        name TEXT NOT NULL, text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
        created_at INTEGER NOT NULL, author_user_id TEXT
      );
      CREATE INDEX board_notes_resource ON board_notes(resource_id, created_at);
      INSERT INTO board_notes VALUES ('legacy-v4', 'wall', 'old-session', 'Legacy', 'keep in main', 123, NULL);
      PRAGMA user_version = 4;`);
    old.close();

    const upgraded = openDatabase(path);
    try {
      assert.equal(upgraded.pragma('user_version', { simple: true }), 6);
      const main = new BoardStore(upgraded);
      const other = new BoardStore(upgraded, 'studio');
      assert.deepEqual(main.list('wall'), [{ id: 'legacy-v4', resourceId: 'wall', authorSessionId: 'old-session',
        authorUserId: '', name: 'Legacy', text: 'keep in main', createdAt: 123 }]);
      assert.deepEqual(other.list('wall'), []);
      assert.equal(other.post('wall', 'studio-user', 'Studio guest', 'new Space note'), true);
      assert.equal(main.list('wall').length, 1);
      assert.equal(other.list('wall').length, 1);
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

test('board capacity, listing and deletion are isolated by Space for the same resource', () => {
  const database = openDatabase(':memory:');
  try {
    const main = new BoardStore(database, 'main');
    const studio = new BoardStore(database, 'studio');
    for (let i = 0; i < 100; i++) assert.equal(main.post('wall', 'alice', 'Alice', `main ${i}`), true);
    assert.equal(main.post('wall', 'alice', 'Alice', 'main is full'), false);

    assert.equal(studio.post('wall', 'bob', 'Bob', 'studio has its own capacity'), true);
    const studioNote = studio.list('wall')[0]!;
    const mainNote = main.list('wall')[0]!;
    assert.equal(main.delete('wall', studioNote.id, 'bob', true), false);
    assert.equal(studio.delete('wall', mainNote.id, 'alice', true), false);
    assert.equal(main.list('wall').length, 100);
    assert.equal(studio.list('wall').length, 1);
    assert.equal(studio.delete('wall', studioNote.id, 'bob'), true);
    assert.equal(main.list('wall').length, 100);
  } finally { database.close(); }
});
