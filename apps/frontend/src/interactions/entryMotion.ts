const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animate the button independently of its slot, so layout motion never cancels the jelly. */
export function animateIconIn(button: HTMLElement): Animation | undefined {
  button.getAnimations().forEach(animation => animation.cancel());
  if (reducedMotion()) return;
  return button.animate([
    { opacity: 0, transform: 'translateY(-30px) scale(.4, .65)', offset: 0 },
    { opacity: 1, transform: 'translateY(4px) scale(1.8, 1.45)', offset: .4 },
    { transform: 'translateY(-4px) scale(1.32, 1.65)', offset: .56 },
    { transform: 'translateY(2px) scale(.92, 1.05)', offset: .75 },
    { transform: 'translateY(-1px) scale(1.08, .97)', offset: .9 },
    { opacity: 1, transform: 'translateY(0) scale(1)', offset: 1 },
  ], { duration: 680, easing: 'cubic-bezier(.22,.7,.3,1)' });
}

export function animateIconOut(button: HTMLElement): Animation | undefined {
  const transform = getComputedStyle(button).transform;
  const opacity = getComputedStyle(button).opacity;
  button.getAnimations().forEach(animation => animation.cancel());
  if (reducedMotion()) return;
  return button.animate([
    { transform, opacity },
    { transform: 'translateY(-22px) scale(.8)', opacity: 0 },
  ], { duration: 190, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
}

/** FLIP keeps surviving entries (and the attachment indicator) moving smoothly after removal/wrap. */
export function animateEntryLayout(entries: HTMLElement, change: () => void) {
  const elements = Array.from(entries.closest('.map-indicators')?.querySelectorAll<HTMLElement>('.zone-entry-slot') ?? []);
  const before = new Map(elements.map(element => [element, element.getBoundingClientRect()]));
  elements.forEach(element => element.getAnimations().forEach(animation => animation.cancel()));
  change();
  if (reducedMotion()) return;
  for (const element of elements) {
    if (!element.isConnected || element.hidden) continue;
    const previous = before.get(element)!;
    const next = element.getBoundingClientRect();
    if (!previous.width || !next.width) continue;
    const x = previous.left - next.left, y = previous.top - next.top;
    if (x || y) element.animate([
      { transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' },
    ], { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' });
  }
}
