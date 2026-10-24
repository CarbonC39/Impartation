import { createHmac } from 'node:crypto';
import { voiceCredentialsSchema } from '@impartation/shared';
import { config, voiceTurnUrls } from './config.js';

/** Mint coturn TURN REST API credentials for the verified application user. */
export function issueVoiceCredentials(userId: string, now = Date.now()) {
  if (!voiceTurnUrls.length || !config.VOICE_TURN_SHARED_SECRET) {
    return voiceCredentialsSchema.parse({ iceServers: [], expiresAt: 0 });
  }
  const expiry = Math.floor(now / 1000) + config.VOICE_TURN_CREDENTIAL_TTL_SECONDS;
  const username = `${expiry}:${userId}`;
  const credential = createHmac('sha1', config.VOICE_TURN_SHARED_SECRET).update(username).digest('base64');
  return voiceCredentialsSchema.parse({
    iceServers: [{ urls: voiceTurnUrls, username, credential }],
    expiresAt: expiry * 1000,
  });
}
