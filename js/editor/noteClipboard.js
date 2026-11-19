export function copyNotes(notes, timeDivision) {
    if (!notes.length) return null;
    const start = Math.min(...notes.map(n => n.tick));
    return { timeDivision, notes: notes.map(({ id, track, tick, ...note }) => ({ ...note, tick: tick - start })) };
}

// Keep the full phrase together; return null rather than silently clipping notes.
export function planPaste(clip, { step, timeDivision, length, cursor, selection, notes }) {
    if (!clip) return null;
    const scale = timeDivision / clip.timeDivision;
    const phrase = clip.notes.map(n => ({ ...n, tick: Math.round(n.tick * scale), dur: Math.max(1, Math.round(n.dur * scale)) }));
    const span = Math.max(...phrase.map(n => n.tick + n.dur));
    const limit = length - span;
    if (limit < 0 || (cursor != null && cursor > limit)) return null;
    if (cursor != null) return { start: cursor, notes: phrase };
    const after = selection.reduce((end, n) => Math.max(end, n.tick + n.dur), 0);
    const preferred = Math.ceil(after / step) * step;
    const occupied = new Map();
    for (const n of notes) {
        if (!occupied.has(n.key)) occupied.set(n.key, []);
        occupied.get(n.key).push(n);
    }
    for (const [first, last] of [[preferred, limit], [0, Math.min(preferred - 1, limit)]]) {
        for (let start = first; start <= last; start += step) {
            const collides = phrase.some(n => occupied.get(n.key)?.some(existing =>
                existing.tick < start + n.tick + n.dur && existing.tick + existing.dur > start + n.tick));
            if (!collides) return { start, notes: phrase };
        }
    }
    return null;
}
