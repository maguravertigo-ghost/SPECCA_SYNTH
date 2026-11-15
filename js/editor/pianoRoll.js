// js/editor/pianoRoll.js
import { log } from '../core/log.js';
import { writeMIDIFromSequence } from './exportMidi.js';
import { getSynth, getAudioContext, getSequencer, resumeAudio, loadSong, applyChannelMix, setMasterVolume } from '../core/synth.js';

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

const LAYER_DEFS = [
    { id:'drums',   name:'DRUMS',   color:'#888888', channel:9, isDrum:true,  pitchMin:35, pitchMax:81, defaultProgram:0,
      presets:[
        {name:'Standard',   program:0},  {name:'Room',       program:8},
        {name:'Power',      program:16}, {name:'Electronic', program:24},
        {name:'TR-808',     program:25}, {name:'Jazz',       program:32},
        {name:'Brush',      program:40}, {name:'Orchestra',  program:48},
      ]},
    { id:'piano',   name:'PIANO',   color:'#4ec9b0', channel:0, isDrum:false, pitchMin:48, pitchMax:83, defaultProgram:0,
      presets:[
        {name:'Grand Piano',    program:0}, {name:'Bright Piano',   program:1},
        {name:'Electric Piano', program:4}, {name:'Harpsichord',    program:6},
        {name:'Organ',          program:19},{name:'Nylon Guitar',   program:24},
        {name:'Steel Guitar',   program:25},
      ]},
    { id:'bass',    name:'BASS',    color:'#dcdcaa', channel:1, isDrum:false, pitchMin:36, pitchMax:60, defaultProgram:33,
      presets:[
        {name:'Finger Bass',  program:33}, {name:'Picked Bass',  program:34},
        {name:'Slap Bass',    program:36}, {name:'Synth Bass 1', program:38},
        {name:'Synth Bass 2', program:39},
      ]},
    { id:'strings', name:'STRINGS', color:'#c586c0', channel:2, isDrum:false, pitchMin:48, pitchMax:83, defaultProgram:48,
      presets:[
        {name:'String Ensemble', program:48}, {name:'Slow Strings',  program:49},
        {name:'Pizzicato',       program:45}, {name:'Tremolo',       program:44},
        {name:'Viola',           program:41}, {name:'Cello',         program:42},
      ]},
    { id:'brass',   name:'BRASS',   color:'#ce9178', channel:3, isDrum:false, pitchMin:48, pitchMax:83, defaultProgram:61,
      presets:[
        {name:'Brass Section', program:61}, {name:'Trumpet',  program:56},
        {name:'Trombone',      program:57}, {name:'Sax',      program:65},
        {name:'Flute',         program:73}, {name:'Clarinet', program:71},
      ]},
    { id:'fx',      name:'FX',      color:'#569cd6', channel:4, isDrum:false, pitchMin:48, pitchMax:83, defaultProgram:120,
      presets:[
        {name:'FX 1 (Rain)',       program:120}, {name:'FX 2 (Soundtrack)',program:121},
        {name:'FX 3 (Crystal)',    program:122}, {name:'FX 4 (Atmosphere)',program:123},
        {name:'FX 5 (Brightness)', program:124}, {name:'FX 6 (Goblins)',   program:125},
      ]},
];

const DUR_BUTTONS = [
    { label:'1', mult:1 },
    { label:'2', mult:2 },
    { label:'4', mult:4 },
    { label:'8', mult:8 },
];

const HEADER_H = 20;
const LABEL_W  = 64;
const ROW_H    = 20;
const MIN_CELL_W = 18;

