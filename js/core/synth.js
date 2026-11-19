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
let audioStatus = { state: 'idle', message: 'Audio off · press Play' };
const statusListeners = new Set();

export function onAudioStatus(listener) {
    statusListeners.add(listener);
    listener(audioStatus);
    return () => statusListeners.delete(listener);
}

function reportAudio(state, message) {
    audioStatus = { state, message };
    for (const listener of statusListeners) listener(audioStatus);
}

async function audioStep(label, milliseconds, start, workletFailure) {
    reportAudio('loading', label);
    let timer;
    try {
        return await Promise.race([
            start(),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`no response after ${milliseconds / 1000}s`)), milliseconds);
            }),
            ...(workletFailure ? [workletFailure] : []),
        ]);
    } catch (error) {
        throw new Error(`${label}: ${error?.message ?? error}`, { cause: error });
    } finally {
        clearTimeout(timer);
    }
}

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
    return ctx;
}

// Called directly from Play or Enable audio, before any asynchronous MIDI I/O.
export async function initSynth() {
    if (synth) {
        await resumeAudio();
        return;
    }
    if (readyPromise) {
        // A second user gesture can unlock a resume still waiting for permission.
        if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
        return readyPromise;
    }

    const init = async () => {
        let context, candidate, node, onProcessorError;
        const download = new AbortController();
        try {
            context = ensureContext();
            await audioStep('Unlocking audio', 3000, resumeAudio);
            if (!context.audioWorklet) throw new Error('AudioWorklet unavailable. Open the site in a secure browser tab (HTTPS or localhost).');

            await audioStep('Loading AudioWorklet', 12000, () => context.audioWorklet.addModule(
                new URL('../../spessasynth_processor.min.js', import.meta.url),
            ));
            const workletFailure = new Promise((_, reject) => {
                onProcessorError = () => reject(new Error('AudioWorklet processor failed'));
            });
            await audioStep('Starting synth (Vorbis decoder)', 10000, () => {
                candidate = new WorkletSynthesizer(context, {
                    eventsEnabled: true, convolverMode: false,
                    audioNodeCreators: { worklet: (context, name, options) => {
                        node = new AudioWorkletNode(context, name, options);
                        node.addEventListener('processorerror', onProcessorError);
                        return node;
                    } },
                });
                // Keep the node in the active output graph while it starts up.
                masterGain = context.createGain();
                masterGain.gain.value = volume;
                analyser = context.createAnalyser();
                analyser.fftSize = 2048;
                sampleFrame = new Float32Array(analyser.fftSize);
                candidate.connect(masterGain);
                masterGain.connect(analyser);
                analyser.connect(context.destination);
                return candidate.isReady;
            }, workletFailure);

            const sfBuffer = await audioStep('Downloading SoundFont', 60000, async () => {
                const response = await fetch(new URL('../../soundfont.sf2', import.meta.url), { signal: download.signal });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.arrayBuffer();
            }, workletFailure);
            await audioStep('Installing SoundFont', 20000, () => candidate.soundBankManager.addSoundBank(sfBuffer, 'main-sf2', 0), workletFailure);

            seq = new Sequencer(candidate, { skipToFirstNoteOn: false });
            previewSeq = new Sequencer(candidate, { skipToFirstNoteOn: false });
            synth = candidate;
            reportAudio('ready', `Audio ready · ${context.sampleRate / 1000} kHz`);
        } catch (error) {
            try { candidate?.destroy(); } catch {}
            if (context && context.state !== 'closed') context.close().catch(() => {});
            ctx = synth = seq = previewSeq = masterGain = analyser = sampleFrame = null;
            reportAudio('error', error?.message ?? String(error));
            throw error;
        } finally {
            download.abort();
            node?.removeEventListener('processorerror', onProcessorError);
        }
    };

    readyPromise = init().finally(() => { readyPromise = null; });
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