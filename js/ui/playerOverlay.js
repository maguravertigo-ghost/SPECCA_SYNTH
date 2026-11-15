// js/ui/playerOverlay.js
import { log } from '../core/log.js';
import { mountPlaylistView } from './playlistView.js';

export function mountPlayerOverlay({ playlist, onSelectTrack, onRequestInit, onLoaded } = {}) {
    const overlay   = document.getElementById('playerOverlay');
    const closeBtn  = document.getElementById('playerCloseBtn');
    const addBtn    = document.getElementById('addFilesBtn');
    const clearBtn  = document.getElementById('clearUserTracksBtn');
    const fileInput = document.getElementById('fileInput');
    const listEl    = document.getElementById('playlistItems');

    if (!overlay) {
        log('Player overlay: element #playerOverlay missing', 'error');
        return { open(){}, close(){}, toggle(){} };
    }

    let listView = null;
    if (playlist && listEl) {
        listView = mountPlaylistView(listEl, {
            playlist,
            getActiveId: () => playlist.getActiveId?.(),
            onSelect: (item) => {
                log(`Player overlay: select "${item?.name ?? '?'}"`);
                onSelectTrack?.(item);
            },
            onRemove: (id) => {
                playlist.removeUserTrack?.(id);
                listView?.refresh?.();
                onRequestInit?.();
            },
        });
    }

    const open  = () => { overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden','false'); onLoaded?.(); };
    const close = () => { overlay.classList.add('hidden');    overlay.setAttribute('aria-hidden','true'); };
    const toggle = () => overlay.classList.contains('hidden') ? open() : close();

    closeBtn?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F5') { e.preventDefault(); toggle(); }
        if (e.key === 'Escape' && !overlay.classList.contains('hidden')) close();
    });

    addBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        try {
            for (const f of files) {
                await playlist.addUserFile?.(f);
            }
            listView?.refresh?.();
            onRequestInit?.();
        } catch (err) {
            log(`Player overlay: add failed: ${err}`, 'error');
        } finally {
            fileInput.value = '';
        }
    });

    clearBtn?.addEventListener('click', () => {
        playlist.clearUserTracks?.();
        listView?.refresh?.();
        onRequestInit?.();
    });

    return { open, close, toggle, refresh: () => listView?.refresh?.() };
}