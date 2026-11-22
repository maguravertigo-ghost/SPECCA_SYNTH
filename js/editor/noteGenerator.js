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

// Positions are sixteenths of a 4/4 bar, mapped onto the project's grid.
const eighths = [0, 2, 4, 6, 8, 10, 12, 14];
const offbeats = [2, 6, 10, 14];
const grooves = {
    straight: ['Straight / Pop', [[0, 8], [0, 8, 10]], [4, 12], eighths],
    syncopated: ['Syncopated', [[0, 3, 8, 11], [0, 6, 8, 14]], [4, 12], [0, 2, 4, 7, 8, 10, 12, 14, 15]],
    'half-time': ['Half-time', [[0, 6, 11], [0, 4, 14]], [8], eighths],
    euclidean: ['Euclidean', [euclideanPulses(16, 5)], [4, 12], euclideanPulses(16, 7)],
    dnb: ['Drum & Bass', [[0, 7, 10], [0, 3, 10, 14]], [4, 12], [0, 2, 3, 6, 8, 9, 10, 14, 15], { ghosts: [5, 11], open: [6, 14] }],
    techno: ['Techno', [[0, 4, 8, 12]], [4, 12], [0, 2, 4, 6, 8, 10, 12, 14, 15], { open: offbeats, snareKey: 39 }],
    trance: ['Trance', [[0, 4, 8, 12]], [4, 12], [0, 2, 4, 6, 8, 10, 12, 14, 15], { open: offbeats, percussion: [[51, [0, 4, 8, 12]]] }],
    house: ['House', [[0, 4, 8, 12]], [4, 12], [2, 4, 6, 8, 10, 12, 14], { open: offbeats, percussion: [[54, [0, 4, 8, 12]]] }],
    rnb: ['R&B / Neo-soul', [[0, 6, 10, 15], [0, 3, 9, 14]], [4, 12], [0, 2, 5, 7, 8, 10, 13, 15], { ghosts: [3, 11], soft: true, snareKey: 37 }],
    hiphop: ['Hip-hop / Boom bap', [[0, 7, 8, 11], [0, 3, 8, 10]], [4, 12], eighths, { ghosts: [15] }],
    trap: ['Trap', [[0, 3, 10, 14], [0, 6, 7, 13]], [8], [0, 2, 4, 6, 8, 10, 12, 13, 14, 15], { open: [6] }],
    rock: ['Rock', [[0, 6, 8], [0, 2, 8, 10]], [4, 12], eighths, { open: [14] }],
    metal: ['Metal', [[0, 1, 2, 3, 8, 9, 10, 11], [0, 2, 6, 7, 8, 10, 14, 15]], [4, 12], eighths, { percussion: [[51, [0, 4, 8, 12]]] }],
    funk: ['Funk', [[0, 3, 6, 10, 14], [0, 6, 8, 11, 14]], [4, 12], [0, 1, 2, 4, 6, 7, 8, 10, 12, 14, 15], { ghosts: [2, 9, 13], open: [7] }],
    disco: ['Disco', [[0, 4, 8, 12]], [4, 12], eighths, { open: offbeats, percussion: [[54, eighths]] }],
    reggae: ['Reggae / One drop', [[8]], [8], offbeats, { soft: true, snareKey: 37 }],
    latin: ['Latin / Clave', [[0, 6, 12]], [8], offbeats, { percussion: [[75, [0, 6, 12, 8, 10]], [64, [3, 7, 11, 15]]] }],
    jazz: ['Jazz / Swing', [[0, 8]], [4, 12], [0, 4, 7, 8, 12, 15], { ghosts: [7, 15], soft: true, hatKey: 51 }],
};
export const DRUM_GROOVES = Object.entries(grooves).map(([id, [label]]) => [label, id]);
export const MELODIC_SECTIONS = [['Main phrase', 'main'], ['Intro', 'intro'], ['Breakdown / sparse', 'breakdown'], ['Transition / Fill', 'fill'], ['Ending', 'ending']];

export const DRUM_SECTIONS = [['Full groove', 'main'], ['Intro', 'intro'], ['Breakdown', 'breakdown'], ['Transition / Fill', 'fill'], ['Ending', 'ending']];

