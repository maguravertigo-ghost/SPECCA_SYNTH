import {readProjectLibrary,writeProjectLibrary} from './editor/projectLibrary.js';
import {openProjectLibrary} from './ui/projectLibrary.js';
import {importWav} from './core/audioTracks.js';
import {chooseNsfImport} from './ui/importNsfDialog.js';
import {appendNsfTrace} from './editor/nsf.js';
import { renderProjectWav } from './editor/renderWav.js';
import { openWavExport } from './ui/exportWavDialog.js';
import { openAudioEffects } from './ui/audioEffectsDialog.js';
import { defaultEffects } from './editor/audioEffects.js';
import { applyProjectEffects } from './core/synth.js';
import { automationSummary } from './editor/automation.js';
import { mountSoundFontLibrary } from './ui/soundFontLibrary.js';
// js/main.js
import { log, setStatus, wireGlobalErrorHandlers } from './core/log.js';
import { initSynth, onAudioStatus, applyChannelVolume, getAudioContext, getSequencer, getPreviewSequencer, getOutputLevel, getMasterVolume, getSynth } from './core/synth.js';
import { Playlist } from './playlist.js';
import { mountMenubar } from './ui/menubar.js';
import { mountPlayerOverlay } from './ui/playerOverlay.js';
import { mountPianoRoll } from './editor/pianoRoll.js';
import { importMidi } from './editor/importMidi.js';
import { adaptToSoundfont } from './editor/instruments.js';
import { writeArrangementMIDI, writeChannelMIDIFiles } from './editor/exportMidi.js';
import { appendMidiChannels } from './editor/appendMidiChannels.js';
import { zipStoredFiles } from './core/zipStore.js';
import { askName, confirmAction, askUnsavedChanges } from './ui/dialogs.js';
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
let savedSnapshot = null;
let currentSavedKey = null;
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
    // Finish a live take before moving the history cursor.
    pianoRoll?.stop();
    const snapshot = history[action]();
    if (!snapshot) return;
    arrangerView?.stop(); pianoRoll?.stop();
    currentSequence = Sequence.fromJSON(snapshot);
    applyProjectEffects({ ...currentSequence, effects: currentSequence.effects ?? defaultEffects() });
    const channel = pianoRoll?.getChannel();
    if (channel != null && !currentSequence.channels.some(c => c.channel === channel)) showArranger();
    refreshAll(); syncHistory();
}
const commitEffects = () => {
    commitEdit();
    arrangerView?.refreshAudio?.();
    pianoRoll?.refreshAudio?.();
};
const showAudioEffects = () => openAudioEffects({ getSequence: () => currentSequence,
    onChange: () => applyProjectEffects(currentSequence), onCommit: commitEffects });
const showProjectMixer = () => openMixer({ title: 'Project mixer', showPan: true,
    onEffects: showAudioEffects,
    onSendCommit: commitEffects,
    onSendChange: () => { currentSequence.effects ??= defaultEffects(); applyProjectEffects(currentSequence); },
    getAutomation: channel => automationSummary(currentSequence.patterns.filter(p => p.channel === channel.channel)),
    channels: currentSequence.orderedChannels().filter(c => c.kind !== 'comment'),
    onChange: channel => {
        applyChannelVolume(channel);
        arrangerView?.refresh();
        if (pianoRoll?.getChannel() === channel.channel) pianoRoll.refreshChannelMute();
    },
    onCommit: commitEdit,
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

function refreshProjectName() {
    const label = document.getElementById('arrProjectName');
    if (label) label.textContent = label.title = currentSequence?.name || 'Untitled';
}

function refreshProjectTempo() {
    refreshProjectName();
    const output = document.getElementById('projectBpm');
    const tempo = currentSequence?.tempo;
    output.value = Number.isFinite(tempo) ? String(Number(tempo.toFixed(2))) : '–';
}

function mountQuickTempo() {
    const root = document.querySelector('.project-tempo');
    const toggle = document.getElementById('projectTempoToggle');
    const panel = document.getElementById('quickTempoPanel');
    const field = document.getElementById('quickTempoBpm');
    const range = document.getElementById('quickTempoRange');
    const close = () => { toggle.setAttribute('aria-expanded', 'false'); panel.hidden = true; };
    toggle.addEventListener('click', () => {
        if (!panel.hidden) { close(); return; }
        field.value = currentSequence?.tempo ?? 120; range.value = field.value;
        panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); field.focus(); field.select();
    });
    field.addEventListener('input', () => { if (field.validity.valid) range.value = field.value; });
    range.addEventListener('input', () => { field.value = range.value; });
    panel.addEventListener('submit', event => {
        event.preventDefault();
        if (!currentSequence || !field.validity.valid) return;
        const seq = currentSequence;
        if (seq.tempo !== field.valueAsNumber) {
            arrangerView?.stop(); pianoRoll?.stop();
            seq.tempo = field.valueAsNumber;
            refreshAll(); commitEdit();
            setStatus(`Tempo: ${seq.tempo} BPM`);
        }
        close(); toggle.focus();
    });
    document.addEventListener('pointerdown', event => { if (!root.contains(event.target)) close(); });
    root.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) { close(); toggle.focus(); } });
}

