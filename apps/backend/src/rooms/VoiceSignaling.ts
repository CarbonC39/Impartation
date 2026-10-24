import { canConnectVoice, type SpaceState, type VoiceAnswer, type VoiceEnd, type VoiceIceCandidate,
  type VoiceOffer, type VoiceConfig } from '@impartation/shared';
import type { SpaceClient } from '../interactions/context.js';

type Pair = { a: string; b: string; connectionId: string; answered: boolean; createdAt: number };

export class VoiceSignaling {
  private pairs = new Map<string, Pair>();
  constructor(private state: SpaceState, private config: VoiceConfig,
    private clientById: (id: string) => SpaceClient | undefined) {}

  private key(a: string, b: string) { return JSON.stringify([a, b].sort()); }
  private eligible(a: string, b: string, radius: number) {
    return a !== b && canConnectVoice(this.state.players.get(a), this.state.players.get(b), radius) &&
      Boolean(this.clientById(a) && this.clientById(b));
  }
  private count(id: string) { return [...this.pairs.values()].filter(pair => pair.a === id || pair.b === id).length; }
  private remove(pair: Pair) {
    this.pairs.delete(this.key(pair.a, pair.b));
    if (this.state.players.get(pair.a)?.connected && this.state.players.get(pair.a)?.voiceEnabled)
      this.clientById(pair.a)?.send('voiceEnd', { sessionId: pair.b, peerId: pair.b, connectionId: pair.connectionId });
    if (this.state.players.get(pair.b)?.connected && this.state.players.get(pair.b)?.voiceEnabled)
      this.clientById(pair.b)?.send('voiceEnd', { sessionId: pair.a, peerId: pair.a, connectionId: pair.connectionId });
  }
  setEnabled(id: string, enabled: boolean) {
    const player = this.state.players.get(id);
    if (!player?.connected) return;
    player.voiceEnabled = enabled;
    if (!enabled) this.clear(id);
  }
  clear(id: string) {
    const player = this.state.players.get(id);
    if (player) player.voiceEnabled = false;
    for (const pair of [...this.pairs.values()]) if (pair.a === id || pair.b === id) this.remove(pair);
  }
  offer(sender: string, input: VoiceOffer) {
    if (sender >= input.peerId || !this.eligible(sender, input.peerId, this.config.connectRadius)) return false;
    const key = this.key(sender, input.peerId);
    if (this.pairs.has(key) || this.count(sender) >= this.config.maxPeers || this.count(input.peerId) >= this.config.maxPeers) return false;
    this.pairs.set(key, { a: sender, b: input.peerId, connectionId: input.connectionId, answered: false, createdAt: Date.now() });
    this.clientById(input.peerId)?.send('voiceOffer', { ...input, sessionId: sender });
    return true;
  }
  private pair(sender: string, input: VoiceEnd) {
    const pair = this.pairs.get(this.key(sender, input.peerId));
    return pair?.connectionId === input.connectionId && this.eligible(sender, input.peerId, this.config.disconnectRadius) ? pair : undefined;
  }
  answer(sender: string, input: VoiceAnswer) {
    const pair = this.pair(sender, input);
    if (!pair || pair.b !== sender || pair.answered) return false;
    pair.answered = true;
    this.clientById(pair.a)?.send('voiceAnswer', { ...input, sessionId: sender });
    return true;
  }
  candidate(sender: string, input: VoiceIceCandidate) {
    const pair = this.pair(sender, input);
    if (!pair) return;
    this.clientById(input.peerId)?.send('voiceIceCandidate', { ...input, sessionId: sender });
  }
  end(sender: string, input: VoiceEnd) {
    const pair = this.pairs.get(this.key(sender, input.peerId));
    if (pair?.connectionId === input.connectionId) this.remove(pair);
  }
  tick() {
    for (const pair of [...this.pairs.values()]) {
      if (!this.eligible(pair.a, pair.b, this.config.disconnectRadius) || (!pair.answered && Date.now() - pair.createdAt > 15_000)) this.remove(pair);
    }
  }
  dispose() { for (const pair of [...this.pairs.values()]) this.remove(pair); }
}
