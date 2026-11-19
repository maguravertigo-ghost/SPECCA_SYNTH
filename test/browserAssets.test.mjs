import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const asset = name => new URL(`../${name}`, import.meta.url);

test('browser bundle initializes Vorbis without the synchronous WASM constructor', async () => {
    const original = globalThis.WebAssembly;
    let instantiations = 0;
    const syncConstructor = new Proxy(original.Instance, {
        construct() { throw new Error('WebAssembly.Instance is disallowed on the main thread'); },
    });
    globalThis.WebAssembly = new Proxy(original, {
        get(target, name) {
            if (name === 'Instance') return syncConstructor;
            if (name === 'instantiate') return async (...args) => {
                const instance = await target.instantiate(...args);
                instantiations++;
                return instance;
            };
            return Reflect.get(target, name);
        },
    });
    try {
        // Count successful asynchronous instantiations, not just calls to the API.
        const bundle = await import(asset('main.min.js'));
        assert.equal(typeof bundle.WorkletSynthesizer, 'function');
        for (let i = 0; i < 100 && instantiations === 0; i++) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(instantiations, 1);
    } finally {
        globalThis.WebAssembly = original;
    }
});

test('published HTML and worklet do not reference missing Pages assets', async () => {
    const [html, worklet] = await Promise.all([
        readFile(asset('index.html'), 'utf8'), readFile(asset('spessasynth_processor.min.js'), 'utf8'),
    ]);
    assert.match(html, /<link rel="icon" href="\.\/favicon\.ico"/);
    assert.ok((await readFile(asset('favicon.ico'))).length > 0);
    assert.doesNotMatch(worklet, /sourceMappingURL=/);
});
