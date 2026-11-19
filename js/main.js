// js/main.js
import { log, setStatus, wireGlobalErrorHandlers } from './core/log.js';
import { initSynth, getAudioContext, getSequencer, getOutputLevel, getMasterVolume, getSynth } from './core/synth.js';
import { Playlist } from './playlist.js';
import { mountMenubar } from './ui/menubar.js';
import { mountPlayerOverlay } from './ui/playerOverlay.js';
import { mountPianoRoll } from './editor/pianoRoll.js';
import { importMidi } from './editor/importMidi.js';
import { adaptToSoundfont } from './editor/instruments.js';
import { writeArrangementMIDI } from './editor/exportMidi.js';
import { Sequence } from './editor/sequence.js';
import { openProjectSettings } from './ui/projectSettings.js';
import { mountArranger } from './ui/arrangerView.js';

wireGlobalErrorHandlers();
// ---------------- Log toggle / copy ----------------
const logPanel     = document.getElementById('logPanel');
const toggleLogBtn = document.getElementById('toggleLogBtn');
const copyLogBtn   = document.getElementById('copyBtn');

toggleLogBtn?.addEventListener('click', () => {
    logPanel?.classList.toggle('collapsed');
    // через кадр пересчитать размеры piano roll (canvas)
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
});
copyLogBtn?.addEventListener('click', () => {
    const text = Array.from(document.querySelectorAll('#logBox span'))
        .map(s => s.textContent).join('');
    navigator.clipboard.writeText(text)
        .then(() => log('Log copied to clipboard'))
        .catch(err => log(`Copy failed: ${err}`, 'error'));
});

// ---------------- Playlist ----------------
const playlist = new Playlist();
// ---------------- Editor state ----------------
let pianoRoll = null;
let currentSequence = null;
let lastLoadedName = null;
const selectedPatterns = new Map();
const getChannelPattern = (channel) => {
    const selected = currentSequence?.getPattern(selectedPatterns.get(channel));
    return selected && selected.channel === channel ? selected : currentSequence?.getChannelPattern(channel);
};

const createEmptySequence = () => {
    const seq = Sequence.create();
    seq.name = 'Untitled';
    seq.tempo = 120;
    seq.timeDivision = 480;
    const defaultPrograms = {
        0:  0,    // Piano (Acoustic Grand)
        1:  33,   // Bass (Finger)
        2:  48,   // Strings (Ensemble)
        3:  61,   // Brass (Section)
        4:  120,  // FX (Rain)
        9:  0,    // Drums
    };
    seq.channels = [];
    for (let ch = 0; ch < 16; ch++) {
        seq.channels.push({
            channel: ch,
            program: defaultPrograms[ch] ?? 0,
            isDrum: ch === 9,
            volume: 100,
            pan: 64,
            muted: false,
        });
    }
    return seq;
};

function useSequence(sequence, name = null) {
    currentSequence = sequence;
    lastLoadedName = name;
    selectedPatterns.clear();
    pianoRoll?.setChannel(null);
    arrangerView?.reset();
    showArranger();
}

function openMidiBuffer(buffer, name) {
    const sequence = importMidi(buffer, name);
    const substitutes = adaptToSoundfont(sequence, getSynth()?.soundBankManager.presetList);
    useSequence(sequence, name);
    const totalNotes = sequence.arrangement.reduce((count, clip) => count + (sequence.getPattern(clip.patternId)?.notes.length ?? 0), 0);
    if (substitutes) log(`MIDI import: ${substitutes} unavailable instrument(s) replaced with SoundFont presets.`, 'warn');
    log(`main: imported "${name}" — ${totalNotes} notes, ${sequence.patterns.length} patterns @ ${Number(sequence.tempo.toFixed(2))} BPM`);
    setStatus(totalNotes ? `Loaded: ${name}${substitutes ? ` · ${substitutes} sound fallback(s)` : ''}` : `No editable notes: ${name}`);
}

