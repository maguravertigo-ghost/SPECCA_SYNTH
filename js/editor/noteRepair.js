import { scaleIntervals } from './noteGenerator.js';

const chroma = key => ((key % 12) + 12) % 12;
const profiles = {
    major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};

// A suggestion, not a transcription of harmony: sustained pitch classes weigh more.
export function suggestKey(notes, beat = 480) {
    const weights = Array(12).fill(0);
    for (const n of notes) if (!n.ghost) weights[chroma(n.key)] += Math.min(beat * 2, Math.max(1, n.dur));
    let best = { tonic: 0, mode: 'major' }, max = -Infinity;
    for (const [mode, profile] of Object.entries(profiles)) {
        const mean = profile.reduce((a, b) => a + b, 0) / 12;
        const norm = Math.hypot(...profile.map(x => x - mean));
        for (let tonic = 0; tonic < 12; tonic++) {
            const score = weights.reduce((sum, w, i) => sum + w * (profile[chroma(i - tonic)] - mean), 0) / norm;
            if (score > max) { max = score; best = { tonic, mode }; }
        }
    }
    return best;
}

// Return a non-destructive preview. Keep timing, velocity, count and any
// in-scale notes intact. Don't create new unisons that overlap in time.
export function planPitchRepair(notes, { tonic = 0, mode = 'major', maxShift = 1, targets = null } = {}) {
    const intervals = scaleIntervals(mode);
    const inScale = new Set(intervals.map(i => chroma(i + tonic)));
    const triad = new Set([0, 2, 4].map(i => chroma(tonic + intervals[i])));
    const lanes = Array.from({ length: 128 }, () => new Set());
    for (const n of notes) lanes[n.key]?.add(n);
    const changes = new Map();
    let skipped = 0;
    for (const n of [...notes].sort((a,b) => a.tick - b.tick || a.key - b.key)) {
        if (n.ghost || (targets && !targets.has(n)) || inScale.has(chroma(n.key))) continue;
        // Prefer the nearest pitch; if equidistant, prefer a tonic-triad tone.
        const candidates = [];
        for (let distance = 1; distance <= maxShift; distance++) {
            for (const key of [n.key - distance, n.key + distance]) {
                if (key >= 0 && key <= 127 && inScale.has(chroma(key))) candidates.push(key);
            }
        }
        candidates.sort((a,b) => Math.abs(a - n.key) - Math.abs(b - n.key) || Number(triad.has(chroma(b))) - Number(triad.has(chroma(a))));
        const key = candidates.find(pitch => {
            for (const other of lanes[pitch]) {
                if (n.tick < other.tick + other.dur && other.tick < n.tick + n.dur) return false;
            }
            return true;
        });
        if (key === undefined) { skipped++; continue; }
        changes.set(n, key);
        lanes[n.key].delete(n);
        lanes[key].add(n);
    }
    return { changes, skipped };
}
