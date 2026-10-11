import { InteractionRegistry } from '@virtual-workspace/shared';
import type { ServerInteraction } from './context.js';

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I : never;
type Messages<T> = UnionToIntersection<{ [K in keyof T]: T[K] extends { messages: infer M } ? M : object }[keyof T]>;

/** Compose typed message handlers and lifecycle hooks without interaction-specific dispatch. */
export function registerServerInteractions<T extends Record<string, ServerInteraction>>(handlers: T) {
  const registry = new InteractionRegistry<ServerInteraction>();
  const messages: Record<string, unknown> = {};
  for (const [kind, handler] of Object.entries(handlers)) {
    registry.register(kind, handler);
    for (const [name, message] of Object.entries(handler.messages ?? {})) {
      if (Object.hasOwn(messages, name)) throw new Error(`Duplicate interaction message: ${name}`);
      messages[name] = message;
    }
  }
  // Each registered dictionary contributes its exact message types to the intersection.
  return { registry, messages: messages as Messages<T> };
}
