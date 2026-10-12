import type { Room } from '@colyseus/sdk';
import { InteractionRegistry, type SpaceProtocol } from '@virtual-workspace/shared';
import { InteractionDispatcher, type InteractionHandler } from './dispatcher';
import { BoardInteraction } from './board/handler';
import { PomodoroInteraction } from './pomodoro/handler';
import { WebToolInteraction } from './web/handler';
import { PortalInteraction } from './portal/handler';
import type { PresentationRegistry } from './web/presentations';

/** Composition root: register concrete interactions with the generic dispatcher. */
export function createInteractions(room: Room<SpaceProtocol>, presentations?: PresentationRegistry) {
  const registry = new InteractionRegistry<InteractionHandler>()
    .register('board', new BoardInteraction(room))
    .register('pomodoro', new PomodoroInteraction(room))
    .register('Portal', new PortalInteraction(room))
    .register('web', new WebToolInteraction(presentations));
  return new InteractionDispatcher(registry);
}
