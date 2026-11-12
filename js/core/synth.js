// js/core/synth.js
import { WorkletSynthesizer, Sequencer } from '../../main.min.js';

let ctx = null;
let synth = null;
let seq = null;
let readyPromise = null;

export const getAudioContext = () => ctx;
export const getSynth        = () => synth;
export const getSequencer    = () => seq;
export const getSeq          = () => seq;                       // ← алиас для Transport
export const getSongDuration = () => seq?.duration ?? 0;        // ← добавили

export async function resumeAudio() {                           // ← добавили
    if (!ctx) return;
    if (ctx.state !== 'running') {
        try { await ctx.resume(); }
        catch (e) { console.warn('[synth] AudioContext resume failed:', e); }
    }
}

export async function initSynth({ onProgress } = {}) {
	// Читаем сохранённый sample rate (по умолчанию 44100)
	const savedRate = parseInt(localStorage.getItem('midi-player.sampleRate') || '44100', 10);
	const sampleRate = [44100, 48000, 96000].includes(savedRate) ? savedRate : 44100;

	// Пробуем создать контекст с выбранной частотой; если не поддерживается — фолбэк
	let ctxOptions = { latencyHint: 'interactive' };
	try {
		ctxOptions.sampleRate = sampleRate;
		ctx = new AudioContext(ctxOptions);
	} catch (e) {
		console.warn(`[synth] sampleRate ${sampleRate} не поддерживается, используется дефолт`, e);
		delete ctxOptions.sampleRate;
		ctx = new AudioContext(ctxOptions);
	}
    if (readyPromise) return readyPromise;

    readyPromise = (async () => {
        // 1. Показать оверлей и ждать клика
        const overlay = document.getElementById('audioUnlock');
        if (overlay) {
            overlay.classList.remove('hidden');
            await new Promise(resolve => {
                const onClick = () => {
                    overlay.removeEventListener('click', onClick);
                    window.removeEventListener('keydown', onKey);
                    resolve();
                };
                const onKey = (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        overlay.removeEventListener('click', onClick);
                        window.removeEventListener('keydown', onKey);
                        resolve();
                    }
                };
                overlay.addEventListener('click', onClick);
                window.addEventListener('keydown', onKey);
            });
        }

        // 2. Контекст создаём уже после жеста — он стартует running
        ctx = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' });
		['pointerdown', 'keydown'].forEach(evt =>
			window.addEventListener(evt, () => {
				if (ctx.state !== 'running') ctx.resume();
			}, { capture: true })
		);
        if (ctx.state !== 'running') await ctx.resume();

        await ctx.audioWorklet.addModule(
            new URL('../../spessasynth_processor.min.js', import.meta.url)
        );

        synth = new WorkletSynthesizer(ctx, {
            eventsEnabled: true,
            convolverMode: false,
        });

        await synth.isReady;
        onProgress?.(0.1);

        const sfResp = await fetch(new URL('../../soundfont.sf2', import.meta.url));
        if (!sfResp.ok) throw new Error(`SoundFont HTTP ${sfResp.status}`);
        const sfBuffer = await sfResp.arrayBuffer();
        onProgress?.(0.2);

        await synth.soundBankManager.addSoundBank(sfBuffer, 'main-sf2', 0);
        onProgress?.(1);

        synth.connect(ctx.destination);
        seq = new Sequencer(synth, { skipToFirstNoteOn: true });

        // 3. Убрать оверлей
        if (overlay) {
            overlay.classList.add('hidden');
            setTimeout(() => overlay.remove(), 300);
        }

        return { ctx, synth, seq };
    })();

    return readyPromise;
}

export async function loadSong(buffer, name = '') {
    if (!seq) throw new Error('Synth not initialized');

    await new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            seq.eventHandler.removeEvent('songChange', onSongChange);
            seq.eventHandler.removeEvent('midiError',  onError);
        };
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Timeout loading "${name}" (30s)`));
        }, 30000);
        const onSongChange = () => { cleanup(); resolve(); };
        const onError      = (err) => {
            cleanup();
            reject(new Error(`MIDI load error: ${err?.message || String(err) || 'unknown'}`));
        };

        seq.eventHandler.addEvent('songChange', onSongChange, onSongChange);
        seq.eventHandler.addEvent('midiError',  onError,      onError);

        try {
            seq.loadNewSongList([{ binary: buffer, fileName: name }]);
        } catch (e) {
            cleanup();
            reject(e);
        }
    });

    // Синхронизируем main-thread view, чтобы currentTime не «рос» от старого absoluteStartTime.
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
    seq.currentTime = 0;
}