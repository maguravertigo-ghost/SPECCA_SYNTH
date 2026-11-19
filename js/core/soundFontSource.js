const MIB = 1024 * 1024;

export function createSoundFontSource(url, { stallMs = 60000, fetchFile = (...args) => fetch(...args) } = {}) {
    let localFile = null;
    let activeDownload = null;

    function select(file) {
        localFile = file;
        activeDownload?.abort();
    }

    async function read({ signal, onStatus = () => {} }) {
        if (!localFile) {
            const controller = new AbortController();
            activeDownload = controller;
            const cancel = () => controller.abort();
            signal.addEventListener('abort', cancel, { once: true });
            if (signal.aborted) cancel();
            let timer;
            let timedOut = false;
            const resetTimeout = () => {
                clearTimeout(timer);
                timer = setTimeout(() => { timedOut = true; cancel(); }, stallMs);
            };
            const label = 'Loading bundled soundfont.sf2';
            onStatus(label, { loaded: 0 });
            try {
                resetTimeout();
                const response = await fetchFile(url, { signal: controller.signal });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                resetTimeout();
                if (!response.body?.getReader) return await response.arrayBuffer();

                const total = Number(response.headers.get('Content-Length'));
                const reader = response.body.getReader();
                const chunks = [];
                let loaded = 0, lastReport = 0;
                try {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (!value.byteLength) continue;
                        chunks.push(value);
                        loaded += value.byteLength;
                        resetTimeout();
                        if (loaded - lastReport >= MIB) {
                            lastReport = loaded;
                            const size = `${(loaded / MIB).toFixed(1)} MiB`;
                            const volume = total >= loaded ? `${size} / ${(total / MIB).toFixed(1)} MiB` : size;
                            onStatus(`SoundFont · ${volume}`, { loaded, total });
                        }
                    }
                } finally {
                    reader.releaseLock();
                }
                if (!localFile) return await new Blob(chunks).arrayBuffer();
            } catch (error) {
                if (signal.aborted || !localFile) {
                    const reason = timedOut ? `no data for ${stallMs / 1000}s` : (error?.message ?? String(error));
                    throw new Error(`${label}: ${reason}. Choose a local SoundFont to retry.`, { cause: error });
                }
                // Selecting a local file intentionally cancels the bundled download.
            } finally {
                clearTimeout(timer);
                controller.abort();
                signal.removeEventListener('abort', cancel);
                if (activeDownload === controller) activeDownload = null;
            }
        }
        if (signal.aborted) throw new Error('SoundFont loading cancelled');
        const file = localFile;
        onStatus(`Reading local SoundFont: ${file.name}`);
        try {
            return await file.arrayBuffer();
        } catch (error) {
            if (file === localFile) localFile = null;
            throw new Error(`Cannot read local SoundFont: ${file.name}`, { cause: error });
        }
    }

    return { read, select };
}
