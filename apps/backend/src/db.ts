import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path);
  try {
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 5000');
    // Reserved profile storage. Guest identities are never persisted as accounts.
    const version = database.pragma('user_version', { simple: true }) as number;
    if (version > 2) throw new Error('Database is newer than this application');
    if (version < 1) database.transaction(() => {
      database.exec(`CREATE TABLE profiles (
        user_id TEXT PRIMARY KEY,
        avatar_id TEXT NOT NULL DEFAULT 'mint',
        updated_at INTEGER NOT NULL
      );`);
      database.pragma('user_version = 1');
    })();
    if (version < 2) database.transaction(() => {
      database.exec(`CREATE TABLE board_notes (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        author_session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
        created_at INTEGER NOT NULL
      );
      CREATE INDEX board_notes_resource ON board_notes(resource_id, created_at);`);
      database.pragma('user_version = 2');
    })();
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export const db = openDatabase(config.DATABASE_PATH);
