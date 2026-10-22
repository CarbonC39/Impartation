import { readPreference, writePreference } from './preferences';

const SOUND_KEY = 'virtual-workspace-chat-alert-sound';
const NOTIFICATION_KEY = 'virtual-workspace-chat-alert-notification';

function saved(key: string) { return readPreference(key) === 'true'; }

/** Owns per-browser alerts for incoming chat while the page is in the background. */
export class ChatAlerts {
  private soundEnabled = saved(SOUND_KEY);
  private notificationEnabled = saved(NOTIFICATION_KEY);
  private audio: AudioContext | undefined;

  constructor(
    private readonly soundSwitch: HTMLButtonElement,
    private readonly notificationSwitch: HTMLButtonElement,
    private readonly status: HTMLElement,
  ) {
    this.render();
    // A saved sound preference still needs a fresh user gesture after reloading the page.
    const unlock = () => { if (this.soundEnabled) void this.resumeAudio(); };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    soundSwitch.addEventListener('click', () => {
      this.soundEnabled = !this.soundEnabled;
      writePreference(SOUND_KEY, String(this.soundEnabled));
      if (this.soundEnabled) void this.resumeAudio();
      this.render();
    });
    notificationSwitch.addEventListener('click', () => { void this.toggleNotifications(); });
  }

  notify(senderId: string, ownSessionId: string, name: string, text: string) {
    if (document.hidden !== true || senderId === ownSessionId) return;
    if (this.soundEnabled) this.playSound();
    if (this.notificationEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(`${name} 发来消息`, { body: text.slice(0, 120), tag: `chat-${senderId}` });
      } catch { /* Browser notifications may be unavailable in embedded contexts. */ }
    }
  }

  private async toggleNotifications() {
    if (this.notificationEnabled) {
      this.notificationEnabled = false;
      writePreference(NOTIFICATION_KEY, 'false');
      this.render();
      return;
    }
    if (typeof Notification === 'undefined') {
      this.status.textContent = '此浏览器不支持通知。';
      return;
    }
    // Invoke requestPermission directly from the user click handler.
    let permission = Notification.permission;
    if (permission === 'default') {
      try { permission = await Notification.requestPermission(); }
      catch { permission = 'denied'; }
    }
    if (permission !== 'granted') {
      this.status.textContent = permission === 'denied' ? '通知权限已关闭，请在浏览器设置中允许后再开启。' : '未授予通知权限。';
      this.notificationEnabled = false;
      writePreference(NOTIFICATION_KEY, 'false');
      this.render(false);
      return;
    }
    this.notificationEnabled = true;
    writePreference(NOTIFICATION_KEY, 'true');
    this.render();
  }

  private async resumeAudio() {
    if (typeof AudioContext === 'undefined') return;
    try {
      this.audio ??= new AudioContext();
      if (this.audio.state === 'suspended') await this.audio.resume();
    } catch { /* Audio is an optional enhancement. */ }
  }

  private playSound() {
    void this.resumeAudio().then(() => {
      const audio = this.audio;
      if (!audio || audio.state !== 'running') return;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.16);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.17);
    });
  }

  private render(showDefaultStatus = true) {
    this.soundSwitch.setAttribute('aria-checked', String(this.soundEnabled));
    this.notificationSwitch.setAttribute('aria-checked', String(this.notificationEnabled));
    const supported = typeof Notification !== 'undefined';
    this.notificationSwitch.disabled = !supported;
    if (!supported) this.status.textContent = '此浏览器不支持通知；消息音效仍可单独使用。';
    else if (showDefaultStatus) this.status.textContent = '仅在页面隐藏时提醒其他人的新消息。';
  }
}
