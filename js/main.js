// js/main.js
import { log, setStatus, wireGlobalErrorHandlers } from './core/log.js';
import { initSynth, onAudioStatus, selectLocalSoundFont, applyChannelVolume, getAudioContext, getSequencer, getOutputLevel, getMasterVolume, getSynth } from './core/synth.js';
import { Playlist } from './playlist.js';
import { mountMenubar } from './ui/menubar.js';
import { mountPlayerOverlay } from './ui/playerOverlay.js';
import { mountPianoRoll } from './editor/pianoRoll.js';
import { importMidi } from './editor/importMidi.js';
import { adaptToSoundfont } from './editor/instruments.js';
import { writeArrangementMIDI } from './editor/exportMidi.js';
import { askName, confirmAction } from './ui/dialogs.js';
import { openTrackGenerator } from './ui/trackGeneratorDialog.js';
import { openMixer } from './ui/mixer.js';
import { createEditHistory } from './editor/history.js';
import { Sequence } from './editor/sequence.js';
import { openProjectSettings } from './ui/projectSettings.js';
import { mountArranger } from './ui/arrangerView.js';

wireGlobalErrorHandlers();
// Keep the OS context menu out of the studio, but preserve it for real text editing.
document.addEventListener('contextmenu', event => {
    if (!event.target.closest?.('input[type="text"], input[type="number"], textarea, [contenteditable="true"]')) event.preventDefault();
});
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
const history = createEditHistory();
let menubar;
const syncHistory = () => {
    menubar?.setEnabled('undo', history.canUndo);
    menubar?.setEnabled('redo', history.canRedo);
};
const commitEdit = () => {
    if (currentSequence && history.commit(currentSequence.toJSON(0))) syncHistory();
};
function restoreEdit(action) {
    const snapshot = history[action]();
    if (!snapshot) return;
    arrangerView?.stop(); pianoRoll?.stop();
    currentSequence = Sequence.fromJSON(snapshot);
    const channel = pianoRoll?.getChannel();
    if (channel != null && !currentSequence.channels.some(c => c.channel === channel)) showArranger();
    refreshAll(); syncHistory();
}
const showProjectMixer = () => openMixer({ title: 'Project mixer',
    channels: currentSequence.channels.filter(c => c.created !== false && c.kind !== 'comment').sort((a,b) => a.channel - b.channel),
    onChange: channel => { applyChannelVolume(channel); arrangerView?.refresh(); }, onCommit: commitEdit,
});
const selectedPatterns = new Map();
const getChannelPattern = (channel) => {
    const selected = currentSequence?.getPattern(selectedPatterns.get(channel));
    return selected && selected.channel === channel ? selected : currentSequence?.getChannelPattern(channel);
};

const createEmptySequence = () => new Sequence({
    name: 'Untitled', tempo: 120, timeDivision: 480,
    channels: [{ channel: 9, name: 'Drums', program: 0, isDrum: true, volume: 100, pan: 64, muted: false }],
});

function refreshProjectTempo() {
    const output = document.getElementById('projectBpm');
    const tempo = currentSequence?.tempo;
    output.value = Number.isFinite(tempo) ? String(Number(tempo.toFixed(2))) : '–';
}

