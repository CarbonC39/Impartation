import type { Room } from '@colyseus/sdk';
import { canConnectVoice, canHear, voiceConfigSchema, voiceCredentialsSchema, type SpaceProtocol, type VoiceConfig, type VoiceCredentials, type VoiceIceCandidate,
  type VoiceSignal, type VoiceOffer, type VoiceAnswer, type VoiceEnd } from '@impartation/shared';
import { audioContext, captureErrorMessage, LevelMeter, microphoneUnavailableReason, openMicrophone,
  setPreferredMicrophone, SPEAKING_HOLD_MS, SPEAKING_LEVEL, streamDevice } from './microphone';

type Peer = { id: string; connectionId: string; connection: RTCPeerConnection; audio: HTMLAudioElement;
  sender: RTCRtpSender; candidates: RTCIceCandidateInit[]; localCandidates: RTCIceCandidateInit[]; ready: boolean;
  trackUpdate: Promise<void> };

function voiceCapabilityError(): string | undefined {
  const microphone = microphoneUnavailableReason();
  if (microphone) return microphone;
  if (typeof window.RTCPeerConnection !== 'function') {
    return '当前浏览器未提供 WebRTC（RTCPeerConnection）；请检查浏览器或内嵌预览的 WebRTC 设置';
  }
}

export class ProximityVoice {
  private configPromise?: Promise<VoiceConfig>;
  private config?: VoiceConfig;
  private turnCredentials?: VoiceCredentials;
  private turnCredentialsPromise?: Promise<VoiceCredentials>;
  private stream?: MediaStream;
  private peers = new Map<string, Peer>();
  private pendingPeers = new Map<string, number>();
  private cooldown = new Map<string, number>();
  private timer?: number;
  private generation = 0;
  private muted = false;
  private deafened = false;
  private disposed = false;
  private connected = true;
  private error = '';
  private unsubscribers: (() => void)[] = [];
  private meters = new Map<string, LevelMeter>();
  private loudAt = new Map<string, number>();
  private levelTimer?: number;
  /** Called after the device or enabled state changes, so pickers can follow the real device. */
  onDeviceChange?: (deviceId: string) => void;

  constructor(private room: Room<SpaceProtocol>, private micButton: HTMLButtonElement,
    private disconnectButton: HTMLButtonElement, private status: HTMLElement) {
    this.unsubscribers.push(
      room.onMessage('voiceOffer', signal => { void this.onOffer(signal); }),
      room.onMessage('voiceAnswer', signal => { void this.onAnswer(signal); }),
      room.onMessage('voiceIceCandidate', signal => { void this.onCandidate(signal); }),
      room.onMessage('voiceEnd', signal => this.onEnd(signal)),
    );
    const refreshPeers = () => this.scan();
    room.onStateChange(refreshPeers);
    this.unsubscribers.push(() => room.onStateChange.remove(refreshPeers));
    this.render();
  }

  private render() {
    const enabled = Boolean(this.stream);
    const live = enabled && !this.muted;
    this.micButton.disabled = this.disposed || !this.connected || !this.room.connection.isOpen;
    this.micButton.setAttribute('aria-pressed', String(live));
    const micLabel = live ? '关闭麦克风' : '开启麦克风';
    this.micButton.setAttribute('aria-label', micLabel);
    this.micButton.title = micLabel;
    this.disconnectButton.hidden = !enabled;
    const extras = `${this.muted ? ' · 麦克风已关' : ''}${this.deafened ? ' · 声音已关' : ''}`;
    this.status.textContent = this.error ? `语音错误：${this.error}` : enabled ?
      `语音已开启${extras} · 附近 ${this.peers.size} 人` : '语音已关闭';
  }

  /** Mic button: starts voice on first use, then switches the microphone on and off while staying connected. */
  async toggleMic() {
    if (!this.connected) return;
    if (this.stream) { this.toggleMute(); return; }
    await this.enable();
  }

  /** Silences every incoming voice without touching the microphone. */
  setDeafened(deafened: boolean) {
    this.deafened = deafened;
    for (const peer of this.peers.values()) {
      this.updateVolume(peer);
      if (!peer.audio.muted) void peer.audio.play().catch(() => {});
    }
    this.render();
  }

