import test from 'node:test';
import assert from 'node:assert/strict';
import {formatPlayheadTime,parsePlayheadTime,snapPlayheadTick} from '../js/editor/playhead.js';
import {Sequence} from '../js/editor/sequence.js';

test('playhead HH:MM:SS timecode supports exact milliseconds and rejects malformed input', () => {
    for (const seconds of [0, 1, 59.999, 60, 3600, 3661.125, 360000]) {
        assert.equal(parsePlayheadTime(formatPlayheadTime(seconds)), seconds);
    }
    assert.equal(formatPlayheadTime(0), '00:00:00');
    assert.equal(formatPlayheadTime(59.9996), '00:01:00');
    assert.equal(parsePlayheadTime(' 00:01:02,5 '), 62.5);
    for (const invalid of ['', '00:60:00', '00:00:60', '-1:00:00', '01:02', '00:00:01.1234', 'abc']) assert.equal(parsePlayheadTime(invalid), null);
});

test('bar snap uses musical bar starts, free mode preserves exact ticks and tempo conversion', () => {
    for (const ticksPerBar of [1920, 1440, 3840]) {
        assert.equal(snapPlayheadTick(ticksPerBar * 1.3, ticksPerBar, true), ticksPerBar);
        assert.equal(snapPlayheadTick(ticksPerBar * 1.7, ticksPerBar, true), ticksPerBar * 2);
        assert.equal(snapPlayheadTick(ticksPerBar * 1.3, ticksPerBar, false), ticksPerBar * 1.3);
        assert.equal(snapPlayheadTick(-2, ticksPerBar, true), 0);
    }
    const song = new Sequence({tempo:120,timeDivision:480,tempoChanges:[{tick:1920,tempo:60}]});
    const seconds = parsePlayheadTime('00:00:03.125');
    assert.ok(Math.abs(song.ticksToSeconds(song.secondsToTicks(seconds)) - seconds) < 1e-8);
});
