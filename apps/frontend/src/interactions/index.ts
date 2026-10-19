import type { Room } from '@colyseus/sdk';
import { InteractionRegistry, type SpaceProtocol, type WorldMap } from '@virtual-workspace/shared';
import { InteractionDispatcher, type InteractionHandler } from './dispatcher';
import { BoardInteraction } from './board/handler';
import { PomodoroInteraction } from './pomodoro/handler';
import { WebToolInteraction } from './web/handler';
import { PortalInteraction } from './portal/handler';
import { VariantSelectorInteraction } from './variantSelector/handler';
import { PrivateAreaInteraction } from './privateArea/handler';
import { WardrobeInteraction } from './wardrobe/handler';
import type { PresentationRegistry } from './web/presentations';

/** Composition root: register concrete interactions with the generic dispatcher. */
export function createInteractions(room: Room<SpaceProtocol>, presentations?: PresentationRegistry, native?: { world(): WorldMap | undefined; openWardrobe(): void }) {
  const registry = new InteractionRegistry<InteractionHandler>()
    .register('board', new BoardInteraction(room))
    .register('pomodoro', new PomodoroInteraction(room))
    .register('Portal', new PortalInteraction(room))
    .register('web', new WebToolInteraction(presentations));
  const dispatcher = new InteractionDispatcher(registry);
  if (native) registry.register('variantSelector', new VariantSelectorInteraction(room, native.world, claimed => dispatcher.setZoneSuspended(claimed)))
    .register('privateArea', new PrivateAreaInteraction(room))
    .register('wardrobe', new WardrobeInteraction(native.openWardrobe));
  return dispatcher;
}