  /**
   * Starts voice. A stream already opened by the pre-join check is reused, so the browser
   * does not prompt twice; otherwise the preferred device is opened here.
   */
  async enable(options: { stream?: MediaStream; muted?: boolean } = {}) {
    if (this.stream || this.disposed || !this.connected || !this.room.connection.isOpen) { options.stream?.getTracks().forEach(track => track.stop()); return; }
    const capabilityError = voiceCapabilityError();
    if (capabilityError) { options.stream?.getTracks().forEach(track => track.stop()); this.error = capabilityError; this.render(); return; }
    const generation = ++this.generation;
    this.error = '';
    this.status.textContent = '正在请求麦克风…';
    this.micButton.disabled = true;
    let captured: MediaStream | undefined = options.stream;
    try {
      // Call from the user gesture before waiting for network configuration.
      captured ??= await openMicrophone();
      this.configPromise ??= fetch('/api/voice-config', { signal: AbortSignal.timeout(12_000) }).then(async response => {
        if (!response.ok) throw new Error('语音配置加载失败');
        return voiceConfigSchema.parse(await response.json());
      });
      const config = await this.configPromise;
      const stream = captured;
      if (this.disposed || generation !== this.generation || !this.room.connection.isOpen) {
        stream.getTracks().forEach(track => track.stop()); return;
      }
      this.config = config;
      this.muted = Boolean(options.muted);
      this.useStream(stream);
      if (!await this.room.request('voiceEnabled', { enabled: true })) throw new Error('房间拒绝开启语音');
      if (generation !== this.generation || !this.room.connection.isOpen) { this.disable(); return; }
      this.timer = window.setInterval(() => this.scan(), config.scanIntervalMs);
      this.levelTimer = window.setInterval(() => this.sampleLevels(), 100);
      this.scan();
    } catch (error) {
      this.configPromise = undefined;
      if (captured && captured !== this.stream) captured.getTracks().forEach(track => track.stop());
      if (generation === this.generation && !this.disposed) {
        this.disable();
        this.error = captureErrorMessage(error);
      }
    }
    this.render();
  }

  /** Switches the input device; live peers get the new track without renegotiation. */
  async setDevice(deviceId: string) {
    setPreferredMicrophone(deviceId);
    if (!this.stream) return;
    const generation = this.generation;
    try {
      const next = await openMicrophone(deviceId);
      if (generation !== this.generation || !this.stream) { next.getTracks().forEach(track => track.stop()); return; }
      const previous = this.stream;
      this.useStream(next);
      for (const peer of this.peers.values()) this.updateOutgoingTrack(peer);
      await Promise.all([...this.peers.values()].map(peer => peer.trackUpdate));
      previous.getTracks().forEach(item => item.stop());
      this.error = '';
    } catch (error) { this.error = captureErrorMessage(error); }
    this.render();
  }

  get deviceId(): string { return this.stream ? streamDevice(this.stream) : ''; }

  /** True while a player audible to this browser (or this browser itself, unmuted) is talking. */
  isSpeaking(sessionId: string): boolean {
    if (sessionId === this.room.sessionId && (!this.stream || this.muted)) return false;
    if (sessionId !== this.room.sessionId) {
      const peer = this.peers.get(sessionId);
      if (!peer || peer.audio.muted || peer.audio.volume === 0) return false;
    }
    return performance.now() - (this.loudAt.get(sessionId) ?? -Infinity) < SPEAKING_HOLD_MS;
  }

  private useStream(stream: MediaStream) {
    this.stream = stream;
    stream.getAudioTracks().forEach(track => { track.enabled = !this.muted; track.addEventListener('ended', () => {
      if (this.stream === stream) { this.disable(); this.error = '麦克风已断开'; this.render(); }
    }); });
    this.setMeter(this.room.sessionId, stream);
    this.onDeviceChange?.(streamDevice(stream));
  }

  private setMeter(id: string, stream?: MediaStream) {
    this.meters.get(id)?.dispose();
    this.meters.delete(id);
    this.loudAt.delete(id);
    if (stream) this.meters.set(id, new LevelMeter(stream));
  }

  private sampleLevels() {
    const now = performance.now();
    for (const [id, meter] of this.meters) if (meter.level() >= SPEAKING_LEVEL) this.loudAt.set(id, now);
  }

  toggleMute() {
    if (!this.stream) return;
    this.muted = !this.muted;
    this.stream.getAudioTracks().forEach(track => { track.enabled = !this.muted; });
    for (const peer of this.peers.values()) if (!peer.audio.muted) void peer.audio.play().catch(() => {});
    this.render();
  }

