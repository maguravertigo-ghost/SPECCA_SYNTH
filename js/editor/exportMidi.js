// One MIDI writer for the pattern preview and the complete arrangement.
function writeVarLen(value) {
    const bytes = [value & 0x7f];
    for (value >>>= 7; value; value >>>= 7) bytes.unshift((value & 0x7f) | 0x80);
    return bytes;
}

function gsMessage(part, parameter, value) {
    const address = [0x40, part, parameter, value];
    const checksum = -address.reduce((sum, byte) => sum + byte, 0) & 0x7f;
    return [0x41, 0x10, 0x42, 0x12, ...address, checksum, 0xf7];
}

const gsPart = channel => channel === 9 ? 0 : channel < 9 ? channel + 1 : channel;
const marker = text => [0xff, 0x06, text.length, ...Array.from(text, c => c.charCodeAt(0))];

function writeSequence(sequence, clips, { loop = null, respectMute = false, liveMix = false, previewAt = null, tempoWindow = false, splitTracks = false } = {}) {
    const meta = [];
    const parts = new Map();
    const trackKey = lane => splitTracks ? lane : Math.floor(lane / 16);
    const active = new Set();
    const visual = new Set(sequence.channels.filter(c => c.kind === 'comment').map(c => c.channel));
    let endTick = 0;
    const emit = (tick, order, data, part = null) => {
        let events = meta;
        if (part !== null) {
            if (!parts.has(part)) parts.set(part, []);
            events = parts.get(part);
        }
        events.push({ tick, order, data });
    };

    for (const { pattern, startTick, trim } of clips) {
        if (visual.has(pattern.channel)) continue;
        endTick = Math.max(endTick, startTick + pattern.lengthTicks);
        for (const note of pattern.notes) {
            const lane = note.track;
            if (!Number.isInteger(lane) || lane < 0 || lane >= 128 * 16) throw new Error(`Invalid MIDI lane: ${lane}`);
            const part = trackKey(lane), ch = lane % 16;
            const localStart = Math.max(0, Math.round(note.tick));
            if (trim && localStart >= pattern.lengthTicks) continue;
            const tick = startTick + localStart;
            const end = tick + Math.max(1, Math.round(note.dur));
            const endNote = trim ? Math.min(end, startTick + pattern.lengthTicks) : end;
            const velocity = note.ghost ? 1 : Math.max(1, Math.min(127, note.vel ?? 90));
            active.add(lane);
            emit(tick, 1, [0x90 | ch, note.key & 0x7f, velocity], part);
            emit(endNote, 0, [0x80 | ch, note.key & 0x7f, 0x40], part);
            endTick = Math.max(endTick, endNote);
        }
    }

    const sysex = (bytes, order, part) => emit(0, order, [0xf0, ...writeVarLen(bytes.length), ...bytes], part);
    if (parts.size) sysex(gsMessage(0, 0x7f, 0), -6, Math.min(...parts.keys()));
    for (const lane of active) {
        const part = trackKey(lane), ch = lane % 16;
        const info = sequence.channels.find(c => c.channel === lane) ?? {};
        const isDrum = info.isDrum ?? (ch === 9);
        if (isDrum !== (ch === 9)) sysex(gsMessage(0x10 | gsPart(ch), 0x15, isDrum ? 1 : 0), -5, part);
        emit(0, -4, [0xb0 | ch, 0, (info.bankMSB ?? 0) & 0x7f], part);
        emit(0, -3, [0xb0 | ch, 32, (info.bankLSB ?? 0) & 0x7f], part);
        emit(0, -2, [0xc0 | ch, (info.program ?? 0) & 0x7f], part);
        const volume = liveMix ? 100 : respectMute && info.muted ? 0 : (info.volume ?? 100);
        emit(0, -1, [0xb0 | ch, 7, Math.round(volume * 127 / 100)], part);
        emit(0, -1, [0xb0 | ch, 10, (info.pan ?? 64) & 0x7f], part);
    }
    if (loop) {
        const loopEnd = loop.end ?? endTick;
        endTick = Math.max(endTick, loopEnd);
        emit(loop.start ?? 0, -7, marker('loopStart'));
        emit(loopEnd, 2, marker('loopEnd'));
    }

    const tempoEvent = (tempo) => {
        const micros = Math.min(0xffffff, Math.max(1, Math.round(60000000 / tempo)));
        return [0xff, 0x51, 3, micros >> 16, (micros >> 8) & 0xff, micros & 0xff];
    };
    emit(0, -9, tempoEvent(previewAt === null ? sequence.tempo : sequence.tempoAt(previewAt)));
    if (previewAt === null || tempoWindow) for (const change of sequence.tempoChanges ?? []) {
        const tick = change.tick - (tempoWindow ? previewAt : 0);
        if (tick > 0 && tick <= endTick) emit(tick, -9, tempoEvent(change.tempo));
    }
    const ppq = Math.max(1, sequence.timeDivision || 480);
    const steps = sequence.stepsPerBar || 16;
    emit(0, -8, [0xff, 0x58, 4, steps % 4 === 0 ? steps / 4 : steps, steps % 4 === 0 ? 2 : 4, 24, 8]);
    const formatOne = splitTracks || [...parts.keys()].some(part => part > 0);
    const encodeTrack = (events) => {
        events.sort((a, b) => a.tick - b.tick || a.order - b.order);
        const track = [];
        let last = 0;
        for (const event of events) {
            track.push(...writeVarLen(event.tick - last), ...event.data);
            last = event.tick;
        }
        track.push(...writeVarLen(endTick - last), 0xff, 0x2f, 0);
        return track;
    };
    const tracks = formatOne ? [encodeTrack(meta), ...[...parts.keys()].sort((a, b) => a - b).map(part => {
        const port = splitTracks ? Math.floor(part / 16) : part;
        emit(0, -11, [0xff, 0x21, 1, port], part);
        if (splitTracks) {
            const info = sequence.channels.find(c => c.channel === part);
            const name = new TextEncoder().encode((info?.name || `Channel ${part + 1}`).slice(0, 160));
            emit(0, -10, [0xff, 0x03, ...writeVarLen(name.length), ...name], part);
        }
        return encodeTrack(parts.get(part));
    })] : [encodeTrack(meta.concat(parts.get(0) ?? []))];
    const out = new Uint8Array(14 + tracks.reduce((length, track) => length + 8 + track.length, 0));
    const view = new DataView(out.buffer);
    out.set([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6]);
    view.setUint16(8, formatOne ? 1 : 0);
    view.setUint16(10, tracks.length);
    view.setUint16(12, ppq);
    let offset = 14;
    for (const track of tracks) {
        out.set([0x4d, 0x54, 0x72, 0x6b], offset);
        view.setUint32(offset + 4, track.length);
        out.set(track, offset + 8);
        offset += track.length + 8;
    }
    return out.buffer;
}

