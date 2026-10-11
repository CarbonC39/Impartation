import { createBoardInteraction } from './board.js';
import { createPomodoroInteraction } from './pomodoro.js';
import { createPortalInteraction } from './portal.js';
import { registerServerInteractions } from './registry.js';

export function createInteractions(context: Parameters<typeof createPortalInteraction>[0]) {
  return registerServerInteractions({
    board: createBoardInteraction(context),
    pomodoro: createPomodoroInteraction(context),
    Portal: createPortalInteraction(context),
  });
}
