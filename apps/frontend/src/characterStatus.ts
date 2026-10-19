import Phaser from 'phaser';

/**
 * Canvas-drawn text and status around a character: the nickname under the feet, and above the
 * head a speech bubble, typing dots and the speaking microphone. They are drawn in the same frame
 * as the character, so they never trail behind it while walking.
 *
 * The status group is scaled by 1/zoom, so its children are laid out in screen pixels.
 */
export const MIC_TEXTURE = 'speaking-mic';
// Material Symbols "mic" (filled), Apache License 2.0, https://fonts.google.com/icons
const MIC_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path fill="#ffffff" fill-opacity="0.85" d="M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35Zm-40 280v-123q-104-14-172-93t-68-184h80q0 83 58.5 141.5T480-320q83 0 141.5-58.5T680-520h80q0 105-68 184t-172 93v123h-80Z"/></svg>';

const BUBBLE_LINE = 0x8b7aa6;
const BUBBLE_FILL = 0xfffaf3;
const PAD_X = 6;
const PAD_Y = 3;
const OUTLINE = 2;
const TAIL = 6;
const ROW_HEIGHT = 20;
const MIC_SIZE = 20;
const TYPING_WIDTH = 34;
const TYPING_HEIGHT = 16;
const GAP = 4;

export function preloadStatusTextures(scene: Phaser.Scene) {
  // Rasterised large and filtered smoothly, so the icon stays clean when scaled down.
  scene.load.svg(MIC_TEXTURE, `data:image/svg+xml;base64,${btoa(MIC_SVG)}`, { width: 64, height: 64 });
}
export function prepareStatusTextures(scene: Phaser.Scene) {
  scene.textures.get(MIC_TEXTURE).setFilter(Phaser.Textures.FilterMode.LINEAR);
}

export type StatusState = {
  name: string; nameVisible: boolean; connected: boolean;
  bubble?: string; typing: boolean; speaking: boolean;
};

export class CharacterStatus {
  private label: Phaser.GameObjects.Text;
  private group: Phaser.GameObjects.Container;
  private bubbleShape: Phaser.GameObjects.Graphics;
  private bubbleText: Phaser.GameObjects.Text;
  private mic: Phaser.GameObjects.Image;
  private typing: Phaser.GameObjects.Graphics;
  private shownBubble = '';

  constructor(scene: Phaser.Scene, id: string, own: boolean, zoom: number) {
    // Name sits under the feet as outlined text, so it never covers the character or speech bubble.
    this.label = scene.add.text(0, 0, '', {
      fontSize: '12px', fontStyle: 'bold', color: own ? '#b0507a' : '#4a3d60',
      stroke: '#ffffff', strokeThickness: 3,
    }).setOrigin(0.5, 0).setScale(1 / zoom).setName(`name:${id}`);
    this.bubbleShape = scene.add.graphics().setName('bubble-shape');
    this.bubbleText = scene.add.text(0, 0, '', {
      fontSize: '12px', color: '#4a3d60', align: 'center', wordWrap: { width: 180, useAdvancedWrap: true },
    }).setOrigin(0.5, 0).setName('bubble-text');
    this.mic = scene.add.image(0, 0, MIC_TEXTURE).setDisplaySize(MIC_SIZE, MIC_SIZE).setOrigin(0.5, 1).setName('mic');
    this.typing = scene.add.graphics().setName('typing');
    this.group = scene.add.container(0, 0, [this.bubbleShape, this.bubbleText, this.mic, this.typing])
      .setScale(1 / zoom).setName(`status:${id}`);
  }

  setZoom(zoom: number) {
    this.label.setScale(1 / zoom);
    this.group.setScale(1 / zoom);
  }

