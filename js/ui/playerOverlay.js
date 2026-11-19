import { getPreviewSequencer, getSynth, getMidiMixChannels, applyLiveMix, loadSong, initSynth, bindMasterVolume } from '../core/synth.js';
import { importMidi } from '../editor/importMidi.js';
import { adaptToSoundfont } from '../editor/instruments.js';
import { writeArrangementMIDI } from '../editor/exportMidi.js';
import { log } from '../core/log.js';
import { openMixer } from './mixer.js';
import { mountPlaylistView } from './playlistView.js';

const formatTime = (time) => {
    const seconds = Math.max(0, Math.floor(time || 0));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export function mountPlayerOverlay({ playlist, onOpen, onClose } = {}) {
    const overlay = document.getElementById('playerOverlay');
    if (!overlay) return null;
    const $ = (selector) => overlay.querySelector(selector);
    const closeBtn = $('#playerCloseBtn');
    const input = $('#fileInput');
    const playBtn = $('#ptPlay');
    const pauseBtn = $('#ptPause');
    const stopBtn = $('#ptStop');
    const seek = $('#ptProgress');
    const previous = $('#ptPrevious');
    const next = $('#ptNext');
    const title = $('#ptTrackName');
    const status = $('#ptStatus');
    const mixerBtn = $('#ptMixer');
    let mixChannels = [];
    let mixer;
    const compatible = $('#ptCompatible');
    bindMasterVolume($('#ptVolume'));
    let active = null, loaded = null, pending = false, request = 0, frame = 0, restoreFocus;
    let scrubPointer = null, seekUntil = 0;
    const visible = () => !overlay.classList.contains('hidden');

    const refresh = () => {
        const seq = getPreviewSequencer();
        const index = playlist.items.findIndex(i => i.id === active?.id);
        const ready = !!seq && loaded?.id === active?.id && !!loaded && !pending;
        const playing = ready && !seq.paused && !seq.isFinished;
        playBtn.disabled = pending || !playlist.items.length || playing;
        mixerBtn.disabled = !ready || !mixChannels.length;
        pauseBtn.disabled = !playing;
        stopBtn.disabled = !ready && !pending;
        previous.disabled = index <= 0;
        next.disabled = index >= playlist.items.length - 1;
        seek.disabled = !ready || !seq.duration;
        seek.max = ready ? seq.duration : 0;
        if (!ready) seek.value = 0;
        else if (scrubPointer === null && performance.now() >= seekUntil) {
            seek.value = Math.min(seq.duration, Math.max(0, seq.currentTime));
        }
        $('#ptTimeNow').textContent = formatTime(Number(seek.value));
        $('#ptTimeTotal').textContent = formatTime(ready ? seq.duration : 0);
    };

    const stop = (rewind = true) => {
        request++;
        pending = false;
        scrubPointer = null;
        seekUntil = 0;
        const seq = getPreviewSequencer();
        seq?.pause();
        if (seq && loaded && rewind) seq.currentTime = 0;
        if (rewind && active) status.textContent = 'Stopped';
        refresh();
    };

    async function select(item) {
        if (!item || !visible()) return;
        const id = ++request;
        scrubPointer = null;
        seekUntil = 0;
        getPreviewSequencer()?.pause();
        active = item;
        loaded = null;
        mixer?.close();
        mixChannels = [];
        playlist.activeId = item.id;
        listView.refresh();
        pending = true;
        title.textContent = item.name;
        status.textContent = 'Loading…';
        refresh();
        try {
            await initSynth();
            const current = () => visible() && request === id;
            if (!current()) return;
            const seq = getPreviewSequencer();
            let buffer = await playlist.getBuffer(item);
            if (!current()) return;
            if (compatible.checked) {
                const sequence = importMidi(buffer, item.name);
                if (!sequence.arrangement.length) throw new Error('No playable notes in this file');
                const count = adaptToSoundfont(sequence, getSynth()?.soundBankManager.presetList);
                if (count) log(`Player compatibility: ${count} sound(s) substituted.`);
                buffer = writeArrangementMIDI(sequence);
            }
            if (!await loadSong(buffer, item.name, seq, current)) return;
            if (!seq.duration) throw new Error('No playable MIDI duration. Try Compatible if the source contains notes.');
            loaded = item;
            mixChannels = getMidiMixChannels(seq);
            seq.loopCount = 0;
            seq.play();
            status.textContent = 'Playing';
        } catch (err) {
            if (request !== id) return;
            status.textContent = err.message || 'Cannot play this file';
            log(`Player: ${item.name}: ${err}`, 'error');
        } finally {
            if (request === id) { pending = false; refresh(); }
        }
    }

    const listView = mountPlaylistView($('#playlistItems'), {
        playlist,
        onSelect: select,
        onRemove: async (id) => {
            if (id === active?.id) { stop(); active = loaded = null; playlist.activeId = null; title.textContent = 'No track selected'; }
            await playlist.removeUserTrack(id);
        },
    });
    playlist.subscribe(() => { listView.refresh(); refresh(); });

    const step = (delta) => {
        const index = playlist.items.findIndex(i => i.id === active?.id);
        select(playlist.items[index + delta]);
    };
    const tick = () => {
        if (!visible()) return;
        const seq = getPreviewSequencer();
        if (loaded && !pending && status.textContent === 'Playing' && seq?.isFinished) {
            const index = playlist.items.findIndex(i => i.id === loaded.id);
            const following = playlist.items[index + 1];
            if (following) select(following);
            else status.textContent = 'Finished';
        }
        refresh();
        frame = requestAnimationFrame(tick);
    };
    const open = () => {
        if (visible()) return;
        restoreFocus = document.activeElement;
        onOpen?.();
        overlay.classList.remove('hidden');
        overlay.setAttribute('aria-hidden', 'false');
        closeBtn.focus();
        tick();
    };
    const close = () => {
        if (!visible()) return;
        stop();
        // Reload on the next play: the editor may have changed the shared synth's channel state.
        loaded = null;
        cancelAnimationFrame(frame);
        overlay.classList.add('hidden');
        overlay.setAttribute('aria-hidden', 'true');
        onClose?.();
        restoreFocus?.focus();
    };
    const toggle = () => visible() ? close() : open();

    playBtn.addEventListener('click', async () => {
        const seq = getPreviewSequencer();
        if (pending) return;
        if (!seq || !loaded) return select(active ?? playlist.items[0]);
        const id = request;
        try {
            await initSynth();
            if (!visible() || id !== request) return;
            if (seq.isFinished) seq.currentTime = 0;
            seq.play();
            status.textContent = 'Playing';
            refresh();
        } catch (err) { if (visible() && id === request) status.textContent = err.message; }
    });
    mixerBtn.addEventListener('click', () => {
        mixer = openMixer({ title: 'Player mixer', channels: mixChannels, onChange: channel => applyLiveMix(channel.index, channel) });
    });
    pauseBtn.addEventListener('click', () => { getPreviewSequencer()?.pause(); status.textContent = 'Paused'; refresh(); });
    stopBtn.addEventListener('click', () => stop());
    compatible.addEventListener('change', () => { if (active) select(active); });
    previous.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    const commitSeek = () => {
        if (!loaded || pending) return;
        const seq = getPreviewSequencer();
        seekUntil = performance.now() + 150;
        seq.currentTime = Math.min(seq.duration, Math.max(0, Number(seek.value)));
        refresh();
    };
    seek.addEventListener('pointerdown', (e) => {
        if (e.button === 0 && !seek.disabled) scrubPointer = e.pointerId;
    });
    // Keep the slider stable as the pointer moves. Send the worklet one seek
    // on release, not a controller reset/replay on every intermediate input.
    seek.addEventListener('input', () => {
        if (scrubPointer === null) commitSeek();
        else refresh();
    });
    window.addEventListener('pointerup', (e) => {
        if (e.pointerId !== scrubPointer) return;
        scrubPointer = null;
        commitSeek();
    });
    window.addEventListener('pointercancel', (e) => {
        if (e.pointerId === scrubPointer) { scrubPointer = null; refresh(); }
    });
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F5' && !document.querySelector('dialog[open]') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { e.preventDefault(); toggle(); }
        if (e.key === 'Escape' && visible() && !mixer?.open) close();
    });
    $('#addFilesBtn').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
        try { await playlist.addFiles([...input.files]); }
        catch (err) { log(`Player: add files failed: ${err}`, 'error'); }
        finally { input.value = ''; }
    });
    const clear = () => {
        if (active?.source === 'user') { stop(); active = loaded = null; playlist.activeId = null; title.textContent = 'No track selected'; }
        playlist.clearUserTracks();
    };
    $('#clearUserTracksBtn').addEventListener('click', clear);
    return { open, close, toggle, clear };
}
