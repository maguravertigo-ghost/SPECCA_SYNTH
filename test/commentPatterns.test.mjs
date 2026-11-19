import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BasicMIDI } from '../main.min.js';
import { Sequence } from '../js/editor/sequence.js';
import { importMidi } from '../js/editor/importMidi.js';
import { writeArrangementMIDI, writePatternMIDI } from '../js/editor/exportMidi.js';

const midi = bytes => BasicMIDI.fromArrayBuffer(bytes);

test('new patterns after importing Contra Force use one bar of the imported meter', () => {
    const bytes = readFileSync(new URL('../ContraForceL2.mid', import.meta.url));
    const seq = importMidi(bytes, 'ContraForceL2.mid');
    assert.equal(seq.stepsPerBar, 16);
    assert.equal(seq.patternLengthTicks, seq.ticksPerBar);
    const pattern = seq.createChannelPattern(seq.patterns[0].channel);
    assert.equal(pattern.lengthTicks, 4 * seq.timeDivision);
});

test('resizing validates notes and all placed copies without mutating on failure', () => {
    const seq = new Sequence();
    const bar = seq.ticksPerBar;
    const a = seq.addPattern({ lengthTicks: bar * 2 });
    const b = seq.addPattern({ lengthTicks: bar });
    seq.addNote(a.id, { track: 0, key: 61, tick: bar + 20, dur: 30 });
    seq.placePattern(a.id, 0);
    seq.placePattern(a.id, 5 * bar);
    seq.placePattern(b.id, 7 * bar);
    assert.throws(() => seq.resizePattern(a.id, 1), /shorten notes/);
    assert.throws(() => seq.resizePattern(a.id, 3), /overlap the next clip/);
    assert.equal(a.lengthTicks, 2 * bar);
    a.notes[0].tick = 20;
    assert.equal(seq.resizePattern(a.id, 1), true);
    assert.equal(a.lengthTicks, bar);
    assert.equal(seq.resizePattern(a.id, 1), false);
});

test('comment resize has a one-bar minimum and respects the nearest next clip across copies', () => {
    const seq = new Sequence({ channels: [{ channel: 4, kind: 'comment' }] });
    const bar = seq.ticksPerBar;
    const cue = seq.addPattern({ channel: 4, lengthTicks: bar });
    const next = seq.addPattern({ channel: 4, lengthTicks: bar });
    seq.placePattern(cue.id, 0);
    seq.placePattern(cue.id, 6 * bar);
    seq.placePattern(next.id, 9 * bar);
    assert.deepEqual(seq.patternResizeBounds(cue.id), { minBars: 1, maxBars: 3 });
    assert.equal(seq.resizePattern(cue.id, 3), true);
    assert.throws(() => seq.resizePattern(cue.id, 4), /overlap/);
    assert.equal(seq.resizePattern(cue.id, 1), true);
});

test('comment clips save with the project but do not alter any MIDI event or duration', () => {
    const seq = new Sequence({ channels: [{ channel: 0 }, { channel: 1, kind: 'comment' }] });
    const music = seq.addPattern({ channel: 0 });
    seq.addNote(music.id, { track: 0, key: 60, tick: 0, dur: 240 });
    seq.placePattern(music.id, 0);
    const before = writeArrangementMIDI(seq);
    const cue = seq.addPattern({ channel: 1 });
    cue.comment = 'Bass enters here\nHold the last note.';
    // Existing notes can remain in a lane converted to Comment, without leaking to playback.
    seq.addNote(cue.id, { track: 1, key: 70, tick: 0, dur: 240 });
    seq.placePattern(cue.id, seq.ticksPerBar * 20);
    const restored = Sequence.fromJSON(seq.toJSON());
    assert.equal(restored.getPattern(cue.id).comment, cue.comment);
    assert.equal(restored.getPattern(cue.id).notes.length, 1);
    assert.deepEqual(writeArrangementMIDI(restored), before);
    assert.equal(midi(writePatternMIDI(restored, cue.id)).tracks.flatMap(t => t.events).filter(e => (e.statusByte & 0xf0) === 0x90).length, 0);
    assert.equal(restored.flatten().filter(e => e.type === 'on').length, 1);
});
