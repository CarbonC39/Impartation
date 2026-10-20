import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../../../', import.meta.url));

function loadMaxClients(value?: string, expected?: number) {
  const env = { ...process.env };
  delete env.SPACE_MAX_CLIENTS;
  delete env.NODE_TEST_CONTEXT;
  if (value !== undefined) env.SPACE_MAX_CLIENTS = value;
  const assertion = expected === undefined ? '' : `if (config.SPACE_MAX_CLIENTS !== ${expected}) process.exit(2);`;
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', '--input-type=module', '-e',
    `const { config } = await import('./apps/backend/src/config.ts'); ${assertion}`,
  ], { cwd, env, encoding: 'utf8' });
  return result;
}

function loadRegistration(mode: string | undefined, requiredCode: string | undefined, suppliedCode: string | undefined) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.DATABASE_PATH = ':memory:';
  delete env.SPACE_MAX_CLIENTS;
  delete env.NODE_TEST_CONTEXT;
  delete env.REGISTRATION_MODE;
  delete env.REGISTRATION_CODE;
  if (mode !== undefined) env.REGISTRATION_MODE = mode;
  if (requiredCode !== undefined) env.REGISTRATION_CODE = requiredCode;
  if (suppliedCode !== undefined) env.TEST_REGISTRATION_CODE = suppliedCode;
  else delete env.TEST_REGISTRATION_CODE;
  return spawnSync(process.execPath, [
    '--import', 'tsx', '--input-type=module', '-e',
    `const { registrationAllowed } = await import('./apps/backend/src/accounts.ts'); if (!registrationAllowed(process.env.TEST_REGISTRATION_CODE)) process.exit(2);`,
  ], { cwd, env, encoding: 'utf8' });
}

test('SPACE_MAX_CLIENTS defaults to 32 and accepts an integer environment override', () => {
  const fallback = loadMaxClients(undefined, 32);
  assert.equal(fallback.status, 0, fallback.stderr);

  const override = loadMaxClients('48', 48);
  assert.equal(override.status, 0, override.stderr);
});

test('SPACE_MAX_CLIENTS rejects zero, negative, fractional and non-numeric values', () => {
  for (const value of ['0', '-1', '1.5', 'many']) {
    const result = loadMaxClients(value);
    assert.equal(result.status, 1, `Expected ${JSON.stringify(value)} to be rejected; stdout=${result.stdout} stderr=${result.stderr}`);
  }
});

test('registration mode defaults to open and admin mode disables public registration', () => {
  assert.equal(loadRegistration(undefined, undefined, undefined).status, 0);
  const admin = loadRegistration('admin', undefined, undefined);
  assert.equal(admin.status, 2, admin.stderr);
});

test('code registration requires a configured code and compares submitted codes', () => {
  const missing = loadRegistration('code', undefined, 'secret-code');
  assert.equal(missing.status, 1, missing.stderr);
  const correct = loadRegistration('code', 'secret-code', 'secret-code');
  assert.equal(correct.status, 0, correct.stderr);
  const incorrect = loadRegistration('code', 'secret-code', 'wrong-code');
  assert.equal(incorrect.status, 2, incorrect.stderr);
});
