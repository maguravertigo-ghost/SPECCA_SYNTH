import { BasicMIDI } from '../../main.min.js';
import { Sequence } from './sequence.js';

function buildPatterns(sequence, channel, notes, barTicks) {
    notes.sort((a, b) => a.tick - b.tick || a.key - b.key || a.dur - b.dur || a.vel - b.vel);
    const patterns = new Map();
    for (let i = 0; i < notes.length;) {
        const start = Math.floor(notes[i].tick / barTicks) * barTicks;
        let end = start + barTicks;
        const local = [];
        // Keep sustained notes intact: join adjacent bars if a note crosses the boundary.
        for (; i < notes.length && notes[i].tick < end; i++) {
            const note = notes[i];
            end = Math.max(end, Math.ceil((note.tick + note.dur) / barTicks) * barTicks);
            local.push({ ...note, tick: note.tick - start, track: channel });
        }
        const lengthTicks = end - start;
        const signature = JSON.stringify([lengthTicks, local.map(n => [n.tick, n.key, n.vel, n.dur])]);
        let pattern = patterns.get(signature);
        if (!pattern) {
            pattern = sequence.addPattern({ name: `${channel + 1}.${patterns.size + 1}`, channel, lengthTicks });
            for (const note of local) sequence.addNote(pattern.id, note);
            patterns.set(signature, pattern);
        }
        sequence.placePattern(pattern.id, start);
    }
}

