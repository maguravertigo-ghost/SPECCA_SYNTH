import { TONICS } from '../editor/noteGenerator.js';
import { planPitchRepair, suggestKey } from '../editor/noteRepair.js';

export function choosePitchFix({ notes, selected, beat }) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'arr-dialog-box app-dialog';
        dialog.setAttribute('aria-label', 'Fix notes');
        dialog.innerHTML = `<form method="dialog">
            <h2 class="arr-dialog-title">Fix notes</h2>
            <div class="arr-dialog-body">
                <p class="muted">Move out-of-scale notes to nearby pitches. Timing, note lengths and velocity stay unchanged. Check the suggested key before applying.</p>
                <label class="arr-field"><span>Scope</span><select name="scope">${selected.size ? '<option value="selection">Selected notes</option>' : ''}<option value="all">Whole pattern</option></select></label>
                <label class="arr-field"><span>Key</span><select name="tonic"></select></label>
                <label class="arr-field"><span>Scale</span><select name="mode"><option value="major">Major</option><option value="minor">Natural minor</option><option value="dorian">Dorian</option><option value="mixolydian">Mixolydian</option></select></label>
                <label class="arr-field"><span>Max. shift</span><select name="shift"><option value="1">1 semitone</option><option value="2">2 semitones</option></select></label>
                <p role="status" data-preview></p>
            </div>
            <div class="arr-dialog-footer"><button type="button" data-cancel class="btn">Cancel</button><button value="fix" class="btn btn-primary">Apply FIX</button></div>
        </form>`;
        const form = dialog.querySelector('form'), f = form.elements;
        const auto = suggestKey(notes, beat);
        f.tonic.replaceChildren(...TONICS.map((key, i) => new Option(key, i)));
        f.tonic.value = auto.tonic; f.mode.value = auto.mode;
        const apply = dialog.querySelector('[value="fix"]');
        let result;
        const preview = () => {
            const { changes, skipped } = result = planPitchRepair(notes, { tonic: Number(f.tonic.value), mode: f.mode.value,
                maxShift: Number(f.shift.value), targets: f.scope.value === 'selection' ? selected : null });
            dialog.querySelector('[data-preview]').textContent = `${changes.size} note(s) would change. ${skipped ? `${skipped} outside the scale left unchanged (limit or overlapping pitch).` : ''}`;
            apply.disabled = !changes.size;
        };
        dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => { dialog.remove(); resolve(dialog.returnValue === 'fix' ? result : null); }, { once: true });
        form.addEventListener('change', preview);
        preview(); document.body.append(dialog); dialog.showModal();
    });
}