export function mountPianoRoll(rootEl, opts = {}) {
    if (!rootEl) return null;

    const {
        getSequence,
        getActivePatternId,
        onNoteChange,
        onRequestNewSequence,
        onBackToArranger,
    } = opts;

    rootEl.innerHTML = `
        <div class="pr-shell">
            <div class="pr-layer-bar" id="prLayerBar"></div>
            <div class="pr-toolbar">
			    <button id="prBackBtn" class="pr-t-btn" type="button" title="Back to Arranger">← Arranger</button>
                <span class="pr-sep"></span>
                <label class="pr-num" title="Master volume">
                    <span>Vol</span>
                    <input id="prMasterVol" type="range" min="0" max="100" value="100" style="width:90px">
                </label>
                <span class="pr-sep"></span>
				<span class="pr-sep"></span>
                <button id="prPlayBtn" class="pr-t-btn" type="button" title="Play">▶</button>
                <button id="prStopBtn" class="pr-t-btn" type="button" title="Stop">⏹</button>
                <button id="prLoopBtn" class="pr-t-btn active" type="button" title="Loop">LOOP</button>
                <button id="prModeBtn" class="pr-t-btn" type="button" title="Track (all layers) / Solo (current)">Track</button>
                <span class="pr-sep"></span>
                <span class="pr-dur-label">Dur:</span>
                <div class="pr-dur-group" id="prDurGroup"></div>
                <span class="pr-sep"></span>
                <button id="prClearBtn" class="btn btn-ghost" type="button" title="Clear current layer">🗑 Clear</button>
            </div>
            <div class="pr-canvas-wrap"><canvas id="prCanvas"></canvas></div>
            <div class="pr-scrollbar hidden" id="prScrollBar">
                <input id="prScrollInput" type="range" min="0" max="1000" value="0" step="1">
            </div>
        </div>
    `;

    const $ = (s) => rootEl.querySelector(s);
    const canvas     = $('#prCanvas');
    const wrap       = canvas.parentElement;
    const layerBar   = $('#prLayerBar');
    const playBtn    = $('#prPlayBtn');
    const stopBtn    = $('#prStopBtn');
    const loopBtn    = $('#prLoopBtn');
    const modeBtn    = $('#prModeBtn');
    const durGroup   = $('#prDurGroup');
    const bpmInput   = $('#prBpm');
    const barsInput  = $('#prBars');
    const stepsInput = $('#prSteps');
    const clearBtn   = $('#prClearBtn');
    const scrollBar  = $('#prScrollBar');
    const scrollInput= $('#prScrollInput');
    const ctx        = canvas.getContext('2d');

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------
    const state = {
        activeLayerIdx: 1,
        activePatternId: null,
        durMult: 1,
        stepsPerBar: 16,
        barsPerLoop: 4,
        playMode: 'track',      // 'track' | 'solo'
        loopEnabled: true,
        tool: 'pencil',          // 'cross' | 'pencil'
        zoom: 1,                // 1 = fit, до 4
        scrollX: 0,
        scrollY: 0,
        selection: new Set(),
        drag: null,
		rect: null,      // {x0, y0, x1, y1, add: boolean}
        playing: false,
    };
    let dpr = Math.max(1, window.devicePixelRatio || 1);
    let dirty = true;
    let rafId = 0;
    let hotReloadTimer = null;

    const getSeq     = () => (typeof getSequence === 'function' ? getSequence() : null);
    const getChannel = () => LAYER_DEFS[state.activeLayerIdx].channel;
    const getLayer   = () => LAYER_DEFS[state.activeLayerIdx];
    const getTimeDiv = () => getSeq()?.timeDivision || 480;
    const stepTicks  = () => Math.max(1, Math.round(getTimeDiv() / 4));
    const durTicks   = () => Math.max(1, stepTicks() * state.durMult);
    const totalSteps = () => state.stepsPerBar * state.barsPerLoop;
    const loopTicks  = () => totalSteps() * stepTicks();

    const getPattern = () => {
        const seq = getSeq();
        if (!seq) return null;
        const id = state.activePatternId ?? getActivePatternId?.() ?? seq.patterns?.[0]?.id;
        return seq.patterns?.find(p => p.id === id) || seq.patterns?.[0] || null;
    };

    const syncPatternLength = () => {
        const seq = getSeq();
        if (!seq) return;
        for (const p of (seq.patterns || [])) p.lengthTicks = loopTicks();
    };

    // ------------------------------------------------------------------
    // Geometry
    // ------------------------------------------------------------------
    const layer   = () => getLayer();
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
        return n > 0 ? Math.max(1, avail / n) : 40;
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

    const tickToX = (tick) => LABEL_W + tick / stepTicks() * cellW() - state.scrollX;
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
        const spb = state.stepsPerBar;

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

            for (let s = 0; s < ts; s++) {
                const barIdx = Math.floor(s / spb);
                const x = stepToX(s);
                if (x + cw < LABEL_W || x > w) continue;
                const shadeBase = isBlack ? 9 : 14;
                const boost = (barIdx % 2 === 0) ? 0 : 8;
                const v = shadeBase + boost;
                ctx.fillStyle = `hsl(240, 5%, ${v}%)`;
                ctx.fillRect(x, y, cw, ROW_H);
            }
        }

        // Grid lines
        ctx.lineWidth = 1;
        for (let s = 0; s <= ts; s++) {
            const x = Math.round(stepToX(s)) + 0.5;
            if (x < LABEL_W || x > w) continue;
            ctx.strokeStyle = (s % spb === 0) ? 'rgba(180,180,200,0.45)' : 'rgba(0,0,0,0.9)';
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
        const layerColor = getLayer().color;
        if (p?.notes) {
            for (const n of p.notes) {
                if (n.track !== chn) continue;
                const row = ps.indexOf(n.key);
                if (row < 0) continue;
                const x = stepToX(n.tick / stepTicks());
                const y = rowToY(row);
                const noteDurSteps = Math.max(1, Math.round(n.dur / stepTicks()));
                const nw = noteDurSteps * cw;
                if (y + ROW_H < HEADER_H || y > h) continue;
                if (x + nw < LABEL_W || x > w) continue;
                const selected = state.selection.has(n);
                ctx.fillStyle = selected ? '#e35b5b' : layerColor;   // красный
                ctx.fillRect(x + 1, y + 1, nw - 2, ROW_H - 2);
                ctx.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.55)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x + 0.5, y + 0.5, nw - 1, ROW_H - 1);
            }
        }

        // Playhead
        const sequencer = getSequencer();
        if (sequencer && !sequencer.paused && !sequencer.isFinished) {
            const dur = sequencer.duration;
            if (dur > 0) {
                const pos = Math.max(0, Math.min(1, sequencer.currentTime / dur));
                const totalW = cw * ts;
                const phX = LABEL_W + pos * totalW - state.scrollX;
                if (phX >= LABEL_W && phX <= w) {
                    ctx.strokeStyle = '#ff4081';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(phX, HEADER_H);
                    ctx.lineTo(phX, h);
                    ctx.stroke();
                    // маленький треугольник сверху
                    ctx.fillStyle = '#ff4081';
                    ctx.beginPath();
                    ctx.moveTo(phX - 5, HEADER_H);
                    ctx.lineTo(phX + 5, HEADER_H);
                    ctx.lineTo(phX, HEADER_H + 8);
                    ctx.fill();
                }
            }
        }
		// Selection rectangle
        if (state.rect) {
            const r = state.rect;
            const x0 = Math.min(r.x0, r.x1), y0 = Math.min(r.y0, r.y1);
            const w  = Math.abs(r.x1 - r.x0), h = Math.abs(r.y1 - r.y0);
            ctx.strokeStyle = '#4a9eff';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(x0 + 0.5, y0 + 0.5, w, h);
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(74,158,255,0.12)';
            ctx.fillRect(x0, y0, w, h);
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
        for (let bar = 0; bar < state.barsPerLoop; bar++) {
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
        // угол
        ctx.fillStyle = '#0a0a10';
        ctx.fillRect(0, 0, LABEL_W, HEADER_H);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.strokeRect(0.5, 0.5, LABEL_W - 1, HEADER_H - 1);
    };

    const frame = () => {
        if (dirty) { dirty = false; draw(); }
        else if (state.playing) draw();   // playhead анимируется
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
            const startStep = Math.round(n.tick / stepTicks());
            const endStep   = startStep + Math.max(1, Math.round(n.dur / stepTicks()));
            if (step >= startStep && step < endStep) return { note: n, startStep, endStep };
        }
        return null;
    };

    const addNote = (step, key) => {
        if (step < 0 || step >= totalSteps()) return null;
        if (findNoteAt(step, key)) return null;
        const seq = getSeq();
        const p = getPattern();
        if (!seq || !p) { onRequestNewSequence?.(); return null; }
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
        syncPatternLength();
        dirty = true;
        if (hotReloadTimer) clearTimeout(hotReloadTimer);
        hotReloadTimer = setTimeout(() => {
            if (state.playing) pushToSequencer(true).catch(err => log(`hot-reload failed: ${err}`, 'error'));
        }, 200);
    };

    const pushToSequencer = async (keepPlaying = false) => {
        const seq = getSeq();
        const sequencer = getSequencer?.();
        if (!seq || !sequencer) return;
        try {
            await resumeAudio();

            // --- сохраняем позицию для live editing ---
            const wasPlaying = !sequencer.paused && !sequencer.isFinished;
            const savedTime  = wasPlaying ? Math.max(0, sequencer.currentTime) : 0;

            const activeChannel = state.playMode === 'solo' ? getChannel() : null;
            const midi = writeMIDIFromSequence(seq, {
                playMode: state.playMode,
                activeChannel,
                useAnchor: true,
                stepsPerBar: state.stepsPerBar,
                barsPerLoop: state.barsPerLoop,
            });
            await loadSong(midi, 'pattern');
			
			applyChannelMix(seq);
			
            sequencer.loopCount = state.loopEnabled ? Infinity : 0;

            if (keepPlaying || state.playing) {
                // возвращаем плейхед на то же место — нота зазвучит в следующем проходе
                if (wasPlaying && savedTime > 0) {
                    try { sequencer.currentTime = savedTime; } catch {}
                }
                sequencer.play();
                state.playing = true;
                playBtn.classList.add('active');
                playBtn.textContent = '❚❚';
            }
        } catch (err) {
            log(`pushToSequencer: ${err}`, 'error');
        }
    };

    const play = async () => {
        const seq = getSeq();
        if (!seq) { onRequestNewSequence?.(); return; }
        try {
            await pushToSequencer(true);
            if (!state.playing) {
                // если pushToSequencer не запустил (пустой паттерн) — всё равно жмём play
                getSequencer()?.play();
                state.playing = true;
                playBtn.classList.add('active');
                playBtn.textContent = '❚❚';
            }
        } catch (err) {
            log(`play: ${err}`, 'error');
        }
    };

    const stop = () => {
        const sequencer = getSequencer?.();
        if (sequencer) {
            try { sequencer.pause(); sequencer.currentTime = 0; } catch {}
        }
        state.playing = false;
        playBtn.classList.remove('active');
        playBtn.textContent = '▶';
        dirty = true;
    };

    const togglePlay = async () => {
        if (state.playing) {
            stop();
        } else {
            await play();
        }
    };

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
        const found = findNoteAt(step, key);
        if (!found) return { key, step, note: null, row };

        // resize hit: правый край
        const endX = stepToX(found.endStep);
        const rightEdge = endX - 4;
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
        if (mx < LABEL_W || my < HEADER_H) return;

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
            const dxSteps = Math.round((mx - d.startX) / cellW());
            const dyPitch = -Math.round((my - d.startY) / ROW_H);

            let minTick = Infinity, maxEndTick = -Infinity, minKey = Infinity, maxKey = -Infinity;
            for (const o of d.orig) {
                minTick    = Math.min(minTick, o.tick);
                maxEndTick = Math.max(maxEndTick, o.tick + o.note.dur);
                minKey     = Math.min(minKey, o.key);
                maxKey     = Math.max(maxKey, o.key);
            }
            const ts = totalSteps();
            const minStep = Math.floor(minTick / stepT);
            const maxStep = Math.floor(maxEndTick / stepT);
            const dxClamp = Math.max(-minStep, Math.min(ts - maxStep, dxSteps));
            const dyClamp = Math.max(L.pitchMin - minKey, Math.min(L.pitchMax - maxKey, dyPitch));

            for (const o of d.orig) {
                o.note.tick = o.tick + dxClamp * stepT;
                o.note.key  = o.key  + dyClamp;
            }
            d.moved = true;
            dirty = true;
            return;
        }

        // Resize
        if (d.mode === 'resize') {
            const step = xToStep(mx);
            const startStep = Math.round(d.note.tick / stepTicks());
            const newDurSteps = Math.max(1, Math.min(totalSteps() - startStep, step - startStep + 1));
            d.note.dur = newDurSteps * stepTicks();
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
    // Layer bar
    // ------------------------------------------------------------------
    const buildLayerBar = () => {
        layerBar.innerHTML = '';
        LAYER_DEFS.forEach((def, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pr-layer-btn' + (idx === state.activeLayerIdx ? ' active' : '');
            btn.style.background = def.color;
            btn.dataset.idx = idx;
            btn.textContent = def.name;
            let pressTimer = null, longPressed = false;
            btn.addEventListener('pointerdown', () => {
                longPressed = false;
                pressTimer = setTimeout(() => { longPressed = true; openPresetPicker(idx); }, 500);
            });
            const clear = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
            btn.addEventListener('pointerup', () => { clear(); if (!longPressed) selectLayer(idx); });
            btn.addEventListener('pointerleave', clear);
            btn.addEventListener('pointercancel', clear);
            btn.addEventListener('contextmenu', (e) => { e.preventDefault(); openPresetPicker(idx); });
            layerBar.appendChild(btn);
        });
    };
    const refreshLayerBar = () => {
        [...layerBar.children].forEach((b, i) => b.classList.toggle('active', i === state.activeLayerIdx));
    };
    const selectLayer = (idx) => {
        state.activeLayerIdx = idx;
        state.selection.clear();
        state.scrollX = 0;
        refreshLayerBar();
        updateScrollbar();
        dirty = true;
    };

    // ------------------------------------------------------------------
    // Preset picker
    // ------------------------------------------------------------------
    let pickerEl = null;
    const openPresetPicker = (idx) => {
        const seq = getSeq();
        if (!seq) return;
        const def = LAYER_DEFS[idx];
        const ch = seq.channels?.find(c => c.channel === def.channel);
        if (!ch) return;

        if (!pickerEl) {
            pickerEl = document.createElement('div');
            pickerEl.className = 'pr-picker-overlay hidden';
            pickerEl.innerHTML = `
                <div class="pr-picker-box">
                    <div class="pr-picker-title" id="prPickerTitle"></div>
                    <div class="pr-picker-list" id="prPickerList"></div>
                    <button class="btn btn-primary pr-picker-close" id="prPickerClose" type="button">Cancel</button>
                </div>
            `;
            document.body.appendChild(pickerEl);
            pickerEl.addEventListener('click', (e) => { if (e.target === pickerEl) pickerEl.classList.add('hidden'); });
            pickerEl.querySelector('#prPickerClose').addEventListener('click', () => pickerEl.classList.add('hidden'));
        }
        pickerEl.querySelector('#prPickerTitle').textContent = `${def.name}: instrument`;
        const list = pickerEl.querySelector('#prPickerList');
        list.innerHTML = '';
        def.presets.forEach(p => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'pr-picker-item' + (ch.program === p.program ? ' active' : '');
            item.textContent = `${p.name} (${p.program})`;
            item.addEventListener('click', () => {
                ch.program = p.program;
                pickerEl.classList.add('hidden');
                scheduleHotReload();
            });
            list.appendChild(item);
        });
        pickerEl.classList.remove('hidden');
    };

    // ------------------------------------------------------------------
    // Dur buttons
    // ------------------------------------------------------------------
    const buildDurButtons = () => {
        durGroup.innerHTML = '';
        DUR_BUTTONS.forEach(d => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'pr-dur-btn' + (d.mult === state.durMult ? ' active' : '');
            b.dataset.mult = d.mult;
            b.textContent = d.label;
            b.addEventListener('click', () => {
                state.durMult = d.mult;
                [...durGroup.children].forEach(x => x.classList.toggle('active', Number(x.dataset.mult) === state.durMult));
            });
            durGroup.appendChild(b);
        });
    };

    // ------------------------------------------------------------------
    // UI wiring
    // ------------------------------------------------------------------

    playBtn?.addEventListener('click', togglePlay);
    stopBtn?.addEventListener('click', stop);
    loopBtn?.addEventListener('click', () => {
        state.loopEnabled = !state.loopEnabled;
        loopBtn.classList.toggle('active', state.loopEnabled);
        const sequencer = getSequencer?.();
        if (sequencer) sequencer.loopCount = state.loopEnabled ? Infinity : 0;
    });
    modeBtn?.addEventListener('click', () => {
        state.playMode = state.playMode === 'track' ? 'solo' : 'track';
        modeBtn.textContent = state.playMode === 'track' ? 'Track' : 'Solo';
        modeBtn.classList.toggle('active', state.playMode === 'solo');
        if (state.playing) scheduleHotReload();
    });
    bpmInput?.addEventListener('change', () => {
        const seq = getSeq();
        if (!seq) return;
        const bpm = Math.max(40, Math.min(200, Number(bpmInput.value) || 120));
        bpmInput.value = String(bpm);
        seq.tempo = bpm;
        scheduleHotReload();
    });
    barsInput?.addEventListener('change', () => {
        state.barsPerLoop = Math.max(1, Math.min(32, Number(barsInput.value) || 4));
        barsInput.value = String(state.barsPerLoop);
        syncPatternLength();
        state.scrollX = 0;
        updateScrollbar();
        scheduleHotReload();
    });
    stepsInput?.addEventListener('change', () => {
        state.stepsPerBar = Math.max(1, Math.min(16, Number(stepsInput.value) || 4));
        stepsInput.value = String(state.stepsPerBar);
        syncPatternLength();
        state.scrollX = 0;
        updateScrollbar();
        scheduleHotReload();
    });
    clearBtn?.addEventListener('click', () => {
        const p = getPattern();
        if (!p?.notes) return;
        const chn = getChannel();
        p.notes = p.notes.filter(n => n.track !== chn);
        state.selection.clear();
        scheduleHotReload();
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

    // подписываемся на stop извне (sequencer сам закончился)
    const seqRef = getSequencer?.();
    if (seqRef?.eventHandler) {
        seqRef.eventHandler.addEvent('songEnded', 'ui', () => {
            state.playing = false;
            playBtn?.classList.remove('active');
            if (playBtn) playBtn.textContent = '▶';
        });
    }

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------
	    // ------------------------------------------------------------------
    // Keyboard: arrows / CTRL+A / DEL / CTRL+C / CTRL+V
    // ------------------------------------------------------------------
    const isTypingTarget = (el) => el && ['INPUT','TEXTAREA','SELECT'].includes(el.tagName);

    document.addEventListener('keydown', (e) => {
        if (isTypingTarget(document.activeElement)) return;
        const p = getPattern();
        if (!p) return;
        const chn = getChannel();

        // CTRL+A — выделить всё в слое
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            state.selection.clear();
            for (const n of p.notes) if (n.track === chn) state.selection.add(n);
            dirty = true;
            return;
        }

        // CTRL+X — cut
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x' && state.selection.size) {
            e.preventDefault();
            window.__prClipboard = Array.from(state.selection).map(n => ({ ...n }));
            p.notes = p.notes.filter(n => !state.selection.has(n));
            const count = state.selection.size;
            state.selection.clear();
            scheduleHotReload();
            dirty = true;
            log(`Cut ${count} notes`);
            return;
        }

        // CTRL+C — copy
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && state.selection.size) {
            e.preventDefault();
            window.__prClipboard = Array.from(state.selection).map(n => ({ ...n }));
            log(`Copied ${state.selection.size} notes`);
            return;
        }

        // CTRL+V — paste at EXACT positions, select the pasted notes
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && window.__prClipboard?.length) {
            e.preventDefault();
            const pasted = [];
            for (const n of window.__prClipboard) {
                const copy = { ...n, track: chn };
                p.notes.push(copy);
                pasted.push(copy);
            }
            state.selection.clear();
            for (const n of pasted) state.selection.add(n);
            scheduleHotReload();
            dirty = true;
            log(`Pasted ${pasted.length} notes (selected — move with arrows)`);
            return;
        }

        // DEL / Backspace — удалить
        if ((e.key === 'Delete' || e.key === 'Backspace') && state.selection.size) {
            e.preventDefault();
            p.notes = p.notes.filter(n => !state.selection.has(n));
            state.selection.clear();
            scheduleHotReload();
            dirty = true;
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
            n.tick = Math.max(0, Math.min(loopTicks() - n.dur, n.tick + dStep * stepTicks()));
        }
        scheduleHotReload();
        dirty = true;
    });
	
	    // ------------------------------------------------------------------
    // Mixer overlay (channel mute + volume) + master volume
    // ------------------------------------------------------------------
    let mixerEl = null;
    const openMixer = () => {
        const seq = getSeq();
        if (!seq) return;
        if (!mixerEl) {
            mixerEl = document.createElement('div');
            mixerEl.className = 'pr-picker-overlay hidden';
            mixerEl.innerHTML = `
                <div class="pr-picker-box" style="width:min(480px,100%)">
                    <div class="pr-picker-title">Mixer</div>
                    <div class="pr-picker-list" id="prMixerList" style="padding:8px 12px"></div>
                    <button class="btn btn-primary pr-picker-close" id="prMixerClose" type="button">Close</button>
                </div>`;
            document.body.appendChild(mixerEl);
            mixerEl.addEventListener('click', e => { if (e.target === mixerEl) mixerEl.classList.add('hidden'); });
            mixerEl.querySelector('#prMixerClose').addEventListener('click', () => mixerEl.classList.add('hidden'));
        }
        const list = mixerEl.querySelector('#prMixerList');
        list.innerHTML = '';
        LAYER_DEFS.forEach(def => {
            const ch = seq.channels?.find(c => c.channel === def.channel);
            if (!ch) return;
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)';

            const dot = document.createElement('span');
            dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${def.color};flex-shrink:0`;
            row.appendChild(dot);

            const name = document.createElement('span');
            name.textContent = def.name;
            name.style.cssText = 'flex:1;font-size:12px;font-weight:600';
            row.appendChild(name);

            const mute = document.createElement('button');
            mute.type = 'button';
            mute.textContent = ch.muted ? '◯' : '●';
            mute.title = 'Mute';
            mute.style.cssText = `background:${ch.muted?'transparent':'#1a7f37'};color:${ch.muted?'#666':'#fff'};border:1px solid ${ch.muted?'#666':'#1a7f37'};width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:12px;line-height:1;padding:0`;
            mute.addEventListener('click', () => {
                ch.muted = !ch.muted;
                mute.textContent = ch.muted ? '◯' : '●';
                mute.style.cssText = `background:${ch.muted?'transparent':'#1a7f37'};color:${ch.muted?'#666':'#fff'};border:1px solid ${ch.muted?'#666':'#1a7f37'};width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:12px;line-height:1;padding:0`;
                applyChannelMix(getSeq());
            });
            row.appendChild(mute);

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = 0; slider.max = 100;
            slider.value = String(ch.volume ?? 100);
            slider.style.cssText = 'width:120px';
            row.appendChild(slider);

            const val = document.createElement('span');
            val.textContent = String(ch.volume ?? 100);
            val.style.cssText = 'font-family:var(--mono);font-size:11px;color:var(--text-mut);width:30px;text-align:right';
            row.appendChild(val);

            slider.addEventListener('input', () => {
                ch.volume = Number(slider.value);
                val.textContent = String(ch.volume);
                applyChannelMix(getSeq());
            });
            list.appendChild(row);
        });
        mixerEl.classList.remove('hidden');
    };

    $('#prMasterVol')?.addEventListener('input', (e) => {
        setMasterVolume(Number(e.target.value) / 100);
    });
	
    $('#prBackBtn')?.addEventListener('click', () => {
        stop();
        onBackToArranger?.();
    });
	
    resizeCanvas();
    buildLayerBar();
    buildDurButtons();
    if (bpmInput)   bpmInput.value   = String(getSeq()?.tempo || 120);
    if (barsInput)  barsInput.value  = String(state.barsPerLoop);
    if (stepsInput) stepsInput.value = String(state.stepsPerBar);
    loopBtn?.classList.toggle('active', state.loopEnabled);
    syncPatternLength();
    frame();

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------
    return {
		root: rootEl,
        openMixer: () => openMixer(),
        setActivePattern(pid) {
            const seq = getSeq();
            if (!seq?.patterns?.find(p => p.id === pid)) return;
            state.activePatternId = pid;
            const pat = seq.patterns.find(p => p.id === pid);
            if (pat?.channel !== undefined) {
                const idx = LAYER_DEFS.findIndex(d => d.channel === pat.channel);
                if (idx >= 0) state.activeLayerIdx = idx;
            }
            state.selection.clear();
            state.scrollX = 0;
            refreshLayerBar();
            updateScrollbar();
            dirty = true;
        },
        refresh() {
            state.selection.clear();
            if (bpmInput) bpmInput.value = String(getSeq()?.tempo || 120);

            // Автоподгонка количества баров под паттерн (для MIDI-импорта)
            const p = getPattern();
            if (p && p.lengthTicks > 0) {
                const ticksPerBar = stepTicks() * state.stepsPerBar;
                const bars = Math.ceil(p.lengthTicks / ticksPerBar);
                state.barsPerLoop = Math.min(32, Math.max(4, bars));
                state.scrollX = 0;
            }
            syncPatternLength();
            updateScrollbar();
            dirty = true;
        },
        getSelection: () => Array.from(state.selection),
        deleteSelection() {
            const p = getPattern();
            if (!p?.notes) return;
            p.notes = p.notes.filter(n => !state.selection.has(n));
            state.selection.clear();
            scheduleHotReload();
        },
        copySelection: () => Array.from(state.selection).map(n => ({ ...n })),
        pasteNotes(clipboard, atTick = null) {
            const p = getPattern();
            if (!p || !clipboard?.length) return;
            const minTick = Math.min(...clipboard.map(n => n.tick));
            const offset = atTick ?? minTick;
            clipboard.forEach(n => {
                p.notes.push({ ...n, tick: n.tick - minTick + offset, track: getChannel() });
            });
            scheduleHotReload();
        },
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
		setGrid({ bars, steps }) {
            if (bars)  { state.barsPerLoop  = Math.max(1, Math.min(32, bars)); }
            if (steps) { state.stepsPerBar  = Math.max(1, Math.min(16, steps)); }
            syncPatternLength();
            state.scrollX = 0;
            updateScrollbar();
            dirty = true;
        },
		setLayer(idx) {
            if (idx < 0 || idx >= LAYER_DEFS.length) return;
            state.activeLayerIdx = idx;
            state.selection.clear();
            state.scrollX = 0;
            refreshLayerBar();
            updateScrollbar();
            dirty = true;
        },
        setVisible(v) { /* no-op, visibility handled by CSS */ },
    };
}