export function importMidi(buffer, name = '') {
    const midi = BasicMIDI.fromArrayBuffer(buffer, name);
    const seq = new Sequence({ name: name || midi.fileName || 'Imported', timeDivision: midi.timeDivision || 480 });
    const division = seq.timeDivision;
    // BasicMIDI lists tempo changes in reverse; the default 120 BPM precedes tick-zero events.
    const tempos = Array.from(new Map([...midi.tempoChanges].reverse().map(t => [t.ticks, t.tempo])));
    seq.tempo = tempos[0]?.[1] ?? 120;
    seq.tempoChanges = tempos.filter(([tick]) => tick > 0).map(([tick, tempo]) => ({ tick, tempo }));
    const meter = midi.tracks.flatMap(t => t.events.filter(e => e.statusByte === 0x58 && e.ticks === 0))[0];
    if (meter) seq.stepsPerBar = Math.max(1, Math.round(meter.data[0] * 16 / (2 ** meter.data[1])));
    const barTicks = Math.max(1, Math.round(division * seq.stepsPerBar / 4));
    seq.patternLengthTicks = barTicks * 4;
    seq.channels = Array.from({ length: 16 }, (_, channel) => ({
        channel, program: 0, isDrum: channel === 9, volume: 100, pan: 64, created: false,
    }));

    const ports = new Map();
    const state = (port) => {
        if (!ports.has(port)) ports.set(port, {
            mode: 'gm', channels: Array.from({ length: 16 }, (_, channel) => ({
                program: 0, isDrum: channel === 9, bankMSB: 0, bankLSB: 0, volume: 100, pan: 64,
                pending: new Map(), groups: new Map(),
            })),
        });
        return ports.get(port);
    };
    const pendingTrackPort = midi.tracks.map(track => track.port);
    const trackSettings = midi.tracks.map(() => new Map());
    const groups = [];
    const finishNote = (start, tick) => start.group.notes.push({ key: start.key, vel: start.vel,
        tick: start.tick, dur: Math.max(1, tick - start.tick) });

    midi.iterate((event, trackNumber) => {
        const status = event.statusByte;
        if (status === 0x21) pendingTrackPort[trackNumber] = event.data[0];
        if (status < 0x80 || status > 0xf0) return;
        const track = midi.tracks[trackNumber];
        const sourcePort = pendingTrackPort[trackNumber];
        const port = state(sourcePort);
        const [a, b, c, d, e, f, g, h] = event.data;
        if (status === 0xf0) {
            if (a === 0x7e && c === 9 && (d === 1 || d === 3)) port.mode = d === 3 ? 'gm2' : 'gm';
            if (a === 0x43 && c === 0x4c && d === 0 && e === 0 && f === 0x7e) port.mode = 'xg';
            if (a === 0x43 && c === 0x4c && d === 8 && f === 7 && port.channels[e]) port.channels[e].isDrum = g > 0;
            if (a === 0x41 && c === 0x42 && d === 0x12 && e === 0x40) {
                if (f === 0 && g === 0x7f) port.mode = 'gs';
                if ((f & 0xf0) === 0x10 && g === 0x15) {
                    const part = f & 15;
                    port.channels[part === 0 ? 9 : part <= 9 ? part - 1 : part].isDrum = h > 0;
                }
            }
            return;
        }
        const source = status & 15;
        const ch = port.channels[source];
        const trackKey = `${sourcePort}:${source}`;
        const settings = trackSettings[trackNumber];
        if (!settings.has(trackKey)) settings.set(trackKey, {});
        const local = settings.get(trackKey);
        switch (status & 0xf0) {
            case 0x90: if (b > 0) {
                // Honor tracks that carry their own program/volume even when the file
                // reuses a channel; note-only tracks still inherit the port's MIDI state.
                const patch = local.patch ?? ch.patch ?? { program: ch.program, bankMSB: ch.bankMSB, bankLSB: ch.bankLSB };
                const gm2 = port.mode === 'gm2';
                const xg = port.mode === 'xg';
                const isDrum = gm2 && [120, 121].includes(patch.bankMSB) ? patch.bankMSB === 120
                    : xg && patch.bankMSB >= 126 ? true : ch.isDrum;
                const bankMSB = (isDrum && (gm2 || xg)) || (gm2 && patch.bankMSB === 121) ? 0 : patch.bankMSB;
                const bankLSB = isDrum && (gm2 || xg) ? 0 : patch.bankLSB;
                const key = `${trackNumber}:${+isDrum}:${bankMSB}:${bankLSB}:${patch.program}`;
                let group = ch.groups.get(key);
                if (!group) {
                    group = { source, sourcePort, sourceTrack: trackNumber + 1,
                        program: patch.program, isDrum, bankMSB, bankLSB, name: track.name?.trim(),
                        volume: local.volume ?? ch.volume, pan: local.pan ?? ch.pan, notes: [] };
                    ch.groups.set(key, group);
                    groups.push(group);
                }
                const pending = ch.pending.get(a) ?? [];
                pending.push({ group, trackNumber, key: a, vel: b, tick: event.ticks });
                ch.pending.set(a, pending);
                break;
            }
            // A velocity-zero note-on is a note-off.
            case 0x80: {
                const queue = ch.pending.get(a);
                const ownTrack = queue?.findIndex(n => n.trackNumber === trackNumber) ?? -1;
                const [start] = queue?.splice(Math.max(0, ownTrack), 1) ?? [];
                if (start) finishNote(start, event.ticks);
                break;
            }
            case 0xc0:
                ch.program = a;
                ch.patch = { program: a, bankMSB: local.bankMSB ?? ch.bankMSB, bankLSB: local.bankLSB ?? ch.bankLSB };
                local.patch = ch.patch;
                break;
            case 0xb0:
                if (a === 0) local.bankMSB = ch.bankMSB = b;
                if (a === 32) local.bankLSB = ch.bankLSB = b;
                if (a === 7) {
                    local.volume = ch.volume = Math.round(b * 100 / 127);
                    // The editor uses one level per instrument, not the original automation.
                    // Do not turn a fade-in that started at zero into a permanently muted lane.
                    if (ch.volume) for (const group of ch.groups.values()) {
                        if (!group.volume) group.volume = ch.volume;
                    }
                }
                if (a === 10) local.pan = ch.pan = b;
                break;
        }
    });
    for (const port of ports.values()) for (const ch of port.channels) {
        for (const pending of ch.pending.values()) for (const note of pending) finishNote(note, midi.lastVoiceEventTick);
    }
    // Keep the first part on each of the 16 original rows, then allocate spare rows
    // and further MIDI ports. Never merge several instruments into one editable part.
    const occupied = new Set(groups.map(g => g.source));
    const primary = new Set();
    for (const group of groups) {
        let channel = group.source;
        if (primary.has(channel)) {
            channel = seq.channels.find(c => !occupied.has(c.channel) && (c.channel !== 9 || group.isDrum))?.channel
                ?? seq.channels.find(c => !occupied.has(c.channel))?.channel
                ?? seq.channels.length;
        } else primary.add(channel);
        occupied.add(channel);
        const { program, isDrum, bankMSB, bankLSB, volume, pan, source, sourcePort, sourceTrack } = group;
        seq.channels[channel] = { channel, program, isDrum, bankMSB, bankLSB, volume, pan,
            source, sourcePort, sourceTrack,
            name: group.name || (isDrum ? `Drums · Ch ${channel + 1}` : `Ch ${channel + 1}`), created: true };
        buildPatterns(seq, channel, group.notes, barTicks);
    }
    return seq;
}
