import { TONICS, DRUM_GROOVES, DRUM_SECTIONS, MELODIC_SECTIONS, MUSIC_PRESETS } from '../editor/noteGenerator.js';

export function chooseGeneratedNotes({ isDrum, hasNotes, defaults = {} }) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'arr-dialog-box app-dialog';
        dialog.setAttribute('aria-label', 'Generate notes');
        dialog.innerHTML = `<form method="dialog">
            <h2 class="arr-dialog-title">Generate ${isDrum ? 'drum groove' : 'notes'}</h2>
            <div class="arr-dialog-body">
                ${isDrum ? '' : `<label class="arr-field"><span>Key</span><select name="tonic"></select></label>
                <label class="arr-field"><span>Scale</span><select name="mode"><option value="major">Major</option><option value="minor">Minor</option></select></label>`}
                <label class="arr-field"><span>${isDrum ? 'Groove' : 'Rhythm'}</span><select name="style"></select></label>
                ${!isDrum ? '<label class="arr-field"><span>Genre</span><select name="preset"><option value="">Classic / neutral</option></select></label>' : ''}
                <label class="arr-field"><span>Section</span><select name="section"></select></label>
                ${hasNotes ? `<label class="arr-field"><span>Existing notes</span><select name="operation"><option value="replace">Replace</option><option value="append">Keep and add</option></select></label>` : ''}
                <p class="muted">Fills the current pattern with editable notes. Undo restores the previous notes.</p>
            </div>
            <div class="arr-dialog-footer"><button class="btn" value="cancel">Cancel</button><button class="btn btn-primary" value="generate">Generate</button></div>
        </form>`;
        const form = dialog.querySelector('form');
        const fields = form.elements;
        if (!isDrum) {
            fields.tonic.replaceChildren(...TONICS.map((name, i) => new Option(name, i)));
            fields.tonic.value = defaults.tonic ?? '0';
            fields.mode.value = defaults.mode ?? 'major';
            fields.preset.append(...Object.entries(MUSIC_PRESETS).map(([id, p]) => new Option(p.title, id)));
            fields.preset.value = defaults.preset ?? '';
        }
        const rhythms = isDrum ? DRUM_GROOVES
            : [['Chords', 'chords'], ['Melody', 'melody'], ['Bass line', 'bass'], ['Arpeggio', 'arpeggio'], ['Syncopated chords', 'syncopated']];
        fields.style.replaceChildren(...rhythms.map(args => new Option(...args)));
        if (rhythms.some(([, value]) => defaults.style === value)) fields.style.value = defaults.style;
        const sections = isDrum ? DRUM_SECTIONS : MELODIC_SECTIONS;
        fields.section.replaceChildren(...sections.map(args => new Option(...args)));
        if (sections.some(([, value]) => defaults.section === value)) fields.section.value = defaults.section;
        dialog.addEventListener('close', () => {
            const result = dialog.returnValue === 'generate' ? {
                style: fields.style.value, section: fields.section?.value, preset: fields.preset?.value, tonic: Number(fields.tonic?.value ?? 0), mode: fields.mode?.value,
                replace: fields.operation?.value === 'replace',
            } : null;
            dialog.remove(); resolve(result);
        }, { once: true });
        document.body.append(dialog); dialog.showModal();
        (fields.tonic ?? fields.style).focus();
    });
}
