import { EFFECTS, effectMessages, effectSend } from '../editor/audioEffects.js';
// js/core/synth.js
import { WorkletSynthesizer, Sequencer } from '../../main.min.js';
import { createSoundFontSource } from './soundFontSource.js';

let ctx = null;
let masterGain = null;
let volume = 1;
let analyser = null;
let sampleFrame = null;
const volumeControls = new Map();

export function setMasterVolume(value) {
    if (!Number.isFinite(value)) return;
    volume = Math.max(0, Math.min(1, value));
    if (masterGain) masterGain.gain.value = volume;
    for (const [control, output] of volumeControls) {
        control.value = String(Math.round(volume * 100));
        if (output) output.value = `${control.value}%`;
    }
}

export function bindMasterVolume(control, output = null) {
    if (!control) return;
    volumeControls.set(control, output);
    control.value = String(Math.round(volume * 100));
    if (output) output.value = `${control.value}%`;
    control.addEventListener('input', () => setMasterVolume(Number(control.value) / 100));
}

export function getOutputLevel() {
    if (!analyser || ctx.state !== 'running') return 0;
    analyser.getFloatTimeDomainData(sampleFrame);
    return sampleFrame.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
}

export const getMasterVolume = () => volume;

const mixedChannels = new Set();

export function getMidiMixChannels(target) {
    const midi = target?.midiData;
    if (!midi) return [];
    const channels = new Map();
    for (const track of midi.tracks) for (const channel of track.channels ?? []) {
        const port = track.port ?? 0;
        const lane = port * 16 + channel;
        const index = (midi.portChannelOffsetMap[port] ?? 0) + channel;
        channels.set(lane, { lane, index, channel, name: `Port ${port + 1} · Ch ${channel + 1}`, volume: 100 });
    }
    return [...channels.values()].sort((a, b) => a.lane - b.lane);
}

export function applyLiveMix(index, info) {
    const channel = synth?.midiChannels[index];
    if (!channel) return;
    mixedChannels.add(index);
    channel.setSystemParameter('gain', (info.volume ?? 100) / 100);
    channel.setSystemParameter('isMuted', !!info.muted);
    if (Number.isInteger(info.pan)) channel.setSystemParameter('pan', Math.max(-1, Math.min(1, (info.pan - 64) / (info.pan > 64 ? 63 : 64))));
}

function resetLiveMix() {
    for (const index of mixedChannels) {
        const channel = synth?.midiChannels[index];
        channel?.setSystemParameter('gain', 1);
        channel?.setSystemParameter('isMuted', false);
        channel?.setSystemParameter('pan', 0);
    }
    mixedChannels.clear();
}

export function applyChannelVolume(info) {
    const slot = getMidiMixChannels(seq).find(channel => channel.lane === info.channel);
    if (slot) applyLiveMix(slot.index, info);
}

export function applyProjectEffects(sequence) {
    if (!synth || !sequence?.effects) return;
    for (const message of effectMessages(sequence.effects)) synth.systemExclusive(message);
    for (const {lane,index} of getMidiMixChannels(seq)) {
        const info=sequence.channels.find(c=>c.channel===lane);
        if(info) for(const [id,spec] of Object.entries(EFFECTS)) synth.controllerChange(index,spec.cc,effectSend(info,id));
    }
}

export function applyChannelMix(sequence) {
    applyProjectEffects(sequence);
    const channels = new Map(sequence.channels.map(c => [c.channel, c]));
    for (const { lane, index } of getMidiMixChannels(seq)) {
        if (channels.has(lane)) applyLiveMix(index, channels.get(lane));
    }
}
let synth = null;
let seq = null;
let previewSeq = null;
let readyPromise = null;
let audioStatus = { state: 'idle', message: 'Audio off · press Play' };
const statusListeners = new Set();
export const bundledFontURL = new URL('../../soundfont.sf2', import.meta.url);
const soundFont = createSoundFontSource(bundledFontURL);
let onFontInstalled = null;
let replacingFont = false;
let installingFont = false;

export function selectLocalSoundFont(file, onInstalled = null) {
    if (synth || installingFont) return false;
    soundFont.select(file);
    onFontInstalled = onInstalled;
    if (!readyPromise) reportAudio('idle', file ? `SoundFont selected · ${file.name} · press Play` : 'Bundled SoundFont selected · press Play');
    return true;
}

export function onAudioStatus(listener) {
    statusListeners.add(listener);
    listener(audioStatus);
    return () => statusListeners.delete(listener);
}

function reportAudio(state, message, progress = false) {
    audioStatus = { state, message, progress, canSelectFont: !installingFont && !replacingFont };
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
        if (replacingFont) throw new Error('SoundFont is being switched.');
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

            const sfBuffer = await Promise.race([
                soundFont.read({ signal: download.signal, onStatus: (label, progress) => reportAudio('loading', label, progress) }),
                workletFailure,
            ]);
            validateSoundFont(sfBuffer);
            const remember = onFontInstalled;
            const copy = remember ? new Blob([sfBuffer]) : null;
            installingFont = true;
            try {
                await audioStep('Installing SoundFont', 20000, () => candidate.soundBankManager.addSoundBank(sfBuffer, 'main-sf2', 0), workletFailure);
            } finally {
                installingFont = false;
            }

            seq = new Sequencer(candidate, { skipToFirstNoteOn: false });
            previewSeq = new Sequencer(candidate, { skipToFirstNoteOn: false });
            synth = candidate;
            reportAudio('ready', `Audio ready · ${context.sampleRate / 1000} kHz`);
            onFontInstalled = null;
            if (remember) await remember(copy);
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

function validateSoundFont(bytes) {
    const header = new TextDecoder().decode(bytes.slice(0, 12));
    if (!header.startsWith('RIFF') || header.slice(8) !== 'sfbk') {
        throw new Error('Choose a valid SF2 or SF3 SoundFont.');
    }
}

export async function changeSoundFont(file, onInstalled = null) {
    if (!synth) {
        if (!selectLocalSoundFont(file, onInstalled)) throw new Error('Wait for the current SoundFont install.');
        return initSynth();
    }
    if (replacingFont) throw new Error('Wait for the current SoundFont switch.');
    replacingFont = true;
    const source = createSoundFontSource(bundledFontURL);
    source.select(file);
    try {
        reportAudio('loading', 'Switching SoundFont');
        await lastLoad.catch(() => {});
        const bytes = await source.read({ signal: new AbortController().signal, onStatus: (label, progress) => reportAudio('loading', label, progress) });
        validateSoundFont(bytes);
        const copy = onInstalled ? new Blob([bytes]) : null;
        seq.pause(); previewSeq.pause(); synth.stopAll(true);
        await audioStep('Installing SoundFont', 20000, () => synth.soundBankManager.addSoundBank(bytes, 'main-sf2', 0));
        if (onInstalled) await onInstalled(copy);
    } finally {
        replacingFont = false;
        reportAudio('ready', `Audio ready · ${ctx.sampleRate / 1000} kHz`);
    }
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
    resetLiveMix();
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