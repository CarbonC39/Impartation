import { readFileSync } from 'node:fs';
import { createAccount, listAccounts, moderateAccount } from './accounts.js';
import { db } from './db.js';
import { setRole } from './identity.js';

function readPasswordFromStdin(): string {
  if (process.stdin.isTTY) throw new Error('Pipe the password to stdin; do not pass it as a command-line argument');
  const value = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  if (!value) throw new Error('Password stdin is empty');
  return value;
}

function usage(): string {
  return [
    'Usage:',
    '  npm run identity -- list',
    '  npm run identity -- role <user-id> <admin|member> --yes',
    '  npm run identity -- create <username> <display-name> --password-stdin',
    '  npm run identity -- <suspend|unsuspend|delete|reset-password|kick> <user-id> --yes',
  ].join('\n');
}

async function main(args: string[]): Promise<void> {
  const [command, userId, value, ...extra] = args;
  if (command === 'list' && args.length === 1) {
    console.table(listAccounts().map(account => ({
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      role: account.role,
      suspended: account.suspended,
    })));
    return;
  }
  if (command === 'create' && userId && value && extra.length === 1 && extra[0] === '--password-stdin') {
    const account = await createAccount({ username: userId, displayName: value, password: readPasswordFromStdin() });
    console.log(`Created account ${account.username ?? userId} (${account.id})`);
    return;
  }
  if (command === 'role' && userId && (value === 'admin' || value === 'member') && extra.length === 1 && extra[0] === '--yes') {
    if (!setRole(userId, value)) throw new Error('Unknown identity');
    console.log(`Identity ${userId}: ${value}`);
    return;
  }
  const actions = ['suspend', 'unsuspend', 'delete', 'reset-password', 'kick'] as const;
  if (actions.includes(command as typeof actions[number]) && userId && value === '--yes' && extra.length === 0) {
    const action = command as typeof actions[number];
    const result = await moderateAccount(userId, action);
    if (action === 'reset-password') {
      if (!result || typeof result !== 'object' || !('url' in result) || typeof result.url !== 'string') {
        throw new Error('Password reset link was not returned');
      }
      console.log(`Password reset URL: ${result.url}`);
    } else if (action === 'kick') {
      console.log('Disconnect command queued; the online server should process it within 1 second.');
    } else {
      console.log(`Identity ${userId}: ${action} complete`);
    }
    return;
  }
  if (command === 'role' && userId && (value === 'admin' || value === 'member') && extra.length === 0) {
    throw new Error('Role changes require --yes');
  }
  if (actions.includes(command as typeof actions[number]) && userId && value !== '--yes') {
    throw new Error(`${command} requires --yes`);
  }
  throw new Error(usage());
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  db.close();
}
