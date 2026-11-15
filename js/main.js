// js/main.js
import { log, setStatus, wireGlobalErrorHandlers } from './core/log.js';
import { initSynth, getSynth, getAudioContext, getSequencer } from './core/synth.js';
import { Playlist } from './playlist.js';
import { mountPlaylistView } from './ui/playlistView.js';
import { mountMenubar } from './ui/menubar.js';
import { mountPlayerOverlay } from './ui/playerOverlay.js';
import { mountPianoRoll } from './editor/pianoRoll.js';
import { importMidi } from './editor/importMidi.js';
import { writeMIDIFromSequence } from './editor/exportMidi.js';
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
const playlistItemsEl = document.getElementById('playlistItems');

let playlistView = null;
if (playlistItemsEl) {
    playlistView = mountPlaylistView(playlistItemsEl, {
        playlist,
        getActiveId: () => playlist.getActiveId?.(),
        onSelect: async (item) => loadTrackIntoEditor(item),
        onRemove: (id) => {
            playlist.removeUserTrack?.(id);
            playlistView?.refresh?.();
        },
    });
}

// ---------------- Audio unlock ----------------

// ---------------- Editor state ----------------
let pianoRoll = null;
let currentSequence = null;
let lastLoadedName = null;

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
    if (!seq.patterns || seq.patterns.length === 0) {
        const pattern = seq.addPattern({ name: 'Pattern 1', lengthTicks: 480 * 4 * 4 });  // 4 bars × 4 beats
        seq.placePattern(pattern.id, 0);
    }
    return seq;
};

const ensureSequence = () => {
    if (!currentSequence) {
        currentSequence = createEmptySequence();
        pianoRoll?.refresh();
    }
    return currentSequence;
};

