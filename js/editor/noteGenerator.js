export const TONICS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

const HARMONY = {
    major: { scale: [0, 2, 4, 5, 7, 9, 11], progressions: [[0, 4, 5, 3], [0, 5, 1, 4], [0, 3, 5, 4], [0, 1, 3, 4]] },
    minor: { scale: [0, 2, 3, 5, 7, 8, 10], progressions: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6], [0, 3, 6, 0]] },
};

// Returns ordinary, editable MIDI notes. No network, synth or DOM dependencies.
export function generatePatternNotes({ lengthTicks, ticksPerBar, stepsPerBar = 16, tonic = 0, mode = 'major',
    style = 'chords', isDrum = false, random = Math.random } = {}) {
    if (!Number.isSafeInteger(lengthTicks) || lengthTicks < 1 || !Number.isSafeInteger(ticksPerBar) || ticksPerBar < 1) return [];
    const steps = Math.max(1, Math.round(stepsPerBar));
    const step = Math.max(1, Math.round(ticksPerBar / steps));
    const notes = [], seen = new Set();
    const add = (key, tick, duration, velocity) => {
        if (tick < 0 || tick >= lengthTicks) return;
        const id = `${key}:${tick}`;
        if (seen.has(id)) return;
        seen.add(id);
        notes.push({ key, tick, dur: Math.max(1, Math.min(lengthTicks - tick, Math.round(duration))), vel: velocity });
    };
    const choose = array => array[Math.floor(random() * array.length)];

    if (isDrum) {
        for (let start = 0, bar = 0; start < lengthTicks; start += ticksPerBar, bar++) {
            const at = fraction => start + Math.min(ticksPerBar - 1, Math.min(steps - 1, Math.round(steps * fraction / 16)) * step);
            const kick = style === 'syncopated' ? choose([[0, 3, 8, 11], [0, 6, 8, 14]])
                : style === 'half-time' ? choose([[0, 6, 11], [0, 4, 14]]) : choose([[0, 8], [0, 8, 10]]);
            const snare = style === 'half-time' ? [8] : [4, 12];
            const hat = style === 'syncopated' ? [0, 2, 4, 7, 8, 10, 12, 14, 15] : [0, 2, 4, 6, 8, 10, 12, 14];
            for (const beat of kick) add(36, at(beat), step, beat ? 93 : 110);
            for (const beat of snare) add(38, at(beat), step, 100);
            for (const beat of hat) add(beat === 14 && bar % 2 ? 46 : 42, at(beat), step * .65, beat % 4 ? 54 : 73);
        }
    } else {
        const { scale, progressions } = mode === 'minor' ? HARMONY.minor : HARMONY.major;
        const progression = choose(progressions);
        const root = 60 + ((Math.round(tonic) % 12 + 12) % 12);
        // One-bar loops still get a change of harmony; longer patterns get one chord per bar.
        const span = lengthTicks <= ticksPerBar ? Math.max(1, Math.min(ticksPerBar, Math.round(steps / 2) * step)) : ticksPerBar;
        const variant = choose([[0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 0]]);
        const scaleTone = degree => root + scale[degree % 7] + 12 * Math.floor(degree / 7);
        for (let start = 0, i = 0; start < lengthTicks; start += span, i++) {
            const degree = progression[i % progression.length];
            const chord = [0, 2, 4].map(offset => scaleTone(degree + offset));
            // Keep a compact register over middle C while retaining the chord's three pitch classes.
            const voicing = chord.map(key => key > 78 ? key - 12 : key).sort((a, b) => a - b);
            const available = Math.min(span, lengthTicks - start);
            if (style === 'arpeggio') {
                const pulse = Math.max(1, step * 2);
                for (let j = 0; j * pulse < available; j++) add(voicing[variant[j % variant.length]], start + j * pulse, Math.min(pulse * .82, available - j * pulse), j ? 84 : 100);
            } else {
                const offbeat = Math.min(available - 1, Math.round(span * .625 / step) * step);
                const pulses = style === 'syncopated' && offbeat > 0 ? [0, offbeat] : [0];
                pulses.forEach((offset, j) => {
                    const dur = ((pulses[j + 1] ?? available) - offset) * (style === 'syncopated' ? .7 : .92);
                    for (const key of voicing) add(key, start + offset, dur, j ? 80 : 96);
                });
            }
        }
    }
    return notes.sort((a, b) => a.tick - b.tick || a.key - b.key);
}

// Ignore generated notes that would collide with a note already sounding on the same pitch.
export function withoutNoteConflicts(generated, existing) {
    const lanes = new Map();
    for (const { key, tick, dur } of existing) {
        if (!lanes.has(key)) lanes.set(key, []);
        lanes.get(key).push({ start: tick, end: tick + dur });
    }
    for (const [key, intervals] of lanes) {
        intervals.sort((a, b) => a.start - b.start);
        const merged = [];
        for (const interval of intervals) {
            const last = merged.at(-1);
            if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
            else merged.push(interval);
        }
        lanes.set(key, merged);
    }
    return generated.filter(({ key, tick, dur }) => {
        const intervals = lanes.get(key);
        if (!intervals) return true;
        let lo = 0, hi = intervals.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (intervals[mid].end <= tick) lo = mid + 1;
            else hi = mid;
        }
        return lo === intervals.length || intervals[lo].start >= tick + dur;
    });
}
