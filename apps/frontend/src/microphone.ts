import { readPreference, writePreference } from './preferences';

const DEVICE_KEY = 'virtual-workspace-mic-device';
const ENABLED_KEY = 'virtual-workspace-mic-on-join';
const MUTED_KEY = 'virtual-workspace-mic-muted-on-join';

/** Chosen input device; empty means the browser default. Stored per browser like other display choices. */
export function preferredMicrophone(): string { return readPreference(DEVICE_KEY) ?? ''; }
export function setPreferredMicrophone(deviceId: string) { writePreference(DEVICE_KEY, deviceId); }
export function joinWithMicrophone(): boolean { return readPreference(ENABLED_KEY) === 'true'; }
export function setJoinWithMicrophone(value: boolean) { writePreference(ENABLED_KEY, String(value)); }
export function joinMuted(): boolean { return readPreference(MUTED_KEY) === 'true'; }
export function setJoinMuted(value: boolean) { writePreference(MUTED_KEY, String(value)); }

export function microphoneUnavailableReason(): string | undefined {
  if (!window.isSecureContext) {
    return `当前地址 ${window.location.origin} 不是安全上下文；本机请用 http://127.0.0.1:5173/ 或 http://localhost:5173/，其它设备需 HTTPS`;
  }
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    return '当前浏览器未提供麦克风 API（getUserMedia）；请检查浏览器或内嵌预览的麦克风设置';
  }
}

export function captureErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      return '麦克风权限被拒绝；请在地址栏的站点权限中允许麦克风后重试';
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') return '未找到麦克风设备';
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') return '麦克风无法读取，请检查设备是否被其它程序占用';
  }
  return error instanceof Error ? error.message : String(error);
}

/** Opens the chosen microphone, falling back to the default device when the saved one is gone. */
export async function openMicrophone(deviceId = preferredMicrophone()): Promise<MediaStream> {
  const processing = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...processing, deviceId: { exact: deviceId } }, video: false });
    } catch (error) {
      if (!(error instanceof DOMException) || !['OverconstrainedError', 'NotFoundError'].includes(error.name)) throw error;
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: processing, video: false });
}

/** Device id of the track actually opened, so the picker shows the real device after a fallback. */
export function streamDevice(stream: MediaStream): string {
  return stream.getAudioTracks()[0]?.getSettings().deviceId ?? '';
}

/**
 * Fills a <select> with audio inputs. Labels are only exposed after permission is granted,
 * so unlabeled devices get numbered names.
 */
export async function fillMicrophoneSelect(select: HTMLSelectElement, selected: string) {
  let devices: MediaDeviceInfo[] = [];
  try { devices = (await navigator.mediaDevices?.enumerateDevices?.() ?? []).filter(device => device.kind === 'audioinput'); }
  catch { /* Leave only the default entry. */ }
  const options = [new Option('系统默认麦克风', '')];
  devices.filter(device => device.deviceId && device.deviceId !== 'default').forEach((device, index) =>
    options.push(new Option(device.label || `麦克风 ${index + 1}`, device.deviceId)));
  select.replaceChildren(...options);
  select.value = options.some(option => option.value === selected) ? selected : '';
}

let sharedContext: AudioContext | undefined;
/** One AudioContext for all meters; created lazily and resumed from user gestures. */
export function audioContext(): AudioContext | undefined {
  if (typeof window.AudioContext !== 'function') return undefined;
  sharedContext ??= new AudioContext();
  if (sharedContext.state === 'suspended') void sharedContext.resume().catch(() => {});
  return sharedContext;
}

/** Reads a stream's loudness without playing it. */
export class LevelMeter {
  private source?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  private samples = new Float32Array(512);

  constructor(stream: MediaStream) {
    const context = audioContext();
    if (!context || !stream.getAudioTracks().length) return;
    try {
      this.source = context.createMediaStreamSource(stream);
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = this.samples.length;
      this.source.connect(this.analyser);
    } catch { this.dispose(); }
  }

  /** Root-mean-square level, roughly 0 (silence) to 1. */
  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const sample of this.samples) sum += sample * sample;
    return Math.sqrt(sum / this.samples.length);
  }

  dispose() {
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.source = undefined;
    this.analyser = undefined;
  }
}

/** Speech threshold with a short hold, so the indicator does not flicker between syllables. */
export const SPEAKING_LEVEL = 0.02;
export const SPEAKING_HOLD_MS = 350;
