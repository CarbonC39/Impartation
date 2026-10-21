import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { z } from 'zod';
import { InteractionRegistry, type SpaceProtocol, type Zone } from '@virtual-workspace/shared';
import { InteractionDispatcher, type InteractionHandler } from '../../frontend/src/interactions/dispatcher.js';
import { PresentationRegistry } from '../../frontend/src/interactions/web/presentations.js';
import type { SpaceRoom } from '../src/rooms/SpaceRoom.js';

// Compile-time check: moving the public contract must not let wire payloads drift.
type Payload<T> = T extends { format: infer F extends z.ZodType } ? z.input<F> : T extends (...args: infer A) => unknown ? A[1] : never;
type Result<T> = T extends { handler: (...args: never[]) => infer R } ? Awaited<R> : T extends (...args: never[]) => infer R ? Awaited<R> : never;
type Same<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
const protocolMatches: { [K in keyof SpaceProtocol['messages']]: Same<Payload<SpaceProtocol['messages'][K]>, Payload<SpaceRoom['messages'][K]>> } = {
  selectVariant: true, privateArea: true, cancelAction: true, input: true, chat: true, typing: true, webTool: true, boardPost: true, boardDelete: true, pomodoro: true, portal: true, activateAction: true,
  voiceEnabled: true, voiceOffer: true, voiceAnswer: true, voiceIceCandidate: true, voiceEnd: true,
};
const responseMatches: { [K in 'boardPost' | 'boardDelete' | 'pomodoro' | 'portal' | 'activateAction' | 'selectVariant' | 'privateArea' | 'cancelAction']: Same<Result<SpaceProtocol['messages'][K]>, Result<SpaceRoom['messages'][K]>> } = {
  selectVariant: true, privateArea: true, cancelAction: true, boardPost: true, boardDelete: true, pomodoro: true, portal: true, activateAction: true,
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

test('claimed point presentation suspends area handlers and restores the latest area', () => {
  const events: string[] = [];
  const handler: InteractionHandler = {
    setZone(zone) { events.push(zone?.id ?? 'exit'); },
    setConnected(value) { events.push(`connected:${value}`); },
    dispose() { events.push('dispose'); },
  };
  const dispatcher = new InteractionDispatcher(new InteractionRegistry<InteractionHandler>().register('web', handler));
  const zone: Zone = { id: 'one', kind: 'web', resourceId: 'tool', properties: {}, x: 0, y: 0, width: 16, height: 16 };
  dispatcher.setZone(zone);
  dispatcher.setZoneSuspended(true);
  dispatcher.setZoneSuspended(true);
  dispatcher.setZone({ ...zone, id: 'two' });
  dispatcher.setConnected(false);
  dispatcher.setZoneSuspended(false);
  dispatcher.setZoneSuspended(false);
  dispatcher.dispose();
  assert.deepEqual(events, ['connected:true', 'one', 'exit', 'connected:false', 'connected:false', 'two', 'dispose']);
});

test('web presentation dispatch selects embed or external by resource configuration and cleans up', () => {
  const events: string[] = [];
  const host = {} as HTMLElement;
  const registry = new PresentationRegistry().register('external', tool => {
    events.push(`external:${tool.resourceId}`); return () => events.push('cleanup:external');
  }).register('embed', tool => {
    events.push(`embed:${tool.resourceId}`); return () => events.push('cleanup:embed');
  });
  const base = { resourceId: 'resource', url: 'https://tools.example/' };
  registry.open(base, host, host)();
  registry.open({ ...base, mode: 'embed' }, host, host)();
  registry.open({ ...base, resourceId: 'another-resource', mode: 'external' }, host, host)();
  assert.deepEqual(events, ['external:resource', 'cleanup:external', 'embed:resource', 'cleanup:embed',
    'external:another-resource', 'cleanup:external']);
  const fallback = new PresentationRegistry().register('external', () => () => {});
  assert.throws(() => fallback.open({ ...base, mode: 'embed' }, host, host));
  assert.throws(() => fallback.open({ ...base, mode: 'embed', fallback: 'external' }, host, host));
});

test('server interactions compose new kinds and reject ambiguous message names', async () => {
  const { registerServerInteractions } = await import('../src/interactions/registry.js');
  let initialized = false;
  const interactions = registerServerInteractions({ custom: { initialize() { initialized = true; }, messages: { customAction: () => 'custom-result' } } });
  for (const handler of interactions.registry.values()) handler.initialize?.();
  assert.equal(initialized, true);
  assert.equal(interactions.messages.customAction(), 'custom-result');
  assert.throws(() => registerServerInteractions({ first: { messages: { same: () => 1 } }, second: { messages: { same: () => 2 } } }), /Duplicate/);
});
