import type { Client } from '@colyseus/core';
import type { ChatMessage, SpaceState, WorldMap, Zone } from '@virtual-workspace/shared';
import type { activeProfile } from '../identity.js';

export type SpaceClient = Client<{ messages: { chat: ChatMessage } }>;
export type InteractionContext = {
  state: SpaceState;
  worlds: WorldMap[];
  authorize(client: SpaceClient): ReturnType<typeof activeProfile>;
  check(client: SpaceClient, kind: Zone['kind'], resourceId: string): string | undefined;
};
export type ServerInteraction = { messages?: object; initialize?(): void; tick?(): void; dispose?(): void };