async function loadTrackIntoEditor(item) {
    if (!item) return;
    try {
        setStatus(`Loading ${item.name}…`);
        const buffer = await playlist.getBuffer(item);
        lastLoadedName = item.name;
        const seq = importMidi(buffer, item.name);
        currentSequence = seq;
        const totalNotes = seq.patterns.reduce((s, p) => s + (p.notes?.length || 0), 0);
        log(`main: imported "${item.name}" — ${totalNotes} notes, ${seq.patterns.length} patterns @ ${seq.tempo} BPM`);
        refreshAll();
        setStatus(`Loaded: ${item.name}`);
    } catch (err) {
        log(`import failed: ${err}`, 'error');
        setStatus('Load failed');
    }
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
    if (initBar) initBar.style.display = 'none';
	
	ensureSequence();
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
        getActivePatternId:   () => currentSequence?.patterns?.[0]?.id,
        onNoteChange:         () => {},
        onRequestNewSequence: () => ensureSequence(),
        onBackToArranger:     () => showArranger(),
    });
}
if (arrangerRoot) {
    arrangerView = mountArranger(arrangerRoot, {
        getSequence: () => currentSequence,
        onOpenPattern: (pid) => {
            pianoRoll?.setActivePattern?.(pid);
            showPianoRoll();
        },
    });
}
// Default view: arranger
showArranger();

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
    const name = prompt('Project name:', lastLoadedName || 'My Loop');
    if (!name) return;
    const projects = readProjects();
    projects[name] = {
        seq: {
            name: seq.name,
            tempo: seq.tempo,
            timeDivision: seq.timeDivision,
            channels: seq.channels?.map(c => ({ ...c })),
            patterns: seq.patterns?.map(p => ({
                id: p.id, name: p.name, lengthTicks: p.lengthTicks,
                notes: (p.notes || []).map(n => ({ ...n })),
            })),
            arrangement: seq.arrangement?.map(x => ({ ...x })) || [],
        },
        timestamp: Date.now(),
    };
    writeProjects(projects);
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
            const seq = Sequence.create();
            const s = projects[n].seq;
            seq.name = s.name || n;
            seq.tempo = s.tempo || 120;
            seq.timeDivision = s.timeDivision || 480;
            seq.channels = (s.channels || []).map(c => ({ ...c }));
            seq.patterns = (s.patterns || []).map(p => ({ ...p, notes: (p.notes || []).map(x => ({ ...x })) }));
            seq.arrangement = (s.arrangement || []).map(x => ({ ...x }));
            currentSequence = seq;
            refreshAll();
            lastLoadedName = n;
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
                seq.patterns[0].name = 'Pattern 1';
                seq.patterns[0].lengthTicks = 480 * steps / 4 * bars
                currentSequence = seq;
                lastLoadedName = null;
                refreshAll();
                pianoRoll?.setGrid?.({ bars, steps });
                setStatus(`New project: ${name}`);
                log(`main: new project "${name}" ${bpm}BPM ${bars}bars × ${steps}steps`);
            },
        });
    },
    open: () => {
        log('Menu: Open MIDI…');
        const input = document.getElementById('fileInput');
        if (!input) return;
        input.onchange = async (e) => {
            const files = Array.from(e.target.files || []);
            if (!files.length) return;
            for (const f of files) {
                try { await playlist.addUserFile?.(f); }
                catch (err) { log(`Add failed: ${err}`, 'error'); }
            }
            playlistView?.refresh?.();
            const first = playlist.items?.[0];
            if (first) await loadTrackIntoEditor(first);
            input.value = '';
        };
        input.click();
    },

    save: saveProjectToLocal,
    saveAs: () => {
        log('Menu: Save As MIDI…');
        if (!currentSequence) { log('Save As: nothing to save', 'warn'); return; }
        try {
            const midiBuf = writeMIDIFromSequence(currentSequence, { playMode: 'track', useAnchor: true });
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
    cut:  () => {
        const sel = pianoRoll?.getSelection?.() || [];
        if (!sel.length) return;
        window.__prClipboard = pianoRoll.copySelection();
        pianoRoll.deleteSelection();
        log(`Menu: cut ${sel.length} notes`);
    },
    copy: () => {
        const sel = pianoRoll?.getSelection?.() || [];
        if (!sel.length) return;
        window.__prClipboard = pianoRoll.copySelection();
        log(`Menu: copied ${sel.length} notes`);
    },
    paste: () => {
        if (window.__prClipboard?.length) {
            pianoRoll?.pasteNotes(window.__prClipboard);
            log(`Menu: pasted ${window.__prClipboard.length} notes`);
        }
    },
    del: () => {
        const sel = pianoRoll?.getSelection?.() || [];
        if (sel.length) {
            pianoRoll.deleteSelection();
            log(`Menu: deleted ${sel.length} notes`);
        }
    },

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
        playlist.clearUserTracks?.();
        playlistView?.refresh?.();
        log('Menu: playlist cleared');
    },
	projectSettings: () => {
        const seq = currentSequence;
        openProjectSettings({
            title: 'Project Settings',
            initial: {
                name:  seq?.name  || 'Untitled',
                bpm:   seq?.tempo || 120,
                bars:  Math.max(1, Math.round((seq?.patterns?.[0]?.lengthTicks || 1920) / (480 * 4))),
                steps: 4,
            },
            onApply: ({ name, bpm, bars, steps }) => {
                if (!seq) return;
                seq.name  = name;
                seq.tempo = bpm;
                seq.patterns.forEach(p => p.lengthTicks = 480 * steps * bars);
                refreshAll();
                pianoRoll?.setGrid?.({ bars, steps });
                setStatus(`Settings updated: ${bpm}BPM ${bars}×${steps}`);
            },
        });
    },
});

// ---------------- Player overlay ----------------
const playerOverlay = mountPlayerOverlay({
    playlist,
    onSelectTrack: (item) => loadTrackIntoEditor(item),
    onRequestInit: () => playlistView?.refresh?.(),
    onLoaded: () => playlistView?.refresh?.(),
});

// ---------------- Init UI ----------------
await playlist.load();          // ← подхватывает demo.mid и сохранённые треки
playlistView?.refresh?.();

bootAudio();                    // initSynth сам покажет оверлей, дождётся 1 клика и скроется

log('main: shell ready');

// js/main.js — в самом конце
const srSelect = document.getElementById('sampleRateSelect');
if (srSelect) {
    const saved = localStorage.getItem('midi-player.sampleRate') || '44100';
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