const iconUrls: Readonly<Record<string, string>> = {
  board: new URL('../assets/interaction-icons/board.svg', import.meta.url).href,
  pomodoro: new URL('../assets/interaction-icons/pomodoro.svg', import.meta.url).href,
  wardrobe: new URL('../assets/interaction-icons/wardrobe.svg', import.meta.url).href,
  privateArea: new URL('../assets/interaction-icons/privateArea.svg', import.meta.url).href,
  web: new URL('../assets/interaction-icons/web.svg', import.meta.url).href,
  attachment: new URL('../assets/interaction-icons/attachment.svg', import.meta.url).href,
  'variant-selector': new URL('../assets/interaction-icons/variant-selector.svg', import.meta.url).href,
};

export function createInteractionIcon(id: string): HTMLImageElement | undefined {
  const src = iconUrls[id];
  if (!src) return undefined;

  const image = new Image();
  image.src = src;
  image.alt = '';
  return image;
}
