// js/core/synth.js
import { WorkletSynthesizer, Sequencer } from '../../main.min.js';

let ctx = null;
let masterGain = null;

export function setMasterVolume(v) {
    if (!masterGain) return;
    const g = Math.max(0, Math.min(2, Number(v) || 0));
    masterGain.gain.value = g;
}

export function applyChannelMix(seq) {
    if (!synth || !seq?.channels) return;
    for (const ch of seq.channels) {
        const vol = ch.muted ? 0 : (ch.volume ?? 100);
        try { synth.controllerChange(ch.channel, 7, Math.round(vol * 127 / 100)); } catch {}
    }
}
let synth = null;
let seq = null;
let readyPromise = null;

export const getAudioContext = () => ctx;
export const getSynth        = () => synth;
export const getSequencer    = () => seq;
export const getSeq          = () => seq;
export const getSongDuration = () => seq?.duration ?? 0;

export async function resumeAudio() {
    if (!ctx) return;
    if (ctx.state !== 'running') {
        try { await ctx.resume(); }
        catch (e) { console.warn('[synth] AudioContext resume failed:', e); }
    }
}

// Создаём ОДИН AudioContext (suspended до жеста) и регистрируем авто-resume.
function ensureContext() {
    if (ctx) return ctx;
    const savedRate = parseInt(localStorage.getItem('midi-player.sampleRate') || '44100', 10);
    const sampleRate = [44100, 48000, 96000].includes(savedRate) ? savedRate : 44100;
    try {
        ctx = new AudioContext({ sampleRate, latencyHint: 'interactive' });
    } catch (e) {
        console.warn(`[synth] sampleRate ${sampleRate} unsupported, fallback`, e);
        ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    ['pointerdown', 'keydown'].forEach(evt =>
        window.addEventListener(evt, () => {
            if (ctx.state !== 'running') ctx.resume().catch(() => {});
        }, { capture: true })
    );
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

        if (typeof synth.disconnect === 'function') { try { synth.disconnect(); } catch {} }
        masterGain = ctx.createGain();
        synth.connect(masterGain);
        masterGain.connect(ctx.destination);
        seq = new Sequencer(synth, { skipToFirstNoteOn: true });
        report(1);

        if (overlay) {
            overlay.classList.add('hidden');
            setTimeout(() => overlay.remove(), 300);
        }
        return { ctx, synth, seq };
    })();

    readyPromise.catch(err => { readyPromise = null; throw err; }); // разрешаем retry
    return readyPromise;
}

export async function loadSong(buffer, name = '') {
    if (!seq) throw new Error('Synth not initialized');

    await new Promise((resolve, reject) => {
        const id = 'load_' + Date.now();           // ← строковый id, не функция
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

    try { seq.currentTime = 0; } catch {}
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