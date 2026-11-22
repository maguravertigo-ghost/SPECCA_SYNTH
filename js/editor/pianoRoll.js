import { mountAutomationEditor } from '../ui/automationEditor.js';
import { choosePitchFix } from '../ui/fixNotesDialog.js';
// js/editor/pianoRoll.js
import { getInstrumentLabel, mountInstrumentFields } from '../ui/instrumentFields.js';
import { chooseGeneratedNotes } from '../ui/generateNotesDialog.js';
import { generatePatternNotes, withoutNoteConflicts } from './noteGenerator.js';
import { confirmAction } from '../ui/dialogs.js';
import { instrumentFamily } from './instruments.js';
import { log } from '../core/log.js';
import { copyNotes, planPaste } from './noteClipboard.js';
import { writePatternMIDI, writePatternMixMIDI } from './exportMidi.js';
import { getSequencer, initSynth, loadSong, applyChannelMix, bindMasterVolume } from '../core/synth.js';

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const BLACK_KEYS = new Set([1,3,6,8,10]);
const DRUM_NAMES = {
    35:'AcBass', 36:'Kick',  37:'Stick', 38:'Snare', 39:'Clap',
    40:'Snr2',   41:'LoFlr', 42:'ClHat', 43:'HiFlr', 44:'PdHat',
    45:'LoTom',  46:'OpHat', 47:'LMTom', 48:'HMTom', 49:'Crash',
    50:'HiTom',  51:'Ride',  52:'Chnse', 53:'RideBl',54:'Tamb',
    55:'Splash', 56:'Cowbell',57:'Crash2',58:'Vibra',59:'Ride2',
    60:'HBongo', 61:'LBongo',62:'MConga',63:'HConga',64:'LoTimb',
    65:'HiTimb', 66:'HAgogo',67:'LAgogo',68:'Cabasa',69:'Maracas',
    70:'WhstSh', 71:'WhstLg',72:'ShtWhs',73:'GuiroSh',74:'GuiroLg',
    75:'Claves', 76:'HiWood',77:'LoWood',78:'CuicaM',79:'CuicaO',
    80:'TriMute',81:'TriOpen',
};

const DUR_BUTTONS = [
    { label:'1', mult:1 },
    { label:'2', mult:2 },
    { label:'4', mult:4 },
    { label:'8', mult:8 },
];

const HEADER_H = 20;
const LABEL_W  = 64;
const ROW_H    = 20;
const MIN_CELL_W = 6;

