// js/editor/sequence.js

const DEFAULT_TPQ = 480;

function makeId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

export class Sequence {
    constructor(data = {}) {
        this.version = 1;
        this.name = data.name ?? 'Untitled';
        this.tempo = data.tempo ?? 120;
        this.timeDivision = data.timeDivision ?? DEFAULT_TPQ;
        this.channels = data.channels ?? [
            { channel: 0, program: 0, isDrum: false, volume: 100, pan: 64 },
            { channel: 1, program: 0, isDrum: false, volume: 100, pan: 64 },
            { channel: 2, program: 0, isDrum: false, volume: 100, pan: 64 },
            { channel: 9, program: 0, isDrum: true,  volume: 100, pan: 64 },
        ];
        this.patterns = data.patterns ?? [];
        this.arrangement = data.arrangement ?? [];
    }

    static create() { return new Sequence(); }
    static fromJSON(input) {
        const data = typeof input === 'string' ? JSON.parse(input) : input;
        return new Sequence(data);
    }
    toJSON() {
        return JSON.stringify({
            version: this.version,
            name: this.name,
            tempo: this.tempo,
            timeDivision: this.timeDivision,
            channels: this.channels,
            patterns: this.patterns,
            arrangement: this.arrangement,
        }, null, 2);
    }

    getPattern(id) {
        return this.patterns.find(p => p.id === id) ?? null;
    }

    addPattern({ name = 'Pattern', lengthTicks = this.timeDivision * 4, channel = 0 } = {}) {
        const p = { id: makeId('pat'), name, lengthTicks, channel, notes: [] };
        this.patterns.push(p);
        return p;
    }

    removePattern(id) {
        this.patterns = this.patterns.filter(p => p.id !== id);
        this.arrangement = this.arrangement.filter(a => a.patternId !== id);
    }

    addNote(patternId, { track, key, vel = 100, tick, dur = this.timeDivision / 2 }) {
        const p = this.getPattern(patternId);
        if (!p) throw new Error('No pattern ' + patternId);
        const n = { id: makeId('n'), track, key, vel, tick, dur };
        p.notes.push(n);
        return n;
    }

    removeNote(patternId, noteId) {
        const p = this.getPattern(patternId);
        if (!p) return false;
        const before = p.notes.length;
        p.notes = p.notes.filter(n => n.id !== noteId);
        return p.notes.length !== before;
    }

    placePattern(patternId, startTick) {
        const pl = { id: makeId('pl'), patternId, startTick };
        this.arrangement.push(pl);
        return pl;
    }

    // Плоский список событий в секундах. Сортирован.
    flatten() {
        const secPerTick = 60 / (this.tempo * this.timeDivision);
        const events = [];
        for (const place of this.arrangement) {
            const p = this.getPattern(place.patternId);
            if (!p) continue;
            for (const n of p.notes) {
                const absStart = (place.startTick + n.tick) * secPerTick;
                const durSec   = n.dur * secPerTick;
                const ch = this.channels[n.track];
                if (!ch) continue;
                events.push({ type: 'on',  time: absStart,          channel: ch.channel, key: n.key, vel: n.vel });
                events.push({ type: 'off', time: absStart + durSec, channel: ch.channel, key: n.key });
            }
        }
        events.sort((a, b) => a.time - b.time || (a.type === 'off' ? -1 : 1));
        return events;
    }

    getDurationSeconds() {
        let maxTick = 0;
        for (const place of this.arrangement) {
            const p = this.getPattern(place.patternId);
            if (!p) continue;
            maxTick = Math.max(maxTick, place.startTick + p.lengthTicks);
        }
        return maxTick * 60 / (this.tempo * this.timeDivision);
    }
}