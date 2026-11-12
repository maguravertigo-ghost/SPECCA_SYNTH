// js/editor/playback.js

const LOOKAHEAD = 0.1; // секунд — окно планирования

export class Playback {
    constructor({ synth, ctx, sequence }) {
        this.synth = synth;
        this.ctx = ctx;
        this.sequence = sequence;

        this.playing   = false;
        this.pausedAt  = 0;
        this.startAt   = 0;
        this.offset    = 0;
        this.cursor    = 0;
        this.events    = [];
        this.rafId     = null;
        this.pendingTimers = new Set();

        this.onTimeChange = null;
        this.onEnd        = null;

        this._loop = this._loop.bind(this);
    }

    get currentTime() {
        if (!this.playing) return this.pausedAt;
        return this.offset + (this.ctx.currentTime - this.startAt);
    }

    get duration() {
        return this.sequence.getDurationSeconds();
    }

    play(fromSeconds = null) {
        if (this.playing) return;
        const from = fromSeconds ?? this.pausedAt;
        this.events = this.sequence.flatten();
        this.offset  = from;
        this.cursor  = this.events.findIndex(e => e.time >= from);
        if (this.cursor < 0) this.cursor = this.events.length;
        this.startAt = this.ctx.currentTime;
        this.playing = true;
        this._loop();
    }

    pause() {
        if (!this.playing) return;
        this.pausedAt = this.currentTime;
        this.playing  = false;
        if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
        this._cancelAll();
        this._allOff();
    }

    stop() {
        this.playing = false;
        if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
        this._cancelAll();
        this._allOff();
        this.pausedAt = 0;
        this.offset   = 0;
        this.cursor   = 0;
    }

    seek(seconds) {
        const wasPlaying = this.playing;
        this.stop();
        this.pausedAt = Math.max(0, seconds);
        if (wasPlaying) this.play();
    }

    _loop() {
        if (!this.playing) return;
        const now     = this.ctx.currentTime;
        const horizon = now + LOOKAHEAD;

        while (this.cursor < this.events.length) {
            const ev = this.events[this.cursor];
            const evCtxTime = this.startAt + (ev.time - this.offset);
            if (evCtxTime > horizon) break;
            this._schedule(ev, evCtxTime);
            this.cursor++;
        }

        this.onTimeChange?.(this.currentTime);

        if (this.cursor >= this.events.length && this.currentTime >= this.duration) {
            this.playing = false;
            this._allOff();
            this.pausedAt = 0;
            this.onEnd?.();
            return;
        }
        this.rafId = requestAnimationFrame(this._loop);
    }

    _schedule(ev, atCtxTime) {
        const delay = Math.max(0, (atCtxTime - this.ctx.currentTime) * 1000);
        const timer = setTimeout(() => {
            this.pendingTimers.delete(timer);
            try {
                if (ev.type === 'on') this.synth.noteOn(ev.channel, ev.key, ev.vel);
                else                  this.synth.noteOff(ev.channel, ev.key);
            } catch (e) {
                console.warn('[playback] event failed', ev, e);
            }
        }, delay);
        this.pendingTimers.add(timer);
    }

    _cancelAll() {
        for (const t of this.pendingTimers) clearTimeout(t);
        this.pendingTimers.clear();
    }

    _allOff() {
        try {
            for (const ch of this.sequence.channels) {
                this.synth.controllerChange(ch.channel, 123, 0); // all notes off
            }
        } catch (e) { console.warn('[playback] allOff failed', e); }
    }
}