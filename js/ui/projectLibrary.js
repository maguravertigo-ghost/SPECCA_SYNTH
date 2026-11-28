import {askName, confirmAction} from './dialogs.js';
import {readProjectLibrary, writeProjectLibrary, copyProjectEntry, projectCopyName} from '../editor/projectLibrary.js';

export function openProjectLibrary({onOpen, onRename, onDelete}) {
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog arr-dialog-box project-library';
    dialog.setAttribute('aria-label', 'Saved projects');
    dialog.innerHTML = `<header class="arr-dialog-title project-library-header"><span>Saved projects</span><span data-count></span><button type="button" class="btn project-library-close" data-close aria-label="Close saved projects" title="Close">×</button></header><div class="project-library-intro">Projects saved in this browser. Clones share the original WAV assets; deleting a project does not delete audio files.</div><label class="project-library-search">Search <input type="search" aria-label="Search saved projects" placeholder="Project name…"></label><div class="project-library-list" role="listbox" aria-label="Saved compositions"></div><output class="project-library-status" role="status"></output><footer class="arr-dialog-footer"><div class="project-library-actions" role="group" aria-label="Selected project actions"><button type="button" class="btn btn-primary" data-action="open">Open</button><button type="button" class="btn" data-action="clone">Clone</button><button type="button" class="btn" data-action="rename">Rename</button><button type="button" class="btn" data-action="delete">Delete</button></div><button type="button" class="btn" data-close>Close</button></footer>`;
    const list = dialog.querySelector('.project-library-list'), status = dialog.querySelector('output'), search = dialog.querySelector('input');
    const actionButtons = [...dialog.querySelectorAll('[data-action]')];
    let busy = false, selected = null, visibleNames = [];
    function updateControls() {
        for (const button of actionButtons) button.disabled = busy || selected === null;
        for (const button of dialog.querySelectorAll('[data-close]')) button.disabled = busy;
        search.disabled = busy;
        list.setAttribute('aria-disabled', String(busy));
    }
    function select(name, focus = false) {
        selected = name;
        for (const row of list.querySelectorAll('[role="option"]')) {
            const active = row.dataset.name === selected;
            row.setAttribute('aria-selected', String(active)); row.tabIndex = active ? 0 : -1;
            if (active && focus) { row.focus(); row.scrollIntoView({block:'nearest'}); }
        }
        updateControls();
    }
    const run = async action => {
        if (busy || selected === null) return;
        const name = selected;
        busy = true; dialog.setAttribute('aria-busy', 'true'); updateControls();
        status.textContent = '';
        try { await action(name); }
        catch (error) { status.textContent = error.message || 'Could not update saved projects.'; }
        finally { busy = false; dialog.removeAttribute('aria-busy'); if (dialog.open) render(); }
    };
    const actions = {
        open: async name => { if (await onOpen(name)) dialog.close(); },
        rename: async name => {
            const next = await askName('Rename saved project', 'Name', name); if (!next || next === name || !dialog.open) return;
            const updated = copyProjectEntry(readProjectLibrary(), name, next, {move:true});
            writeProjectLibrary(updated); selected = next; onRename?.(name, next); status.textContent = `Renamed to “${next}”.`;
        },
        clone: async name => {
            const next = await askName('Clone saved project', 'Name', projectCopyName(readProjectLibrary(), name)); if (!next || !dialog.open) return;
            writeProjectLibrary(copyProjectEntry(readProjectLibrary(), name, next)); selected = next; status.textContent = `Created “${next}”.`;
        },
        delete: async name => {
            if (!await confirmAction('Delete saved project', `Delete the saved project “${name}” from this browser? The open composition and WAV assets will remain unchanged.`) || !dialog.open) return;
            const updated = readProjectLibrary(); delete updated[name]; writeProjectLibrary(updated); onDelete?.(name);
            const index = visibleNames.indexOf(name);
            selected = visibleNames[index + 1] ?? visibleNames[index - 1] ?? null;
            status.textContent = `Deleted “${name}”.`;
        },
    };
    for (const button of actionButtons) button.onclick = () => run(actions[button.dataset.action]);
    function render() {
        const hadRowFocus = list.contains(document.activeElement);
        const projects = readProjectLibrary(), all = Object.keys(projects);
        visibleNames = all.filter(name => name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())).sort((a,b) => (projects[b].timestamp || 0) - (projects[a].timestamp || 0) || a.localeCompare(b));
        if (!visibleNames.includes(selected)) selected = visibleNames[0] ?? null;
        list.replaceChildren();
        dialog.querySelector('[data-count]').textContent = `${all.length} saved project${all.length === 1 ? '' : 's'}`;
        if (!visibleNames.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = all.length ? 'No matching projects.' : 'No saved projects yet. Use File → Save Project.'; list.append(empty); }
        for (const name of visibleNames) {
            const entry = projects[name], row = document.createElement('div'); row.className = 'project-library-row'; row.setAttribute('role', 'option'); row.setAttribute('aria-label', name); row.dataset.name = name;
            const info = document.createElement('div'); info.className = 'project-library-info';
            const title = document.createElement('strong'); title.textContent = title.title = name;
            const details = document.createElement('small'); details.textContent = `${entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Unknown save date'} · ${entry.seq?.channels?.length ?? 0} channels · ${entry.seq?.patterns?.length ?? 0} patterns`;
            info.append(title, details); row.append(info);
            row.onclick = () => { if (!busy) select(name, true); };
            row.onfocus = () => { if (!busy && selected !== name) select(name); };
            list.append(row);
        }
        select(selected, hadRowFocus);
    }
    list.addEventListener('keydown', e => {
        if (busy || !visibleNames.length) return;
        const index = visibleNames.indexOf(selected);
        const next = {ArrowDown:Math.min(visibleNames.length-1,index+1),ArrowUp:Math.max(0,index-1),Home:0,End:visibleNames.length-1}[e.key];
        if (next !== undefined) { e.preventDefault(); select(visibleNames[next], true); }
        else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); select(selected, true); }
    });
    search.addEventListener('input', () => { if (!busy) render(); });
    for (const button of dialog.querySelectorAll('[data-close]')) button.onclick = () => { if (!busy) dialog.close(); };
    dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
    dialog.addEventListener('close', () => { dialog.remove(); previousFocus?.focus(); }, {once:true});
    document.body.append(dialog); render(); dialog.showModal(); search.focus();
}
