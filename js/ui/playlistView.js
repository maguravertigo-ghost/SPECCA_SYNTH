// js/ui/playlistView.js
//
// Playlist view. Работает со стандартным API Playlist:
//   playlist.items          — массив | геттер | функция
//   playlist.getActiveId?() — id или undefined
//   playlist.setActiveId?() — сеттер (иначе пишет в .activeId)
//   playlist.removeUserTrack?(id) | playlist.remove?(id)
//
// Экспортирует mountPlaylistView (+ алиасы) — то, что импортируют
// js/main.js и js/ui/playerOverlay.js.

function readItems(playlist) {
    if (!playlist) return [];
    const v = playlist.items;
    if (typeof v === 'function') {
        try { return v() || []; } catch { return []; }
    }
    if (Array.isArray(v)) return v;
    if (typeof playlist.getItems === 'function') {
        try { return playlist.getItems() || []; } catch { return []; }
    }
    return [];
}

function readActiveId(playlist, getActiveId) {
    if (typeof getActiveId === 'function') {
        try { const v = getActiveId(); if (v != null) return v; } catch {}
    }
    if (playlist) {
        if (typeof playlist.getActiveId === 'function') {
            try { return playlist.getActiveId(); } catch {}
        }
        if (playlist.activeId != null)  return playlist.activeId;
        if (playlist.currentId != null) return playlist.currentId;
    }
    return null;
}

function writeActiveId(playlist, id) {
    if (!playlist) return;
    if (typeof playlist.setActiveId === 'function') {
        try { playlist.setActiveId(id); return; } catch {}
    }
    if (typeof playlist.setActive === 'function') {
        try { playlist.setActive(id); return; } catch {}
    }
    try { playlist.activeId = id; } catch {}
}

function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function mountPlaylistView(rootEl, opts = {}) {
    if (!rootEl) return { refresh() {}, render() {}, root: rootEl };

    const { playlist, getActiveId, onSelect, onRemove } = opts;

    const render = () => {
        const items    = readItems(playlist);
        const activeId = readActiveId(playlist, getActiveId);

        rootEl.innerHTML = '';

        if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'playlist-empty';
            empty.textContent = 'No tracks. Use “+ Add” to add files for preview.';
            rootEl.appendChild(empty);
            return;
        }

        for (const item of items) {
            const id = item?.id ?? item?.name ?? '';
            const row = document.createElement('div');
            row.className = 'playlist-item' +
                (String(id) === String(activeId) ? ' active' : '');
            row.dataset.id = String(id);

            const name = document.createElement('span');
            name.className = 'playlist-name';
            name.textContent = item?.name || item?.fileName || '(untitled)';
            name.title = name.textContent;
            row.appendChild(name);

            const meta = document.createElement('span');
            meta.className = 'playlist-meta';
            const sz = item?.size ?? item?.byteLength ?? item?.buffer?.byteLength;
            meta.textContent = sz ? formatSize(sz) : '';
            row.appendChild(meta);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'playlist-remove';
            btn.textContent = '×';
            btn.title = 'Remove';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                try {
                    if (typeof onRemove === 'function')                          onRemove(id);
                    else if (typeof playlist?.removeUserTrack === 'function')    playlist.removeUserTrack(id);
                    else if (typeof playlist?.remove === 'function')             playlist.remove(id);
                } catch (err) { console.error(err); }
                render();
            });
            row.appendChild(btn);

            row.addEventListener('click', () => {
                try {
                    writeActiveId(playlist, id);
                    if (typeof onSelect === 'function') onSelect(item);
                } catch (err) { console.error(err); }
                [...rootEl.children].forEach(c => c.classList.remove('active'));
                row.classList.add('active');
            });

            rootEl.appendChild(row);
        }
    };

    render();
    return { refresh: render, render, root: rootEl };
}

// Алиасы на случай, если где-то ещё в проекте импортируют старые имена
export const PlaylistView       = mountPlaylistView;
export const createPlaylistView = mountPlaylistView;
export default mountPlaylistView;