async function bootAudio() {
    setStatus('Loading soundfont…');
    const initBar  = document.getElementById('initBar');
    const initFill = document.getElementById('initFill');
    if (initBar) initBar.style.display = 'block';

    await initSynth({
        onProgress: (p) => {
            if (initFill) initFill.style.width = `${Math.round(p * 100)}%`;
        },
    });

    const ctx = getAudioContext();
    if (!ctx) throw new Error('AudioContext unavailable');

    setStatus('Ready');
    const meters = [...document.querySelectorAll('.audio-meter')];
    let level = 0;
    setInterval(() => {
        level = Math.max(getOutputLevel(), level * 0.75);
        const description = getMasterVolume() === 0 ? 'Master volume is zero'
            : ctx.state !== 'running' ? `Audio output is ${ctx.state}. Click Play to resume.`
            : `Audio output · ${ctx.sampleRate / 1000} kHz`;
        for (const meter of meters) {
            meter.value = Math.min(1, Math.sqrt(level));
            meter.title = description;
        }
    }, 80);
    if (initBar) initBar.style.display = 'none';
	
	refreshAll();
	document.getElementById('logPanel')?.classList.add('collapsed');
	requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

// ---------------- Piano roll ----------------
// ---------------- Views ----------------
const editorRoot   = document.getElementById('editorRoot');
const arrangerRoot = document.getElementById('arrangerRoot');

let arrangerView = null;

function stopAllPlayback() {
    try {
        const seq = getSequencer?.();
        if (seq) { seq.pause(); seq.currentTime = 0; }
    } catch {}
}

const showArranger = () => {
    pianoRoll?.stop();
    stopAllPlayback();
    if (arrangerRoot) arrangerRoot.style.display = 'flex';
    if (editorRoot)   editorRoot.style.display = 'none';
    arrangerView?.setVisible?.(true);
    pianoRoll?.setVisible?.(false);
    arrangerView?.refresh();
};

const showPianoRoll = () => {
    stopAllPlayback();
    if (arrangerRoot) arrangerRoot.style.display = 'none';
    if (editorRoot)   editorRoot.style.display = 'flex';
    arrangerView?.setVisible?.(false);
    pianoRoll?.setVisible?.(true);
    pianoRoll?.refresh();
};

function refreshAll() {
    pianoRoll?.refresh?.();
    arrangerView?.refresh?.();
}

// Piano roll
if (editorRoot) {
    pianoRoll = mountPianoRoll(editorRoot, {
        getSequence:          () => currentSequence,
        getChannelPattern,
        onPatternSelect: (channel, id) => selectedPatterns.set(channel, id),
        onInstrumentChange: () => arrangerView?.refresh(),
        onBackToArranger:     () => showArranger(),
    });
}
if (arrangerRoot) {
    arrangerView = mountArranger(arrangerRoot, {
        getSequence: () => currentSequence,
        getChannelPattern,
        onSelectPattern: (channel, id) => selectedPatterns.set(channel, id),
        onOpenChannel: (channel) => {
            currentSequence.ensureChannelPattern(channel);
            pianoRoll?.setChannel(channel);
            showPianoRoll();
        },
    });
}
// Default view: arranger
useSequence(createEmptySequence());

// ---------------- Local project save/load ----------------
const STORAGE_KEY = 'spessa_projects_v1';
const readProjects = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
};
const writeProjects = (obj) => localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));

const saveProjectToLocal = () => {
    const seq = currentSequence;
    if (!seq) { log('Save: nothing to save', 'warn'); return; }
    const name = prompt('Project name:', lastLoadedName || seq.name);
    if (!name) return;
    const projects = readProjects();
    const entry = {
        seq: JSON.parse(seq.toJSON()),
        timestamp: Date.now(),
    };
    writeProjects({ ...projects, [name]: entry });
    log(`main: project saved "${name}"`);
    setStatus(`Saved: ${name}`);
};

