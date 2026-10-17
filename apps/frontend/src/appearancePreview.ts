import { APPEARANCE_LAYERS, type JoinOptions } from '@virtual-workspace/shared';
import { avatarDefinition, layerAssetIds, layerAssets } from './characters';

const images = new Map<string, HTMLImageElement>();
const frame = avatarDefinition('mint');
const ready = Promise.all(layerAssetIds.map(id => new Promise<void>((resolve, reject) => {
  const image = new Image();
  image.onload = () => { images.set(id, image); resolve(); };
  image.onerror = () => reject(new Error(`无法加载角色素材：${id}`));
  image.src = layerAssets[id];
})));

/** Uses the same full frame, origin, layer order and multiplicative RGB tint as the map. */
export async function drawAppearancePreview(canvas: HTMLCanvasElement, appearance: JoinOptions['appearance'], frameIndex = 0) {
  await ready;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, frame.frameWidth, frame.frameHeight);
  const source = document.createElement('canvas');
  source.width = frame.frameWidth; source.height = frame.frameHeight;
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) return;
  sourceContext.imageSmoothingEnabled = false;
  for (const layer of APPEARANCE_LAYERS) {
    const part = appearance[layer];
    if (part.assetId === 'none') continue;
    const image = images.get(part.assetId);
    if (!image) continue;
    sourceContext.clearRect(0, 0, source.width, source.height);
    sourceContext.drawImage(image, frameIndex % 4 * frame.frameWidth,
      Math.floor(frameIndex / 4) * frame.frameHeight, frame.frameWidth, frame.frameHeight,
      0, 0, frame.frameWidth, frame.frameHeight);
    const pixels = sourceContext.getImageData(0, 0, frame.frameWidth, frame.frameHeight);
    const tint = Number.parseInt(part.color.slice(1), 16);
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] = Math.round(pixels.data[i]! * ((tint >> 16) & 255) / 255);
      pixels.data[i + 1] = Math.round(pixels.data[i + 1]! * ((tint >> 8) & 255) / 255);
      pixels.data[i + 2] = Math.round(pixels.data[i + 2]! * (tint & 255) / 255);
    }
    sourceContext.putImageData(pixels, 0, 0);
    context.drawImage(source, 0, 0);
  }
}
