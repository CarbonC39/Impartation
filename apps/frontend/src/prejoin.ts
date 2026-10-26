import { captureErrorMessage, fillMicrophoneSelect, joinMuted, joinWithMicrophone, LevelMeter, microphoneUnavailableReason,
  openMicrophone, preferredMicrophone, setJoinMuted, setJoinWithMicrophone, setPreferredMicrophone, streamDevice } from './microphone';

/** What the player chose before entering; the stream is handed over so voice starts without a second prompt. */
export type VoicePlan = { enabled: boolean; stream?: MediaStream; muted: boolean };

type Elements = {
  dialog: HTMLDialogElement; worldLabels: HTMLElement[]; micSwitch: HTMLButtonElement; options: HTMLElement;
  device: HTMLSelectElement; level: HTMLElement; muted: HTMLInputElement; status: HTMLElement;
  enter: HTMLButtonElement; cancel: HTMLButtonElement;
};

/**
 * Zoom-style check before entering a world: microphone on or off, which device, a live level
 * meter, and whether to start muted. Nothing is captured unless the player turns the microphone on.
 */
export function mountPrejoin(elements: Elements, onEnter: (plan: VoicePlan) => void) {
  let stream: MediaStream | undefined;
  let meter: LevelMeter | undefined;
  let frame = 0;
  let generation = 0;
  let handedOver = false;

  function setStatus(text: string) {
    elements.status.textContent = text;
    elements.status.hidden = !text;
  }
  function setSwitch(on: boolean) {
    elements.micSwitch.setAttribute('aria-checked', String(on));
    elements.options.hidden = !on;
  }
  function stopPreview() {
    ++generation;
    cancelAnimationFrame(frame);
    meter?.dispose();
    meter = undefined;
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
    elements.level.style.setProperty('--level', '0');
  }
  function drawLevel() {
    // Speech RMS rarely passes 0.3, so scale it up for a lively bar.
    elements.level.style.setProperty('--level', String(Math.min(1, (meter?.level() ?? 0) * 4)));
    frame = requestAnimationFrame(drawLevel);
  }
  async function startPreview(deviceId = preferredMicrophone()) {
    stopPreview();
    const reason = microphoneUnavailableReason();
    if (reason) { setSwitch(false); setStatus(`无法使用麦克风：${reason}`); return; }
    const current = ++generation;
    setStatus('正在请求麦克风…');
    try {
      const opened = await openMicrophone(deviceId);
      if (current !== generation) { opened.getTracks().forEach(track => track.stop()); return; }
      stream = opened;
      meter = new LevelMeter(opened);
      await fillMicrophoneSelect(elements.device, streamDevice(opened) || deviceId);
      setStatus('麦克风正常');
      drawLevel();
    } catch (error) {
      if (current !== generation) return;
      setSwitch(false);
      setStatus(`麦克风未开启：${captureErrorMessage(error)}。仍可不开麦进入。`);
    }
  }

  elements.micSwitch.addEventListener('click', () => {
    const on = elements.micSwitch.getAttribute('aria-checked') !== 'true';
    setSwitch(on);
    setJoinWithMicrophone(on);
    if (on) void startPreview(); else { stopPreview(); setStatus(''); }
  });
  elements.device.addEventListener('change', () => {
    setPreferredMicrophone(elements.device.value);
    void startPreview(elements.device.value);
  });
  elements.muted.addEventListener('change', () => setJoinMuted(elements.muted.checked));
  elements.cancel.addEventListener('click', () => elements.dialog.close());
  elements.dialog.addEventListener('close', () => { if (!handedOver) stopPreview(); });
  elements.enter.addEventListener('click', () => {
    const on = elements.micSwitch.getAttribute('aria-checked') === 'true';
    // A preview still waiting on the permission prompt is dropped; voice opens the device after joining.
    const plan: VoicePlan = { enabled: on, muted: elements.muted.checked, ...(on && stream ? { stream } : {}) };
    if (!stream) stopPreview();
    // Keep the tracks alive: voice takes ownership once the room is joined.
    cancelAnimationFrame(frame);
    meter?.dispose();
    meter = undefined;
    stream = undefined;
    handedOver = true;
    elements.dialog.close();
    handedOver = false;
    onEnter(plan);
  });

  return {
    open(worldName: string) {
      for (const label of elements.worldLabels) label.textContent = worldName;
      elements.muted.checked = joinMuted();
      const on = joinWithMicrophone();
      setSwitch(on);
      setStatus('');
      elements.dialog.showModal();
      if (on) void startPreview();
      else void fillMicrophoneSelect(elements.device, preferredMicrophone());
      elements.enter.focus();
    },
  };
}
