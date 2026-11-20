import assert from 'node:assert/strict';
import test from 'node:test';
import { BasicMIDI } from '../main.min.js';
import { Sequence } from '../js/editor/sequence.js';
import { writeArrangementMIDI } from '../js/editor/exportMidi.js';
import { generateTrack } from '../js/editor/trackGenerator.js';

const snapshot = seq => seq.patterns.map(p => [p.channel, p.lengthTicks, p.notes.map(({ tick, key, dur, vel }) => [tick, key, dur, vel])]);
const sourceMIDI = () => {
    const seq = new Sequence({ name: 'Fixture.mid', tempo: 102, tempoChanges: [{ tick: 1920, tempo: 121 }], channels: [
        { channel: 0, program: 29, volume: 88 }, { channel: 1, program: 33, volume: 70 }, { channel: 9, program: 0, isDrum: true, volume: 75 },
    ] });
    for (const [channel, keys] of [[0, [68, 63, 72, 71]], [1, [34, 33, 34, 36]], [9, [36, 42, 38, 42]]]) {
        const p = seq.addPattern({ channel, lengthTicks: seq.ticksPerBar });
        [0, 360, 960, 1320].forEach((tick, i) => seq.addNote(p.id, { key: keys[i], tick, dur: 300, track: channel, vel: 95 }));
        seq.placePattern(p.id, 0);
        seq.placePattern(p.id, seq.ticksPerBar * 2);
    }
    return seq;
};
const layout = seq => seq.arrangement.map(p => [p.startTick, seq.getPattern(p.patternId).channel, seq.getPattern(p.patternId).lengthTicks]);
const validNotes = seq => seq.patterns.every(p => p.notes.every(n => n.track === p.channel && n.key >= 0 && n.key <= 127 &&
    n.tick >= 0 && n.dur >= 1 && n.tick + n.dur <= p.lengthTicks));

test('new tracks are repeatable, arranged in sections, in key and export real notes on four lanes', () => {
    const config = { style: 'retro', mood: 'dramatic', palette: 'piano', bars: 32, tonic: 9, bpm: 140, seed: 29 };
    const song = generateTrack(config);
    assert.deepEqual(snapshot(song), snapshot(generateTrack(config)));
    assert.equal(song.tempo, 140);
    assert.deepEqual(song.channels.map(c => c.program), [0, 48, 32, 0]);
    assert.equal(Math.max(...layout(song).map(([t, , l]) => t + l)), 32 * song.ticksPerBar);
    assert.ok(song.patterns.some(p => p.name.includes('Bridge')));
    assert.ok(new Set(song.arrangement.map(p => p.patternId)).size < song.arrangement.length);
    assert.ok(validNotes(song));
    const minor = [0, 2, 3, 5, 7, 8, 10];
    assert.ok(song.patterns.filter(p => p.channel !== 9).every(p => p.notes.every(n => minor.includes((n.key - 9) % 12))));
    const lastLead = song.patterns.find(p => p.channel === 0 && p.name.endsWith('Ending'));
    assert.equal(lastLead.notes.at(-1).key % 12, 9);
    const parsed = BasicMIDI.fromArrayBuffer(writeArrangementMIDI(song));
    const sounding = new Set(parsed.tracks.flatMap(t => t.events).filter(e => (e.statusByte & 0xf0) === 0x90 && e.data[1]).map(e => e.statusByte & 15));
    assert.equal(sounding.size, 4);
});

test('a MIDI source can supply melody contours or rhythm for a fresh composition', () => {
    const source = sourceMIDI();
    const unmodified = source.toJSON(0);
    const dry = generateTrack({ seed: 3, bars: 8 });
    const withNotes = generateTrack({ source, sourceUse: 'notes', seed: 3, bars: 8 });
    const withRhythm = generateTrack({ source, sourceUse: 'rhythm', seed: 3, bars: 8 });
    assert.notDeepEqual(snapshot(dry), snapshot(withNotes));
    assert.deepEqual(withRhythm.patterns.find(p => p.channel === 0).notes.filter(n => n.tick < 1920).map(n => n.tick), [0, 360, 960, 1320]);
    assert.deepEqual(withRhythm.patterns.find(p => p.channel === 9).notes.filter(n => n.tick < 1920).map(n => n.key), [36, 42, 38, 42]);
    assert.equal(source.toJSON(0), unmodified);
});

test('a MIDI variation preserves pitches modulo octave, tempo, instruments, and clip layout', () => {
    const source = sourceMIDI(), unmodified = source.toJSON(0);
    const seq = generateTrack({ type: 'variation', source, sourceUse: 'notes', seed: 11 });
    assert.deepEqual(seq.channels, source.channels);
    assert.deepEqual(seq.tempoChanges, source.tempoChanges);
    assert.deepEqual(layout(seq), layout(source));
    assert.deepEqual(seq.patterns[2], source.patterns[2]);
    assert.notDeepEqual(snapshot(seq), snapshot(source));
    assert.deepEqual(seq.patterns.map(p => p.notes.map(n => n.key % 12)), source.patterns.map(p => p.notes.map(n => n.key % 12)));
    const rhythm = generateTrack({ type: 'variation', source, sourceUse: 'rhythm', seed: 11 });
    assert.ok(rhythm.patterns[0].notes.length > source.patterns[0].notes.length || rhythm.patterns[1].notes.length > source.patterns[1].notes.length);
    assert.ok(validNotes(rhythm));
    assert.equal(source.toJSON(0), unmodified);
});

test('recomposition preserves drums and source layout while substituting harmonized melodic material', () => {
    const source = sourceMIDI(), unmodified = source.toJSON(0);
    const seq = generateTrack({ type: 'recompose', source, tonic: 2, mood: 'dramatic', seed: 19 });
    assert.deepEqual(layout(seq), layout(source));
    assert.deepEqual(seq.channels, source.channels);
    assert.deepEqual(seq.tempoChanges, source.tempoChanges);
    assert.deepEqual(seq.patterns.filter(p => p.channel === 9), source.patterns.filter(p => p.channel === 9));
    assert.ok(seq.patterns.filter(p => p.channel !== 9).every(p => p.notes.every(n => [0, 2, 3, 5, 7, 8, 10].includes((n.key - 2) % 12))));
    assert.notDeepEqual(snapshot(seq), snapshot(source));
    assert.ok(validNotes(seq));
    assert.equal(source.toJSON(0), unmodified);
    assert.throws(() => generateTrack({ type: 'recompose', source: new Sequence() }), /contains notes/);
});
