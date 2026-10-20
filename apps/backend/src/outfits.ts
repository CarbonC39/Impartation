import { savedOutfitsSchema, type SavedOutfits } from '@virtual-workspace/shared';
import { db } from './db.js';

const EMPTY_OUTFITS: SavedOutfits = [null, null, null];

export function loadSavedOutfits(userId: string): SavedOutfits {
  const row = db.prepare('SELECT slots_json AS slotsJson FROM saved_outfits WHERE user_id = ?')
    .get(userId) as { slotsJson: string } | undefined;
  if (!row) return [...EMPTY_OUTFITS];
  return savedOutfitsSchema.parse(JSON.parse(row.slotsJson));
}

export function saveSavedOutfits(userId: string, value: unknown): SavedOutfits {
  const slots = savedOutfitsSchema.parse(value);
  db.prepare(`INSERT INTO saved_outfits (user_id, slots_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET slots_json = excluded.slots_json, updated_at = excluded.updated_at`)
    .run(userId, JSON.stringify(slots), Date.now());
  return slots;
}
