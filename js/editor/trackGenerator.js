import { Sequence } from './sequence.js';
import { TONICS, DRUM_GROOVES, MUSIC_PRESETS, presetBassNotes, generatePatternNotes, phraseNotes, scaleTone, voiceChord } from './noteGenerator.js';

export const TRACK_STYLES = {
    pop: { title: 'Pop', bpm: 110, groove: 'straight', kit: [0, 0, 33, 0], rhythm: [0, 3, 6, 8, 12] },
    chill: { title: 'Lo-fi', bpm: 82, groove: 'half-time', kit: [4, 5, 32, 0], rhythm: [0, 6, 10, 14] },
    retro: { title: 'Retro / Game', bpm: 138, groove: 'syncopated', kit: [80, 81, 38, 0], rhythm: [0, 2, 4, 7, 8, 10, 12, 14] },
    folk: { title: 'Folk / World', bpm: 96, groove: 'euclidean', kit: [73, 24, 32, 0], rhythm: [0, 3, 6, 9, 12, 14],
        modes: ['mixolydian', 'dorian'], phrases: [[0, 6, 3, 0], [0, 3, 6, 4], [3, 0, 6, 0]] },
    medieval: { title: 'Medieval', bpm: 88, groove: 'half-time', kit: [74, 46, 42, 0], rhythm: [0, 4, 6, 10, 12],
        modes: ['mixolydian', 'dorian'], phrases: [[0, 3, 6, 0], [0, 6, 4, 0], [0, 1, 6, 0]] },
    ...MUSIC_PRESETS,
};
const PALETTES = { piano: [0, 48, 32, 0], electric: [4, 27, 33, 0], synth: [81, 89, 38, 0] };
const MOODS = {
    bright: { mode: 'major', phrases: [[0, 4, 5, 3], [0, 3, 1, 4], [5, 3, 0, 4]] },
    calm: { mode: 'major', phrases: [[0, 5, 3, 0], [0, 1, 3, 4], [3, 0, 1, 4]] },
    dramatic: { mode: 'minor', phrases: [[0, 5, 2, 6], [0, 3, 5, 4], [5, 6, 3, 4]] },
};
const ROLES = ['lead', 'chords', 'bass', 'drums'];
const mod = (value, n) => ((value % n) + n) % n;
const pick = (array, random) => array[Math.floor(random() * array.length)];
const integer = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
const randomFrom = seed => () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
};

