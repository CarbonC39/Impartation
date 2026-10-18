import { FloatingPosition } from './floatingPosition';
import { PAD_SCALE_MAX, PAD_SCALE_MIN, type TouchPad } from './touchPad';

type Elements = {
  panel: HTMLElement; scale: HTMLInputElement; scaleValue: HTMLOutputElement;
  reset: HTMLButtonElement; done: HTMLButtonElement; actionBar: HTMLElement;
};

/**
 * Touch layout editor: resize the direction pad and drag the pad and the action bar anywhere.
 * While editing, controls are drag handles only, so nothing walks or triggers an action.
 */
export class LayoutEditor {
  readonly actionBar: FloatingPosition;
  private editing = false;

  constructor(private elements: Elements, private pad: TouchPad) {
    this.actionBar = new FloatingPosition(elements.actionBar, 'virtual-workspace-action-bar');
    elements.scale.min = String(PAD_SCALE_MIN * 100);
    elements.scale.max = String(PAD_SCALE_MAX * 100);
    elements.scale.addEventListener('input', () => {
      pad.setScale(Number(elements.scale.value) / 100);
      this.showScale();
    });
    elements.reset.addEventListener('click', () => {
      pad.reset();
      this.actionBar.reset();
      this.syncScale();
    });
    elements.done.addEventListener('click', () => this.close());
    window.addEventListener('keydown', event => { if (this.editing && event.key === 'Escape') this.close(); });

    // Capture phase, so the bar's own buttons never see presses made while editing.
    const bar = elements.actionBar;
    bar.addEventListener('pointerdown', event => {
      if (!this.editing) return;
      event.preventDefault();
      event.stopPropagation();
      this.actionBar.begin(event);
    }, true);
    bar.addEventListener('pointermove', event => { if (this.editing) this.actionBar.move(event); }, true);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      bar.addEventListener(type, event => { if (this.editing) this.actionBar.end(event); }, true);
    }
    bar.addEventListener('click', event => { if (this.editing) { event.preventDefault(); event.stopPropagation(); } }, true);
  }

  get isEditing() { return this.editing; }

  open() {
    if (this.editing) return;
    this.editing = true;
    this.pad.setEditing(true);
    this.syncScale();
    document.body.classList.add('layout-editing');
    this.elements.panel.hidden = false;
    this.elements.done.focus();
  }

  close() {
    if (!this.editing) return;
    this.editing = false;
    this.pad.setEditing(false);
    document.body.classList.remove('layout-editing');
    this.elements.panel.hidden = true;
  }

  /** Re-applies saved positions once the map is visible. */
  refresh() { this.actionBar.apply(); }

  private syncScale() {
    this.elements.scale.value = String(Math.round(this.pad.scale * 100));
    this.showScale();
  }

  private showScale() { this.elements.scaleValue.value = `${this.elements.scale.value}%`; }
}