function useSequence(sequence, name = null, { keepHistory = false } = {}) {
    arrangerView?.stop();
    currentSequence = sequence;
    refreshProjectTempo();
    if (keepHistory) history.commit(sequence.toJSON(0));
    else history.reset(sequence.toJSON(0));
    syncHistory();
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

function mountAudioStatus() {
    const button = document.getElementById('audioUnlock');
    const statuses = [document.getElementById('audioState'), document.getElementById('ptAudioState')];
    const picker = document.getElementById('soundFontChoice');
    const startupFont = document.getElementById('startupSoundFont');
    const useLocal = document.getElementById('chooseStartupFont');
    startupFont.addEventListener('change', () => { useLocal.disabled = !startupFont.files.length; });
    const start = () => { picker.close(); initSynth().catch(() => {}); };
    const useBundled = document.getElementById('chooseBundledFont');
    if (location.hostname.endsWith('github.io')) useBundled.textContent = 'Load from GitHub Pages';
    useBundled.addEventListener('click', start);
    useLocal.addEventListener('click', () => {
        const file = startupFont.files?.[0];
        if (file && selectLocalSoundFont(file)) start();
    });
    picker.showModal();
    const fontInput = document.getElementById('localSoundFont');
    const fontButtons = [...document.querySelectorAll('[data-local-soundfont]')];
    for (const choose of fontButtons) choose.addEventListener('click', () => fontInput.click());
    fontInput.addEventListener('change', () => {
        const file = fontInput.files?.[0];
        fontInput.value = '';
        if (file) selectLocalSoundFont(file);
    });
    button.addEventListener('click', () => initSynth().catch(() => {}));
    onAudioStatus(({ state, message, progress, canSelectFont = true }) => {
        for (const status of statuses) {
            status.setAttribute('aria-live', progress?.loaded ? 'off' : 'polite');
            status.textContent = status.title = message;
            status.dataset.state = state;
        }
        for (const choose of fontButtons) {
            choose.disabled = !canSelectFont;
            choose.hidden = state === 'ready';
        }
        for (const bar of document.querySelectorAll('[data-font-progress]')) {
            bar.hidden = progress?.loaded == null;
            if (progress?.total > 0) { bar.max = progress.total; bar.value = progress.loaded; }
            else bar.removeAttribute('value');
        }
        button.disabled = state === 'loading';
        button.hidden = state === 'ready';
        button.textContent = state === 'error' ? 'Retry audio' : 'Enable audio';
        if (state !== 'idle' && !progress?.loaded) log(`Audio: ${message}`, state === 'error' ? 'error' : 'info');
        if (state === 'ready') refreshAll();
    });

    const meters = [...document.querySelectorAll('.audio-meter')];
    let level = 0;
    setInterval(() => {
        level = Math.max(getOutputLevel(), level * 0.75);
        const context = getAudioContext();
        const description = getMasterVolume() === 0 ? 'Master volume is zero'
            : !context ? statuses[0].textContent
            : context.state !== 'running' ? `Audio output is ${context.state}. Click Play to resume.`
            : `Audio output · ${context.sampleRate / 1000} kHz`;
        for (const meter of meters) {
            meter.value = Math.min(1, Math.sqrt(level));
            meter.title = description;
        }
    }, 80);
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
    refreshProjectTempo();
    pianoRoll?.refresh?.();
    arrangerView?.refresh?.();
}

// Piano roll
if (editorRoot) {
    pianoRoll = mountPianoRoll(editorRoot, {
        getSequence:          () => currentSequence,
        getChannelPattern,
        onPatternSelect: (channel, id) => selectedPatterns.set(channel, id),
        onEdit: commitEdit,
        onMixer: showProjectMixer,
        onInstrumentChange: () => arrangerView?.refresh(),
        onBackToArranger:     () => showArranger(),
    });
}
if (arrangerRoot) {
    arrangerView = mountArranger(arrangerRoot, {
        getSequence: () => currentSequence,
        getChannelPattern,
        onSelectPattern: (channel, id) => selectedPatterns.set(channel, id),
        onEdit: commitEdit,
        onMixer: showProjectMixer,
        onOpenChannel: (channel, patternId) => {
            if (patternId) selectedPatterns.set(channel, patternId);
            if (!currentSequence.getChannelPattern(channel)) { currentSequence.ensureChannelPattern(channel); commitEdit(); }
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

const saveProjectToLocal = async () => {
    const seq = currentSequence;
    if (!seq) { log('Save: nothing to save', 'warn'); return; }
    const name = await askName('Save project', 'Name', lastLoadedName || seq.name);
    if (!name || currentSequence !== seq) return;
    const projects = readProjects();
    const entry = {
        seq: JSON.parse(seq.toJSON()),
        timestamp: Date.now(),
    };
    try { writeProjects({ ...projects, [name]: entry }); }
    catch (error) { log(`Save failed: ${error}`, 'error'); setStatus('Could not save project'); return; }
    log(`main: project saved "${name}"`);
    setStatus(`Saved: ${name}`);
    return true;
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

async function generateProject(type) {
    const previous = currentSequence;
    if (previous?.patterns.length || previous?.arrangement.length) {
        if (!await confirmAction('Save before generating?',
            'The generator will create a new project. Save your current project locally before opening the generator.', 'Save and continue')) return;
        if (currentSequence !== previous || !await saveProjectToLocal()) return;
    }
    if (currentSequence !== previous) return;
    const sequence = await openTrackGenerator(type);
    if (!sequence || currentSequence !== previous) return;
    adaptToSoundfont(sequence, getSynth()?.soundBankManager.presetList);
    useSequence(sequence, null, { keepHistory: true });
    setStatus(`Generated: ${sequence.name}`);
    log(`Generated ${sequence.name} — ${sequence.arrangement.length} editable clips`);
}

// ---------------- Menubar ----------------
menubar = mountMenubar({
    new: () => {
        openProjectSettings({
            title: 'New Project',
            initial: { name: 'Untitled', bpm: 120, bars: 4, steps: 16 },
            onApply: ({ name, bpm, bars, steps }) => {
                const seq = createEmptySequence();
                seq.name = name;
                seq.tempo = bpm;
                seq.stepsPerBar = steps;
                seq.patternLengthTicks = seq.ticksPerBar * bars;
                useSequence(seq);
                setStatus(`New project: ${name}`);
                log(`main: new project "${name}" ${bpm}BPM ${bars}bars × ${steps}steps`);
            },
        });
    },
    openProject: openProjectDialog,
    open: () => document.getElementById('openMidiInput')?.click(),

    composeTrack: () => generateProject('compose'),
    varyTrack: () => generateProject('variation'),
    recomposeTrack: () => generateProject('recompose'),
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

    undo: () => restoreEdit('undo'),
    redo: () => restoreEdit('redo'),
    cut: () => pianoRoll?.editNotes('cut'),
    copy: () => pianoRoll?.editNotes('copy'),
    paste: () => pianoRoll?.editNotes('paste'),
    del: () => pianoRoll?.editNotes('delete'),

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
                bars: Math.max(1, Math.round(seq.patternLengthTicks / seq.ticksPerBar)),
                steps: seq.stepsPerBar,
            },
            onApply: ({ name, bpm, bars, steps }) => {
                if (!seq) return;
                seq.name  = name;
                seq.tempo = bpm;
                seq.stepsPerBar = steps;
                seq.patternLengthTicks = seq.ticksPerBar * bars;
                refreshAll();
                commitEdit();
                setStatus(`Settings updated: ${bpm}BPM ${bars}×${steps}`);
            },
        });
    },
});

syncHistory();
document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || document.querySelector('dialog[open], .arr-dialog-overlay') ||
        document.querySelector('.menubar')?.inert || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.code === 'KeyZ' || e.code === 'KeyY') {
        e.preventDefault(); restoreEdit(e.shiftKey || e.code === 'KeyY' ? 'redo' : 'undo');
    }
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

mountAudioStatus();
logPanel?.classList.add('collapsed');

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