  setConnected(connected: boolean) {
    this.connected = connected;
    if (!connected) { this.disable(); this.error = ''; }
    this.render();
  }

  mapChanged() {
    for (const id of [...this.peers.keys()]) this.closePeer(id, true);
    this.scan();
  }

  disable() {
    ++this.generation;
    this.error = '';
    if (this.timer !== undefined) window.clearInterval(this.timer);
    if (this.levelTimer !== undefined) window.clearInterval(this.levelTimer);
    this.timer = undefined;
    this.levelTimer = undefined;
    this.pendingPeers.clear();
    for (const id of [...this.peers.keys()]) this.closePeer(id, true);
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    this.setMeter(this.room.sessionId);
    this.muted = false;
    if (this.connected && this.room.connection.isOpen) this.room.send('voiceEnabled', { enabled: false });
    this.render();
  }

  dispose() {
    this.disable();
    this.disposed = true;
    this.unsubscribers.forEach(unsubscribe => unsubscribe());
    this.unsubscribers = [];
    this.render();
  }

  private scan() {
    if (!this.connected || !this.stream || !this.config || !this.room.connection.isOpen) return;
    const own = this.room.state.players.get(this.room.sessionId);
    if (!own?.connected) return;
    for (const [id, peer] of this.peers) {
      const other = this.room.state.players.get(id);
      if (!canConnectVoice(own, other, this.config.disconnectRadius)) { this.closePeer(id, true); continue; }
      this.updateVolume(peer);
      this.updateOutgoingTrack(peer);
    }
    const available = this.config.maxPeers - this.peers.size - this.pendingPeers.size;
    if (available <= 0) { this.render(); return; }
    const nearby = [...this.room.state.players]
      .filter(([id, other]) => id !== this.room.sessionId && id > this.room.sessionId &&
        !this.peers.has(id) && !this.pendingPeers.has(id) && canConnectVoice(own, other, this.config!.connectRadius) &&
        Date.now() > (this.cooldown.get(id) ?? 0))
      .sort((a, b) => Math.hypot(own.x - a[1].x, own.y - a[1].y) - Math.hypot(own.x - b[1].x, own.y - b[1].y));
    for (const [id] of nearby.slice(0, available)) void this.startOffer(id);
    this.render();
  }

  private createPeerWithIce(id: string, connectionId: string, iceServers: RTCIceServer[]): Peer {
    const connection = new RTCPeerConnection({ iceServers });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.muted = this.deafened;
    audio.setAttribute('playsinline', '');
    audio.dataset.voicePeer = id;
    audio.style.display = 'none';
    document.body.append(audio);
    const track = this.stream!.getAudioTracks()[0];
    const own = this.room.state.players.get(this.room.sessionId);
    const other = this.room.state.players.get(id);
    const maySend = Boolean(track && own && other && this.config && canHear(own, other, this.config.disconnectRadius));
    const sender = maySend ? connection.addTrack(track!, this.stream!) : connection.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    const peer: Peer = { id, connectionId, connection, audio, sender, candidates: [], localCandidates: [], ready: false,
      trackUpdate: Promise.resolve() };
    this.peers.set(id, peer);
    this.updateVolume(peer);
    if (maySend) this.updateOutgoingTrack(peer);
    connection.ontrack = event => {
      if (this.peers.get(id) !== peer) return;
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      audioContext();
      this.setMeter(id, audio.srcObject);
      void audio.play().then(() => { if (this.error.startsWith('浏览器阻止播放')) { this.error = ''; this.render(); } })
        .catch(() => { this.error = '浏览器阻止播放，请点击麦克风或喇叭按钮重试'; this.render(); });
    };
    connection.onicecandidate = event => {
      if (!event.candidate || this.peers.get(id) !== peer || !this.room.connection.isOpen) return;
      const value = event.candidate.toJSON();
      if (!value.candidate) return;
      peer.localCandidates.push(value);
      this.flushLocalCandidates(peer);
    };
    connection.onconnectionstatechange = () => {
      if (this.peers.get(id) !== peer) return;
      if (connection.connectionState === 'failed') {
        this.error = '附近语音连接失败，请稍后重试';
        this.closePeer(id, true);
      } else if (connection.connectionState === 'connected') {
        if (this.error.startsWith('附近语音连接失败')) { this.error = ''; this.render(); }
      } else if (connection.connectionState === 'closed') this.closePeer(id, true);
    };
    return peer;
  }

