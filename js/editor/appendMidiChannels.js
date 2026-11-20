import { Sequence } from './sequence.js';

// Copy cleanly into a new snapshot so multiple-file imports are one atomic edit.
// Offset in quarter notes is conserved across different MIDI resolutions.
export function appendMidiChannels(project, sources) {
    const sequence = Sequence.fromJSON(project.toJSON(0));
    const order = sequence.orderedChannels().map(c => c.channel);
    const used = new Set(order);
    const lanes = Array.from({ length: 2048 }, (_, i) => i);
    let count = 0;
    for (const source of sources) {
        const scale = tick => Math.round(tick * sequence.timeDivision / source.timeDivision);
        const patterns = new Map();
        for (const p of source.patterns) {
            if (!patterns.has(p.channel)) patterns.set(p.channel, []);
            patterns.get(p.channel).push(p);
        }
        const remapped = new Map();
        for (const info of source.orderedChannels()) {
            const originals = patterns.get(info.channel) ?? [];
            if (!originals.some(p => p.notes.length)) continue;
            const lane = lanes.find(i => !used.has(i) && (i % 16 === 9) === !!info.isDrum)
                ?? lanes.find(i => !used.has(i));
            if (lane === undefined) throw new Error('Not enough free MIDI channels to import all files.');
            used.add(lane);
            order.push(lane);
            sequence.channels = sequence.channels.filter(c => c.channel !== lane);
            sequence.channels.push({ ...info, channel: lane, created: true });
            delete sequence.patternCounters[lane];
            count++;
            for (const original of originals) {
                const pattern = sequence.createChannelPattern(lane);
                pattern.lengthTicks = Math.max(1, scale(original.lengthTicks));
                remapped.set(original.id, pattern.id);
                for (const note of original.notes) {
                    const tick = Math.min(pattern.lengthTicks - 1, scale(note.tick));
                    const end = Math.min(pattern.lengthTicks, scale(note.tick + note.dur));
                    sequence.addNote(pattern.id, { track: lane, key: note.key, vel: note.vel, tick, dur: Math.max(1, end - tick) });
                }
            }
        }
        for (const clip of source.arrangement) {
            if (remapped.has(clip.patternId)) sequence.placePattern(remapped.get(clip.patternId), scale(clip.startTick));
        }
    }
    sequence.channelOrder = order;
    return { sequence, count };
}
