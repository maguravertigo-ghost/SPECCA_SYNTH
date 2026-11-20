import assert from 'node:assert/strict';
import test from 'node:test';
import { planPitchRepair, suggestKey } from '../js/editor/noteRepair.js';
const note = (key, tick, dur = 100) => ({ key, tick, dur, vel: 82 });

test('FIX only proposes pitches within the limit, leaving existing notes and non-selected notes alone', () => {
    const notes = [note(60, 0), note(61, 0), note(61, 120), note(64, 240), note(63, 240)];
    const input = structuredClone(notes);
    const { changes } = planPitchRepair(notes, { targets: new Set([notes[1], notes[2]]), maxShift: 1 });
    assert.deepEqual([...changes], [[notes[1], 62], [notes[2], 60]]);
    assert.deepEqual(notes, input);
});

test('FIX skips clashes instead of deleting or merging notes', () => {
    const notes = [note(60, 0), note(61, 0), note(62, 0)];
    const preview = planPitchRepair(notes);
    assert.equal(preview.changes.size, 0);
    assert.equal(preview.skipped, 1);
});

test('FIX scales to a dense pattern and suggests a key from sustained pitches', () => {
    const notes = Array.from({ length: 3500 }, (_, i) => note([60, 64, 67, 61][i % 4], i * 120, i % 4 === 3 ? 15 : 100));
    assert.deepEqual(suggestKey(notes), { tonic: 0, mode: 'major' });
    assert.equal(planPitchRepair(notes).changes.size, 875);
});
