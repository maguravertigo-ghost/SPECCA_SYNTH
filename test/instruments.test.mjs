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

test('instrument tooltip includes full name, patch numbers and original fallback assignment', async () => {
    const {instrumentTooltip} = await import('../js/editor/instruments.js');
    const text = instrumentTooltip({program:73,bankMSB:0,bankLSB:0,sourcePatch:{program:73,bankMSB:8,bankLSB:1},sourceTrack:2,sourcePort:0,source:3},'A long full preset name');
    assert.match(text,/A long full preset name/);assert.match(text,/Program 74 \(MIDI 73\)/);
    assert.match(text,/original:.*Bank 8:1/);assert.match(text,/MIDI track 2 · port 0 · channel 4/);
});