function buildDrums({ style, section, random, lengthTicks, ticksPerBar, steps, step, add }) {
    const [, kicks, snares, hats, extra = {}] = grooves[style] ?? grooves.straight;
    const { ghosts = [], open = [], snareKey = 38, hatKey = 42, soft = false } = extra;
    for (let start = 0, bar = 0; start < lengthTicks; start += ticksPerBar, bar++) {
        const final = start + ticksPerBar >= lengthTicks;
        const at = beat => start + Math.min(ticksPerBar - 1, Math.min(steps - 1, Math.round(steps * beat / 16)) * step);
        const hit = (key, beat, vel, duration = step) => add(key, at(beat), duration, soft ? Math.round(vel * .88) : vel);
        if (section === 'ending' && final) {
            hit(36, 0, 112); hit(49, 0, 104, Math.min(ticksPerBar / 2, lengthTicks - start));
            continue;
        }
        const fill = section === 'fill' && final;
        const breakDown = section === 'breakdown';
        const intro = section === 'intro';
        const available = Math.min(ticksPerBar, lengthTicks - start);
        const cutoff = fill ? 8 * available / ticksPerBar : 16;
        const kick = kicks[Math.floor(random() * kicks.length)];
        for (const beat of (intro ? kick.slice(0, 1) : breakDown ? [] : kick)) if (beat < cutoff) hit(36, beat, beat ? 93 : 110);
        for (const beat of (intro ? [] : breakDown ? [8] : snares)) if (beat < cutoff) hit(snareKey, beat, breakDown ? 82 : 100);
        const cymbals = style === 'euclidean' ? euclideanPulses(16, 7, bar % 2) : hats;
        for (const [i, beat] of cymbals.entries()) {
            if (beat >= cutoff || ((intro || breakDown) && i % 2)) continue;
            const key = open.includes(beat) || (hatKey === 42 && beat === 14 && bar % 2 && !intro && !breakDown) ? 46 : hatKey;
            hit(key, beat, beat % 4 ? 54 : 73, step * .65);
        }
        if (!intro && !breakDown) {
            for (const beat of ghosts) if (beat < cutoff) hit(snareKey, beat, 47, step * .55);
            for (const [key, beats] of extra.percussion ?? []) for (const beat of beats) if (beat < cutoff) hit(key, beat, 66);
        }
        if (fill) {
            const roll = style === 'dnb' || style === 'trap' || style === 'metal' ? [8, 10, 11, 12, 13, 14, 15] : [8, 10, 12, 13, 15];
            roll.forEach((beat, i) => {
                const tick = start + Math.min(available - 1, Math.floor(available * beat / 16));
                const key = i < 2 ? snareKey : [50, 47, 45][Math.min(2, i - 2)];
                add(key, tick, Math.min(step, available / 8), Math.min(112, 77 + 6 * i));
            });
        }
    }
}

