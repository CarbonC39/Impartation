import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

process.env.DATABASE_PATH = ':memory:';
const { openDatabase, db } = await import('../src/db.js');
const { BoardStore } = await import('../src/board.js');
after(() => db.close());

test('SQLite migration is idempotent and data survives reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'virtual-space-db-'));
  const path = join(directory, 'world.sqlite');
  let database = openDatabase(path);
  try {
    assert.equal(database.pragma('user_version', { simple: true }), 2);
    assert.equal(database.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(database.pragma('foreign_keys', { simple: true }), 1);
    database.prepare('INSERT INTO profiles (user_id, avatar_id, updated_at) VALUES (?, ?, ?)').run('test-profile', 'violet', 123);
    assert.equal(new BoardStore(database).post('message-wall', 'guest-session', '访客', '<b>saved</b>'), true);
    database.close();
    database = openDatabase(path);
    assert.deepEqual(database.prepare('SELECT * FROM profiles').get(), {
      user_id: 'test-profile', avatar_id: 'violet', updated_at: 123,
    });
    assert.equal(database.pragma('user_version', { simple: true }), 2);
    const notes = new BoardStore(database).list('message-wall');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].text, '<b>saved</b>');
    assert.equal(notes[0].authorSessionId, 'guest-session');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a database from a newer application is rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'virtual-space-new-db-'));
  const path = join(directory, 'world.sqlite');
  const database = openDatabase(path);
  database.pragma('user_version = 3');
  database.close();
  try { assert.throws(() => openDatabase(path), /newer/); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});

test('version 1 databases migrate without losing existing profiles', () => {
  // Exercise an actual on-disk v1 reopen, rather than changing the running connection.
  const directory = mkdtempSync(join(tmpdir(), 'virtual-space-v1-db-'));
  const path = join(directory, 'world.sqlite');
  try {
    const old = openDatabase(path);
    old.exec('DROP TABLE board_notes');
    old.pragma('user_version = 1');
    old.prepare('INSERT INTO profiles VALUES (?, ?, ?)').run('existing', 'mint', 123);
    old.close();
    const upgraded = openDatabase(path);
    try {
      assert.equal(upgraded.pragma('user_version', { simple: true }), 2);
      assert.deepEqual(upgraded.prepare('SELECT user_id FROM profiles').get(), { user_id: 'existing' });
      assert.equal(new BoardStore(upgraded).post('wall', 'guest', 'Guest', 'works'), true);
    } finally { upgraded.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('boards enforce capacity, resource separation, session ownership and unsubscribe', () => {
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
