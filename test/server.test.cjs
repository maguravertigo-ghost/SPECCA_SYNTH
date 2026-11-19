const assert = require('node:assert/strict');
const { test } = require('node:test');
const { startServer } = require('../server.js');

const close = (server) => new Promise(resolve => server.close(resolve));

test('server starts on a free port and serves only app assets', async () => {
    const first = await startServer({ port: 0 });
    let next;
    try {
        const busy = first.address().port;
        next = await startServer({ port: busy });
        assert.ok(next.address().port > busy);
        const url = `http://127.0.0.1:${next.address().port}`;
        assert.equal((await fetch(url)).status, 200);
        const module = await fetch(`${url}/js/core/synth.js`, { method: 'HEAD' });
        assert.match(module.headers.get('content-type'), /javascript/);
        const font = await fetch(`${url}/icons/MaterialIcons-Regular.woff2`, { method: 'HEAD' });
        assert.equal(font.status, 200);
        assert.equal(font.headers.get('content-type'), 'font/woff2');
        assert.equal((await fetch(`${url}/server.js`)).status, 404);
        assert.equal((await fetch(`${url}/.git/HEAD`)).status, 404);
        for (const range of ['bytes=0-3', 'bytes=-4']) {
            const res = await fetch(`${url}/demo.mid`, { headers: { Range: range } });
            assert.equal(res.status, 206);
            assert.equal((await res.arrayBuffer()).byteLength, 4);
        }
    } finally {
        await Promise.all([close(first), next && close(next)]);
    }
});
