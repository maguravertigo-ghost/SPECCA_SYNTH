// js/editor/index.js
import { Sequence } from './sequence.js';
import { Playback } from './playback.js';
import { getSynth, getAudioContext, getSequencer } from '../core/synth.js';
import { log } from '../core/log.js';

export function mountEditor(rootEl) {
    if (!rootEl) return null;
    rootEl.innerHTML = `
        <div class="editor-shell">
            <div class="editor-toolbar">
                <span class="editor-title">Editor</span>
                <button id="editorTestBtn" class="btn">▶ Test pattern</button>
                <button id="editorStopBtn" class="btn">Stop</button>
                <span class="editor-hint" id="editorStatus">(idle)</span>
            </div>
            <div class="editor-canvas" id="editorCanvas">
                <div class="editor-placeholder">
                    Editor canvas<br>
                    <small>Click "Test pattern" to hear a demo sequence.</small>
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

    const buildDemo = () => {
        const seq = Sequence.create();
        seq.name  = 'Demo';
        seq.tempo = 120;

        const trackPiano = 0;   // channel 0
        const trackDrum  = 3;   // channel 9

        const pPiano = seq.addPattern({ name: 'Piano', lengthTicks: 480 * 16 });
        const pDrum  = seq.addPattern({ name: 'Drums', lengthTicks: 480 * 16 });

        // 16 четвертных нот — простая гамма туда-обратно
        const melody = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 60];
        melody.forEach((key, i) => {
            seq.addNote(pPiano.id, { track: trackPiano, key, vel: 100, tick: i * 480, dur: 400 });
        });

        // 4 такта барабанов: kick 1/3, snare 2/4, hihat на 8-х
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

    const testBtn = rootEl.querySelector('#editorTestBtn');
    const stopBtn = rootEl.querySelector('#editorStopBtn');

    testBtn?.addEventListener('click', async () => {
        playback?.stop();
        try { getSequencer()?.pause(); } catch {}

        sequence = buildDemo();
        playback = new Playback({ synth, ctx, sequence });

        // Настройка каналов: program + volume + pan
        try {
            for (const ch of sequence.channels) {
                if (!ch.isDrum) synth.programChange(ch.channel, ch.program);
                synth.controllerChange(ch.channel, 7,  ch.volume ?? 100);
                synth.controllerChange(ch.channel, 10, ch.pan    ?? 64);
            }
        } catch (e) { log('Editor: channel setup failed: ' + e, 'warn'); }

        playback.onTimeChange = t => {
            statusEl.textContent = `playing ${t.toFixed(1)} / ${playback.duration.toFixed(1)} s`;
        };
        playback.onEnd = () => {
            statusEl.textContent = '(ended)';
            log('Editor: demo finished');
        };

        try {
            if (ctx.state !== 'running') await ctx.resume();
            playback.play(0);
            statusEl.textContent = 'starting...';
            log('Editor: demo started');
        } catch (e) {
            log('Editor: play failed: ' + e, 'error');
        }
    });

    stopBtn?.addEventListener('click', () => {
        playback?.stop();
        statusEl.textContent = '(idle)';
    });

    return {
        root: rootEl,
        canvas: rootEl.querySelector('#editorCanvas'),
        getSequence: () => sequence,
        getPlayback: () => playback,
    };
}