import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BasicMIDI } from '../main.min.js';
import { Sequence } from '../js/editor/sequence.js';
import { importMidi } from '../js/editor/importMidi.js';
import { writeArrangementMIDI } from '../js/editor/exportMidi.js';

const notes = (sequence) => sequence.arrangement.flatMap(({ startTick, patternId }) =>
    sequence.getPattern(patternId).notes.map(({ track, key, vel, tick, dur }) => [track, key, vel, tick + startTick, dur])
).sort();

test('arrangement export keeps clip offsets and repeats without exporting unused patterns', () => {
    const sequence = Sequence.create();
    const pattern = sequence.addPattern();
    const unused = sequence.addPattern();
    sequence.addNote(pattern.id, { track: 0, key: 60, vel: 91, tick: 120, dur: 240 });
    sequence.addNote(unused.id, { track: 0, key: 72, tick: 0 });
    sequence.placePattern(pattern.id, 1920);
    sequence.placePattern(pattern.id, 3840);

    const exported = importMidi(writeArrangementMIDI(sequence));

    assert.deepEqual(notes(exported), [
        [0, 60, 91, 2040, 240],
        [0, 60, 91, 3960, 240],
    ]);
});

test('arrangement export preserves demo notes beyond the piano roll loop', () => {
    const demo = readFileSync(new URL('../demo.mid', import.meta.url));
    const original = importMidi(Uint8Array.from(demo).buffer, 'demo.mid');
    const exported = importMidi(writeArrangementMIDI(original));
    assert.equal(exported.timeDivision, original.timeDivision);
    assert.equal(exported.tempo, original.tempo);
    assert.deepEqual(exported.tempoChanges, original.tempoChanges);
    assert.equal(notes(original).length, 3033);
    assert.ok(original.patterns.length < original.arrangement.length);
    assert.deepEqual(notes(exported), notes(original));
});

test('channel patch and bank assignments survive arrangement MIDI export', () => {
    const sequence = new Sequence({ channels: [
        { channel: 6, program: 32, isDrum: true, volume: 70, pan: 45 },
        { channel: 9, program: 4, isDrum: false, bankMSB: 8, bankLSB: 1, volume: 80, pan: 90 },
    ] });
    for (const channel of sequence.channels) {
        const pattern = sequence.ensureChannelPattern(channel.channel);
        sequence.addNote(pattern.id, { track: channel.channel, key: 60, tick: 120, dur: 240 });
        sequence.placePattern(pattern.id, 960);
    }
    const restored = importMidi(writeArrangementMIDI(sequence));
    for (const ch of sequence.channels) {
        const result = restored.channels[ch.channel];
        assert.equal(result.isDrum, ch.isDrum);
        assert.equal(result.program, ch.program);
        assert.equal(result.bankMSB, ch.bankMSB ?? 0);
        assert.equal(result.bankLSB, ch.bankLSB ?? 0);
        assert.equal(result.volume, ch.volume);
        assert.equal(result.pan, ch.pan);
    }
});


test('separate-track MIDI writes named format-1 lanes with their own channel and port', () => {
    const seq = new Sequence({ tempo: 98, tempoChanges: [{ tick: 1920, tempo: 126 }], channels: [
        { channel: 0, name: 'Lead', program: 80, isDrum: false },
        { channel: 1, name: 'Bass', program: 33, isDrum: false },
        { channel: 9, name: 'Noise guide', program: 0, isDrum: true },
        { channel: 16, name: 'Second port', program: 48, isDrum: false },
    ] });
    for (const ch of seq.channels) {
        const p = seq.ensureChannelPattern(ch.channel);
        seq.addNote(p.id, { track: ch.channel, key: ch.isDrum ? 36 : 62, tick: 120, dur: 240 });
        seq.placePattern(p.id, 1920);
    }
    const bytes = writeArrangementMIDI(seq, { splitTracks: true });
    assert.equal(new DataView(bytes).getUint16(8), 1);
    const parsed = BasicMIDI.fromArrayBuffer(bytes);
    assert.equal(parsed.tracks.length, 5);
    assert.equal(parsed.tracks[0].events.filter(e => e.statusByte === 0x51).length, 2);
    assert.deepEqual(parsed.tracks.slice(1).map(t => t.name), seq.channels.map(ch => ch.name));
    assert.deepEqual(parsed.tracks.slice(1).map(t => t.port), [0, 0, 0, 1]);
    for (const [i, track] of parsed.tracks.slice(1).entries()) {
        const channel = seq.channels[i];
        const keys = track.events.filter(e => (e.statusByte & 0xf0) === 0x90);
        assert.deepEqual(keys.map(e => [e.statusByte & 15, e.ticks]), [[channel.channel % 16, 2040]]);
        assert.equal(track.events.find(e => (e.statusByte & 0xf0) === 0xc0)?.data[0], channel.program);
    }
    assert.deepEqual(notes(importMidi(bytes)), notes(importMidi(writeArrangementMIDI(seq))));
});
