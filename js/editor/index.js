// js/editor/index.js
import { Sequence } from './sequence.js';
import { Playback } from './playback.js';
import { importMidi } from './importMidi.js';
import { getSynth, getAudioContext, getSequencer } from '../core/synth.js';
import { log } from '../core/log.js';

export function mountEditor(rootEl, { playlist, getActiveId, onEditorStart } = {}) {
    if (!rootEl) return null;
    rootEl.innerHTML = `
        <div class="editor-shell">
            <div class="editor-toolbar">
                <span class="editor-title">Editor</span>
                <button id="editorLoadBtn" class="btn">Load current MIDI</button>
                <button id="editorTestBtn" class="btn">▶ Test pattern</button>
                <button id="editorStopBtn" class="btn">Stop</button>
                <span class="editor-hint" id="editorStatus">(idle)</span>
            </div>
            <div class="editor-canvas" id="editorCanvas">
                <div class="editor-placeholder">
                    Editor canvas<br>
                    <small>"Test pattern" — demo. "Load current MIDI" — selected playlist track.</small>
                </div>
            </div>
        </div>
    `;

    const synth = getSynth();
    const ctx   = getAudioContext();
    const statusEl = rootEl.querySelector('#editorStatus');

    if (!synth || !ctx) {
        log('Editor: synth not ready — mount later', 'warn');
        return { root: rootEl, canvas: rootEl.querySelector('#editorCanvas') };
    }

    let playback = null;
    let sequence = null;

    const setupChannels = (seq) => {
        try {
            for (const ch of seq.channels) {
                if (!ch.isDrum) synth.programChange(ch.channel, ch.program);
                synth.controllerChange(ch.channel, 7,  ch.volume ?? 100);
                synth.controllerChange(ch.channel, 10, ch.pan    ?? 64);
            }
        } catch (e) { log('Editor: channel setup failed: ' + e, 'warn'); }
    };

    const startPlayback = async (seq, label) => {
        playback?.stop();
        try { getSequencer()?.pause(); } catch {}
		onEditorStart?.();   // ← новая строка

        sequence = seq;
        playback = new Playback({ synth, ctx, sequence });
        setupChannels(sequence);

        playback.onTimeChange = t => {
            statusEl.textContent = `${label} ${t.toFixed(1)} / ${playback.duration.toFixed(1)} s`;
        };
        playback.onEnd = () => {
            statusEl.textContent = `(${label} ended)`;
            log(`Editor: ${label} finished`);
        };

        try {
            if (ctx.state !== 'running') await ctx.resume();
            playback.play(0);
            statusEl.textContent = `${label} starting...`;
            log(`Editor: ${label} started`);
        } catch (e) {
            log(`Editor: ${label} play failed: ${e}`, 'error');
        }
    };

    const buildDemo = () => {
        const seq = Sequence.create();
        seq.name  = 'Demo';
        seq.tempo = 120;

        const trackPiano = 0;
        const trackDrum  = 3;

        const pPiano = seq.addPattern({ name: 'Piano', lengthTicks: 480 * 16 });
        const pDrum  = seq.addPattern({ name: 'Drums', lengthTicks: 480 * 16 });

        const melody = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 60];
        melody.forEach((key, i) => {
            seq.addNote(pPiano.id, { track: trackPiano, key, vel: 100, tick: i * 480, dur: 400 });
        });

        for (let bar = 0; bar < 4; bar++) {
            const b = bar * 4 * 480;
            seq.addNote(pDrum.id, { track: trackDrum, key: 36, vel: 110, tick: b + 0,    dur: 100 });
            seq.addNote(pDrum.id, { track: trackDrum, key: 36, vel: 110, tick: b + 960,  dur: 100 });
            seq.addNote(pDrum.id, { track: trackDrum, key: 38, vel: 100, tick: b + 480,  dur: 100 });
            seq.addNote(pDrum.id, { track: trackDrum, key: 38, vel: 100, tick: b + 1440, dur: 100 });
            for (let hh = 0; hh < 8; hh++) {
                seq.addNote(pDrum.id, { track: trackDrum, key: 42, vel: 60, tick: b + hh * 240, dur: 60 });
            }
        }

        seq.placePattern(pPiano.id, 0);
        seq.placePattern(pDrum.id,  0);
        return seq;
    };

    rootEl.querySelector('#editorTestBtn')?.addEventListener('click', async () => {
        await startPlayback(buildDemo(), 'demo');
    });

    rootEl.querySelector('#editorLoadBtn')?.addEventListener('click', async () => {
        try {
            if (!playlist) { log('Editor: playlist not available', 'error'); return; }
            const id = getActiveId?.();
            const item = playlist.items.find(i => i.id === id) || playlist.items[0];
            if (!item) { log('Editor: playlist empty', 'warn'); return; }

            statusEl.textContent = `loading ${item.name}...`;
            log(`Editor: importing "${item.name}"...`);
            const buffer = await playlist.getBuffer(item);
            const seq = importMidi(buffer, item.name);
            const totalNotes = seq.patterns.reduce((s, p) => s + p.notes.length, 0);
            log(`Editor: imported ${totalNotes} notes across ${seq.patterns.length} patterns @ ${seq.tempo} BPM`);
            await startPlayback(seq, item.name);
        } catch (e) {
            log('Editor: import failed: ' + e, 'error');
            statusEl.textContent = '(import failed)';
        }
    });

    rootEl.querySelector('#editorStopBtn')?.addEventListener('click', () => {
        playback?.stop();
        statusEl.textContent = '(idle)';
    });

	return {
		root: rootEl,
		canvas: rootEl.querySelector('#editorCanvas'),
		getSequence: () => sequence,
		getPlayback: () => playback,
		stop: () => {
			playback?.stop();
			statusEl.textContent = '(idle)';
		},
	};
}