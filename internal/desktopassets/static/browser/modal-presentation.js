/** A visual exit never owns the next dialog, route, or identity. */
export class ModalExit {
    version = 0;
    timer;
    cancel() { this.version++; clearTimeout(this.timer); this.timer = undefined; }
    start(valid, finish, delay = 140) {
        this.cancel();
        const version = this.version;
        let finished = false;
        const complete = () => {
            if (finished || version !== this.version)
                return;
            finished = true;
            clearTimeout(this.timer);
            this.timer = undefined;
            if (valid())
                finish();
        };
        if (delay <= 0)
            complete();
        else
            this.timer = setTimeout(complete, delay);
        return complete;
    }
}
//# sourceMappingURL=modal-presentation.js.map