export function writePatternMIDI(sequence, patternId, previewAt = 0, options = {}) {
    const pattern = sequence.getPattern(patternId);
    if (!pattern) throw new Error('No pattern ' + patternId);
    return writeSequence(sequence, [{ pattern, startTick: 0, trim: true }], { loop: {}, respectMute: true, previewAt, ...options });
}

// Build a temporary, local-tick window of the arrangement. Clip crossing notes
// at both edges; the original clips and patterns remain untouched.
export function writePatternMixMIDI(sequence, patternId, { placementId, anchorTick = 0, ...options } = {}) {
    const patterns = new Map(sequence.patterns.map(p => [p.id, p]));
    const pattern = patterns.get(patternId);
    if (!pattern) throw new Error('No pattern ' + patternId);
    const matching = sequence.arrangement.filter(p => p.patternId === patternId);
    const placement = matching.find(p => p.id === placementId)
        ?? matching.reduce((first, p) => !first || p.startTick < first.startTick ? p : first, null);
    const startTick = placement?.startTick ?? Math.max(0, Math.round(anchorTick));
    const endTick = startTick + pattern.lengthTicks;
    const visual = new Set(sequence.channels.filter(c => c.kind === 'comment').map(c => c.channel));
    const clips = [];
    const add = (p, start) => {
        if (!p || visual.has(p.channel) || start >= endTick || start + p.lengthTicks <= startTick) return;
        const notes = [];
        for (const n of p.notes) {
            const onset = start + Math.max(0, Math.round(n.tick));
            const release = Math.min(start + p.lengthTicks, onset + Math.max(1, Math.round(n.dur)));
            const first = Math.max(startTick, onset), last = Math.min(endTick, release);
            if (last > first) notes.push({ ...n, tick: first - startTick, dur: last - first });
        }
        if (notes.length) clips.push({ startTick: 0, trim: true, pattern: { channel: p.channel, lengthTicks: pattern.lengthTicks, notes } });
    };
    for (const clip of sequence.arrangement) add(patterns.get(clip.patternId), clip.startTick);
    if (!placement) add(pattern, startTick);
    return { startTick, midi: clips.length ? writeSequence(sequence, clips, {
        previewAt: startTick, tempoWindow: true, loop: { end: pattern.lengthTicks }, respectMute: true, ...options,
    }) : null };
}

export function writeArrangementMIDI(sequence, options) {
    const clips = [];
    for (const placement of sequence.arrangement) {
        const pattern = sequence.getPattern(placement.patternId);
        if (pattern) clips.push({ pattern, startTick: placement.startTick });
    }
    return writeSequence(sequence, clips, options);
}