export function mountPianoRoll(rootEl, opts = {}) {
    if (!rootEl) return null;

    const {
        getSequence,
        getChannelPattern,
        onPatternSelect,
        onInstrumentChange,
        onEdit,
        onMixer,
        onBackToArranger,
    } = opts;

    rootEl.innerHTML = `
        <div class="pr-shell">
            <div class="pr-layer-bar">
                <strong id="prChannelName"></strong>
                <label id="prPatternField" class="pr-num" hidden><span>Pattern</span> <select id="prPatternSelect"></select></label>
                <button id="prInstrumentBtn" class="pr-t-btn" type="button">Instrument…</button>
                <button id="prNewPattern" class="pr-t-btn" type="button">New pattern</button>
                <label id="prBarsField" class="pr-num" title="Length of this pattern and all its clips"><span>Bars</span>
                    <input id="prPatternBars" type="number" min="1" max="1024" step="1" aria-label="Pattern length in bars">
                </label>
                <button id="prDeletePattern" class="pr-t-btn" type="button" title="Delete pattern and all its clips">Delete pattern</button>
                <button id="prEffects" class="pr-t-btn" type="button" aria-pressed="false">Effects</button>
                <button id="prGenerate" class="pr-t-btn" type="button" title="Generate notes for this pattern"><span class="material-icon" aria-hidden="true">auto_awesome</span> Generate</button>
                <button id="prFixNotes" class="pr-t-btn" type="button" title="Correct out-of-scale pitches">FIX</button>
            </div>
            <div class="pr-toolbar">
			    <button id="prBackBtn" class="pr-t-btn" type="button" title="Back to Arranger"><span class="material-icon" aria-hidden="true">arrow_back</span> Arranger</button>
                <span class="pr-sep"></span>
                <div class="pr-volume-controls">
                    <span id="prChannelMute" role="status" aria-label="Current channel mute status" title="Current channel mute status" hidden></span>
                    <label class="pr-num" title="Master volume">
                        <span>Vol</span>
                        <input id="prMasterVol" type="range" min="0" max="100" step="1" value="100" aria-label="Master volume"><output id="prMasterVolumeValue">100%</output>
                    </label>
                </div>
                <span class="pr-sep"></span>
				<span class="pr-sep"></span>
                <button id="prMixerBtn" class="pr-t-btn" type="button" title="Project mixer" aria-label="Project mixer"><span class="material-icon" aria-hidden="true">tune</span></button>
                <button id="prMixBtn" class="pr-t-btn active" type="button" aria-pressed="true" title="Hear the arrangement behind this pattern (respects channel mute)">MIX</button>
                <button id="prHomeBtn" class="pr-t-btn" type="button" aria-label="To start" title="To start"><span class="material-icon" aria-hidden="true">skip_previous</span></button>
                <button id="prPlayBtn" class="pr-t-btn" type="button" title="Play / pause" aria-label="Play / pause"><span class="material-icon" aria-hidden="true">play_arrow</span></button>
                <button aria-label="Stop" id="prStopBtn" class="pr-t-btn" type="button" title="Stop"><span class="material-icon" aria-hidden="true">stop</span></button>
                <button id="prEndBtn" class="pr-t-btn" type="button" aria-label="To end" title="To end"><span class="material-icon" aria-hidden="true">skip_next</span></button>
                <button aria-label="Loop" id="prLoopBtn" class="pr-t-btn active" type="button" title="Loop"><span class="material-icon" aria-hidden="true">repeat</span></button>
                <span class="pr-sep"></span>
                <label class="pr-num" title="Alt temporarily bypasses snap"><span>Snap</span>
                    <select id="prSnap"><option value="grid">Grid</option><option value="third">⅓ step</option><option value="free">Free</option></select>
                </label>
                <span class="pr-dur-label">Dur:</span>
                <div class="pr-dur-group" id="prDurGroup"></div>
                <span class="pr-sep"></span>
                <button id="prClearBtn" class="btn btn-ghost" type="button" title="Clear current pattern"><span class="material-icon" aria-hidden="true">delete</span> Clear</button>
            </div>
            <section id="prCommentPane" class="pr-comment" hidden>
                <label for="prCommentText">Notes</label>
                <textarea id="prCommentText" rows="6" maxlength="4000" placeholder="Write a cue for this section…"></textarea>
                <p>Shown on the pattern’s clips in the arrangement. Not played or exported to MIDI.</p>
            </section>
            <div class="pr-canvas-wrap"><canvas id="prCanvas" tabindex="0" aria-label="Piano roll. Click its ruler to position playback or paste."></canvas></div>
            <div id="prEditStatus" class="pr-edit-status" role="status">Ctrl/Cmd+C, X, V · Click the ruler to position playback or paste</div>
            <div class="pr-scrollbar hidden" id="prScrollBar">
                <input id="prScrollInput" type="range" min="0" max="1000" value="0" step="1">
            </div>
        </div>
    `;

    const $ = (s) => rootEl.querySelector(s);
    const canvas     = $('#prCanvas');
    const wrap       = canvas.parentElement;
    const instrumentBtn = $('#prInstrumentBtn');
    const patternSelect = $('#prPatternSelect');
    const playBtn    = $('#prPlayBtn');
    const stopBtn    = $('#prStopBtn');
    const mixBtn     = $('#prMixBtn');
    const loopBtn    = $('#prLoopBtn');
    const durGroup   = $('#prDurGroup');
    const clearBtn   = $('#prClearBtn');
    const scrollBar  = $('#prScrollBar');
    const scrollInput= $('#prScrollInput');
    const ctx        = canvas.getContext('2d');

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------
    const state = {
        channel: null,
        visible: false,
        durMult: 1,
        loopEnabled: true,
        tool: 'pencil',          // 'cross' | 'pencil'
        zoom: 1,                // 1 = fit, до 4
        scrollX: 0,
        scrollY: 0,
        selection: new Set(),
        drag: null,
		rect: null,      // {x0, y0, x1, y1, add: boolean}
        playing: false,
        loading: false,
        pasteCursor: null,
        cursorTick: 0,
        mixEnabled: true,
        placementId: null,
        anchorTick: 0,
        clock: null,
    };
    let dpr = Math.max(1, window.devicePixelRatio || 1);
    let dirty = true;
    let rafId = 0;
    let hotReloadTimer = null;
    let reloadPending = false;
    let playbackRequest = 0;
    let seekingUntil = 0;
    let clipboard = null;

    const getSeq = () => getSequence?.();
    const getChannel = () => state.channel;
    const getChannelInfo = () => getSeq()?.channels.find(c => c.channel === getChannel());
    const isComment = () => getChannelInfo()?.kind === 'comment';
    const getPattern = () => getChannelPattern?.(getChannel()) ?? null;
    const getTimeDiv = () => getSeq()?.timeDivision || 480;
    const snapQuantum = (altKey = false) => {
        const mode = altKey ? 'free' : $('#prSnap').value;
        return mode === 'grid' ? stepTicks() : mode === 'third' ? stepTicks() / 3 : 1;
    };
    const snapDelta = (delta, altKey) => {
        const quantum = snapQuantum(altKey);
        return Math.round(Math.round(delta / quantum) * quantum);
    };
    const stepTicks = () => Math.max(1, Math.round(getTimeDiv() / 4));
    const stepsPerBar = () => getSeq()?.stepsPerBar || 16;
    const loopTicks = () => Math.max(1, getPattern()?.lengthTicks ?? getTimeDiv() * 4);
    const totalSteps = () => Math.ceil(loopTicks() / stepTicks());
    const durTicks = () => Math.max(1, Math.round(getTimeDiv() * state.durMult / 4));

    const layer = () => {
        const channel = getChannelInfo();
        const isDrum = !!channel?.isDrum;
        let pitchMin = isDrum ? 27 : 0;
        let pitchMax = isDrum ? 87 : 127;
        if (isDrum) for (const note of getPattern()?.notes ?? []) {
            pitchMin = Math.min(pitchMin, note.key);
            pitchMax = Math.max(pitchMax, note.key);
        }
        return { isDrum, pitchMin, pitchMax, color: channel?.color || '#4ec9b0' };
    };
    const pitches = () => {
        const a = [];
        for (let p = layer().pitchMax; p >= layer().pitchMin; p--) a.push(p);
        return a;
    };
    const pitchLabel = (pitch) => {
        if (layer().isDrum) return DRUM_NAMES[pitch] || String(pitch);
        return NOTE_NAMES[pitch % 12] + (Math.floor(pitch / 12) - 1);
    };

    const baseCellW = () => {
        const avail = wrap.clientWidth - LABEL_W;
        const n = totalSteps();
        return n > 0 ? Math.max(MIN_CELL_W, avail / n) : 40;
    };
    const cellW = () => baseCellW() * state.zoom;
    const maxScrollX = () => {
        const total = cellW() * totalSteps();
        const avail = wrap.clientWidth - LABEL_W;
        return Math.max(0, total - avail);
    };
    const clampScroll = () => {
        state.scrollX = Math.max(0, Math.min(state.scrollX, maxScrollX()));
    };

    const xToStep = (x)     => Math.floor((x - LABEL_W + state.scrollX) / cellW());
    const stepToX = (s)     => LABEL_W + s * cellW() - state.scrollX;

    const rowToY = (row) => HEADER_H + row * ROW_H - state.scrollY;
    const yToRow = (y)   => Math.floor((y - HEADER_H + state.scrollY) / ROW_H);

    const maxScrollY = () => {
        const total = pitches().length * ROW_H;
        const avail = wrap.clientHeight - HEADER_H;
        return Math.max(0, total - avail);
    };
    const clampScrollY = () => {
        state.scrollY = Math.max(0, Math.min(state.scrollY, maxScrollY()));
    };

    // ------------------------------------------------------------------
    // Resize
    // ------------------------------------------------------------------
    const resizeCanvas = () => {
        dpr = Math.max(1, window.devicePixelRatio || 1);
        const w = wrap.clientWidth, h = wrap.clientHeight;
        canvas.width  = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width  = w + 'px';
        canvas.style.height = h + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        clampScroll();
        clampScrollY();
        updateScrollbar();
        dirty = true;
    };

    const updateScrollbar = () => {
        const visible = maxScrollX() > 0.5;
        scrollBar.classList.toggle('hidden', !visible);
        if (visible) {
            const max = maxScrollX();
            scrollInput.value = Math.round(state.scrollX / max * 1000);
        }
    };

    // ------------------------------------------------------------------
    // Drawing
    // ------------------------------------------------------------------
    const draw = () => {
        const w = wrap.clientWidth, h = wrap.clientHeight;
        ctx.clearRect(0, 0, w, h);
        clampScroll();
        clampScrollY();

        const ps = pitches();
        const cw = cellW();
        const ts = totalSteps();
        const spb = stepsPerBar();
        const firstStep = Math.max(0, xToStep(LABEL_W));
        const lastStep = Math.min(ts, xToStep(w) + 1);

        // Zebra cell backgrounds
        ctx.save();
        ctx.beginPath();
        ctx.rect(LABEL_W, HEADER_H, w - LABEL_W, h - HEADER_H);
        ctx.clip();

        for (let row = 0; row < ps.length; row++) {
            const p = ps[row];
            const y = rowToY(row);
            if (y + ROW_H < HEADER_H || y > h) continue;
            const isBlack = !layer().isDrum && BLACK_KEYS.has(p % 12);

            for (let s = firstStep; s < lastStep; s++) {
                const barIdx = Math.floor(s / spb);
                const x = stepToX(s);
                if (x + cw < LABEL_W || x > w) continue;
                const shadeBase = isBlack ? 10 : 16;
                const boost = (barIdx % 2 ? 11 : 0) + (Math.floor(s / 4) % 2 ? 5 : 0);
                const v = shadeBase + boost;
                ctx.fillStyle = `hsl(240, 5%, ${v}%)`;
                ctx.fillRect(x, y, cw, ROW_H);
            }
        }

        // Grid lines
        ctx.lineWidth = 1;
        for (let s = firstStep; s <= lastStep; s++) {
            const x = Math.round(stepToX(s)) + 0.5;
            if (x < LABEL_W || x > w) continue;
            ctx.strokeStyle = s % spb === 0 ? '#7b7b8e' : s % 4 === 0 ? '#494954' : '#202025';
            ctx.lineWidth   = (s % spb === 0) ? 1.5 : 1;
            ctx.beginPath();
            ctx.moveTo(x, HEADER_H);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        // Horizontal grid
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.lineWidth = 1;
        for (let row = 0; row <= ps.length; row++) {
            const y = Math.round(rowToY(row)) + 0.5;
            if (y < HEADER_H || y > h) continue;
            ctx.beginPath();
            ctx.moveTo(LABEL_W, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Notes (только активный канал)
        const p = getPattern();
        const chn = getChannel();
        const layerColor = layer().color;
        if (p?.notes) {
            for (const n of p.notes) {
                if (n.track !== chn) continue;
                const row = ps.indexOf(n.key);
                if (row < 0) continue;
                const x = stepToX(n.tick / stepTicks());
                const y = rowToY(row);
                const noteDurSteps = n.dur / stepTicks();
                const nw = noteDurSteps * cw;
                if (y + ROW_H < HEADER_H || y > h) continue;
                if (x + nw < LABEL_W || x > w) continue;
                const selected = state.selection.has(n);
                ctx.fillStyle = selected ? '#e35b5b' : layerColor;   // красный
                ctx.fillRect(x + 1, y + 1, Math.max(1, nw - 2), ROW_H - 2);
                ctx.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.55)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x + 0.5, y + 0.5, nw - 1, ROW_H - 1);
            }
        }

        const phX = stepToX(state.cursorTick / stepTicks());
        if (phX >= LABEL_W && phX <= w) {
            ctx.strokeStyle = '#ff4081';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(phX, HEADER_H);
            ctx.lineTo(phX, h);
            ctx.stroke();

        }

                // Selection rectangle (blue)
        if (state.rect) {
            const r = state.rect;
            const x0 = Math.min(r.x0, r.x1), y0 = Math.min(r.y0, r.y1);
            const w  = Math.abs(r.x1 - r.x0), h = Math.abs(r.y1 - r.y0);
            ctx.fillStyle   = 'rgba(74,158,255,0.15)';
            ctx.fillRect(x0, y0, w, h);
            ctx.strokeStyle = '#4a9eff';
            ctx.lineWidth   = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(x0 + 0.5, y0 + 0.5, w, h);
            ctx.setLineDash([]);
        }

        ctx.restore();

        // Labels (left column) — с клипом, чтобы при скролле не наезжало на рулер
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, HEADER_H, LABEL_W, h - HEADER_H);
        ctx.clip();
        ctx.fillStyle = '#0a0a10';
        ctx.fillRect(0, HEADER_H, LABEL_W, h - HEADER_H);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.moveTo(LABEL_W - 0.5, 0);
        ctx.lineTo(LABEL_W - 0.5, h);
        ctx.stroke();
        ctx.font = '11px -apple-system, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#c8c8d2';
        for (let row = 0; row < ps.length; row++) {
            const y = rowToY(row);
            if (y + ROW_H < HEADER_H || y > h) continue;
            const isBlack = !layer().isDrum && BLACK_KEYS.has(ps[row] % 12);
            if (isBlack) {
                ctx.fillStyle = '#0e0e13';
                ctx.fillRect(0, y, LABEL_W - 1, ROW_H);
                ctx.fillStyle = '#a0a0b0';
            } else {
                ctx.fillStyle = '#15151c';
                ctx.fillRect(0, y, LABEL_W - 1, ROW_H);
                ctx.fillStyle = '#d8d8e0';
            }
            ctx.fillText(pitchLabel(ps[row]), 6, y + ROW_H / 2);
            ctx.strokeStyle = 'rgba(0,0,0,0.6)';
            ctx.beginPath();
            ctx.moveTo(0, y + ROW_H - 0.5);
            ctx.lineTo(LABEL_W - 1, y + ROW_H - 0.5);
            ctx.stroke();
        }
        ctx.restore();        // ← добавили

        // Ruler (M1, M2, ...)
        ctx.fillStyle = '#15151c';
        ctx.fillRect(LABEL_W, 0, w - LABEL_W, HEADER_H);
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.beginPath();
        ctx.moveTo(LABEL_W, HEADER_H - 0.5);
        ctx.lineTo(w, HEADER_H - 0.5);
        ctx.stroke();
        ctx.font = 'bold 11px -apple-system, sans-serif';
        for (let bar = Math.floor(firstStep / spb); bar * spb < lastStep; bar++) {
            const stepIdx = bar * spb;
            const x = stepToX(stepIdx);
            if (x + cw < LABEL_W || x > w) continue;
            // подсветка заголовка бара
            ctx.fillStyle = (bar % 2 === 0) ? '#1d1d26' : '#26262f';
            ctx.fillRect(x, 0, cw * spb, HEADER_H);
            ctx.fillStyle = '#a8a8b8';
            ctx.fillText(`M${bar + 1}`, x + 4, HEADER_H / 2);
            // разделитель бара
            ctx.strokeStyle = 'rgba(180,180,200,0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, HEADER_H);
            ctx.stroke();
        }
        if (state.pasteCursor != null && Math.abs(state.pasteCursor - state.cursorTick) > stepTicks() / 2) {
            const cursorX = stepToX(state.pasteCursor / stepTicks());
            if (cursorX >= LABEL_W && cursorX <= w) {
                ctx.fillStyle = '#ffcd70';
                ctx.fillRect(cursorX, 0, 2, HEADER_H);
            }
        }
        // Draw the playback marker over the ruler, in the same color as the grid playhead.
        if (phX >= LABEL_W && phX <= w) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(LABEL_W, 0, w - LABEL_W, HEADER_H);
            ctx.clip();
            ctx.fillStyle = '#ff4081';
            ctx.fillRect(phX - 1, 0, 2, HEADER_H);
            ctx.beginPath();
            ctx.moveTo(phX - 5, HEADER_H - 7);
            ctx.lineTo(phX + 5, HEADER_H - 7);
            ctx.lineTo(phX, HEADER_H);
            ctx.fill();
            ctx.restore();
        }
        // угол
        ctx.fillStyle = '#0a0a10';
        ctx.fillRect(0, 0, LABEL_W, HEADER_H);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.strokeRect(0.5, 0.5, LABEL_W - 1, HEADER_H - 1);
    };

    const frame = () => {
        const seq = getSequencer();
        if (state.playing && !state.loading && seq?.isFinished) {
            state.cursorTick = loopTicks();
            state.playing = false;
            playBtn.classList.remove('active');
            playBtn.firstElementChild.textContent = 'play_arrow';
            dirty = true;
        }
        if (state.playing && !state.loading && !seq?.paused && state.clock && performance.now() >= seekingUntil) {
            state.cursorTick = Math.max(0, Math.min(loopTicks(), state.clock.toTicks(seq.currentTime)));
        }
        if (state.visible && (dirty || state.playing)) {
            canvas.dataset.playheadTick = String(Math.round(state.cursorTick));
            dirty = false;
            draw();
        }   // playhead анимируется
        rafId = requestAnimationFrame(frame);
    };

    // ------------------------------------------------------------------
    // Note math
    // ------------------------------------------------------------------
    const findNoteAt = (step, key) => {
        const p = getPattern();
        if (!p?.notes) return null;
        const chn = getChannel();
        for (const n of p.notes) {
            if (n.track !== chn || n.key !== key) continue;
            const startStep = n.tick / stepTicks();
            const endStep   = startStep + n.dur / stepTicks();
            if (step >= startStep && step < endStep) return { note: n, startStep, endStep };
        }
        return null;
    };

    const addNote = (step, key) => {
        if (step < 0 || step >= totalSteps()) return null;
        if (findNoteAt(step, key)) return null;
        const seq = getSeq();
        const p = getPattern();
        if (!seq || !p) return null;
        const dur = Math.min(durTicks(), loopTicks() - step * stepTicks());
        if (dur <= 0) return null;
        p.notes = p.notes || [];
        const note = {
            track: getChannel(),
            key,
            vel: 100,
            tick: step * stepTicks(),
            dur,
        };
        p.notes.push(note);
        state.selection.clear();
        state.selection.add(note);
        scheduleHotReload();
        return note;
    };

    const removeNote = (note) => {
        const p = getPattern();
        if (!p?.notes) return;
        const i = p.notes.indexOf(note);
        if (i >= 0) {
            p.notes.splice(i, 1);
            state.selection.delete(note);
            scheduleHotReload();
        }
    };

    // ------------------------------------------------------------------
    // Hot reload (применяем изменения на лету)
    // ------------------------------------------------------------------
    const scheduleHotReload = () => {
        dirty = true;
        if (hotReloadTimer) clearTimeout(hotReloadTimer);
        hotReloadTimer = setTimeout(() => {
            if (state.loading) reloadPending = true;
            else if (state.playing) pushToSequencer(true);
        }, 200);
    };

    const pushToSequencer = async (keepPlaying = false) => {
        const seq = getSeq();
        const pattern = getPattern();
        if (isComment() || !seq || !pattern || !state.visible || rootEl.inert || state.loading) return;
        const request = ++playbackRequest;
        state.loading = playBtn.disabled = true;
        try {
            const mix = state.mixEnabled;
            const options = { liveMix: true };
            const placement = seq.arrangement.find(p => p.id === state.placementId && p.patternId === pattern.id)
                ?? seq.arrangement.filter(p => p.patternId === pattern.id).reduce((first, p) => !first || p.startTick < first.startTick ? p : first, null);
            const soloAt = placement?.startTick ?? state.anchorTick;
            const { startTick, midi } = mix ? writePatternMixMIDI(seq, pattern.id, { ...options, placementId: state.placementId, anchorTick: state.anchorTick })
                : { startTick: soloAt, midi: pattern.notes.length ? writePatternMIDI(seq, pattern.id, soloAt, options) : null };
            if (!midi) {
                if (state.playing) stop(false);
                $('#prEditStatus').textContent = mix ? 'No notes in this part of the arrangement.' : 'No notes in this pattern.';
                return;
            }
            await initSynth();
            if (request !== playbackRequest) return;
            const sequencer = getSequencer();
            if (!await loadSong(midi, pattern.name, sequencer, () => request === playbackRequest && state.visible && !rootEl.inert)) return;
            applyChannelMix(seq);
            sequencer.loopCount = state.loopEnabled ? Infinity : 0;
            const secondsPerTick = 60 / (seq.tempoAt(startTick) * seq.timeDivision);
            const origin = seq.ticksToSeconds(startTick);
            state.clock = mix ? {
                toSeconds: tick => seq.ticksToSeconds(startTick + tick) - origin,
                toTicks: seconds => seq.secondsToTicks(origin + seconds) - startTick,
            } : { toSeconds: tick => tick * secondsPerTick, toTicks: seconds => seconds / secondsPerTick };

            if (keepPlaying || state.playing) {
                if (state.cursorTick >= loopTicks()) state.cursorTick = 0;
                if (state.cursorTick > 0) sequencer.currentTime = Math.min(sequencer.duration, state.clock.toSeconds(state.cursorTick));
                seekingUntil = performance.now() + 100;
                sequencer.play();
                state.playing = true;
                playBtn.classList.add('active');
                playBtn.firstElementChild.textContent = 'pause';
            }
        } catch (err) {
            if (request === playbackRequest) { $('#prEditStatus').textContent = err.message; log(`Pattern play: ${err}`, 'error'); }
        } finally {
            if (request === playbackRequest) {
                state.loading = playBtn.disabled = false;
                if (reloadPending) { reloadPending = false; scheduleHotReload(); }
            }
        }
    };

    const play = () => pushToSequencer(true);

    const stop = (rewind = true) => {
        playbackRequest++;
        if (rewind) state.cursorTick = 0;
        state.loading = playBtn.disabled = false;
        clearTimeout(hotReloadTimer);
        reloadPending = false;
        state.clock = null;
        const sequencer = getSequencer?.();
        if (sequencer) {
            try { sequencer.pause(); if (rewind) sequencer.currentTime = 0; } catch {}
        }
        state.playing = false;
        playBtn.classList.remove('active');
        playBtn.firstElementChild.textContent = 'play_arrow';
        dirty = true;
    };

    const togglePlay = async () => {
        if (state.playing) {
            stop(false);
        } else {
            await play();
        }
    };

    const seekTick = (tick, reveal = false) => {
        if (!getPattern()) return;
        state.cursorTick = Math.max(0, Math.min(loopTicks(), Math.round(tick)));
        const seq = getSequencer();
        if (seq && state.playing && !state.loading && state.clock) {
            seekingUntil = performance.now() + 100;
            seq.currentTime = Math.min(seq.duration, state.clock.toSeconds(state.cursorTick));
        }
        if (reveal) {
            const x = stepToX(state.cursorTick / stepTicks());
            if (x < LABEL_W || x > wrap.clientWidth) {
                state.scrollX = state.cursorTick / stepTicks() * cellW();
                clampScroll();
                updateScrollbar();
            }
        }
        dirty = true;
    };
    $('#prHomeBtn').addEventListener('click', () => seekTick(0, true));
    $('#prEndBtn').addEventListener('click', () => {
        if (state.playing || state.loading) stop(false);
        seekTick(loopTicks(), true);
    });

    // ------------------------------------------------------------------
    // Hit test
    // ------------------------------------------------------------------
    const hitTestNote = (mx, my) => {
        if (mx < LABEL_W || my < HEADER_H) return null;
        const row = yToRow(my);
        const ps = pitches();
        if (row < 0 || row >= ps.length) return null;
        const key = ps[row];
        const step = xToStep(mx);
        if (step < 0 || step >= totalSteps()) return null;
        const found = findNoteAt((mx - LABEL_W + state.scrollX) / cellW(), key);
        if (!found) return { key, step, note: null, row };

        // resize hit: правый край
        const endX = stepToX(found.endStep);
        const rightEdge = endX - Math.min(4, (found.endStep - found.startStep) * cellW() / 3);
        const mode = mx >= rightEdge ? 'resize' : 'move';
        return { key, step, note: found.note, startStep: found.startStep, endStep: found.endStep, row, mode };
    };

    // ------------------------------------------------------------------
    // Pointer interactions (единый pencil-режим + модификаторы)
    // ------------------------------------------------------------------
    const clampX = (x) => Math.max(LABEL_W, Math.min(x, wrap.clientWidth));
    const clampY = (y) => Math.max(HEADER_H, Math.min(y, wrap.clientHeight));

    const startMoveDrag = (mx, my) => {
        const sel = Array.from(state.selection);
        state.drag = {
            mode: 'move',
            startX: mx, startY: my,
            orig: sel.map(n => ({ note: n, tick: n.tick, key: n.key })),
            moved: false,
        };
    };

    const onPointerDown = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        if (mx < LABEL_W) return;
        canvas.focus({ preventScroll: true });
        if (my < HEADER_H) {
            if (e.button === 0) {
                e.preventDefault();
                const step = xToStep(mx);
                if (step < totalSteps()) {
                    state.pasteCursor = Math.min(loopTicks(), step * stepTicks());
                    seekTick(state.pasteCursor);
                    $('#prEditStatus').textContent = `Position: bar ${Math.floor(step / stepsPerBar()) + 1}, step ${step % stepsPerBar() + 1}`;
                    dirty = true;
                }
            }
            return;
        }
        if (e.button === 0) state.pasteCursor = null;

        const hit = hitTestNote(mx, my);

        // ---------- RMB: erase OR clear selection ----------
        if (e.button === 2) {
            if (!hit?.note) {
                if (state.selection.size) {
                    state.selection.clear();
                    dirty = true;
                    return;   // не начинаем erase-drag, только сброс
                }
                state.drag = { mode: 'erase', lastStep: -1, lastKey: -1 };
                return;
            }
            state.drag = { mode: 'erase', lastStep: hit.step, lastKey: hit.key };
            removeNote(hit.note);
            return;
        }

        if (e.button !== 0) return;

        // ---------- Shift: temporary rectangle selection ----------
        if (e.shiftKey) {
            if (hit?.note) {
                if (state.selection.has(hit.note)) state.selection.delete(hit.note);
                else state.selection.add(hit.note);
                dirty = true;
            } else {
                state.rect = {
                    x0: clampX(mx), y0: clampY(my),
                    x1: clampX(mx), y1: clampY(my),
                    add: true,      // shift всегда additive
                };
                dirty = true;
            }
            return;
        }

        // ---------- Ctrl: move-drag ----------
        if (e.ctrlKey || e.metaKey) {
            if (!hit?.note) return;   // по пустому — ничего
            if (!state.selection.has(hit.note)) {
                state.selection.clear();
                state.selection.add(hit.note);
            }
            startMoveDrag(mx, my);
            return;
        }

        // ---------- LMB на ноте: select + drag/resize ----------
        if (hit?.note) {
            if (!state.selection.has(hit.note)) {
                state.selection.clear();
                state.selection.add(hit.note);
            }
            if (hit.mode === 'resize') {
                state.drag = { mode: 'resize', note: hit.note, startX: mx, origDur: hit.note.dur };
            } else {
                startMoveDrag(mx, my);
            }
            dirty = true;
            return;
        }

        // ---------- LMB на пустом: добавить ноту + начать paint-drag ----------
        state.selection.clear();
        addNote(hit.step, hit.key);
        state.drag = { mode: 'paint', lastStep: hit.step, lastKey: hit.key };
    };

    const onPointerMove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (state.rect) {
            state.rect.x1 = clampX(mx);
            state.rect.y1 = clampY(my);
            dirty = true;
            return;
        }

        if (!state.drag) {
            const hit = hitTestNote(mx, my);
            if (hit) {
                if (e.ctrlKey || e.metaKey)      canvas.style.cursor = 'move';
                else if (hit.mode === 'resize')  canvas.style.cursor = 'ew-resize';
                else                             canvas.style.cursor = 'pointer';
            } else {
                canvas.style.cursor = e.shiftKey ? 'cell' : 'crosshair';
            }
            return;
        }

        const d = state.drag;

        // Move
        if (d.mode === 'move' && d.orig) {
            const stepT = stepTicks();
            const L = layer();
            const deltaTick = snapDelta((mx - d.startX) / cellW() * stepT, e.altKey);
            const dyPitch = -Math.round((my - d.startY) / ROW_H);

            let minTick = Infinity, maxEndTick = -Infinity, minKey = Infinity, maxKey = -Infinity;
            for (const o of d.orig) {
                minTick    = Math.min(minTick, o.tick);
                maxEndTick = Math.max(maxEndTick, o.tick + o.note.dur);
                minKey     = Math.min(minKey, o.key);
                maxKey     = Math.max(maxKey, o.key);
            }
            const dxClamp = Math.max(-minTick, Math.min(loopTicks() - maxEndTick, deltaTick));
            const dyClamp = Math.max(L.pitchMin - minKey, Math.min(L.pitchMax - maxKey, dyPitch));

            for (const o of d.orig) {
                o.note.tick = o.tick + dxClamp;
                o.note.key  = o.key  + dyClamp;
            }
            d.moved = true;
            dirty = true;
            return;
        }

        // Resize
        if (d.mode === 'resize') {
            const delta = snapDelta((mx - d.startX) / cellW() * stepTicks(), e.altKey);
            d.note.dur = Math.max(1, Math.min(loopTicks() - d.note.tick, d.origDur + delta));
            d.moved = true;
            dirty = true;
            return;
        }

        // Erase (drag-delete)
        if (d.mode === 'erase') {
            const step = xToStep(mx);
            const row  = yToRow(my);
            const ps   = pitches();
            if (row < 0 || row >= ps.length) return;
            if (step < 0 || step >= totalSteps()) return;
            if (step === d.lastStep && row === d.lastKey) return;
            d.lastStep = step;
            d.lastKey  = row;
            const found = findNoteAt(step, ps[row]);
            if (found) removeNote(found.note);
            return;
        }

        // Paint
        if (d.mode === 'paint') {
            const step = xToStep(mx);
            const row  = yToRow(my);
            const ps   = pitches();
            if (row < 0 || row >= ps.length) return;
            if (step < 0 || step >= totalSteps()) return;
            if (step === d.lastStep && row === d.lastKey) return;
            d.lastStep = step;
            d.lastKey  = row;
            const key = ps[row];
            if (!findNoteAt(step, key)) addNote(step, key);
        }
    };

    const onPointerUp = () => {
        if (state.rect) { finishRect(); return; }
        if (state.drag?.moved) scheduleHotReload();
        if (state.drag) onEdit?.();
        state.drag = null;
    };

    const onWheel = (e) => {
        // Ctrl+wheel → zoom (как было)
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 0.85 : 1.18;
            state.zoom = Math.max(1, Math.min(4, state.zoom * factor));
            updateScrollbar();
            dirty = true;
            return;
        }
        // Shift+wheel или горизонтальный жест тачпада → horizontal scroll
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            if (maxScrollX() > 0) {
                state.scrollX += e.deltaY || e.deltaX;
                clampScroll();
                updateScrollbar();
                dirty = true;
                e.preventDefault();
            }
            return;
        }
        // обычный wheel → vertical scroll (питчи не влезают)
        if (maxScrollY() > 0) {
            state.scrollY += e.deltaY;
            clampScrollY();
            dirty = true;
            e.preventDefault();
        }
    };

    // ------------------------------------------------------------------
    // Select tool (rectangle)
    // ------------------------------------------------------------------
    const inRect = (n, r) => {
        const ps = pitches();
        const row = ps.indexOf(n.key);
        if (row < 0) return false;
        const x = stepToX(n.tick / stepTicks());
        const y = rowToY(row);
        const w = Math.max(1, Math.round(n.dur / stepTicks())) * cellW();
        const h = ROW_H;
        return !(x + w < r.x0 || x > r.x1 || y + h < r.y0 || y > r.y1);
    };

    const finishRect = () => {
        if (!state.rect) return;
        const r = state.rect;
        state.rect = null;
        const p = getPattern();
        if (!p?.notes) { dirty = true; return; }
        const chn = getChannel();
        const rr = {
            x0: Math.min(r.x0, r.x1), x1: Math.max(r.x0, r.x1),
            y0: Math.min(r.y0, r.y1), y1: Math.max(r.y0, r.y1),
        };
        if (!r.add) state.selection.clear();
        for (const n of p.notes) {
            if (n.track !== chn) continue;
            if (inRect(n, rr)) state.selection.add(n);
        }
        dirty = true;
    };

    // ------------------------------------------------------------------
    // Channel/pattern header and instrument picker
    // ------------------------------------------------------------------
    const refreshChannelMute = () => {
        const channel = getChannelInfo();
        const indicator = $('#prChannelMute');
        indicator.hidden = !channel || channel.kind === 'comment';
        const status = channel?.muted ? 'MUTE' : 'ON';
        indicator.dataset.state = channel?.muted ? 'muted' : 'on';
        if (indicator.textContent !== status) indicator.textContent = status;
    };
    const automationEditor = mountAutomationEditor({ host: wrap, button: $('#prEffects'), getPattern,
        onCommit: () => { dirty = true; scheduleHotReload(); onEdit?.(); },
    });
    const refreshHeader = () => {
        automationEditor.refresh();
        const channel = getChannelInfo();
        const pattern = getPattern();
        $('#prChannelName').textContent = channel ? channel.name || `Ch ${channel.channel + 1}` : 'Piano Roll';
        instrumentBtn.textContent = channel ? `Instrument: ${getInstrumentLabel(channel)}` : 'Instrument…';
        instrumentBtn.title = channel ? instrumentFamily(channel) : '';
        const comment = isComment();
        refreshChannelMute();
        instrumentBtn.hidden = comment;
        instrumentBtn.disabled = !channel;
        rootEl.querySelector('.pr-shell').classList.toggle('is-comment', comment);
        $('#prCommentPane').hidden = !comment;
        wrap.hidden = comment;
        const notes = $('#prCommentText');
        notes.disabled = !pattern;
        if (notes.value !== (pattern?.comment ?? '')) notes.value = pattern?.comment ?? '';
        $('#prBarsField').hidden = !pattern;
        $('#prPatternBars').value = pattern ? String(Math.ceil(pattern.lengthTicks / getSeq().ticksPerBar)) : '';
        const patterns = getSeq()?.patterns.filter(p => p.channel === state.channel) ?? [];
        $('#prPatternField').hidden = !patterns.length;
        $('#prNewPattern').disabled = !channel;
        $('#prDeletePattern').disabled = !pattern;
        $('#prEffects').hidden = comment;
        $('#prGenerate').hidden = comment;
        $('#prGenerate').disabled = !pattern;
        $('#prFixNotes').hidden = comment || !!channel?.isDrum;
        $('#prFixNotes').disabled = !pattern;
        patternSelect.replaceChildren(...patterns.map(p => new Option(p.name, p.id)));
        if (pattern) patternSelect.value = pattern.id;
    };
    const resetViewport = () => {
        state.selection.clear();
        state.drag = null;
        state.rect = null;
        state.scrollX = 0;
        state.pasteCursor = null;
        if (!state.playing) state.cursorTick = 0;
        const keys = getPattern()?.notes.map(n => n.key).sort((a, b) => a - b) ?? [];
        const middle = keys[Math.floor(keys.length / 2)] ?? (layer().isDrum ? 45 : 60);
        state.scrollY = Math.max(0, (layer().pitchMax - middle) * ROW_H - wrap.clientHeight / 2);
        clampScrollY();
        updateScrollbar();
        dirty = true;
    };
    $('#prNewPattern').addEventListener('click', () => {
        const seq = getSeq();
        if (!seq || !getChannelInfo()) return;
        stop();
        const pattern = seq.createChannelPattern(state.channel);
        onPatternSelect?.(state.channel, pattern.id);
        refreshHeader(); resetViewport(); onEdit?.();
    });
    $('#prDeletePattern').addEventListener('click', async () => {
        const seq = getSeq(), pattern = getPattern();
        if (!pattern || !await confirmAction('Delete pattern', `Delete ${pattern.name} and all its clips?`) || getSeq() !== seq || getPattern() !== pattern) return;
        stop();
        seq.removePattern(pattern.id);
        onPatternSelect?.(state.channel, seq.getChannelPattern(state.channel)?.id);
        refreshHeader(); resetViewport(); onEdit?.();
    });
    const generationDefaults = { melodic: {}, drums: {} };
    $('#prGenerate').addEventListener('click', async () => {
        const seq = getSeq(), pattern = getPattern(), channel = getChannelInfo();
        if (!pattern || !channel || isComment()) return;
        const kind = channel.isDrum ? 'drums' : 'melodic';
        const choice = await chooseGeneratedNotes({ isDrum: channel.isDrum, hasNotes: pattern.notes.length > 0,
            defaults: generationDefaults[kind] });
        if (!choice || getSeq() !== seq || getPattern() !== pattern || getChannelInfo() !== channel) return;
        generationDefaults[kind] = choice;
        const notes = generatePatternNotes({ ...choice, isDrum: channel.isDrum,
            lengthTicks: pattern.lengthTicks, ticksPerBar: seq.ticksPerBar, stepsPerBar: seq.stepsPerBar });
        if (!notes.length) return;
        if (choice.replace) pattern.notes = [];
        const added = withoutNoteConflicts(notes, pattern.notes)
            .map(note => seq.addNote(pattern.id, { ...note, track: channel.channel }));
        if (added.length) {
            resetViewport();
            state.selection = new Set(added);
            scheduleHotReload(); onEdit?.();
        }
        $('#prEditStatus').textContent = added.length ? `Generated ${added.length} notes in ${pattern.name}` : 'No new notes: the generated notes overlap existing notes.';
    });
    $('#prFixNotes').addEventListener('click', async () => {
        const seq = getSeq(), pattern = getPattern(), channel = getChannelInfo();
        if (!pattern?.notes.length || !channel || channel.isDrum || isComment()) {
            $('#prEditStatus').textContent = 'No melodic notes to fix.';
            return;
        }
        const notes = pattern.notes.filter(n => n.track === channel.channel);
        const selected = new Set(notes.filter(n => state.selection.has(n)));
        const result = await choosePitchFix({ notes, selected, beat: seq.timeDivision });
        if (!result || !result.changes.size || getSeq() !== seq || getPattern() !== pattern) return;
        for (const [note, pitch] of result.changes) note.key = pitch;
        state.selection = new Set(result.changes.keys());
        dirty = true;
        scheduleHotReload(); onEdit?.();
        $('#prEditStatus').textContent = `Fixed ${result.changes.size} note pitch(es) · Undo to restore`;
    });
    const barsInput = $('#prPatternBars');
    barsInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); barsInput.blur(); }
    });
    barsInput.addEventListener('change', () => {
        const seq = getSeq(), pattern = getPattern();
        if (!pattern) return;
        const status = $('#prEditStatus');
        try {
            if (!seq.resizePattern(pattern.id, barsInput.valueAsNumber)) return;
            const position = Math.min(state.cursorTick, loopTicks());
            state.cursorTick = position;
            updateScrollbar(); scheduleHotReload(); onEdit?.();
            status.textContent = `${pattern.name} · ${barsInput.value} bar(s)`;
        } catch (error) {
            barsInput.value = String(Math.ceil(pattern.lengthTicks / seq.ticksPerBar));
            status.textContent = error.message;
        }
    });
    $('#prCommentText').addEventListener('input', event => {
        const pattern = getPattern();
        if (pattern && isComment()) pattern.comment = event.target.value;
    });
    $('#prCommentText').addEventListener('change', () => onEdit?.());
    patternSelect.addEventListener('change', () => {
        stop();
        onPatternSelect?.(state.channel, patternSelect.value);
        refreshHeader();
        resetViewport();
    });

    let pickerEl = null;
    instrumentBtn.addEventListener('click', () => {
        const channel = getChannelInfo();
        if (!channel) return;
        pickerEl?.remove();
        const dialog = document.createElement('dialog');
        pickerEl = dialog;
        dialog.className = 'arr-dialog-box pr-instrument-dialog';
        dialog.innerHTML = `
            <form method="dialog">
                <h2 class="arr-dialog-title">Channel instrument</h2>
                <div class="arr-dialog-body" data-instrument-fields></div>
                <div class="arr-dialog-footer">
                    <button class="btn" value="cancel">Cancel</button>
                    <button class="btn btn-primary" value="apply">Apply</button>
                </div>
            </form>`;
        const readInstrument = mountInstrumentFields(dialog.querySelector('[data-instrument-fields]'), channel);
        dialog.addEventListener('close', () => {
            const patch = readInstrument();
            if (dialog.returnValue === 'apply' && patch && getChannelInfo() === channel) {
                const typeChanged = channel.isDrum !== patch.isDrum;
                Object.assign(channel, patch);
                refreshHeader();
                if (typeChanged) resetViewport();
                onInstrumentChange?.();
                onEdit?.();
                scheduleHotReload();
            }
            dialog.remove();
            if (pickerEl === dialog) pickerEl = null;
        });
        document.body.appendChild(dialog);
        dialog.showModal();
    });

    // ------------------------------------------------------------------
    // Dur buttons
    // ------------------------------------------------------------------
    const buildDurButtons = () => {
        durGroup.replaceChildren();
        const extra = document.createElement('select');
        extra.id = 'prNoteDuration';
        extra.setAttribute('aria-label', 'Note duration');
        const lengths = [['1/64', .25], ['1/32', .5], ['1/16 triplet', 2/3], ['1/16', 1], ['Dotted 1/16', 1.5],
            ['1/8 triplet', 4/3], ['1/8', 2], ['Dotted 1/8', 3], ['1/4 triplet', 8/3], ['1/4', 4],
            ['Dotted 1/4', 6], ['1/2', 8], ['Dotted 1/2', 12], ['Whole', 16], ['Dotted whole', 24]];
        extra.replaceChildren(...lengths.map(([label, length]) => new Option(label, length)));
        durGroup.append(extra);
        const setDuration = length => {
            state.durMult = length;
            extra.value = String(length);
            durGroup.querySelectorAll('button').forEach(x => x.classList.toggle('active', Number(x.dataset.mult) === length));
        };
        extra.addEventListener('change', () => setDuration(Number(extra.value)));
        DUR_BUTTONS.filter(d => d.mult !== 1).forEach(d => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'pr-dur-btn'; b.dataset.mult = d.mult; b.textContent = d.label;
            b.title = `Duration: ${d.mult} grid steps`;
            b.addEventListener('click', () => setDuration(d.mult));
            durGroup.append(b);
        });
        setDuration(state.durMult);
    };

    // ------------------------------------------------------------------
    // UI wiring
    // ------------------------------------------------------------------

    playBtn?.addEventListener('click', togglePlay);
    $('#prMixerBtn').addEventListener('click', () => onMixer?.());
    mixBtn.addEventListener('click', () => {
        state.mixEnabled = !state.mixEnabled;
        mixBtn.classList.toggle('active', state.mixEnabled);
        mixBtn.setAttribute('aria-pressed', String(state.mixEnabled));
        const resume = state.playing || state.loading;
        if (resume) {
            stop(false);
            play();
        }
    });
    stopBtn?.addEventListener('click', () => stop());
    loopBtn?.addEventListener('click', () => {
        state.loopEnabled = !state.loopEnabled;
        loopBtn.classList.toggle('active', state.loopEnabled);
        const sequencer = getSequencer?.();
        if (sequencer) sequencer.loopCount = state.loopEnabled ? Infinity : 0;
    });
    clearBtn?.addEventListener('click', () => {
        const p = getPattern();
        if (!p?.notes) return;
        const chn = getChannel();
        p.notes = p.notes.filter(n => n.track !== chn);
        state.selection.clear();
        scheduleHotReload();
        onEdit?.();
    });
    scrollInput?.addEventListener('input', () => {
        const max = maxScrollX();
        state.scrollX = (Number(scrollInput.value) / 1000) * max;
        dirty = true;
    });

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const ro = new ResizeObserver(() => { resizeCanvas(); });
    ro.observe(wrap);
    window.addEventListener('resize', resizeCanvas);

    // Menu actions and keyboard shortcuts share the same note clipboard.
    const editNotes = (action) => {
        if (isComment() || !state.visible || rootEl.inert || pickerEl?.open) return false;
        const p = getPattern();
        if (!p) return false;
        const message = (text) => { $('#prEditStatus').textContent = text; };
        const selected = [...state.selection];
        if (action === 'all') {
            state.selection = new Set(p.notes.filter(n => n.track === getChannel()));
            dirty = true;
        } else if (action === 'copy' || action === 'cut' || action === 'delete') {
            if (!selected.length) { message('Select notes first'); return true; }
            if (action !== 'delete') clipboard = copyNotes(selected, getTimeDiv());
            if (action !== 'copy') {
                p.notes = p.notes.filter(n => !state.selection.has(n));
                state.selection.clear();
                if (action === 'cut') state.pasteCursor = Math.min(...selected.map(n => n.tick));
                scheduleHotReload();
                onEdit?.();
            }
            message(`${action === 'copy' ? 'Copied' : action === 'cut' ? 'Cut' : 'Deleted'} ${selected.length} note(s)`);
        } else if (action === 'paste') {
            if (!clipboard) { message('No copied notes'); return true; }
            const placement = planPaste(clipboard, { step: stepTicks(), timeDivision: getTimeDiv(), length: loopTicks(),
                cursor: state.pasteCursor, selection: selected, notes: p.notes });
            if (!placement) { message('Not enough room. Choose an earlier position on the ruler or another pattern.'); return true; }
            state.selection = new Set(placement.notes.map(n => getSeq().addNote(p.id, {
                ...n, tick: placement.start + n.tick, track: getChannel(),
            })));
            state.pasteCursor = null;
            const x = stepToX(placement.start / stepTicks());
            if (x < LABEL_W || x >= wrap.clientWidth) {
                state.scrollX = placement.start / stepTicks() * cellW() - cellW();
                updateScrollbar();
            }
            const pasted = [...state.selection];
            const pitch = pasted[Math.floor(pasted.length / 2)].key;
            const y = rowToY(layer().pitchMax - pitch);
            if (y < HEADER_H || y >= wrap.clientHeight) state.scrollY = (layer().pitchMax - pitch) * ROW_H - wrap.clientHeight / 2;
            scheduleHotReload();
            onEdit?.();
            message(`Pasted ${pasted.length} note(s)`);
        }
        return true;
    };

    const shortcuts = { KeyA: 'all', KeyC: 'copy', KeyX: 'cut', KeyV: 'paste' };
    document.addEventListener('keydown', (e) => {
        const active = document.activeElement;
        if (isComment() || !state.visible || rootEl.inert || pickerEl?.open || document.querySelector('dialog[open], .pr-picker-overlay:not(.hidden), .arr-dialog-overlay') ||
            active?.closest('input, textarea, select, [contenteditable="true"]')) return;
        const action = (e.ctrlKey || e.metaKey) && !e.altKey
            ? shortcuts[e.code] ?? shortcuts[`Key${e.key.toUpperCase()}`]
            : (e.key === 'Delete' || e.key === 'Backspace') && 'delete';
        if (action) {
            if (editNotes(action)) e.preventDefault();
            return;
        }

        // Стрелки — сдвиг выделенного
        if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;
        if (!state.selection.size) return;
        e.preventDefault();
        const dKey  = e.key === 'ArrowUp'   ? +1 : e.key === 'ArrowDown'  ? -1 : 0;
        const dStep = e.key === 'ArrowRight'? +1 : e.key === 'ArrowLeft'  ? -1 : 0;
        const L = layer();
        for (const n of state.selection) {
            n.key  = Math.max(L.pitchMin, Math.min(L.pitchMax, n.key + dKey));
            n.tick = Math.max(0, Math.min(loopTicks() - n.dur, n.tick + Math.round(dStep * snapQuantum(e.altKey))));
        }
        scheduleHotReload();
        onEdit?.();
        dirty = true;
    });
	
	    // ------------------------------------------------------------------
    // Master volume
    // ------------------------------------------------------------------
    bindMasterVolume($('#prMasterVol'), $('#prMasterVolumeValue'));
	
    $('#prBackBtn')?.addEventListener('click', () => {
        stop();
        onBackToArranger?.();
    });
	
    resizeCanvas();
    refreshHeader();
    buildDurButtons();
    loopBtn?.classList.toggle('active', state.loopEnabled);
    frame();

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------
    return {
		root: rootEl,
        getChannel: () => state.channel,
        setChannel(channel, placement) {
            state.channel = channel;
            state.placementId = placement?.id ?? null;
            state.anchorTick = placement?.startTick ?? 0;
        },
        refreshChannelMute,
        refresh() {
            refreshHeader();
            resetViewport();
        },
        editNotes,
        play,
        stop,
        destroy() {
            cancelAnimationFrame(rafId);
            ro.disconnect();
            stop();
            if (hotReloadTimer) clearTimeout(hotReloadTimer);
            canvas.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('wheel', onWheel);
            window.removeEventListener('resize', resizeCanvas);
            pickerEl?.remove();
        },
        setVisible(v) { state.visible = v; },
    };
}
