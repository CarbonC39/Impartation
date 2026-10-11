import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { BOARD_LIMIT } from '@virtual-workspace/shared';
import { db } from '../../db.js';

export type StoredNote = {
  id: string; resourceId: string; authorSessionId: string; authorUserId: string; name: string; text: string; createdAt: number;
};

export class BoardStore {
  private listeners = new Set<() => void>();
  constructor(private database: Database.Database) {}

  list(resourceId: string): StoredNote[] {
    return this.database.prepare(`SELECT id, resource_id AS resourceId, author_session_id AS authorSessionId,
      coalesce(author_user_id, '') AS authorUserId, name, text, created_at AS createdAt FROM board_notes WHERE resource_id = ? ORDER BY created_at, id`)
      .all(resourceId) as StoredNote[];
  }

  post(resourceId: string, authorUserId: string, name: string, text: string, authorSessionId = ''): boolean {
    if (!authorUserId) throw new Error('A verified author is required');
    const added = this.database.transaction(() => {
      const count = this.database.prepare('SELECT count(*) AS count FROM board_notes WHERE resource_id = ?')
        .get(resourceId) as { count: number };
      if (count.count >= BOARD_LIMIT) return false;
      this.database.prepare(`INSERT INTO board_notes
        (id, resource_id, author_session_id, author_user_id, name, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), resourceId, authorSessionId, authorUserId, name, text, Date.now());
      return true;
    })();
    if (added) this.notify();
    return added;
  }

  delete(resourceId: string, id: string, authorUserId: string, admin = false): boolean {
    const removed = this.database.prepare('DELETE FROM board_notes WHERE resource_id = ? AND id = ? AND (author_user_id = ? OR ? = 1)')
      .run(resourceId, id, authorUserId, admin ? 1 : 0).changes > 0;
    if (removed) this.notify();
    return removed;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private notify() { for (const listener of this.listeners) listener(); }
}

// One process, one SQLite database: notify every live room when a shared board changes.
export const boards = new BoardStore(db);
