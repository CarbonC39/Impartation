import type { Room } from '@colyseus/sdk';
import { InteractionRegistry, type SpaceProtocol } from '@virtual-workspace/shared';
import { InteractionDispatcher, type InteractionHandler } from './interactions';
import { BoardInteraction } from './board-interaction';
import { PomodoroInteraction } from './pomodoro-interaction';
import { ExternalToolPanel } from './external-tools';
import { PortalInteraction } from './portal-interaction';
import type { PresentationRegistry } from './presentations';

/** Composition root: integrations register themselves with the generic dispatcher. */
export function createInteractions(room: Room<SpaceProtocol>, presentations?: PresentationRegistry) {
  const tools = new ExternalToolPanel(presentations);
  const registry = new InteractionRegistry<InteractionHandler>()
    .register('board', new BoardInteraction(room))
    .register('pomodoro', new PomodoroInteraction(room))
    .register('Portal', new PortalInteraction(room));
  for (const kind of ['media', 'whiteboard', 'drawing', 'document']) registry.register(kind, tools);
  return new InteractionDispatcher(registry);
}
