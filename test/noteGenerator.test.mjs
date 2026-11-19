import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePatternNotes, withoutNoteConflicts } from '../js/editor/noteGenerator.js';

const base = { lengthTicks: 1920, ticksPerBar: 1920, stepsPerBar: 16, random: () => 0 };
const inRange = (notes, length) => notes.every(n => Number.isInteger(n.tick) && Number.isInteger(n.dur) &&
    n.tick >= 0 && n.dur > 0 && n.tick + n.dur <= length && n.key >= 0 && n.key <= 127);

test('a one-bar chord pattern gives two in-key triads', () => {
    const notes = generatePatternNotes(base);
    assert.equal(notes.length, 6);
    assert.deepEqual(notes.filter(n => n.tick === 0).map(n => n.key), [60, 64, 67]);
    assert.notDeepEqual(notes.slice(0, 3).map(n => n.key), notes.slice(3).map(n => n.key));
    assert.ok(inRange(notes, base.lengthTicks));
});

test('minor arpeggios are in scale and do not cross a short pattern ending', () => {
    const config = { ...base, lengthTicks: 1945, tonic: 9, mode: 'minor', style: 'arpeggio' };
    const notes = generatePatternNotes(config);
    const minor = [0, 2, 3, 5, 7, 8, 10];
    assert.ok(notes.length > 5);
    assert.equal(new Set(notes.map(n => n.tick)).size, notes.length);
    assert.ok(notes.every(n => minor.includes((n.key - 9) % 12)));
    assert.ok(inRange(notes, config.lengthTicks));
    assert.equal(notes.at(-1).tick, 1920);
});

test('drum grooves use General MIDI percussion and respect 3/4 or tiny patterns', () => {
    const notes = generatePatternNotes({ ...base, isDrum: true, lengthTicks: 1440, ticksPerBar: 1440, stepsPerBar: 12, style: 'half-time' });
    assert.deepEqual([...new Set(notes.map(n => n.key))].sort(), [36, 38, 42]);
    assert.ok(notes.every(n => n.tick % 120 === 0));
    assert.ok(inRange(notes, 1440));
    assert.ok(inRange(generatePatternNotes({ ...base, lengthTicks: 1, style: 'syncopated' }), 1));
});

test('append preserves existing notes and skips only same-pitch overlaps', () => {
    const existing = [{ key: 60, tick: 100, dur: 10 }, { key: 60, tick: 115, dur: 10 }];
    const generated = [
        { key: 60, tick: 0, dur: 100 }, { key: 60, tick: 95, dur: 10 }, { key: 60, tick: 108, dur: 10 },
        { key: 61, tick: 95, dur: 10 }, { key: 60, tick: 125, dur: 8 },
    ];
    assert.deepEqual(withoutNoteConflicts(generated, existing), [generated[0], generated[3], generated[4]]);
    assert.equal(existing[0].dur, 10);
});