  private async currentIceServers(): Promise<RTCIceServer[]> {
    if (!this.config) throw new Error('语音配置尚未加载');
    const cached = this.turnCredentials;
    if (!cached || (cached.expiresAt > 0 && cached.expiresAt - Date.now() <= 60_000)) {
      if (!this.turnCredentialsPromise) {
        const request = fetch('/api/voice-credentials', { credentials: 'same-origin', signal: AbortSignal.timeout(12_000) })
          .then(async response => {
            if (!response.ok) throw new Error(response.status === 401 ? '登录状态已失效，无法获取 TURN 凭据' : 'TURN 凭据加载失败');
            return voiceCredentialsSchema.parse(await response.json());
          });
        this.turnCredentialsPromise = request;
      }
      const request = this.turnCredentialsPromise;
      try { this.turnCredentials = await request; }
      finally { if (this.turnCredentialsPromise === request) this.turnCredentialsPromise = undefined; }
    }
    return [...this.config.iceServers, ...(this.turnCredentials?.iceServers ?? [])];
  }

  private updateVolume(peer: Peer) {
    const own = this.room.state.players.get(this.room.sessionId);
    const other = this.room.state.players.get(peer.id);
    if (!own || !other || !this.config || own.mapId !== other.mapId) { peer.audio.volume = 0; peer.audio.muted = true; return; }
    peer.audio.muted = this.deafened || !canHear(other, own, this.config.disconnectRadius);
    const fraction = Math.min(1, Math.hypot(own.x - other.x, own.y - other.y) / this.config.disconnectRadius);
    peer.audio.volume = Math.max(0, 1 - fraction * fraction);
  }

  private updateOutgoingTrack(peer: Peer) {
    if (!this.stream || !this.config) return;
    // Read current audience and microphone state when this queued update runs. A stale queued
    // allow-send decision must never reattach a track after a private-area boundary crossing.
    peer.trackUpdate = peer.trackUpdate.then(async () => {
      if (this.peers.get(peer.id) !== peer || !this.config) return;
      const currentOwn = this.room.state.players.get(this.room.sessionId);
      const currentOther = this.room.state.players.get(peer.id);
      const track = currentOwn && currentOther && canHear(currentOwn, currentOther, this.config.disconnectRadius) ?
        this.stream?.getAudioTracks()[0] ?? null : null;
      if (peer.sender.track !== track) await peer.sender.replaceTrack(track);
    }).catch(() => {
      if (this.peers.get(peer.id) === peer) this.closePeer(peer.id, true);
    });
  }

  private flushLocalCandidates(peer: Peer) {
    if (!peer.ready || !this.room.connection.isOpen || this.peers.get(peer.id) !== peer) return;
    for (const candidate of peer.localCandidates.splice(0)) {
      if (!candidate.candidate) continue;
      this.room.send('voiceIceCandidate', { peerId: peer.id, connectionId: peer.connectionId,
        candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? null,
        sdpMLineIndex: candidate.sdpMLineIndex ?? null, usernameFragment: candidate.usernameFragment ?? null });
    }
  }

  private async startOffer(id: string) {
    if (!this.stream || !this.config || this.peers.has(id) || this.pendingPeers.has(id) ||
      this.peers.size + this.pendingPeers.size >= this.config.maxPeers) return;
    const generation = this.generation;
    this.pendingPeers.set(id, generation);
    let peer: Peer | undefined;
    try {
      const iceServers = await this.currentIceServers();
      if (generation !== this.generation || this.pendingPeers.get(id) !== generation || !this.stream ||
        !this.room.connection.isOpen || this.peers.has(id)) return;
      peer = this.createPeerWithIce(id, crypto.randomUUID(), iceServers);
      if (this.pendingPeers.get(id) === generation) this.pendingPeers.delete(id);
      const offer = await peer.connection.createOffer();
      await peer.connection.setLocalDescription(offer);
      if (this.peers.get(id) !== peer || !offer.sdp) return;
      const accepted = await this.room.request('voiceOffer', { peerId: id, connectionId: peer.connectionId, sdp: offer.sdp });
      if (!accepted) throw new Error('Peer unavailable');
      peer.ready = true;
      this.flushLocalCandidates(peer);
    } catch (error) {
      if (peer && this.peers.get(id) === peer) this.closePeer(id, true);
      if (!peer && generation === this.generation && !this.disposed) { this.error = captureErrorMessage(error); this.render(); }
    }
    finally { if (this.pendingPeers.get(id) === generation) this.pendingPeers.delete(id); }
  }

