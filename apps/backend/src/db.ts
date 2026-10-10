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
    if (version > 1) throw new Error('Database is newer than this application');
    if (version < 1) database.transaction(() => {
      database.exec(`CREATE TABLE profiles (
        user_id TEXT PRIMARY KEY,
        avatar_id TEXT NOT NULL DEFAULT 'mint',
        updated_at INTEGER NOT NULL
      );`);
      database.pragma('user_version = 1');
    })();
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export const db = openDatabase(config.DATABASE_PATH);