// Work with imported, editable data only. Nothing is uploaded and the source is never mutated.
export function generateTrack({ type = 'compose', source = null, sourceUse = 'none', style = 'pop', mood = 'bright',
    palette = 'style', groove = 'style', evolution = false, tonic = 0, bars = 16, bpm, seed = 1 } = {}) {
    const preset = TRACK_STYLES[style] ?? TRACK_STYLES.pop;
    const feeling = MOODS[mood] ?? MOODS.bright;
    const random = randomFrom(integer(seed, 1, 0, 0xffffffff));
    tonic = integer(tonic, 0, 0, 11);
    const mode = preset.modes?.[+(feeling.mode === 'minor')] ?? feeling.mode;
    const phrasesForStyle = preset.phrases ?? feeling.phrases;
    if ((type !== 'compose' || sourceUse !== 'none') && !source?.patterns.some(p => p.notes.length)) {
        throw new Error('Choose a MIDI file that contains notes.');
    }
    if (type === 'variation') return varyMIDI(source, sourceUse, random);
    const motif = type === 'compose' && source ? readMotif(source, sourceUse) : {};
    const context = { preset, phrasesForStyle, tonic, mode, random, motif, evolution, groove: DRUM_GROOVES.some(([, id]) => id === groove) ? groove : preset.groove };
    if (type === 'recompose') return recomposeMIDI(source, context);

    bars = Math.ceil(integer(bars, 16, 8, 64) / 4) * 4;
    const programs = PALETTES[palette] ?? preset.kit;
    const seq = new Sequence({ name: `${preset.title} · ${TONICS[tonic]} ${mode}`, tempo: integer(bpm, preset.bpm, 45, 220),
        patternLengthTicks: 1920, channels: ROLES.map((role, i) => ({ channel: i === 3 ? 9 : i, name: role[0].toUpperCase() + role.slice(1),
            program: programs[i], isDrum: i === 3, volume: [88, 58, 84, 78][i], pan: [64, 47, 64, 64][i], created: true })) });
    const barTicks = seq.ticksPerBar;
    const phrases = bars / 4;
    const verse = pick(phrasesForStyle, random), chorus = pick(phrasesForStyle.filter(p => p !== verse), random);
    const contour = motif.contour ?? pick([[0, 1, 1, 2, 0], [1, 0, 2, 1, 0], [0, 2, 1, 0, 1]], random);
    const clipCache = new Map();
    const visits = new Map();
    for (let phrase = 0; phrase < phrases; phrase++) {
        const intro = phrase === 0 && phrases >= 3;
        const finale = phrase === phrases - 1;
        const section = intro ? 'Intro' : finale ? 'Ending' : phrases >= 6 && phrase === phrases - 3 ? 'Bridge'
            : phrase % 2 === 0 ? 'Chorus' : 'Verse';
        const visit = visits.get(section) ?? 0;
        visits.set(section, visit + 1);
        const development = evolution ? (finale ? 2 : visit % 3) : 0;
        const progression = finale ? [...chorus.slice(0, 2), 4, 0] : section === 'Bridge' ? [5, 1, 3, 4] : section === 'Chorus' ? chorus : verse;
        seq.channels.forEach((ch, i) => {
            const role = ROLES[i];
            if (intro && (role === 'lead' || role === 'drums')) return;
            const key = `${role}:${section}:${development}`;
            let pattern = clipCache.get(key);
            if (!pattern) {
                pattern = seq.createChannelPattern(ch.channel);
                pattern.name += ` · ${section}${development && !finale ? ` ${development + 1}` : ''}`;
                pattern.lengthTicks = 4 * barTicks;
                let previous = [];
                progression.forEach((degree, bar) => {
                    const resolve = finale && bar === 3;
                    const chord = voiceChord(tonic, mode, degree, previous);
                    previous = chord;
                    const notes = partNotes({ ...context, contour, degree, chord, ticks: barTicks, role, bar, development,
                        answer: bar === 2, resolve, full: section === 'Chorus' || finale });
                    for (const note of notes) seq.addNote(pattern.id, { ...note, tick: note.tick + bar * barTicks, track: ch.channel });
                });
                clipCache.set(key, pattern);
            }
            seq.placePattern(pattern.id, phrase * 4 * barTicks);
        });
    }
    return seq;
}

function partNotes({ preset, groove, tonic, mode, motif, random, degree, chord, ticks, role, bar, contour, answer, resolve, full, development = 0 }) {
    const pulse = (key, offset, end, vel) => {
        const tick = Math.min(ticks - 1, Math.round(ticks * offset / 16));
        return { key, tick, dur: Math.max(1, Math.round(ticks * end / 16) - tick), vel };
    };
    if (role === 'lead') {
        const base = motif.rhythm ?? (full ? preset.rhythm : preset.rhythm.filter((_, i) => i % 2 === 0));
        const rhythm = development && bar % 2 ? [...base, development === 1 ? 11 : 15] : base;
        return phraseNotes({ tonic, mode, degree, ticks, contour, answer: answer || (development === 2 && bar % 2 === 1),
            resolve, rhythm, center: (full ? 77 : 71) + (development === 2 ? 3 : 0) });
    }
    if (role === 'chords') {
        if (preset === TRACK_STYLES.medieval) return [scaleTone(tonic, mode, degree, 48), scaleTone(tonic, mode, degree + 4, 48)].map(key => pulse(key, 0, 15, 76));

        if ((preset === TRACK_STYLES.retro || preset === TRACK_STYLES.folk || development === 2) && !resolve) return [0, 3, 6, 8, 11, 14].map((off, i) => pulse(chord[i % 3], off, off + 2, i ? 68 : 84));
        return chord.flatMap(key => full && preset !== TRACK_STYLES.chill && !resolve
            ? [pulse(key, 0, 8, 86), pulse(key, 10, 15, 72)] : [pulse(key, 0, 15, 79)]);
    }
    const low = offset => {
        const key = scaleTone(tonic, mode, degree + offset);
        return key + 12 * Math.round((43 - key) / 12);
    };
    if (role === 'bass' && preset.bass && !resolve) return presetBassNotes({ tonic, mode, degree, ticks, rhythm: preset.bass });
    if (role === 'bass') return resolve ? [pulse(low(0), 0, 15, 94)] : [pulse(low(0), 0, 7, 98),
        pulse(low(full ? 4 : 0), 8, full ? 12 : 15, 88), ...(full ? [pulse(low(0), 13, 16, 83)] : [])];
    if (motif.drumHits?.length && !resolve) {
        return motif.drumHits.map(({ key, step, vel }) => pulse(key, step, step + 1, vel));
    }
    const hits = generatePatternNotes({ lengthTicks: ticks, ticksPerBar: ticks, isDrum: true, style: groove, random });
    if (resolve) return hits.filter(n => n.tick === 0);
    if ((full || development) && bar % 4 === 3 && ticks >= 16) hits.push(pulse(45, 14, 15, 86), pulse(47, 15, 16, 90));
    return hits;
}

