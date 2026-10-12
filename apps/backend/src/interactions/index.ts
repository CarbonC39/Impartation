import { createBoardInteraction } from './board/handler.js';
import { createPomodoroInteraction } from './pomodoro/handler.js';
import { createPortalInteraction } from './portal/handler.js';
import { registerServerInteractions } from './registry.js';
import { createSeatInteraction } from './seat/handler.js';

export function createInteractions(context: Parameters<typeof createSeatInteraction>[0]) {
  return registerServerInteractions({
    board: createBoardInteraction(context),
    pomodoro: createPomodoroInteraction(context),
    Portal: createPortalInteraction(context),
    seat: createSeatInteraction(context),
  });
}
