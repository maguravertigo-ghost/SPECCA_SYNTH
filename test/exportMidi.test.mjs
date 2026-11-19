import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
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
