import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adaptToSoundfont } from '../js/editor/instruments.js';

test('missing soundbank variants keep their program when available and drums stay drums', () => {
    const seq = { channels: [
        { program: 33, isDrum: false, bankMSB: 100 },
        { program: 99, isDrum: true, bankMSB: 0 },
        { program: 0, isDrum: false, bankMSB: 0 },
    ] };
    const presets = [
        { name: 'Piano', program: 0, isDrum: false, bankMSB: 0 },
        { name: 'Bass', program: 33, isDrum: false, bankMSB: 0 },
        { name: 'Kit', program: 0, isDrum: true, isGMGSDrum: true, bankMSB: 0 },
    ];
    assert.equal(adaptToSoundfont(seq, presets), 2);
    assert.deepEqual(seq.channels.map(c => [c.program, c.isDrum, c.presetName]), [[33, false, 'Bass'], [0, true, 'Kit'], [0, false, undefined]]);
    assert.equal(seq.channels[0].sourcePatch.bankMSB, 100);
});
