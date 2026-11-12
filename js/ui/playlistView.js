export class PlaylistView {
    activeId = null;

    constructor({ listEl, addBtn, fileInput, clearBtn }, playlist, { onSelect }) {
        Object.assign(this, { listEl, playlist, onSelect });

        addBtn?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', async e => {
            if (e.target.files?.length) {
                await playlist.addFiles(e.target.files);
                e.target.value = '';
            }
        });
        clearBtn?.addEventListener('click', async () => {
            for (const it of [...playlist.items]) {
                if (it.source === 'user') await playlist.remove(it.id);
            }
        });
        playlist.subscribe(() => this.render());
    }

    setActive(id) { this.activeId = id; this.render(); }

    render() {
        if (!this.listEl) return;
        this.listEl.innerHTML = '';

        if (!this.playlist.items.length) {
            const el = document.createElement('div');
            el.className = 'playlist-empty';
            el.textContent = 'No tracks. Click "+ Add" to load a MIDI file.';
            this.listEl.appendChild(el);
            return;
        }

        for (const item of this.playlist.items) {
            const el = document.createElement('div');
            el.className = 'playlist-item' + (item.id === this.activeId ? ' active' : '');
            el.innerHTML = `
                <span class="playlist-name" title="${item.name}">${item.name}</span>
                <span class="playlist-meta">${item.size ? (item.size / 1024).toFixed(1) + ' KB' : ''}</span>
                <button class="playlist-remove" title="Remove">&times;</button>
            `;
            el.querySelector('.playlist-name').addEventListener('click', () => {
                this.onSelect?.(item);
            });
            el.querySelector('.playlist-remove').addEventListener('click', async e => {
                e.stopPropagation();
                await this.playlist.remove(item.id);
            });
            this.listEl.appendChild(el);
        }
    }
}