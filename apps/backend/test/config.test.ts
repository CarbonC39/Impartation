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

function loadVoiceRadius(values: Partial<Record<'VOICE_CONNECT_RADIUS' | 'VOICE_DISCONNECT_RADIUS', string>>) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.VOICE_CONNECT_RADIUS;
  delete env.VOICE_DISCONNECT_RADIUS;
  Object.assign(env, values);
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "const { voiceConfig } = await import('./apps/backend/src/config.ts'); console.log(`${voiceConfig.connectRadius},${voiceConfig.disconnectRadius}`);"],
  { cwd, env, encoding: 'utf8' });
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

function loadTurnConfig(values: Partial<Record<'VOICE_TURN_URLS' | 'VOICE_TURN_SHARED_SECRET' | 'VOICE_TURN_CREDENTIAL_TTL_SECONDS', string>>) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.DATABASE_PATH = ':memory:';
  delete env.NODE_TEST_CONTEXT;
  delete env.VOICE_TURN_URLS;
  delete env.VOICE_TURN_SHARED_SECRET;
  delete env.VOICE_TURN_CREDENTIAL_TTL_SECONDS;
  Object.assign(env, values);
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "await import('./apps/backend/src/config.ts');"], { cwd, env, encoding: 'utf8' });
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

test('voice radii default wider and accept environment overrides', () => {
  const defaults = loadVoiceRadius({});
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.match(defaults.stdout, /320,384/);
  const override = loadVoiceRadius({ VOICE_CONNECT_RADIUS: '512', VOICE_DISCONNECT_RADIUS: '640' });
  assert.equal(override.status, 0, override.stderr);
  assert.match(override.stdout, /512,640/);
  assert.notEqual(loadVoiceRadius({ VOICE_CONNECT_RADIUS: '400', VOICE_DISCONNECT_RADIUS: '300' }).status, 0);
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

test('TURN defaults keep public STUN-only deployments valid and require paired configuration', () => {
  assert.equal(loadTurnConfig({}).status, 0);
  const configured = loadTurnConfig({ VOICE_TURN_URLS: 'turn:relay.example.test:3478',
    VOICE_TURN_SHARED_SECRET: 'test-turn-shared-secret-with-at-least-32-chars' });
  assert.equal(configured.status, 0, configured.stderr);
  assert.notEqual(loadTurnConfig({ VOICE_TURN_URLS: 'turn:relay.example.test:3478' }).status, 0);
  assert.notEqual(loadTurnConfig({ VOICE_TURN_SHARED_SECRET: 'test-turn-shared-secret-with-at-least-32-chars' }).status, 0);
});

test('TURN config validates relay URLs, shared secret length and credential lifetime bounds', () => {
  const secret = 'test-turn-shared-secret-with-at-least-32-chars';
  const urls = 'turn:relay.example.test:3478';
  assert.notEqual(loadTurnConfig({ VOICE_TURN_URLS: 'https://relay.example.test', VOICE_TURN_SHARED_SECRET: secret }).status, 0);
  assert.notEqual(loadTurnConfig({ VOICE_TURN_URLS: urls, VOICE_TURN_SHARED_SECRET: 'short' }).status, 0);
  for (const ttl of ['60', '86400']) {
    const result = loadTurnConfig({ VOICE_TURN_URLS: urls, VOICE_TURN_SHARED_SECRET: secret, VOICE_TURN_CREDENTIAL_TTL_SECONDS: ttl });
    assert.equal(result.status, 0, result.stderr);
  }
  for (const ttl of ['59', '86401', '60.5']) {
    assert.notEqual(loadTurnConfig({ VOICE_TURN_URLS: urls, VOICE_TURN_SHARED_SECRET: secret, VOICE_TURN_CREDENTIAL_TTL_SECONDS: ttl }).status, 0);
  }
});
