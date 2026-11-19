import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundFontSource } from '../js/core/soundFontSource.js';

const bundled = new URL('https://example.test/project/soundfont.sf2');
const signal = () => new AbortController().signal;
const local = () => new File([new Uint8Array([2, 3, 5, 7])], 'soundfont.sf2');
const abortable = signal => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});

test('streams the bundled asset, reporting bytes even without Content-Length', async () => {
    const bytes = new Uint8Array(1024 * 1024 + 1);
    bytes[bytes.length - 1] = 17;
    const source = createSoundFontSource(bundled, { fetchFile: async url => {
        assert.equal(url, bundled);
        return new Response(bytes);
    } });
    const status = [];
    const buffer = await source.read({ signal: signal(), onStatus: (label, progress) => status.push([label, progress]) });
    assert.deepEqual(new Uint8Array(buffer), bytes);
    assert.deepEqual(status, [['Loading bundled soundfont.sf2', { loaded: 0 }], ['SoundFont · 1.0 MiB', { loaded: bytes.length, total: 0 }]]);
});

test('a selected local file cancels the stalled request and is read without a second fetch', async () => {
    let requested;
    const source = createSoundFontSource(bundled, { fetchFile: (_, { signal }) => {
        requested = signal;
        return abortable(signal);
    } });
    const pending = source.read({ signal: signal() });
    assert.equal(requested.aborted, false);
    source.select(local());
    assert.equal(requested.aborted, true);
    assert.deepEqual([...new Uint8Array(await pending)], [2, 3, 5, 7]);
    const firstRequest = requested;
    assert.deepEqual([...new Uint8Array(await source.read({ signal: signal() }))], [2, 3, 5, 7]);
    assert.equal(requested, firstRequest);
});

test('a stalled bundled request expires with instructions to use a local file', async () => {
    const source = createSoundFontSource(bundled, { stallMs: 20, fetchFile: (_, { signal }) => abortable(signal) });
    await assert.rejects(source.read({ signal: signal() }), /no data for 0\.02s\. Choose a local SoundFont/);
});