// Shared genre templates: rhythm, bass rhythm and GM instruments for full tracks.
export const MUSIC_PRESETS = {
    techno: { title: 'Techno', bpm: 132, groove: 'techno', kit: [81, 89, 38, 0], rhythm: [0, 3, 6, 8, 11, 14], bass: [0, 2, 4, 6, 8, 10, 12, 14] },
    trance: { title: 'Trance', bpm: 138, groove: 'trance', kit: [81, 90, 39, 0], rhythm: [0, 2, 4, 7, 8, 10, 12, 14], bass: [2, 6, 10, 14] },
    house: { title: 'House', bpm: 124, groove: 'house', kit: [4, 0, 38, 0], rhythm: [0, 3, 6, 10, 14], bass: [0, 3, 8, 11, 14] },
    dnb: { title: 'Drum & Bass', bpm: 174, groove: 'dnb', kit: [81, 95, 39, 0], rhythm: [0, 3, 6, 9, 12, 15], bass: [0, 3, 7, 10, 14] },
    hiphop: { title: 'Hip-hop / Boom bap', bpm: 90, groove: 'hiphop', kit: [11, 4, 32, 0], rhythm: [0, 4, 7, 10, 13], bass: [0, 6, 8, 13] },
    rnb: { title: 'R&B / Neo-soul', bpm: 82, groove: 'rnb', kit: [4, 27, 33, 0], rhythm: [0, 3, 7, 10, 13, 15], bass: [0, 5, 9, 14] },
    trap: { title: 'Trap', bpm: 146, groove: 'trap', kit: [10, 94, 38, 0], rhythm: [0, 6, 8, 11, 14], bass: [0, 3, 8, 14] },
    rock: { title: 'Rock', bpm: 124, groove: 'rock', kit: [29, 27, 34, 0], rhythm: [0, 4, 6, 8, 12, 14], bass: [0, 2, 4, 6, 8, 10, 12, 14] },
    funk: { title: 'Funk', bpm: 109, groove: 'funk', kit: [17, 28, 36, 0], rhythm: [0, 3, 6, 8, 11, 14], bass: [0, 3, 6, 8, 11, 15] },
    reggae: { title: 'Reggae', bpm: 80, groove: 'reggae', kit: [16, 27, 33, 0], rhythm: [0, 2, 6, 10, 14], bass: [0, 6, 9, 12] },
    latin: { title: 'Latin', bpm: 108, groove: 'latin', kit: [56, 24, 32, 0], rhythm: [0, 3, 6, 8, 10, 14], bass: [0, 6, 10, 14] },
    disco: { title: 'Disco', bpm: 118, groove: 'disco', kit: [62, 48, 36, 0], rhythm: [0, 2, 6, 8, 10, 14], bass: [0, 2, 4, 6, 8, 10, 12, 14] },
    jazz: { title: 'Jazz', bpm: 120, groove: 'jazz', kit: [66, 0, 32, 0], rhythm: [0, 4, 7, 8, 12, 15], bass: [0, 4, 8, 12] },
    metal: { title: 'Metal', bpm: 152, groove: 'metal', kit: [30, 29, 34, 0], rhythm: [0, 2, 4, 8, 9, 12, 14], bass: [0, 2, 4, 6, 8, 10, 12, 14] },
};

export function presetBassNotes({ tonic, mode, degree, ticks, rhythm }) {
    return rhythm.flatMap((position, i) => {
        const tick = Math.round(ticks * position / 16);
        const end = Math.round(ticks * (rhythm[i + 1] ?? 16) / 16);
        if (end <= tick) return [];
        const note = scaleTone(tonic, mode, degree + (i % 4 === 3 ? 4 : 0));
        const key = note - 12 * Math.round((note - 43) / 12);
        return [{ key, tick, dur: Math.max(1, Math.round((end - tick) * .72)), vel: i % 2 ? 83 : 99 }];
    });
}

