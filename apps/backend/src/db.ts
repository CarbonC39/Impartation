import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

if (config.DATABASE_PATH !== ':memory:') mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });
export const db = new Database(config.DATABASE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Reserved application profile storage. No guest identity is persisted as an account.
const version = db.pragma('user_version', { simple: true }) as number;
if (version > 1) throw new Error('Database is newer than this application');
if (version < 1) db.transaction(() => {
  db.exec(`CREATE TABLE profiles (
    user_id TEXT PRIMARY KEY,
    avatar_id TEXT NOT NULL DEFAULT 'mint',
    updated_at INTEGER NOT NULL
  );`);
  db.pragma('user_version = 1');
})();
