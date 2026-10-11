import type {
  BoardDeleteInput,
  BoardPostInput,
  ChatMessage,
  InteractionResult,
  JoinOptions,
  MovementInput,
  PomodoroActionInput,
  SpaceState,
} from './index.js';

/** Client-facing structural contract for the space room. */
export type SpaceProtocol = {
  '~state': SpaceState;
  state: SpaceState;
  onJoin?: (client: unknown, options?: JoinOptions) => unknown;
  '~client': {
    '~messages': {
      chat: ChatMessage;
    };
  };
  messages: {
    input: (client: unknown, input: MovementInput) => void;
    chat: (client: unknown, input: { text: string }) => void;
    boardPost: (client: unknown, input: BoardPostInput) => InteractionResult;
    boardDelete: (client: unknown, input: BoardDeleteInput) => InteractionResult;
    pomodoro: (client: unknown, input: PomodoroActionInput) => InteractionResult;
    portal: (client: unknown, input: { zoneId: string }) => InteractionResult;
  };
};
