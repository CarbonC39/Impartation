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
    const version = database.pragma('user_version', { simple: true }) as number;
    if (version > 6) throw new Error('Database is newer than this application');
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
    if (version < 3) database.transaction(() => {
      database.exec(`ALTER TABLE profiles ADD COLUMN name TEXT NOT NULL DEFAULT '';
        ALTER TABLE profiles ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin'));
        ALTER TABLE board_notes ADD COLUMN author_user_id TEXT;`);
      database.pragma('user_version = 3');
    })();
    if (version < 4) database.transaction(() => {
      database.exec("ALTER TABLE profiles ADD COLUMN appearance_json TEXT NOT NULL DEFAULT '{}';");
      database.pragma('user_version = 4');
    })();
    if (version < 5) database.transaction(() => {
      // Preserve pre-Space notes in the default Space, never copy them into every Space.
      database.exec(`ALTER TABLE board_notes ADD COLUMN space_id TEXT NOT NULL DEFAULT 'main';
        DROP INDEX IF EXISTS board_notes_resource;
        CREATE INDEX board_notes_space_resource ON board_notes(space_id, resource_id, created_at);`);
      database.pragma('user_version = 5');
    })();
    if (version < 6) database.transaction(() => {
      database.exec(`CREATE TABLE saved_outfits (
        user_id TEXT PRIMARY KEY,
        slots_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE moderation_commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );`);
      database.pragma('user_version = 6');
    })();
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export const db = openDatabase(config.DATABASE_PATH);
