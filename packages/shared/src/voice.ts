import { z } from 'zod';

const peerId = z.string().min(1).max(128);
const connectionId = z.uuid();
export const voiceEnabledSchema = z.object({ enabled: z.boolean() }).strict();
export const voiceOfferSchema = z.object({ peerId, connectionId, sdp: z.string().min(1).max(65_536) }).strict();
export const voiceAnswerSchema = voiceOfferSchema;
export const voiceIceCandidateSchema = z.object({
  peerId, connectionId, candidate: z.string().min(1).max(4096),
  sdpMid: z.string().max(256).nullable(), sdpMLineIndex: z.number().int().min(0).max(255).nullable(),
  usernameFragment: z.string().max(256).nullable().optional(),
}).strict();
export const voiceEndSchema = z.object({ peerId, connectionId }).strict();
export type VoiceOffer = z.infer<typeof voiceOfferSchema>;
export type VoiceAnswer = z.infer<typeof voiceAnswerSchema>;
export type VoiceIceCandidate = z.infer<typeof voiceIceCandidateSchema>;
export type VoiceEnd = z.infer<typeof voiceEndSchema>;
export type VoiceSignal<T> = T & { sessionId: string };

const iceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string()).min(1)]),
  username: z.string().optional(), credential: z.string().optional(),
}).strict().superRefine((server, context) => {
  for (const url of [server.urls].flat()) {
    if (!/^(stun|stuns|turn|turns):[^\s]+$/i.test(url)) {
      context.addIssue({ code: 'custom', message: 'ICE URL must use stun:, stuns:, turn: or turns:' });
    }
  }
});
export const voiceConfigSchema = z.object({
  iceServers: z.array(iceServerSchema).max(16),
  connectRadius: z.number().positive().max(10_000),
  disconnectRadius: z.number().positive().max(10_000),
  maxPeers: z.number().int().min(1).max(32),
  scanIntervalMs: z.number().int().min(250).max(5000),
}).strict().refine(value => value.disconnectRadius > value.connectRadius,
  'disconnectRadius must be greater than connectRadius');
export type VoiceConfig = z.infer<typeof voiceConfigSchema>;

export type VoicePosition = { x: number; y: number; mapId: string; connected: boolean; voiceEnabled: boolean };
export function canHear(a: VoicePosition | undefined, b: VoicePosition | undefined, radius: number): boolean {
  return Boolean(a?.connected && b?.connected && a.voiceEnabled && b.voiceEnabled && a.mapId === b.mapId &&
    Math.hypot(a.x - b.x, a.y - b.y) <= radius);
}
