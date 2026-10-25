const sizeEase = 'cubic-bezier(.2,.7,.3,1)';

/** Retarget from the visible height; an old animation may never release a new one. */
export class HeightMotion {
  private element: HTMLElement;
  private animation?: Animation;
  private revision = 0;
  constructor(element: HTMLElement) { this.element = element; }

  private cancel() {
    this.revision++;
    if (this.animation) { this.animation.onfinish = null; this.animation.cancel(); this.animation = undefined; }
  }
  hold() {
    const height = this.element.getBoundingClientRect().height;
    this.cancel();
    this.element.style.height = `${height}px`;
    this.element.dataset.sizeMotion = 'true';
    return height;
  }
  to(height: number, duration: number, immediate = false) {
    const from = this.hold();
    if (immediate || duration <= 0 || !Number.isFinite(height) || Math.abs(from - height) < .5) { this.reset(); return; }
    const revision = this.revision;
    this.animation = this.element.animate([{ height: `${from}px` }, { height: `${Math.max(0, height)}px` }],
      { duration, easing: sizeEase, fill: 'both' });
    this.animation.onfinish = () => { if (revision === this.revision) this.reset(); };
  }
  reset() {
    this.cancel();
    this.element.style.removeProperty('height');
    delete this.element.dataset.sizeMotion;
  }
}