const openProjectDialog = () => {
    const projects = readProjects();
    const names = Object.keys(projects);
    if (!names.length) { log('Open: no saved projects', 'warn'); return; }

    const overlay = document.createElement('div');
    overlay.className = 'pr-picker-overlay';
    overlay.innerHTML = `
        <div class="pr-picker-box">
            <div class="pr-picker-title">Open Project</div>
            <div class="pr-picker-list" id="projList"></div>
            <button class="btn btn-primary pr-picker-close" id="projCancel" type="button">Cancel</button>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#projCancel').addEventListener('click', () => overlay.remove());

    const list = overlay.querySelector('#projList');
    names.forEach((n) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'pr-picker-item';
        item.textContent = n;
        item.addEventListener('click', () => {
            try {
                useSequence(Sequence.fromJSON(projects[n].seq), n);
            } catch (err) {
                log(`Open project failed: ${err}`, 'error');
                setStatus('Load failed');
                return;
            }
            overlay.remove();
            log(`main: project loaded "${n}"`);
            setStatus(`Loaded: ${n}`);
        });
        list.appendChild(item);
    });
};

// ---------------- Menubar ----------------
const menubar = mountMenubar({
    new: () => {
        openProjectSettings({
            title: 'New Project',
            initial: { name: 'Untitled', bpm: 120, bars: 4, steps: 16 },
            onApply: ({ name, bpm, bars, steps }) => {
                const seq = createEmptySequence();
                seq.name = name;
                seq.tempo = bpm;
                seq.stepsPerBar = steps;
                seq.patternLengthTicks = Math.round(seq.timeDivision / 4) * steps * bars;
                useSequence(seq);
                setStatus(`New project: ${name}`);
                log(`main: new project "${name}" ${bpm}BPM ${bars}bars × ${steps}steps`);
            },
        });
    },
    openProject: openProjectDialog,
    open: () => document.getElementById('openMidiInput')?.click(),

    save: saveProjectToLocal,
    saveAs: () => {
        log('Menu: Save As MIDI…');
        if (!currentSequence) { log('Save As: nothing to save', 'warn'); return; }
        try {
            const midiBuf = writeArrangementMIDI(currentSequence);
            const blob = new Blob([midiBuf], { type: 'audio/midi' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const base = lastLoadedName || currentSequence.name || 'untitled';
            a.download = base.endsWith('.mid') ? base : `${base}.mid`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            log(`Menu: saved ${a.download} (${midiBuf.byteLength} bytes)`);
        } catch (err) {
            log(`Save As failed: ${err}`, 'error');
        }
    },

    undo: () => log('Menu: Undo (TODO)'),
    redo: () => log('Menu: Redo (TODO)'),
    cut: () => pianoRoll?.editNotes('cut'),
    copy: () => pianoRoll?.editNotes('copy'),
    paste: () => pianoRoll?.editNotes('paste'),
    del: () => pianoRoll?.editNotes('delete'),

    mixer: () => pianoRoll?.openMixer?.(),
    openPlayer: () => playerOverlay?.open(),
    savePlaylist: () => {
        const items = (playlist.items || []).map(i => ({ name: i.name }));
        const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'playlist.json';
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        log('Menu: playlist saved');
    },
    clearPlaylist: () => {
        playerOverlay?.clear();
        log('Menu: playlist cleared');
    },
	projectSettings: () => {
        const seq = currentSequence;
        openProjectSettings({
            title: 'Project Settings',
            initial: {
                name:  seq?.name  || 'Untitled',
                bpm:   Math.round(seq?.tempo || 120),
                bars: Math.max(1, Math.round(seq.patternLengthTicks / (Math.round(seq.timeDivision / 4) * seq.stepsPerBar))),
                steps: seq.stepsPerBar,
            },
            onApply: ({ name, bpm, bars, steps }) => {
                if (!seq) return;
                seq.name  = name;
                seq.tempo = bpm;
                seq.stepsPerBar = steps;
                seq.patternLengthTicks = Math.round(seq.timeDivision / 4) * steps * bars;
                refreshAll();
                setStatus(`Settings updated: ${bpm}BPM ${bars}×${steps}`);
            },
        });
    },
});

const midiInput = document.getElementById('openMidiInput');
midiInput?.addEventListener('change', async () => {
    const file = midiInput.files?.[0];
    midiInput.value = '';
    if (!file) return;
    try { openMidiBuffer(await file.arrayBuffer(), file.name); }
    catch (err) {
        log(`import failed: ${err}`, 'error');
        setStatus('Load failed');
    }
});

// ---------------- Player overlay ----------------
const playerOverlay = mountPlayerOverlay({
    playlist,
    onOpen: () => {
        pianoRoll?.stop();
        arrangerView?.stop();
        editorRoot.inert = arrangerRoot.inert = document.querySelector('.menubar').inert = true;
    },
    onClose: () => { editorRoot.inert = arrangerRoot.inert = document.querySelector('.menubar').inert = false; },
});

// ---------------- Init UI ----------------
await playlist.load();

bootAudio().catch(err => {
    document.getElementById('audioUnlock')?.classList.add('hidden');
    document.getElementById('initBar')?.style.setProperty('display', 'none');
    log(`Audio unavailable: ${err}`, 'error');
    setStatus('Audio unavailable');
});

log('main: shell ready');

// js/main.js — в самом конце
const srSelect = document.getElementById('sampleRateSelect');
if (srSelect) {
    const saved = localStorage.getItem('midi-player.sampleRate') || 'auto';
    srSelect.value = saved;
    srSelect.addEventListener('change', () => {
        localStorage.setItem('midi-player.sampleRate', srSelect.value);
        const ctx = getAudioContext();
        if (ctx) {
            log(`Sample rate изменён на ${srSelect.value}. Перезагрузите страницу для применения.`, 'warn');
            const status = document.getElementById('status');
            if (status) status.textContent = `SR ${srSelect.value} — reload needed`;
        }
    });
}