function readMotif(source, use) {
    if (use === 'none') return {};
    const drum = new Set(source.channels.filter(ch => ch.isDrum).map(ch => ch.channel));
    const candidates = source.patterns.filter(p => p.notes.length >= 2 && (use !== 'notes' || !drum.has(p.channel)));
    // Prefer a groove from a drum channel or a melodic phrase with distinct pitches.
    const pattern = (use === 'rhythm' ? candidates.find(p => drum.has(p.channel))
        : candidates.find(p => new Set(p.notes.map(n => n.key)).size >= 3)) ?? candidates[0];
    if (!pattern) throw new Error(`This MIDI has no usable ${use === 'notes' ? 'melodic phrase' : 'rhythm'}.`);
    const start = Math.floor(Math.min(...pattern.notes.slice(0, 256).map(n => n.tick)) / source.ticksPerBar) * source.ticksPerBar;
    const window = pattern.notes.filter(n => n.tick >= start && n.tick < start + source.ticksPerBar).slice(0, 256);
    if (use === 'notes') {
        const keys = [...new Map(window.map(n => [n.tick, n.key])).values()].slice(0, 8);
        return { contour: keys.map((key, i) => i ? mod(key - keys[0], 3) : 0) };
    }
    const stepOf = note => Math.min(15, Math.round((note.tick - start) * 16 / source.ticksPerBar));
    const drumHits = drum.has(pattern.channel) ? [...new Map(window.map(n => {
        const step = stepOf(n);
        return [`${n.key}:${step}`, { key: n.key, step, vel: n.vel }];
    })).values()] : [];
    return { rhythm: [...new Set(window.map(stepOf))].slice(0, 10), drumHits };
}

function varyMIDI(source, use, random) {
    const seq = Sequence.fromJSON(source.toJSON(0));
    seq.name = `${source.name.replace(/\.midi?$/i, '')} · Variation`;
    const drums = new Set(seq.channels.filter(ch => ch.isDrum).map(ch => ch.channel));
    if (use === 'notes' && !seq.patterns.some(p => p.notes.length && !drums.has(p.channel))) {
        throw new Error('This MIDI has no melodic notes to vary.');
    }
    for (const p of seq.patterns) {
        if (!p.notes.length || (use === 'notes' && drums.has(p.channel))) continue;
        // Shift complete melodic phrases by an octave, not by arbitrary semitones.
        const transpose = use === 'rhythm' || drums.has(p.channel) ? 0 : random() < .5 ? -12 : 12;
        const shift = p.notes.every(n => n.key + transpose >= 0 && n.key + transpose <= 127) ? transpose : -transpose;
        const safeShift = p.notes.every(n => n.key + shift >= 0 && n.key + shift <= 127) ? shift : 0;
        const repeats = [];
        for (const note of p.notes) {
            note.key += safeShift;
            const variation = Math.round(random() * 18) - 9;
            note.vel = integer(note.vel + variation, 88, 1, 127);
            if (use !== 'notes' && !drums.has(p.channel) && note.dur >= seq.timeDivision / 2 && random() < .35) {
                const split = Math.max(1, Math.min(note.dur - 1, Math.round(note.dur * .625)));
                if (split >= note.dur) continue;
                repeats.push({ ...note, tick: note.tick + split, dur: note.dur - split, vel: Math.max(1, note.vel - 13) });
                note.dur = split;
            } else if (use !== 'notes' && drums.has(p.channel) && random() < .24) {
                // Change articulation without moving the drummer off the imported grid.
                note.dur = Math.max(1, Math.floor(note.dur * .7));
            }
        }
        for (const note of repeats) seq.addNote(p.id, note);
        p.notes.sort((a, b) => a.tick - b.tick || a.key - b.key);
    }
    return seq;
}

