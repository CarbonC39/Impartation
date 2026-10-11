import { db } from './db.js';
import { setRole } from './identity.js';

try {
  const [command, userId, role, ...extra] = process.argv.slice(2);
  if (command === 'list' && !userId) {
    console.table(db.prepare('SELECT user_id AS id, name, avatar_id AS avatar, role FROM profiles ORDER BY updated_at DESC').all());
  } else if (command === 'role' && userId && (role === 'admin' || role === 'member') && !extra.length) {
    if (!setRole(userId, role)) throw new Error('Unknown identity');
    console.log(`Identity ${userId}: ${role}`);
  } else {
    throw new Error('Usage: npm run identity -- list | role <user-id> <admin|member>');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally { db.close(); }
