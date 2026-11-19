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
        this.tempoChanges = data.tempoChanges ?? [];
        this.timeDivision = data.timeDivision ?? DEFAULT_TPQ;
        this.stepsPerBar = data.stepsPerBar ?? 16;
        this.patternLengthTicks = data.patternLengthTicks ?? this.timeDivision * 4 * 4;
        this.channels = data.channels ?? [
            { channel: 0, program: 0, isDrum: false, volume: 100, pan: 64 },
            { channel: 1, program: 0, isDrum: false, volume: 100, pan: 64 },
            { channel: 2, program: 0, isDrum: false, volume: 100, pan: 64 },
            { channel: 9, program: 0, isDrum: true,  volume: 100, pan: 64 },
        ];
        this.patternCounters = data.patternCounters ?? {};
        this.patterns = data.patterns ?? [];
        this.arrangement = data.arrangement ?? [];
    }

    static create() { return new Sequence(); }
    static fromJSON(input) {
        const data = typeof input === 'string' ? JSON.parse(input) : input;
        // Older saves omitted pattern.channel and could mix several tracks in one pattern.
        const seq = new Sequence(data);
        const patterns = [];
        const extraPlacements = [];
        for (const pattern of seq.patterns) {
            const notes = pattern.notes || [];
            const channel = pattern.channel ?? notes[0]?.track ?? 0;
            const byChannel = new Map([[channel, []]]);
            for (const note of notes) {
                const track = note.track ?? channel;
                if (!byChannel.has(track)) byChannel.set(track, []);
                byChannel.get(track).push({ ...note, track });
            }
            for (const [track, trackNotes] of byChannel) {
                const id = track === channel ? pattern.id : makeId('pat');
                patterns.push({ ...pattern, id, channel: track, notes: trackNotes });
                if (id === pattern.id) continue;
                for (const placement of seq.arrangement.filter(p => p.patternId === pattern.id)) {
                    extraPlacements.push({ ...placement, id: makeId('pl'), patternId: id });
                }
            }
        }
        seq.patterns = patterns;
        seq.arrangement = [...seq.arrangement, ...extraPlacements];
        return seq;
    }
    toJSON(indent = 2) {
        return JSON.stringify({
            version: this.version,
            name: this.name,
            tempo: this.tempo,
            tempoChanges: this.tempoChanges,
            timeDivision: this.timeDivision,
            stepsPerBar: this.stepsPerBar,
            patternLengthTicks: this.patternLengthTicks,
            channels: this.channels,
            patternCounters: this.patternCounters,
            patterns: this.patterns,
            arrangement: this.arrangement,
        }, null, indent);
    }

    getPattern(id) {
        return this.patterns.find(p => p.id === id) ?? null;
    }

    addPattern({ name = 'Pattern', lengthTicks = this.timeDivision * 4, channel = 0 } = {}) {
        const p = { id: makeId('pat'), name, lengthTicks, channel, notes: [] };
        this.patterns.push(p);
        return p;
    }

    getChannelPattern(channel) {
        return this.patterns.find(p => p.channel === channel) ?? null;
    }

    get ticksPerBar() { return Math.max(1, Math.round(this.timeDivision * this.stepsPerBar / 4)); }

    resizePattern(id, bars) {
        const pattern = this.getPattern(id);
        if (!pattern || !Number.isSafeInteger(bars) || bars < 1 || bars > 1024) throw new Error('Enter a length from 1 to 1024 bars.');
        const length = bars * this.ticksPerBar;
        if (length === pattern.lengthTicks) return false;
        if (pattern.notes.some(note => note.tick + note.dur > length)) {
            throw new Error('Move or shorten notes beyond the new end first.');
        }
        if (length > pattern.lengthTicks) {
            const ids = new Set(this.patterns.filter(p => p.channel === pattern.channel).map(p => p.id));
            const lane = this.arrangement.filter(c => ids.has(c.patternId)).sort((a, b) => a.startTick - b.startTick);
            // Extending a pattern affects all copies. Check each copy against the next clip on its lane.
            for (let i = 0; i < lane.length - 1; i++) {
                if (lane[i].patternId === id && lane[i].startTick + length > lane[i + 1].startTick) {
                    throw new Error('Not enough room: at least one copy would overlap the next clip.');
                }
            }
        }
        pattern.lengthTicks = length;
        return true;
    }

    createChannelPattern(channel) {
        const prefix = `${channel + 1}.`;
        const highest = this.patterns.reduce((max, p) => {
            if (p.channel !== channel || !p.name?.startsWith(prefix)) return max;
            const number = Number(p.name.slice(prefix.length));
            return Number.isSafeInteger(number) ? Math.max(max, number) : max;
        }, this.patternCounters[channel] ?? 0);
        this.patternCounters[channel] = highest + 1;
        return this.addPattern({ name: `${prefix}${highest + 1}`, channel, lengthTicks: this.patternLengthTicks });
    }

    ensureChannelPattern(channel) {
        return this.getChannelPattern(channel) ?? this.createChannelPattern(channel);
    }

    swapChannels(first, second) {
        const swap = channel => channel === first ? second : channel === second ? first : channel;
        for (const channel of this.channels) channel.channel = swap(channel.channel);
        for (const pattern of this.patterns) {
            pattern.channel = swap(pattern.channel);
            for (const note of pattern.notes) note.track = swap(note.track);
        }
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

    tempoAt(tick) {
        let tempo = this.tempo;
        for (const change of this.tempoChanges) {
            if (change.tick > tick) break;
            tempo = change.tempo;
        }
        return tempo;
    }

    ticksToSeconds(tick) {
        let time = 0, last = 0, tempo = this.tempo;
        for (const change of this.tempoChanges) {
            if (change.tick > tick) break;
            time += (change.tick - last) * 60 / (tempo * this.timeDivision);
            last = change.tick;
            tempo = change.tempo;
        }
        return time + (tick - last) * 60 / (tempo * this.timeDivision);
    }

    secondsToTicks(seconds) {
        let tick = 0, tempo = this.tempo;
        for (const change of this.tempoChanges) {
            const duration = (change.tick - tick) * 60 / (tempo * this.timeDivision);
            if (seconds < duration) break;
            seconds -= duration;
            tick = change.tick;
            tempo = change.tempo;
        }
        return tick + seconds * tempo * this.timeDivision / 60;
    }

    // Плоский список событий в секундах. Сортирован.
    flatten() {
        const events = [];
        const visual = new Set(this.channels.filter(c => c.kind === 'comment').map(c => c.channel));
        for (const place of this.arrangement) {
            const p = this.getPattern(place.patternId);
            if (!p || visual.has(p.channel)) continue;
            for (const n of p.notes) {
                const absTick = place.startTick + n.tick;
                const absStart = this.ticksToSeconds(absTick);
                const absEnd = this.ticksToSeconds(absTick + n.dur);
                const ch = this.channels.find(c => c.channel === n.track);
                if (!ch) continue;
                events.push({ type: 'on',  time: absStart,          channel: ch.channel, key: n.key, vel: n.vel });
                events.push({ type: 'off', time: absEnd, channel: ch.channel, key: n.key });
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
        return this.ticksToSeconds(maxTick);
    }
}