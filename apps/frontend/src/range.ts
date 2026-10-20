/** Pixel sliders paint the filled part of the track from --fill, since WebKit has no progress pseudo-element. */
export function setRangeFill(input: HTMLInputElement) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const ratio = max > min ? (Number(input.value) - min) / (max - min) : 0;
  input.style.setProperty('--fill', `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`);
}
