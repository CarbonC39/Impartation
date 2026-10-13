import { createBoardInteraction } from './board/handler.js';
import { createPomodoroInteraction } from './pomodoro/handler.js';
import { createPortalInteraction } from './portal/handler.js';
import { registerServerInteractions } from './registry.js';
import { createActionInteraction } from './action/handler.js';

export function createInteractions(context: Parameters<typeof createActionInteraction>[0]) {
  return registerServerInteractions({
    board: createBoardInteraction(context),
    pomodoro: createPomodoroInteraction(context),
    Portal: createPortalInteraction(context),
    action: createActionInteraction(context),
  });
}
