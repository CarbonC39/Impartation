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