  private async onOffer(signal: VoiceSignal<VoiceOffer>) {
    if (!this.stream || !this.config || this.peers.size + this.pendingPeers.size >= this.config.maxPeers ||
      this.peers.has(signal.sessionId) || this.pendingPeers.has(signal.sessionId)) {
      if (this.room.connection.isOpen) this.room.send('voiceEnd', { peerId: signal.sessionId, connectionId: signal.connectionId });
      return;
    }
    const generation = this.generation;
    this.pendingPeers.set(signal.sessionId, generation);
    let peer: Peer | undefined;
    try {
      const iceServers = await this.currentIceServers();
      if (generation !== this.generation || this.pendingPeers.get(signal.sessionId) !== generation || !this.stream ||
        !this.room.connection.isOpen || this.peers.has(signal.sessionId)) {
        if (this.room.connection.isOpen) this.room.send('voiceEnd', { peerId: signal.sessionId, connectionId: signal.connectionId });
        return;
      }
      peer = this.createPeerWithIce(signal.sessionId, signal.connectionId, iceServers);
      if (this.pendingPeers.get(signal.sessionId) === generation) this.pendingPeers.delete(signal.sessionId);
      await peer.connection.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      const answer = await peer.connection.createAnswer();
      await peer.connection.setLocalDescription(answer);
      if (this.peers.get(peer.id) !== peer || !answer.sdp) return;
      const accepted = await this.room.request('voiceAnswer', { peerId: peer.id, connectionId: peer.connectionId, sdp: answer.sdp });
      if (!accepted) throw new Error('Peer unavailable');
      peer.ready = true;
      this.flushLocalCandidates(peer);
      await this.flushCandidates(peer);
    } catch (error) {
      if (peer && this.peers.get(peer.id) === peer) this.closePeer(peer.id, true);
      else if (this.room.connection.isOpen) this.room.send('voiceEnd', { peerId: signal.sessionId, connectionId: signal.connectionId });
      if (!peer && generation === this.generation && !this.disposed) { this.error = captureErrorMessage(error); this.render(); }
    } finally { if (this.pendingPeers.get(signal.sessionId) === generation) this.pendingPeers.delete(signal.sessionId); }
  }

  private async onAnswer(signal: VoiceSignal<VoiceAnswer>) {
    const peer = this.peers.get(signal.sessionId);
    if (!peer || peer.connectionId !== signal.connectionId || peer.connection.signalingState !== 'have-local-offer') return;
    try {
      await peer.connection.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      await this.flushCandidates(peer);
    } catch { this.closePeer(peer.id, true); }
  }

  private async onCandidate(signal: VoiceSignal<VoiceIceCandidate>) {
    const peer = this.peers.get(signal.sessionId);
    if (!peer || peer.connectionId !== signal.connectionId) return;
    peer.candidates.push({ candidate: signal.candidate, sdpMid: signal.sdpMid,
      sdpMLineIndex: signal.sdpMLineIndex, usernameFragment: signal.usernameFragment ?? undefined });
    if (peer.connection.remoteDescription) await this.flushCandidates(peer);
  }
  private async flushCandidates(peer: Peer) {
    while (peer.candidates.length && this.peers.get(peer.id) === peer && peer.connection.remoteDescription) {
      const candidate = peer.candidates.shift()!;
      try { await peer.connection.addIceCandidate(candidate); } catch { /* Stale ICE after a negotiation change. */ }
    }
  }
  private onEnd(signal: VoiceSignal<VoiceEnd>) {
    const peer = this.peers.get(signal.sessionId);
    if (peer?.connectionId === signal.connectionId) this.closePeer(peer.id, false);
  }
  private closePeer(id: string, notify: boolean) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    this.setMeter(id);
    this.cooldown.set(id, Date.now() + 2000);
    peer.connection.close();
    peer.audio.pause();
    peer.audio.srcObject = null;
    peer.audio.remove();
    if (notify && this.room.connection.isOpen) this.room.send('voiceEnd', { peerId: id, connectionId: peer.connectionId });
    this.render();
  }
}
