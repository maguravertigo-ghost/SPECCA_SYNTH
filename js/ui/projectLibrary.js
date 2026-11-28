import {askName, confirmAction} from './dialogs.js';
import {readProjectLibrary, writeProjectLibrary, copyProjectEntry, projectCopyName} from '../editor/projectLibrary.js';

export function openProjectLibrary({onOpen, onRename, onDelete}) {
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog arr-dialog-box project-library';
    dialog.setAttribute('aria-label', 'Saved projects');
    dialog.innerHTML = `<header class="arr-dialog-title">Saved projects</header><div class="project-library-intro">Projects saved in this browser. Clones share the original WAV assets; deleting a project does not delete audio files.</div><label class="project-library-search">Search <input type="search" aria-label="Search saved projects" placeholder="Project name…"></label><div class="project-library-list"></div><output class="project-library-status" role="status"></output><footer class="arr-dialog-footer"><span data-count></span><button type="button" class="btn" data-close>Close</button></footer>`;
    const list = dialog.querySelector('.project-library-list'), status = dialog.querySelector('output'), search = dialog.querySelector('input');
    let busy = false;
    const run = async action => {
        if (busy) return;
        busy = true; dialog.setAttribute('aria-busy', 'true');
        for (const button of list.querySelectorAll('button')) button.disabled = true;
        status.textContent = '';
        try { await action(); }
        catch (error) { status.textContent = error.message || 'Could not update saved projects.'; }
        finally { busy = false; dialog.removeAttribute('aria-busy'); if (dialog.open) render(); }
    };
    function render() {
        const projects = readProjectLibrary(), all = Object.keys(projects);
        const names = all.filter(name => name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())).sort((a,b) => (projects[b].timestamp || 0) - (projects[a].timestamp || 0) || a.localeCompare(b));
        list.replaceChildren();
        dialog.querySelector('[data-count]').textContent = `${all.length} saved project${all.length === 1 ? '' : 's'}`;
        if (!names.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = all.length ? 'No matching projects.' : 'No saved projects yet. Use File → Save Project.'; list.append(empty); }
        for (const name of names) {
            const entry = projects[name], row = document.createElement('section'); row.className = 'project-library-row'; row.setAttribute('aria-label', name);
            const info = document.createElement('div'); info.className = 'project-library-info';
            const title = document.createElement('strong'); title.textContent = title.title = name;
            const details = document.createElement('small'); details.textContent = `${entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Unknown save date'} · ${entry.seq?.channels?.length ?? 0} channels · ${entry.seq?.patterns?.length ?? 0} patterns`;
            info.append(title, details); row.append(info);
            const actions = document.createElement('div'); actions.className = 'project-library-actions'; row.append(actions);
            function button(label, action) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = label; b.addEventListener('click', () => run(action)); actions.append(b); }
            button('Open', async () => { if (await onOpen(name)) dialog.close(); });
            button('Rename', async () => {
                const next = await askName('Rename saved project', 'Name', name); if (!next || next === name || !dialog.open) return;
                const updated = copyProjectEntry(readProjectLibrary(), name, next, {move:true});
                writeProjectLibrary(updated); onRename?.(name, next); status.textContent = `Renamed to “${next}”.`;
            });
            button('Clone', async () => {
                const next = await askName('Clone saved project', 'Name', projectCopyName(readProjectLibrary(), name)); if (!next || !dialog.open) return;
                writeProjectLibrary(copyProjectEntry(readProjectLibrary(), name, next)); status.textContent = `Created “${next}”.`;
            });
            button('Delete', async () => {
                if (!await confirmAction('Delete saved project', `Delete the saved project “${name}” from this browser? The open composition and WAV assets will remain unchanged.`) || !dialog.open) return;
                const updated = readProjectLibrary(); delete updated[name]; writeProjectLibrary(updated); onDelete?.(name); status.textContent = `Deleted “${name}”.`;
            });
            list.append(row);
        }
    }
    search.addEventListener('input', () => { if (!busy) render(); });
    dialog.querySelector('[data-close]').onclick = () => { if (!busy) dialog.close(); };
    dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
    dialog.addEventListener('close', () => { dialog.remove(); previousFocus?.focus(); }, {once:true});
    document.body.append(dialog); render(); dialog.showModal(); search.focus();
}
