/** A visual exit never owns the next dialog, route, or identity. */
export class ModalExit {
  private version = 0;
  private timer?: ReturnType<typeof setTimeout>;
  cancel() { this.version++; clearTimeout(this.timer); this.timer = undefined; }
  start(valid: () => boolean, finish: () => void, delay = 140): () => void {
    this.cancel(); const version = this.version; let finished = false;
    const complete = () => {
      if (finished || version !== this.version) return;
      finished = true; clearTimeout(this.timer); this.timer = undefined;
      if (valid()) finish();
    };
    if (delay <= 0) complete(); else this.timer = setTimeout(complete, delay);
    return complete;
  }
}