function recomposeMIDI(source, context) {
    if (source.arrangement.length > 5000) throw new Error('This MIDI has too many clips for recomposition (maximum 5000).');
    const seq = Sequence.fromJSON(source.toJSON(0));
    seq.name = `${source.name.replace(/\.midi?$/i, '')} · New melody`;
    const byId = new Map(seq.patterns.map(p => [p.id, p]));
    const stats = new Map();
    for (const p of seq.patterns) {
        const stat = stats.get(p.channel) ?? { total: 0, count: 0 };
        for (const n of p.notes) { stat.total += n.key; stat.count++; }
        stats.set(p.channel, stat);
    }
    const melodic = seq.channels.filter(ch => !ch.isDrum && stats.get(ch.channel)?.count);
    if (!melodic.length) throw new Error('Choose a MIDI with at least one melodic instrument.');
    const mean = ch => stats.get(ch.channel).total / stats.get(ch.channel).count;
    const bass = melodic.find(ch => ch.program >= 32 && ch.program <= 39) ?? melodic.find(ch => mean(ch) < 54);
    const lead = melodic.filter(ch => ch !== bass).sort((a,b) => mean(b) - mean(a))[0] ?? bass;
    const roles = new Map(melodic.map(ch => [ch.channel, ch === lead ? 'lead' : ch === bass ? 'bass' : 'chords']));
    const progression = pick(context.phrasesForStyle, context.random);
    const contour = pick([[0, 1, 2, 1, 0], [1, 0, 2, 0, 1]], context.random);
    const used = new Set();
    const remapped = new Map();
    let workBars = 0;
    for (const clip of seq.arrangement) {
        const original = byId.get(clip.patternId);
        const role = roles.get(original?.channel);
        if (!role) { used.add(clip.patternId); continue; }
        const phase = Math.floor(clip.startTick / seq.ticksPerBar) % progression.length;
        const development = context.evolution ? Math.floor(clip.startTick / (4 * seq.ticksPerBar)) % 3 : 0;
        const signature = `${original.id}:${phase}:${development}`;
        let replacement = remapped.get(signature);
        if (!replacement) {
            workBars += Math.ceil(original.lengthTicks / seq.ticksPerBar);
            if (workBars > 8192) throw new Error('This arrangement is too long for recomposition.');
            replacement = seq.createChannelPattern(original.channel);
            replacement.lengthTicks = original.lengthTicks;
            let previous = [];
            for (let at = 0, bar = 0; at < replacement.lengthTicks; at += seq.ticksPerBar, bar++) {
                const degree = progression[(bar + phase) % progression.length];
                const chord = voiceChord(context.tonic, context.mode, degree, previous);
                previous = chord;
                const notes = partNotes({ ...context, motif: {}, role, contour, degree, chord, bar, development, answer: (bar + phase) % 4 === 2,
                    full: (bar + phase) % 4 >= 2, ticks: Math.min(seq.ticksPerBar, replacement.lengthTicks - at) });
                for (const note of notes) seq.addNote(replacement.id, { ...note, tick: note.tick + at, track: original.channel });
            }
            remapped.set(signature, replacement);
        }
        clip.patternId = replacement.id;
        used.add(replacement.id);
    }
    seq.patterns = seq.patterns.filter(p => used.has(p.id));
    return seq;
}
