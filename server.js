// Local SPECCA_SYNTH server. No browser profile, port file or log file is created.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream');

const ROOT = __dirname;
const ASSETS = new Set(['index.html', 'favicon.ico', 'demo.mid', 'soundfont.sf2',
    'main.min.js', 'spessasynth_processor.min.js']);
const MIME = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.mid': 'audio/midi', '.ico': 'image/x-icon',
};

function serve(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
    }
    let relative;
    try { relative = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html'; }
    catch { res.writeHead(400).end(); return; }
    const appModule = /^(?:js\/(?:[\w-]+\/)*[\w-]+\.js|css\/[\w-]+\.css)$/.test(relative);
    if (!appModule && !ASSETS.has(relative)) { res.writeHead(404).end(); return; }
    const file = path.join(ROOT, relative);
    fs.stat(file, (error, stat) => {
        if (error || !stat.isFile()) { res.writeHead(404).end(); return; }
        let start = 0, end = stat.size - 1;
        let code = 200;
        const headers = {
            'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
            'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes',
        };
        if (req.headers.range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
            if (match && (match[1] || match[2])) {
                if (match[1]) {
                    start = Number(match[1]);
                    if (match[2]) end = Math.min(end, Number(match[2]));
                } else start = Math.max(0, stat.size - Number(match[2]));
            }
            if (!match || !(match[1] || match[2]) || start > end) {
                res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
                return;
            }
            code = 206;
            headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
        }
        headers['Content-Length'] = end - start + 1;
        res.writeHead(code, headers);
        if (req.method === 'HEAD' || !stat.size) { res.end(); return; }
        pipeline(fs.createReadStream(file, { start, end }), res, () => {});
    });
}

async function startServer({ port = 8787, host = '127.0.0.1' } = {}) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535');
    const server = http.createServer(serve);
    const last = Math.min(port + 20, 65535);
    for (let candidate = port; candidate <= last; candidate++) {
        try {
            return await new Promise((resolve, reject) => {
                const onError = (error) => { server.off('listening', onReady); reject(error); };
                const onReady = () => { server.off('error', onError); resolve(server); };
                server.once('error', onError);
                server.once('listening', onReady);
                server.listen(candidate, host);
            });
        } catch (error) {
            if (error.code !== 'EADDRINUSE' || candidate === last) throw error;
        }
    }
}

function openBrowser(url) {
    // URL contains only the fixed loopback host and the numeric port chosen by Node.
    const [command, ...args] = process.platform === 'win32'
        ? ['cmd.exe', '/d', '/c', 'start', '""', url]
        : [process.platform === 'darwin' ? 'open' : 'xdg-open', url];
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: process.platform === 'win32' });
    const manual = () => console.warn(`[server] Open this address in your browser: ${url}`);
    child.once('error', manual);
    child.once('exit', (code) => { if (code !== 0) manual(); });
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const open = args.includes('--open');
    const host = open ? '127.0.0.1' : process.env.HOST || '127.0.0.1';
    const requestedPort = Number(args.find(arg => arg !== '--open') ?? process.env.PORT ?? 8787);
    startServer({ port: requestedPort, host }).then(server => {
        // Keep localhost for the desktop launcher: browser projects are tied to this origin.
        const url = `http://${host === '127.0.0.1' ? 'localhost' : host}:${server.address().port}/`;
        console.log(`[server] ${url} (Ctrl+C to stop)`);
        if (open) openBrowser(url);
    }).catch(error => { console.error(`[server] ${error.message}`); process.exitCode = 1; });
}

module.exports = { startServer };
