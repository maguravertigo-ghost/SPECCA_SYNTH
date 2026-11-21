import { listFonts, saveFont, removeFont, activeFontId, setActiveFont, openSavedFont } from '../core/fontLibrary.js';
import { selectLocalSoundFont, changeSoundFont, getSynth } from '../core/synth.js';

const pickerTypes = [{ description: 'SoundFont', accept: { 'application/octet-stream': ['.sf2', '.sf3'] } }];

export function mountSoundFontLibrary({ beforeSwitch = () => {}, report = () => {} } = {}) {
    const dialog = document.getElementById('soundFontChoice');
    const fileInput = document.getElementById('startupSoundFont');
    const useLocal = document.getElementById('chooseStartupFont');
    const useBundled = document.getElementById('chooseBundledFont');
    const saved = document.getElementById('savedFontList');
    const status = document.getElementById('fontLibraryStatus');
    const disk = document.getElementById('chooseFontHandle');
    const download = document.getElementById('saveBundledFont');
    let switching = false, refreshId = 0, switchId = 0;
    disk.hidden = typeof window.showOpenFilePicker !== 'function';
    if (location.hostname.endsWith('github.io')) useBundled.textContent = 'Load from GitHub Pages';

    function notify(message) { status.textContent = message; report(message); }
    async function render() {
        const request = ++refreshId;
        try {
            const records = await listFonts();
            const rows = await Promise.all(records.map(async record => ({ record, state: (await openSavedFont(record)).state })));
            if (request !== refreshId) return;
            saved.replaceChildren();
            if (!rows.length) saved.textContent = 'No remembered SoundFonts yet.';
            for (const { record, state } of rows) {
                const row = document.createElement('div');
                row.className = 'font-library-row';
                const label = document.createElement('span');
                label.textContent = `${record.name}${activeFontId() === record.id ? ' · Selected' : ''} — ${state}`;
                const use = document.createElement('button');
                use.type = 'button'; use.className = 'btn'; use.textContent = 'Use';
                use.disabled = !['Saved in this browser', 'Available on disk', 'Permission required'].includes(state);
                use.addEventListener('click', async () => {
                    const { file, state } = await openSavedFont(record, true);
                    if (!file) { notify(state); render(); return; }
                    activate(file, () => setActiveFont(record.id));
                });
                const remove = document.createElement('button');
                remove.type = 'button'; remove.className = 'btn btn-ghost'; remove.textContent = 'Forget';
                remove.title = 'Remove from library without deleting the original file';
                remove.addEventListener('click', async () => {
                    try { await removeFont(record.id); if (activeFontId() === record.id) setActiveFont(null); render(); }
                    catch (error) { notify(error.message); }
                });
                row.append(label, use, remove); saved.append(row);
            }
        } catch { if (request === refreshId) saved.textContent = 'Browser storage is unavailable. You can still load a SoundFont for this session.'; }
    }
    function open() {
        if (!dialog.open) dialog.showModal();
        render();
    }
    async function activate(file, onInstalled) {
        if (switching && (!file || getSynth())) return;
        const request = ++switchId;
        switching = true;
        beforeSwitch();
        if (dialog.open) dialog.close();
        try {
            await changeSoundFont(file, onInstalled && (async bytes => {
                try { await onInstalled(bytes); }
                catch (error) { notify(`SoundFont loaded, but could not be remembered: ${error.message}`); }
            }));
        } catch (error) { if (request === switchId) { notify(error.message); open(); } }
        finally { if (request === switchId) switching = false; }
    }
    async function remember(record) {
        await saveFont(record);
        setActiveFont(record.id);
    }
    const rememberLocal = file => activate(file, () => remember({ id: `copy:${file.name}:${file.size}:${file.lastModified}`, name: file.name, blob: file }));
    const rememberBundled = bytes => remember({ id: 'bundled', name: 'soundfont.sf2 (bundled)', blob: new File([bytes], 'soundfont.sf2') });

    fileInput.addEventListener('change', () => { useLocal.disabled = !fileInput.files.length; });
    useLocal.addEventListener('click', () => {
        const file = fileInput.files[0]; if (!file) return;
        fileInput.value = ''; useLocal.disabled = true;
        rememberLocal(file);
    });
    const legacy = document.getElementById('localSoundFont');
    legacy.addEventListener('change', () => { const file = legacy.files[0]; legacy.value = ''; if (file) rememberLocal(file); });
    useBundled.addEventListener('click', () => activate(null, rememberBundled));
    disk.addEventListener('click', async () => {
        try {
            const [handle] = await window.showOpenFilePicker({ types: pickerTypes, multiple: false });
            const file = await handle.getFile();
            activate(file, async () => {
                const known = await listFonts();
                const match = await Promise.all(known.map(r => r.handle?.isSameEntry(handle).catch(() => false)));
                await remember({ id: known[match.indexOf(true)]?.id ?? `disk:${Date.now()}:${file.name}`, name: file.name, handle });
            });
        } catch (error) { if (error.name !== 'AbortError') notify(error.message); }
    });
    download.addEventListener('click', async () => {
        let handle;
        if (typeof window.showSaveFilePicker === 'function') {
            try { handle = await window.showSaveFilePicker({ suggestedName: 'soundfont.sf2', types: pickerTypes }); }
            catch (error) {
                if (error.name === 'AbortError') return;
                if (error.name !== 'SecurityError' && error.name !== 'NotAllowedError') { notify(error.message); return; }
            }
        }
        activate(null, async bytes => {
            if (handle) {
                const writer = await handle.createWritable();
                await writer.write(bytes); await writer.close();
                await remember({ id: `disk:${Date.now()}:${handle.name}`, name: handle.name, handle });
            } else {
                const url = URL.createObjectURL(bytes);
                const a = document.createElement('a'); a.href = url; a.download = 'soundfont.sf2';
                document.body.append(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 30000);
                await rememberBundled(bytes);
            }
        });
    });

    async function restore() {
        try {
            const id = activeFontId();
            if (id) {
                const record = (await listFonts()).find(font => font.id === id);
                if (record) {
                    const { file, state } = await openSavedFont(record);
                    if (file && selectLocalSoundFont(file)) return;
                    notify(`${record.name}: ${state}. Pick a SoundFont.`);
                }
            }
        } catch { /* normal selector still works without persistent storage */ }
        open();
    }
    return { open, restore };
}
