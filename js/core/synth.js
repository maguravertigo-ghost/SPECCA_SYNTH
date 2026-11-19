// js/core/synth.js
import { WorkletSynthesizer, Sequencer } from '../../main.min.js';

let ctx = null;
let masterGain = null;
let volume = 1;
let analyser = null;
let sampleFrame = null;
const volumeControls = new Set();

export function setMasterVolume(value) {
    if (!Number.isFinite(value)) return;
    volume = Math.max(0, Math.min(1, value));
    if (masterGain) masterGain.gain.value = volume;
    for (const control of volumeControls) control.value = String(Math.round(volume * 100));
}

export function bindMasterVolume(control) {
    if (!control) return;
    volumeControls.add(control);
    control.value = String(Math.round(volume * 100));
    control.addEventListener('input', () => setMasterVolume(Number(control.value) / 100));
}

export function getOutputLevel() {
    if (!analyser || ctx.state !== 'running') return 0;
    analyser.getFloatTimeDomainData(sampleFrame);
    return sampleFrame.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
}

export const getMasterVolume = () => volume;

export function applyChannelVolume(info) {
    const midi = seq?.midiData;
    if (!synth || !midi || !info) return;
    const port = Math.floor(info.channel / 16), local = info.channel % 16;
    if (!midi.tracks.some(t => t.port === port && Array.from(t.channels ?? []).includes(local))) return;
    const offset = midi.portChannelOffsetMap[port] ?? 0;
    const vol = info.muted ? 0 : (info.volume ?? 100);
    synth.controllerChange(offset + local, 7, Math.round(vol * 127 / 100));
}

export function applyChannelMix(sequence) {
    for (const channel of sequence?.channels ?? []) applyChannelVolume(channel);
}
let synth = null;
let seq = null;
let previewSeq = null;
let readyPromise = null;

export const getAudioContext = () => ctx;
export const getSynth        = () => synth;
export const getPreviewSequencer = () => previewSeq;
export const getSequencer    = () => seq;
export const getSeq          = () => seq;
export const getSongDuration = () => seq?.duration ?? 0;

export async function resumeAudio() {
    if (!ctx) throw new Error('Audio output is not initialized');
    if (ctx.state === 'running') return;
    if (ctx.state === 'closed') throw new Error('Audio output is closed. Reload the page.');
    let timeout;
    try {
        await Promise.race([
            ctx.resume(),
            new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error('Audio is blocked. Click the page and retry Play.')), 2000);
            }),
        ]);
        if (ctx.state !== 'running') throw new Error(`Audio output is ${ctx.state}. Check your device and retry Play.`);
    } finally {
        clearTimeout(timeout);
    }
}