  /** `x`/`footY`/`headY` are world coordinates; `time` drives the small animations. */
  update(x: number, footY: number, headY: number, state: StatusState, time: number, depth: number) {
    if (this.label.text !== state.name) this.label.setText(state.name);
    this.label.setVisible(state.nameVisible).setAlpha(state.connected ? 1 : 0.5).setPosition(x, footY).setDepth(depth);

    const bubble = state.bubble ?? '';
    const anything = Boolean(bubble) || state.typing || state.speaking;
    this.group.setVisible(anything);
    if (!anything) return;
    this.group.setPosition(x, headY).setDepth(depth + 1);

    // Status row (mic, typing dots) sits on the head; the bubble's tail points down at it.
    const rowWidth = (state.speaking ? MIC_SIZE : 0) + (state.typing ? TYPING_WIDTH : 0) + (state.speaking && state.typing ? GAP : 0);
    let left = -rowWidth / 2;
    const rowBottom = -2;
    this.mic.setVisible(state.speaking);
    if (state.speaking) {
      // A gentle two-pixel bob reads as "talking" without extra frames.
      this.mic.setPosition(left + MIC_SIZE / 2, rowBottom - (Math.floor(time / 250) % 2) * 2);
      left += MIC_SIZE + GAP;
    }
    this.typing.setVisible(state.typing);
    if (state.typing) this.drawTyping(left + TYPING_WIDTH / 2, rowBottom - (ROW_HEIGHT - TYPING_HEIGHT) / 2 - TYPING_HEIGHT / 2, time);

    this.bubbleShape.setVisible(Boolean(bubble));
    this.bubbleText.setVisible(Boolean(bubble));
    if (!bubble) { this.shownBubble = ''; return; }
    const tip = rowWidth ? rowBottom - ROW_HEIGHT - GAP : rowBottom;
    if (bubble !== this.shownBubble) { this.shownBubble = bubble; this.bubbleText.setText(bubble); }
    this.drawBubble(tip);
  }

  destroy() {
    this.label.destroy();
    this.group.destroy();
  }

  /**
   * One closed outline: box and tail are a single polygon, filled then stroked, so there is no
   * line where they meet.
   */
  private drawBubble(tip: number) {
    const width = Math.ceil(this.bubbleText.width) + PAD_X * 2;
    const height = Math.ceil(this.bubbleText.height) + PAD_Y * 2;
    const bottom = Math.round(tip - TAIL);
    const top = bottom - height;
    const left = -Math.round(width / 2);
    const right = left + width;
    this.bubbleText.setPosition(0, top + PAD_Y);
    const points = [
      new Phaser.Math.Vector2(left, top), new Phaser.Math.Vector2(right, top), new Phaser.Math.Vector2(right, bottom),
      new Phaser.Math.Vector2(TAIL, bottom), new Phaser.Math.Vector2(0, bottom + TAIL), new Phaser.Math.Vector2(-TAIL, bottom),
      new Phaser.Math.Vector2(left, bottom),
    ];
    this.bubbleShape.clear()
      .fillStyle(BUBBLE_FILL, 1).fillPoints(points, true)
      .lineStyle(OUTLINE, BUBBLE_LINE, 1).strokePoints(points, true, true);
  }

  /** Three dots in a soft pill, rising in turn like a chat app's "typing" hint. */
  private drawTyping(centerX: number, centerY: number, time: number) {
    const graphics = this.typing.clear();
    graphics.fillStyle(BUBBLE_FILL, 0.92)
      .fillRoundedRect(centerX - TYPING_WIDTH / 2, centerY - TYPING_HEIGHT / 2, TYPING_WIDTH, TYPING_HEIGHT, TYPING_HEIGHT / 2);
    for (let index = 0; index < 3; index++) {
      const phase = ((time / 1200) - index * 0.125) % 1;
      const lift = phase < 0.5 ? Math.sin(phase * 2 * Math.PI) * 3 : 0;
      graphics.fillStyle(BUBBLE_LINE, lift > 0.5 ? 1 : 0.55).fillCircle(centerX + (index - 1) * 8, centerY - Math.max(0, lift), 2.5);
    }
  }
}
