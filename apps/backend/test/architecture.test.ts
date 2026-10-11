import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { z } from 'zod';
import { InteractionRegistry, type SpaceProtocol, type Zone } from '@virtual-workspace/shared';
import { InteractionDispatcher, type InteractionHandler } from '../../frontend/src/interactions.js';
import { PresentationRegistry } from '../../frontend/src/presentations.js';
import type { SpaceRoom } from '../src/rooms/SpaceRoom.js';

// Compile-time check: moving the public contract must not let wire payloads drift.
type Payload<T> = T extends { format: z.ZodType<infer P> } ? P : T extends (...args: infer A) => unknown ? A[1] : never;
type Result<T> = T extends { handler: (...args: never[]) => infer R } ? Awaited<R> : T extends (...args: never[]) => infer R ? Awaited<R> : never;
type Same<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
const protocolMatches: { [K in keyof SpaceProtocol['messages']]: Same<Payload<SpaceProtocol['messages'][K]>, Payload<SpaceRoom['messages'][K]>> } = {
  input: true, chat: true, boardPost: true, boardDelete: true, pomodoro: true, portal: true,
};
const responseMatches: { [K in 'boardPost' | 'boardDelete' | 'pomodoro' | 'portal']: Same<Result<SpaceProtocol['messages'][K]>, Result<SpaceRoom['messages'][K]>> } = {
  boardPost: true, boardDelete: true, pomodoro: true, portal: true,
};

test('shared protocol agrees with the server and frontend depends only on shared contracts', () => {
  assert.ok(Object.values(protocolMatches).every(Boolean));
  assert.ok(Object.values(responseMatches).every(Boolean));
  const root = fileURLToPath(new URL('../../frontend/', import.meta.url));
  const packageJson = z.object({ dependencies: z.record(z.string(), z.string()), devDependencies: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readFileSync(root + 'package.json', 'utf8')));
  assert.equal(packageJson.dependencies['@virtual-workspace/backend'], undefined);
  assert.equal(packageJson.devDependencies['@virtual-workspace/backend'], undefined);
  assert.match(packageJson.dependencies.phaser, /4\./);
  for (const path of globSync('**/*.ts', { cwd: root + 'src' })) {
    assert.doesNotMatch(readFileSync(root + 'src/' + path, 'utf8'), /@virtual-workspace\/backend/);
  }
});

test('generic interaction dispatch supports new kinds and shared handlers with deterministic cleanup', () => {
  const events: string[] = [];
  const handler: InteractionHandler = {
    setZone(zone) { events.push(zone?.id ?? 'exit'); },
    setConnected(value) { events.push(`connected:${value}`); },
    dispose() { events.push('dispose'); },
  };
  const registry = new InteractionRegistry<InteractionHandler>().register('custom-a', handler).register('custom-b', handler);
  const dispatcher = new InteractionDispatcher(registry);
  const zone: Zone = { id: 'one', kind: 'custom-a', resourceId: '', properties: {}, x: 0, y: 0, width: 16, height: 16 };
  dispatcher.setZone(zone); dispatcher.setZone(zone);
  dispatcher.setZone({ ...zone, id: 'two', kind: 'custom-b' });
  dispatcher.setConnected(false);
  dispatcher.setZone({ ...zone, id: 'unhandled', kind: 'custom-c' });
  dispatcher.dispose();
  assert.deepEqual(events, ['connected:true', 'one', 'exit', 'connected:true', 'two', 'connected:false', 'exit', 'dispose']);
});

test('presentation dispatch selects modes and adapters independently of kind, and fallback is explicit', () => {
  const events: string[] = [];
  const host = {} as HTMLElement;
  const registry = new PresentationRegistry().register('external', tool => {
    events.push(`external:${tool.kind}`); return () => events.push('cleanup:external');
  }).register('embed', tool => {
    events.push(`embed:${tool.kind}`); return () => events.push('cleanup:embed');
  }).registerAdapter('custom-view', tool => {
    events.push(`${tool.mode}:${tool.kind}`); return () => events.push('cleanup:adapter');
  });
  const base = { resourceId: 'resource', kind: 'whiteboard' as const, url: 'https://tools.example/' };
  registry.open(base, host)();
  registry.open({ ...base, mode: 'embed' }, host)();
  registry.open({ ...base, mode: 'native', adapterId: 'custom-view' }, host)();
  registry.open({ ...base, mode: 'adapter', adapterId: 'custom-view' }, host)();
  registry.open({ ...base, mode: 'adapter', adapterId: 'missing', fallback: 'external' }, host)();
  assert.throws(() => registry.open({ ...base, mode: 'adapter', adapterId: 'missing' }, host));
  assert.deepEqual(events, ['external:whiteboard', 'cleanup:external', 'embed:whiteboard', 'cleanup:embed',
    'native:whiteboard', 'cleanup:adapter', 'adapter:whiteboard', 'cleanup:adapter', 'external:whiteboard', 'cleanup:external']);
});

test('server interactions compose new kinds and reject ambiguous message names', async () => {
  const { registerServerInteractions } = await import('../src/integrations/registry.js');
  let initialized = false;
  const interactions = registerServerInteractions({ custom: { initialize() { initialized = true; }, messages: { customAction: () => 'custom-result' } } });
  for (const handler of interactions.registry.values()) handler.initialize?.();
  assert.equal(initialized, true);
  assert.equal(interactions.messages.customAction(), 'custom-result');
  assert.throws(() => registerServerInteractions({ first: { messages: { same: () => 1 } }, second: { messages: { same: () => 2 } } }), /Duplicate/);
});
