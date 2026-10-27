import type {
  ActivateActionInput, SelectVariantInput, PrivateAreaOperationInput,
  BoardDeleteInput,
  BoardPostInput,
  ChatMessage,
  InteractionResult,
  TakeAttachmentInput,
  SpaceJoinOptions,
  QuickTravelInput,
  MovementInput,
  Facing,
  PomodoroActionInput,
  SpaceState,
  VoiceAnswer, VoiceEnd, VoiceIceCandidate, VoiceOffer, VoiceSignal,
} from './index.js';

/** Client-facing structural contract for the space room. */
export type SpaceProtocol = {
  '~state': SpaceState;
  state: SpaceState;
  onJoin?: (client: unknown, options?: SpaceJoinOptions) => unknown;
  '~client': {
    '~messages': {
      chat: ChatMessage;
      voiceOffer: VoiceSignal<VoiceOffer>;
      voiceAnswer: VoiceSignal<VoiceAnswer>;
      voiceIceCandidate: VoiceSignal<VoiceIceCandidate>;
      voiceEnd: VoiceSignal<VoiceEnd>;
    };
  };
  messages: {
    input: (client: unknown, input: MovementInput) => void;
    face: (client: unknown, facing: Facing) => void;
    chat: (client: unknown, input: { text: string }) => void;
    typing: (client: unknown, input: { typing: boolean }) => void;
    webTool: (client: unknown, input: { open: boolean; zoneId?: string }) => void;
    boardPost: (client: unknown, input: BoardPostInput) => InteractionResult;
    boardDelete: (client: unknown, input: BoardDeleteInput) => InteractionResult;
    pomodoro: (client: unknown, input: PomodoroActionInput) => InteractionResult;
    portal: (client: unknown, input: { zoneId: string }) => InteractionResult;
    quickTravel: (client: unknown, input: QuickTravelInput) => InteractionResult;
    selectVariant: (client: unknown, input: SelectVariantInput) => InteractionResult;
    privateArea: (client: unknown, input: PrivateAreaOperationInput) => InteractionResult;
    cancelAction: (client: unknown, input: Record<string, never>) => InteractionResult;
    activateAction: (client: unknown, input: ActivateActionInput) => InteractionResult;
    takeAttachment: (client: unknown, input: TakeAttachmentInput) => InteractionResult;
    clearAttachment: (client: unknown, input: Record<string, never>) => InteractionResult;
    voiceEnabled: (client: unknown, input: { enabled: boolean }) => boolean;
    voiceOffer: (client: unknown, input: VoiceOffer) => boolean;
    voiceAnswer: (client: unknown, input: VoiceAnswer) => boolean;
    voiceIceCandidate: (client: unknown, input: VoiceIceCandidate) => void;
    voiceEnd: (client: unknown, input: VoiceEnd) => void;
  };
};