// Returns ordinary, editable MIDI notes. No network, synth or DOM dependencies.
export function generatePatternNotes({ lengthTicks, ticksPerBar, stepsPerBar = 16, tonic = 0, mode = 'major',
    style = 'chords', section = 'main', preset = '', isDrum = false, random = Math.random } = {}) {
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
        buildDrums({ style, section, random, lengthTicks, ticksPerBar, steps, step, add });
    } else {
        const { progressions } = mode === 'minor' ? HARMONY.minor : HARMONY.major;
        const genre = Object.hasOwn(MUSIC_PRESETS, preset) ? MUSIC_PRESETS[preset] : null;
        const progression = genre ? progressions[0] : choose(progressions);
        // One-bar loops still get a change of harmony; longer patterns get one chord per bar.
        const span = lengthTicks <= ticksPerBar ? Math.max(1, Math.min(ticksPerBar, Math.round(steps / 2) * step)) : ticksPerBar;
        const variant = choose([[0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 0]]);
        for (let start = 0, i = 0; start < lengthTicks; start += span, i++) {
            const degree = progression[i % progression.length];
            const chord = [0, 2, 4].map(offset => scaleTone(tonic, mode, degree + offset));
            // Keep a compact register over middle C while retaining the chord's three pitch classes.
            const voicing = chord.map(key => key > 78 ? key - 12 : key).sort((a, b) => a - b);
            const available = Math.min(span, lengthTicks - start);
            if (style === 'bass') {
                for (const note of presetBassNotes({ tonic, mode, degree, ticks: available, rhythm: genre?.bass ?? [0, 6, 8, 12] })) {
                    add(note.key, start + note.tick, note.dur, note.vel);
                }
            } else if (style === 'melody') {
                for (const note of phraseNotes({ tonic, mode, degree, ticks: available, rhythm: genre?.rhythm, contour: variant, answer: i % 4 === 2 })) {
                    add(note.key, start + note.tick, note.dur, note.vel);
                }
            } else if (style === 'arpeggio') {
                const pulse = Math.max(1, step * (genre && ['trance', 'techno', 'dnb'].includes(preset) ? 1 : 2));
                for (let j = 0; j * pulse < available; j++) add(voicing[variant[j % variant.length]], start + j * pulse, Math.min(pulse * .82, available - j * pulse), j ? 84 : 100);
            } else {
                const offbeat = Math.min(available - 1, Math.round(span * .625 / step) * step);
                const accents = genre ? genre.rhythm.filter((_, i) => i % 2 === 0).map(p => Math.round(available * p / 16)).filter(p => p < available) : [];
                const pulses = accents.length ? [...new Set(accents)] : style === 'syncopated' && offbeat > 0 ? [0, offbeat] : [0];
                pulses.forEach((offset, j) => {
                    const dur = ((pulses[j + 1] ?? available) - offset) * (style === 'syncopated' ? .7 : .92);
                    for (const key of voicing) add(key, start + offset, dur, j ? 80 : 96);
                });
            }
        }
    }
    const result = !isDrum ? shapeMelodicSection(notes, { section, style, lengthTicks, ticksPerBar, tonic, mode, step }) : notes;
    return result.sort((a, b) => a.tick - b.tick || a.key - b.key);
}

// Section variations alter phrasing, not the channel gain or automation.
function shapeMelodicSection(notes, { section, style, lengthTicks, ticksPerBar, tonic, mode, step }) {
    if (!MELODIC_SECTIONS.some(([, id]) => id === section) || section === 'main') return notes;
    const onsets = [...new Set(notes.map(n => n.tick))].sort((a, b) => a - b);
    if (section === 'intro' || section === 'breakdown') {
        const stride = section === 'intro' ? 2 : 3;
        const kept = onsets.filter((_, i) => i % stride === 0);
        const ends = new Map(kept.map((tick, i) => [tick, kept[i + 1] ?? lengthTicks]));
        return notes.filter(n => ends.has(n.tick)).map(n => ({ ...n,
            dur: Math.min(ends.get(n.tick) - n.tick, Math.max(n.dur, Math.round(step * (section === 'intro' ? 1.5 : 3)))),
            vel: Math.max(1, Math.round(n.vel * (section === 'intro' ? .78 + .18 * n.tick / lengthTicks : .68))),
        }));
    }
    // Last half-bar becomes a pickup or a resolved tonic cadence.
    const boundary = Math.max(0, lengthTicks - Math.min(Math.ceil(ticksPerBar / 2), Math.ceil(lengthTicks / 2)));
    const lead = notes.filter(n => n.tick < boundary).map(n => ({ ...n, dur: Math.min(n.dur, boundary - n.tick) }));
    if (section === 'ending') {
        const base = style === 'bass' ? 36 : 60;
        const keys = ['chords', 'syncopated'].includes(style) ? [0, 2, 4] : [0];
        return [...lead, ...keys.map(degree => ({ key: scaleTone(tonic, mode, degree, base), tick: boundary,
            dur: Math.max(1, Math.floor((lengthTicks - boundary) * .8)), vel: 86 }))];
    }
    const pulse = Math.max(1, Math.round(step));
    const base = style === 'bass' ? 36 : 60;
    const scaleRun = mode === 'minor' ? [4, 5, 6, 7, 6, 4, 1, 6] : [4, 5, 6, 7, 6, 4, 2, 6];
    for (let tick = boundary, i = 0; tick < lengthTicks; tick += pulse, i++) {
        lead.push({ key: scaleTone(tonic, mode, scaleRun[i % scaleRun.length], base), tick,
            dur: Math.min(lengthTicks - tick, Math.max(1, Math.round(pulse * .72))), vel: Math.min(115, 88 + i * 2) });
    }
    return lead;
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
