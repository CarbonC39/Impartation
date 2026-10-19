import { createBoardInteraction } from './board/handler.js';
import { createPomodoroInteraction } from './pomodoro/handler.js';
import { createPortalInteraction } from './portal/handler.js';
import { registerServerInteractions } from './registry.js';
import { createPrivateAreaInteraction } from './privateArea/handler.js';
import { createVariantSelectorInteraction } from './variantSelector/handler.js';
import { createActionInteraction, type ActionContext } from './action/handler.js';

export function createInteractions(context: ActionContext) {
  const access = createPrivateAreaInteraction(context);
  const composed = { ...context, access };
  return { ...registerServerInteractions({
    board: createBoardInteraction(context),
    pomodoro: createPomodoroInteraction(context),
    Portal: createPortalInteraction(composed),
    action: createActionInteraction(composed),
    variantSelector: createVariantSelectorInteraction(context),
    privateArea: access,
  }), access };
}
