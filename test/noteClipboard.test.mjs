import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyNotes, planPaste } from '../js/editor/noteClipboard.js';

const a = { id: 'a', track: 6, key: 60, tick: 240, dur: 120, vel: 90 };
const b = { id: 'b', track: 6, key: 64, tick: 360, dur: 120, vel: 100 };
const clip = copyNotes([a, b], 480);
const dest = { step: 120, timeDivision: 480, length: 1920, selection: [], notes: [] };

test('paste in the same pattern uses a non-overlapping position and retains relative note timing', () => {
    const placement = planPaste(clip, { ...dest, selection: [a, b], notes: [a, b] });
    assert.equal(placement.start, 480);
    assert.deepEqual(placement.notes, [{ key: 60, tick: 0, dur: 120, vel: 90 }, { key: 64, tick: 120, dur: 120, vel: 100 }]);
});

test('paste respects the ruler cursor and rescales phrase timing between projects', () => {
    const placement = planPaste(clip, { ...dest, cursor: 60, step: 60, timeDivision: 240 });
    assert.equal(placement.start, 60);
    assert.deepEqual(placement.notes.map(n => [n.tick, n.dur]), [[0, 60], [60, 60]]);
    assert.equal(planPaste(clip, { ...dest, cursor: 1800 }), null);
});
