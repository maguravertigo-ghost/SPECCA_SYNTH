import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BasicMIDI } from '../main.min.js';
import { Sequence } from '../js/editor/sequence.js';
import { importMidi } from '../js/editor/importMidi.js';
import { writePatternMIDI } from '../js/editor/exportMidi.js';

test('opening a channel creates only its pattern, and placements share its edited notes', () => {
    const sequence = new Sequence({ patternLengthTicks: 960 });
    const pattern = sequence.ensureChannelPattern(12);
    assert.equal(sequence.ensureChannelPattern(12), pattern);
    assert.equal(pattern.lengthTicks, 960);
    assert.deepEqual(sequence.arrangement, []);
    const first = sequence.placePattern(pattern.id, 0);
    const repeat = sequence.placePattern(pattern.id, 1920);
    sequence.addNote(pattern.id, { track: 12, key: 67, tick: 120, dur: 240 });
    assert.equal(sequence.getPattern(first.patternId), sequence.getPattern(repeat.patternId));
    assert.equal(sequence.getPattern(repeat.patternId).notes[0].key, 67);
});

test('Piano Roll previews only its pattern at local ticks, without synthetic notes', () => {
    const sequence = new Sequence();
    const preview = sequence.addPattern({ channel: 7, lengthTicks: 7680 });
    const other = sequence.addPattern({ channel: 0, lengthTicks: 7680 });
    sequence.addNote(preview.id, { track: 7, key: 60, tick: 6480, dur: 480 });
    sequence.addNote(other.id, { track: 0, key: 65, tick: 0, dur: 480 });
    sequence.placePattern(preview.id, 9600);
    sequence.placePattern(other.id, 0);
    const buffer = writePatternMIDI(sequence, preview.id);
    const midi = BasicMIDI.fromArrayBuffer(buffer);
    const restored = importMidi(buffer);
    assert.equal(restored.patterns.length, 1);
    assert.equal(midi.loop.start, 0);
    assert.equal(midi.loop.end, 7680);
    const [clip] = restored.arrangement;
    const [pattern] = restored.patterns;
    assert.deepEqual(pattern.notes.map(({ track, key, tick, dur }) => [track, key, clip.startTick + tick, dur]), [[7, 60, 6480, 480]]);
});

test('project save retains channel ownership, kit choice and pattern defaults', () => {
    const sequence = new Sequence({ stepsPerBar: 12, patternLengthTicks: 2880 });
    sequence.channels.push({ channel: 6, program: 32, isDrum: true, presetName: 'Jazz', bankMSB: 0 });
    const pattern = sequence.ensureChannelPattern(6);
    sequence.placePattern(pattern.id, 1440);
    const restored = Sequence.fromJSON(sequence.toJSON());
    assert.equal(restored.getChannelPattern(6).id, pattern.id);
    assert.deepEqual(restored.channels, sequence.channels);
    assert.deepEqual(restored.arrangement, sequence.arrangement);
    assert.equal(restored.stepsPerBar, 12);
    assert.equal(restored.patternLengthTicks, 2880);
});

test('legacy mixed-channel patterns are split into editable channels with matching placements', () => {
    const sequence = Sequence.fromJSON({
        patterns: [{ id: 'p', lengthTicks: 960, notes: [{ track: 1 }, { track: 11 }] }],
        arrangement: [{ id: 'pl', patternId: 'p', startTick: 1920 }],
    });
    assert.deepEqual(sequence.patterns.map(p => [p.channel, p.notes.map(n => n.track)]), [[1, [1]], [11, [11]]]);
    assert.deepEqual(sequence.arrangement.map(p => [sequence.getPattern(p.patternId).channel, p.startTick]), [[1, 1920], [11, 1920]]);
});

test('moving a channel row keeps its notes, placements and instrument tied together', () => {
    const sequence = new Sequence({ channels: [{ channel: 1, program: 33 }, { channel: 8, program: 8 }] });
    const pattern = sequence.ensureChannelPattern(1);
    const placement = sequence.placePattern(pattern.id, 1920);
    const note = sequence.addNote(pattern.id, { track: 1, key: 48, tick: 0 });
    sequence.swapChannels(1, 8);
    assert.equal(sequence.getChannelPattern(8), pattern);
    assert.equal(note.track, 8);
    assert.equal(placement.patternId, pattern.id);
    assert.equal(sequence.channels.find(c => c.channel === 8).program, 33);
});

test('clone inserts below source without moving MIDI lanes and deep copies shared patterns and clips', () => {
    const seq = new Sequence({ channels: [{ channel: 0, name: 'Lead', program: 2 }, { channel: 7, name: 'Bass' }] });
    const p = seq.createChannelPattern(0);
    seq.addNote(p.id, { track: 0, key: 63, tick: 10, dur: 30 });
    seq.placePattern(p.id, 0);
    seq.placePattern(p.id, p.lengthTicks);
    const clone = seq.cloneChannel(0);
    assert.deepEqual(seq.orderedChannels().map(c => c.channel), [0, clone.channel, 7]);
    assert.equal(clone.program, 2);
    const copy = seq.getChannelPattern(clone.channel);
    assert.notEqual(copy.id, p.id);
    assert.notEqual(copy.notes[0].id, p.notes[0].id);
    assert.equal(copy.notes[0].track, clone.channel);
    assert.deepEqual(seq.arrangement.filter(c => c.patternId === copy.id).map(c => c.startTick), [0, p.lengthTicks]);
    copy.notes[0].key = 80;
    assert.equal(p.notes[0].key, 63);
    assert.deepEqual(Sequence.fromJSON(seq.toJSON()).orderedChannels().map(c => c.name), ['Lead', 'Lead (copy)', 'Bass']);
});
