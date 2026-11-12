import { log, setStatus, wireGlobalErrorHandlers } from './core/log.js';
import { initSynth, loadSong } from './core/synth.js';
import { Playlist } from './playlist.js';
import { Transport } from './ui/transport.js';
import { PlaylistView } from './ui/playlistView.js';
import { mountEditor } from './editor/index.js';

wireGlobalErrorHandlers();
const $ = id => document.getElementById(id);

(async function boot() {
    log('=== Boot (modular) ===');

    const playlist = new Playlist();
    await playlist.load();

    const transport = new Transport({
        playBtn: $('playBtn'), pauseBtn: $('pauseBtn'), stopBtn: $('stopBtn'),
        timeEl: $('timeNow'), totalEl: $('timeTotal'),
        progressEl: $('progressBar'), progressFill: $('progressFill'),
    });

    const view = new PlaylistView(
        {
            listEl: $('playlistItems'),
            addBtn: $('addFilesBtn'),
            fileInput: $('fileInput'),
            clearBtn: $('clearUserTracksBtn'),
        },
        playlist,
        {
            onSelect: async item => {
                try {
                    setStatus(`Loading "${item.name}"...`);
                    const buf = await playlist.getBuffer(item);
                    await loadSong(buf, item.name);
                    view.setActive(item.id);
                    transport.reset();
                    setStatus(`Ready: ${item.name}`);
                } catch (e) {
                    log(`Load failed: ${e.message}`, 'error');
                    setStatus('Load failed');
                }
            },
        },
    );


    const initBar  = $('initBar');
    const initFill = $('initFill');
    if (initBar) initBar.style.display = 'block';

    try {
        await initSynth({
            onProgress: p => { if (initFill) initFill.style.width = (p * 100).toFixed(0) + '%'; },
        });
        if (initBar) initBar.style.display = 'none';
		
		mountEditor($('editorRoot'));
		
        if (playlist.items.length > 0) {
            const first = playlist.items[0];
            const buf = await playlist.getBuffer(first);
            await loadSong(buf, first.name);
            view.setActive(first.id);
            transport.reset();
        }
        setStatus('Ready');
    } catch (e) {
        log('INIT FAILED: ' + e.message, 'error');
        setStatus('Init failed');
        return;
    }

    $('copyBtn')?.addEventListener('click', async () => {
        const text = document.getElementById('logBox').textContent;
        try { await navigator.clipboard.writeText(text); alert('Log copied'); }
        catch { alert('Copy failed'); }
    });
    $('toggleLogBtn')?.addEventListener('click', () => {
        $('logPanel')?.classList.toggle('collapsed');
    });
	const rateSelect = document.getElementById('sampleRateSelect');
	if (rateSelect) {
		const current = localStorage.getItem('midi-player.sampleRate') || '44100';
		rateSelect.value = current;
		rateSelect.addEventListener('change', () => {
			localStorage.setItem('midi-player.sampleRate', rateSelect.value);
			location.reload();
		});
	}
})();