function ensureContext() {
    if (ctx) return ctx;
    const preferred = Number(localStorage.getItem('midi-player.sampleRate'));
    const sampleRate = [44100, 48000, 96000].includes(preferred) ? preferred : undefined;
    const options = { latencyHint: 'interactive', ...(sampleRate ? { sampleRate } : {}) };
    try {
        ctx = new AudioContext(options);
    } catch (e) {
        if (!sampleRate) throw e;
        console.warn(`[synth] Requested sample rate ${sampleRate} unavailable; using the device rate.`, e);
        ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    // Resume inside the browser's trusted gesture, before any asynchronous MIDI loading.
    const unlock = () => { if (ctx.state === 'suspended' || ctx.state === 'interrupted') ctx.resume().catch(() => {}); };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    return ctx;
}

export async function initSynth({ onProgress } = {}) {
    if (readyPromise) return readyPromise;

    ensureContext();

    const overlay       = document.getElementById('audioUnlock');
    const progressEl    = document.getElementById('audioUnlockProgress');
    const progressFill  = document.getElementById('audioUnlockProgressFill');
    const progressLabel = document.getElementById('audioUnlockProgressLabel');

    // Один клик. Если контекст уже running (жест был раньше) — пропускаем ожидание.
    if (overlay && ctx.state !== 'running') {
        overlay.classList.remove('hidden');
        await new Promise(resolve => {
            const done = () => {
                overlay.removeEventListener('click', done);
                window.removeEventListener('keydown', onKey);
                resolve();
            };
            const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') done(); };
            overlay.addEventListener('click', done);
            window.addEventListener('keydown', onKey);
        });
    }

    // Переключаем оверлей в режим прогресса (он остаётся видимым до 100%).
    if (overlay) {
        overlay.querySelector('.audio-unlock-icon').style.display   = 'none';
        overlay.querySelector('.audio-unlock-title').textContent    = 'Loading…';
        overlay.querySelector('.audio-unlock-sub').style.display    = 'none';
        progressEl?.classList.remove('hidden');
    }

    const report = (p) => {
        const pct = Math.round(p * 100);
        if (progressFill)  progressFill.style.width = pct + '%';
        if (progressLabel) progressLabel.textContent = `Loading… ${pct}%`;
        onProgress?.(p);
    };
    report(0);

    readyPromise = (async () => {
        await resumeAudio();
        report(0.05);

        await ctx.audioWorklet.addModule(
            new URL('../../spessasynth_processor.min.js', import.meta.url)
        );
        report(0.15);

        synth = new WorkletSynthesizer(ctx, { eventsEnabled: true, convolverMode: false });
        await synth.isReady;
        report(0.20);

        const sfResp = await fetch(new URL('../../soundfont.sf2', import.meta.url));
        if (!sfResp.ok) throw new Error(`SoundFont HTTP ${sfResp.status}`);
        const sfBuffer = await sfResp.arrayBuffer();
        report(0.40);

        await synth.soundBankManager.addSoundBank(sfBuffer, 'main-sf2', 0);
        report(0.95);

        masterGain = ctx.createGain();
        masterGain.gain.value = volume;
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        sampleFrame = new Float32Array(analyser.fftSize);
        synth.connect(masterGain);
        masterGain.connect(analyser);
        analyser.connect(ctx.destination);
        seq = new Sequencer(synth, { skipToFirstNoteOn: false });
        previewSeq = new Sequencer(synth, { skipToFirstNoteOn: false });
        report(1);

        if (overlay) {
            overlay.classList.add('hidden');
            setTimeout(() => overlay.remove(), 300);
        }
        return { ctx, synth, seq };
    })();

    readyPromise.catch(() => { readyPromise = null; }); // разрешаем retry
    return readyPromise;
}

let loadId = 0;
// Both transports share one synth. Loading a file changes that synth's bank and
// channel state, so even loads targeting different sequencers must not overlap.
let lastLoad = Promise.resolve();
export async function loadSong(buffer, name = '', target = seq, isCurrent = () => true) {
    if (!target) throw new Error('Synth not initialized');
    const operation = lastLoad.catch(() => {}).then(async () => {
        if (!isCurrent()) return false;
        await loadSongInternal(target, buffer, name);
        return isCurrent();
    });
    lastLoad = operation;
    return operation;
}

async function loadSongInternal(seq, buffer, name) {
    // A load never inherits a running transport from the previous file.
    seq.pause();

    await new Promise((resolve, reject) => {
        const id = 'load_' + ++loadId;
        const cleanup = () => {
            clearTimeout(timer);
            try { seq.eventHandler.removeEvent('songChange', id); } catch {}
            try { seq.eventHandler.removeEvent('midiError',  id); } catch {}
        };
        const timer = setTimeout(() => { cleanup(); reject(new Error(`Timeout loading "${name}" (30s)`)); }, 30000);
        const onSongChange = () => { cleanup(); resolve(); };
        const onError = (err) => { cleanup(); reject(new Error(`MIDI load error: ${err?.message || err}`)); };

        try {
            seq.eventHandler.addEvent('songChange', id, onSongChange);
            seq.eventHandler.addEvent('midiError',  id, onError);
        } catch (e) { cleanup(); reject(e); return; }

        try {
            seq.loadNewSongList([{ binary: buffer, fileName: name }]);
        } catch (e) { cleanup(); reject(e); }
    });
}

export async function play() {
    if (!ctx || !seq) throw new Error('Synth not initialized');
    await resumeAudio();
    seq.play();
}
export function pause() { seq?.pause(); }
export function stop() {
    if (!seq) return;
    seq.pause();
    try { seq.currentTime = 0; } catch {}
}