function useSequence(sequence, name = null, { keepHistory = false } = {}) {
    pianoRoll?.stop();
    arrangerView?.stop();
    currentSequence = sequence;
    currentSavedKey = null;
    if (name) sequence.name = name;
    refreshProjectTempo();
    const snapshot = sequence.toJSON(0);
    if (keepHistory) history.commit(snapshot);
    else { history.reset(snapshot); savedSnapshot = snapshot; }
    syncHistory();
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
    const fontButtons = [...document.querySelectorAll('[data-local-soundfont]')];
    for (const choose of fontButtons) choose.addEventListener('click', () => fontLibrary.open());
    button.addEventListener('click', () => initSynth().catch(() => {}));
    onAudioStatus(({ state, message, progress, canSelectFont = true }) => {
        for (const status of statuses) {
            status.setAttribute('aria-live', progress?.loaded ? 'off' : 'polite');
            status.textContent = status.title = message;
            status.dataset.state = state;
        }
        for (const choose of fontButtons) {
            choose.disabled = !canSelectFont;

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
        onAudioEffects: showAudioEffects,
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
        onTempoEdit: () => { refreshProjectTempo(); pianoRoll?.refresh(); },
        onMixer: showProjectMixer,
        onAudioEffects: showAudioEffects,
        onOpenChannel: (channel, patternId, placement) => {
            if (patternId) selectedPatterns.set(channel, patternId);
            if (!currentSequence.getChannelPattern(channel)) { currentSequence.ensureChannelPattern(channel); commitEdit(); }
            pianoRoll?.setChannel(channel, placement);
            showPianoRoll();
        },
    });
}
// Default view: arranger
useSequence(createEmptySequence());

// ---------------- Local project save/load ----------------
const readProjects = readProjectLibrary;
const writeProjects = writeProjectLibrary;

const saveProjectToLocal = async () => {
    const seq = currentSequence;
    if (!seq) { log('Save: nothing to save', 'warn'); return; }
    const name = await askName('Save project', 'Name', seq.name);
    if (!name || currentSequence !== seq) return;
    const projects = readProjects();
    const entry = {
        seq: { ...JSON.parse(seq.toJSON()), name },
        timestamp: Date.now(),
    };
    try { writeProjects({ ...projects, [name]: entry }); }
    catch (error) { log(`Save failed: ${error}`, 'error'); setStatus('Could not save project'); return; }
    seq.name = name;
    refreshProjectName();
    currentSavedKey = name;
    arrangerView?.refresh();
    savedSnapshot = seq.toJSON(0);
    commitEdit();
    log(`main: project saved "${name}"`);
    setStatus(`Saved: ${name}`);
    return true;
};

const openProjectDialog = () => openProjectLibrary({
    onOpen: async name => {
        const previous = currentSequence;
        if (previous && previous.toJSON(0) !== savedSnapshot) {
            const action = await askUnsavedChanges('opening another project');
            if (action === 'cancel' || currentSequence !== previous) return false;
            if (action === 'save' && !await saveProjectToLocal()) return false;
        }
        if (currentSequence !== previous) return false;
        const entry = readProjects()[name];
        if (!entry) throw new Error('This saved project no longer exists.');
        useSequence(Sequence.fromJSON(entry.seq), name);
        currentSavedKey = name;
        log(`main: project loaded "${name}"`); setStatus(`Loaded: ${name}`);
        return true;
    },
    onRename: (oldName, newName) => {
        if (currentSavedKey !== oldName || !currentSequence) return;
        currentSavedKey = newName;
        currentSequence.name = newName;
        if (savedSnapshot) { const saved = JSON.parse(savedSnapshot); saved.name = newName; savedSnapshot = JSON.stringify(saved); }
        // Only rename the working copy: do not replace unsaved notes with the stored snapshot.
        commitEdit(); refreshAll();
    },
    onDelete: name => { if (currentSavedKey === name) currentSavedKey = null; },
});

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

function downloadFile(data, type, name) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function exportProjectMidi(splitTracks) {
    if (!currentSequence) return;
    try {
        const midi = writeArrangementMIDI(currentSequence, { splitTracks });
        downloadFile(midi, 'audio/midi', `${midiBaseName()}${splitTracks ? '-tracks' : ''}.mid`);
    } catch (error) {
        log(`Save As MIDI failed: ${error}`, 'error');
        setStatus(error.message);
    }
}

const midiBaseName = () => (currentSequence.name || 'Untitled').replace(/\.midi?$/i, '');

function exportChannelFiles() {
    if (!currentSequence) return;
    try {
        const files = writeChannelMIDIFiles(currentSequence);
        if (!files.length) { setStatus('No placed MIDI notes to export.'); return; }
        downloadFile(zipStoredFiles(files), 'application/zip', `${midiBaseName()}-channels.zip`);
        setStatus(`Exported ${files.length} MIDI channel file(s)`);
    } catch (error) {
        log(`MIDI ZIP export failed: ${error}`, 'error');
        setStatus(error.message);
    }
}

// ---------------- Menubar ----------------
menubar = mountMenubar({
    new: async () => {
        const previous = currentSequence;
        if (previous && previous.toJSON(0) !== savedSnapshot) {
            const action = await askUnsavedChanges();
            if (action === 'cancel' || currentSequence !== previous) return;
            if (action === 'save' && !await saveProjectToLocal()) return;
        }
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
    importNsf: async () => {
        const project=currentSequence;if(!project)return;
        const offsetTick=arrangerView?.getCursorTick()??0;
        arrangerView?.pause();pianoRoll?.stop();stopAllPlayback();
        const choice=await chooseNsfImport({offsetTick});if(!choice||currentSequence!==project)return;
        try{
            let dpcmAsset=null;
            if(choice.trace.dpcmAudio){
                setStatus('Saving DPCM audio layer in this browser…');
                await initSynth();if(currentSequence!==project)return;
                const name=`${choice.trace.header.title||'NSF'} #${choice.trace.song} - DPCM.wav`;
                dpcmAsset=await importWav(new File([choice.trace.dpcmAudio.buffer],name,{type:'audio/wav'}),getAudioContext());
                if(currentSequence!==project)return;
            }
            const {sequence,count,noteCount,audioCount}=appendNsfTrace(project,choice.trace,{offsetTick:choice.offsetTick,title:choice.trace.header.title||'NSF',song:choice.trace.song,dpcmAsset});
            arrangerView?.stop();currentSequence=sequence;commitEdit();showArranger();
            setStatus(`NSF imported: ${count} editable Chiptune lanes, ${noteCount} note segments${audioCount?' + DPCM audio layer':choice.trace.dpcm?' · DPCM not included':''}`);
        }catch(error){setStatus(error.message);log(`NSF import: ${error}`,'error');}
    },
    importWav: () => { showArranger(); arrangerView?.importWav(); },
    importChannels: () => document.getElementById('importMidiChannelsInput').click(),

    composeTrack: () => generateProject('compose'),
    varyTrack: () => generateProject('variation'),
    recomposeTrack: () => generateProject('recompose'),
    save: saveProjectToLocal,
    saveAs: () => exportProjectMidi(false),
    saveTracks: () => exportProjectMidi(true),
    saveChannelFiles: exportChannelFiles,
    exportWav: () => {
        pianoRoll?.stop(); arrangerView?.stop(); stopAllPlayback();
        const sequence=Sequence.fromJSON(currentSequence.toJSON());
        const filename=`${midiBaseName()}.wav`;
        openWavExport({render:options=>renderProjectWav(sequence,options),download:buffer=>downloadFile(buffer,'audio/wav',filename)});
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
            onSoundFont: () => fontLibrary.open(),
            initial: {
                name:  seq?.name  || 'Untitled',
                bpm:   seq?.tempo || 120,
                bars: Math.max(1, Math.round(seq.patternLengthTicks / seq.ticksPerBar)),
                steps: seq.stepsPerBar,
            },
            onApply: ({ name, bpm, bars, steps }) => {
                if (!seq) return;
                if (seq.tempo !== bpm) { arrangerView?.stop(); pianoRoll?.stop(); }
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

const channelMidiInput = document.getElementById('importMidiChannelsInput');
channelMidiInput.addEventListener('change', async () => {
    const files = [...channelMidiInput.files];
    channelMidiInput.value = '';
    const project = currentSequence;
    if (!files.length || !project) return;
    try {
        const sources = [];
        for (const file of files) {
            try { sources.push(importMidi(await file.arrayBuffer(), file.name)); }
            catch { throw new Error(`Could not read ${file.name} as MIDI.`); }
        }
        if (currentSequence !== project) return;
        const { sequence, count } = appendMidiChannels(project, sources);
        if (!count) { setStatus('No notes in the selected MIDI files.'); return; }
        // Adapt only the incoming channels, never the instruments already in the project.
        const existing = new Set(project.orderedChannels().map(c => c.channel));
        adaptToSoundfont({ channels: sequence.channels.filter(c => !existing.has(c.channel) && c.created !== false) }, getSynth()?.soundBankManager.presetList);
        arrangerView?.stop();
        currentSequence = sequence;
        commitEdit();
        showArranger();
        setStatus(`Imported ${count} MIDI channel(s)`);
    } catch (err) {
        log(`Import MIDI channels failed: ${err}`, 'error');
        setStatus(err.message);
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

const fontLibrary = mountSoundFontLibrary({
    beforeSwitch: () => {
        // An early local choice may be replacing a stalled bundled download.
        if (!getSynth()) return;
        getPreviewSequencer()?.pause();
        arrangerView?.stop(); pianoRoll?.stop();
    },
    report: setStatus,
});
mountAudioStatus();
mountQuickTempo();
await fontLibrary.restore();
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