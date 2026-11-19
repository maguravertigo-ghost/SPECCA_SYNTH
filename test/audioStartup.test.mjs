import assert from 'node:assert/strict';
import test from 'node:test';
import { getAudioContext, getSequencer, initSynth, onAudioStatus } from '../js/core/synth.js';

test('initialization is shared across transports and a failed worklet can be retried', async () => {
    const savedContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
    const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const attempts = [];
    const states = [];
    const unsubscribe = onAudioStatus(status => states.push(status));
    const installGlobal = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, value });
    const restoreGlobal = (key, descriptor) => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
    installGlobal('localStorage', { getItem: () => 'auto' });
    installGlobal('AudioContext', class {
        state = 'suspended';
        audioWorklet = { addModule: async () => { throw new Error('module load blocked'); } };
        constructor() { attempts.push(this); }
        async resume() { this.state = 'running'; }
        async close() { this.state = 'closed'; }
    });
    try {
        const first = initSynth();
        const second = initSynth();
        const results = await Promise.allSettled([first, second]);
        assert.equal(attempts.length, 1);
        assert.equal(attempts[0].state, 'closed');
        assert.deepEqual(results.map(result => result.reason?.message), [
            'Loading AudioWorklet: module load blocked', 'Loading AudioWorklet: module load blocked',
        ]);
        assert.deepEqual(states.map(({ state }) => state), ['idle', 'loading', 'loading', 'error']);
        assert.equal(getAudioContext(), null);
        assert.equal(getSequencer(), null);
        await assert.rejects(initSynth(), /Loading AudioWorklet: module load blocked/);
        assert.equal(attempts.length, 2);
    } finally {
        unsubscribe();
        restoreGlobal('AudioContext', savedContext);
        restoreGlobal('localStorage', savedStorage);
    }
});
