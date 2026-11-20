export const TONICS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

const HARMONY = {
    dorian: { scale: [0, 2, 3, 5, 7, 9, 10] },
    mixolydian: { scale: [0, 2, 4, 5, 7, 9, 10] },
    major: { scale: [0, 2, 4, 5, 7, 9, 11], progressions: [[0, 4, 5, 3], [0, 5, 1, 4], [0, 3, 5, 4], [0, 1, 3, 4]] },
    minor: { scale: [0, 2, 3, 5, 7, 8, 10], progressions: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6], [0, 3, 6, 0]] },
};

// Diatonic chords are shared by the song generator and the Piano Roll.
export const scaleIntervals = mode => [...(HARMONY[mode] ?? HARMONY.major).scale];
export const scaleTone = (tonic, mode, degree, base = 60) => {
    const scale = (HARMONY[mode] ?? HARMONY.major).scale;
    return base + ((Math.round(tonic) % 12 + 12) % 12) + scale[((degree % 7) + 7) % 7] + 12 * Math.floor(degree / 7);
};

export function voiceChord(tonic, mode, degree, previous = []) {
    const chord = [0, 2, 4].map(i => scaleTone(tonic, mode, degree + i));
    const voicings = [];
    for (let octave = -1; octave <= 0; octave++) {
        for (let inversion = 0; inversion < 3; inversion++) {
            const v = chord.map((key, i) => key + 12 * (octave + (i < inversion ? 1 : 0))).sort((a, b) => a - b);
            if (v[0] >= 50 && v[2] <= 79) voicings.push(v);
        }
    }
    const target = previous.length ? previous : [57, 62, 67];
    const cost = v => v.reduce((n, key, i) => n + Math.abs(key - target[i]), 0);
    return voicings.reduce((best, v) => cost(v) < cost(best) ? v : best, voicings[0]);
}

// A recurring rhythmic motif: strong beats land on chord tones, weak beats can
// step through the scale. The last phrase resolves instead of choosing at random.
export function phraseNotes({ tonic, mode, degree, ticks, rhythm = [0, 4, 7, 10, 12],
    contour = [0, 1, 2, 1, 0], answer = false, resolve = false, center = 73 }) {
    const chord = [0, 2, 4];
    const pulses = [...new Set([0, ...rhythm.filter(step => step >= 0 && step < 16)])].sort((a,b) => a-b);
    const notes = [];
    for (let i = 0; i < pulses.length; i++) {
        const step = pulses[i];
        const tick = Math.round(ticks * step / 16);
        const next = Math.round(ticks * (pulses[i + 1] ?? 16) / 16);
        if (tick >= next) continue;
        const shape = contour[i % contour.length] + (answer ? 1 : 0);
        const index = ((shape % 3) + 3) % 3;
        const passing = step % 4 !== 0 && i > 0 && i < pulses.length - 1;
        const offset = resolve ? 0 : chord[index] + (passing ? (index === 2 ? -1 : 1) : 0);
        let key = scaleTone(tonic, mode, degree + offset);
        key += 12 * Math.round((center - key) / 12);
        if (resolve && i > 0) break;
        notes.push({ key, tick, dur: Math.min(ticks - tick, Math.max(1, Math.round((resolve ? ticks : next - tick) * .86))), vel: step % 4 ? 77 : 96 });
    }
    return notes;
}

// Distribute hits around a cycle with gaps that differ by at most one step.
export function euclideanPulses(steps, hits, rotation = 0) {
    if (!Number.isSafeInteger(steps) || steps < 1 || steps > 128 || !Number.isSafeInteger(hits) || hits < 1 || hits > steps) return [];
    rotation = ((Math.trunc(rotation) % steps) + steps) % steps;
    return Array.from({ length: steps }, (_, i) => i)
        .filter(i => (((i - rotation + steps) % steps) * hits) % steps < hits);
}

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
            const kick = style === 'euclidean' ? euclideanPulses(16, 5) : style === 'syncopated' ? choose([[0, 3, 8, 11], [0, 6, 8, 14]])
                : style === 'half-time' ? choose([[0, 6, 11], [0, 4, 14]]) : choose([[0, 8], [0, 8, 10]]);
            const snare = style === 'half-time' ? [8] : [4, 12];
            const hat = style === 'euclidean' ? euclideanPulses(16, 7, bar % 2) : style === 'syncopated' ? [0, 2, 4, 7, 8, 10, 12, 14, 15] : [0, 2, 4, 6, 8, 10, 12, 14];
            for (const beat of kick) add(36, at(beat), step, beat ? 93 : 110);
            for (const beat of snare) add(38, at(beat), step, 100);
            for (const beat of hat) add(beat === 14 && bar % 2 ? 46 : 42, at(beat), step * .65, beat % 4 ? 54 : 73);
        }
    } else {
        const { progressions } = mode === 'minor' ? HARMONY.minor : HARMONY.major;
        const progression = choose(progressions);
        // One-bar loops still get a change of harmony; longer patterns get one chord per bar.
        const span = lengthTicks <= ticksPerBar ? Math.max(1, Math.min(ticksPerBar, Math.round(steps / 2) * step)) : ticksPerBar;
        const variant = choose([[0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 0]]);
        for (let start = 0, i = 0; start < lengthTicks; start += span, i++) {
            const degree = progression[i % progression.length];
            const chord = [0, 2, 4].map(offset => scaleTone(tonic, mode, degree + offset));
            // Keep a compact register over middle C while retaining the chord's three pitch classes.
            const voicing = chord.map(key => key > 78 ? key - 12 : key).sort((a, b) => a - b);
            const available = Math.min(span, lengthTicks - start);
            if (style === 'melody') {
                for (const note of phraseNotes({ tonic, mode, degree, ticks: available, contour: variant, answer: i % 4 === 2 })) {
                    add(note.key, start + note.tick, note.dur, note.vel);
                }
            } else if (style === 'arpeggio') {
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
