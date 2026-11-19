import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importMidi } from '../js/editor/importMidi.js';
import { writeArrangementMIDI } from '../js/editor/exportMidi.js';
import { Sequence } from '../js/editor/sequence.js';

function makeMidi(events) {
    const bytes = new Uint8Array(22 + events.length + 4);
    bytes.set([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0, 0x4d, 0x54, 0x72, 0x6b]);
    new DataView(bytes.buffer).setUint32(18, events.length + 4);
    bytes.set(events, 22);
    bytes.set([0, 0xff, 0x2f, 0], 22 + events.length);
    return bytes.buffer;
}

test('exact repeats share a pattern and a held note can span a bar boundary', () => {
    const seq = new Sequence({ stepsPerBar: 12 });
    const p = seq.addPattern({ channel: 2, lengthTicks: 1440 });
    seq.addNote(p.id, { track: 2, key: 60, vel: 100, tick: 120, dur: 360 });
    seq.placePattern(p.id, 0);
    seq.placePattern(p.id, 1440);
    const tail = seq.addPattern({ channel: 2, lengthTicks: 2880 });
    seq.addNote(tail.id, { track: 2, key: 62, vel: 100, tick: 1200, dur: 640 });
    seq.placePattern(tail.id, 2880);
    const restored = importMidi(writeArrangementMIDI(seq));
    assert.equal(restored.stepsPerBar, 12);
    const [first, second, third] = restored.arrangement;
    assert.deepEqual(restored.arrangement.map(c => c.startTick), [0, 1440, 2880]);
    assert.equal(first.patternId, second.patternId);
    assert.notEqual(first.patternId, third.patternId);
    assert.equal(restored.getPattern(third.patternId).notes[0].dur, 640);
});

test('patch changes split editable lanes; GM2 drum kits can be on a non-default channel', () => {
    const input = makeMidi([
        0, 0xf0, 5, 0x7e, 0x7f, 9, 3, 0xf7,
        0, 0xc2, 0, 0, 0x92, 60, 90,
        120, 0x92, 60, 0,
        0, 0xc2, 33, 0, 0x92, 48, 100,
        0, 0xb6, 0, 120, 0, 0xc6, 32, 0, 0x96, 38, 110,
        120, 0x82, 48, 0, 0, 0x86, 38, 0,
    ]);
    const restored = importMidi(input);
    const lanes = restored.channels.filter(c => c.created);
    assert.equal(lanes.length, 3);
    assert.equal(restored.channels[2].program, 0);
    const bass = lanes.find(c => c.program === 33);
    const drums = lanes.find(c => c.isDrum);
    assert.notEqual(bass.channel, 2);
    assert.equal(restored.getChannelPattern(bass.channel).notes[0].key, 48);
    assert.equal(drums.channel, 6);
    assert.equal(drums.program, 32);
    assert.equal(restored.getChannelPattern(6).notes[0].key, 38);
});

test('tempo changes round-trip through the arrangement and convert both time axes', () => {
    const seq = new Sequence({ tempo: 120, tempoChanges: [{ tick: 480, tempo: 60 }] });
    const pattern = seq.addPattern();
    seq.addNote(pattern.id, { track: 0, key: 60, tick: 480 });
    seq.placePattern(pattern.id, 0);
    const restored = importMidi(writeArrangementMIDI(seq));
    assert.deepEqual(restored.tempoChanges, [{ tick: 480, tempo: 60 }]);
    assert.equal(restored.ticksToSeconds(960), 1.5);
    assert.equal(restored.secondsToTicks(1.5), 960);
});

function makeType1(tracks) {
    const bytes = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, tracks.length >> 8, tracks.length & 255, 1, 0xe0];
    for (const events of tracks) {
        const length = events.length + 4;
        bytes.push(0x4d, 0x54, 0x72, 0x6b, 0, 0, length >> 8, length & 255, ...events, 0, 0xff, 0x2f, 0);
    }
    return new Uint8Array(bytes).buffer;
}

test('tracks reusing a MIDI channel keep their own instruments and note lengths', () => {
    const input = makeType1([
        [0, 0xc1, 24, 0, 0x91, 60, 90, 120, 0x81, 60, 0],
        [0, 0xc1, 48, 0, 0x91, 60, 100, 64, 0x81, 60, 0],
    ]);
    const sequence = importMidi(input);
    const parts = sequence.channels.filter(c => c.created);
    assert.equal(parts.length, 2);
    const duration = (program) => sequence.getChannelPattern(parts.find(c => c.program === program).channel).notes[0].dur;
    assert.equal(duration(24), 120);
    assert.equal(duration(48), 64);
});

test('more than 16 parts get separate lanes and remain audible-addressable after MIDI export', () => {
    // 20 independent tracks reuse channel 1; each declares its own distinct patch.
    const input = makeType1(Array.from({ length: 20 }, (_, i) => [0, 0xc0, i, 0, 0x90, 60 + i, 90, 120, 0x80, 60 + i, 0]));
    const original = importMidi(input);
    const restored = importMidi(writeArrangementMIDI(original));
    for (const seq of [original, restored]) {
        const parts = seq.channels.filter(c => c.created);
        assert.equal(parts.length, 20);
        assert.equal(new Set(parts.map(c => c.channel)).size, 20);
        assert.ok(parts.some(c => c.channel >= 16));
        for (const part of parts) assert.equal(seq.getChannelPattern(part.channel).notes[0].key, 60 + part.program);
    }
    assert.ok(restored.channels.some(c => c.created && c.sourcePort === 1));
});
