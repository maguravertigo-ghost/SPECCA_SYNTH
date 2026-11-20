import { importMidi } from '../editor/importMidi.js';
import { TONICS } from '../editor/noteGenerator.js';
import { generateTrack, TRACK_STYLES } from '../editor/trackGenerator.js';

const MODES = {
    compose: { title: 'Compose a track', help: 'Create a melody, chords, bass and drums. Optionally borrow a melodic shape or rhythm from a MIDI. A borrowed drum pattern takes priority over the groove preset.' },
    variation: { title: 'MIDI variation', help: 'Keep the instruments, clip layout and tempo. Vary the phrasing or rhythm without changing the original pitch classes.' },
    recompose: { title: 'New melody in a MIDI arrangement', help: 'Write new melodic parts and harmony in the source clips. Keep the instruments, timing of the clips, tempo changes and drums.' },
};

export function openTrackGenerator(type) {
    const spec = MODES[type];
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'arr-dialog-box app-dialog track-generator';
        dialog.setAttribute('aria-labelledby', 'trackGeneratorTitle');
        dialog.innerHTML = `<form>
            <h2 class="arr-dialog-title" id="trackGeneratorTitle">${spec.title}</h2>
            <div class="arr-dialog-body">
                <p class="muted">${spec.help} All processing is local.</p>
                ${type !== 'variation' ? `<label class="arr-field"><span>Style</span><select name="style"></select></label>
                    <label class="arr-field"><span>Mood</span><select name="mood"><option value="bright">Bright</option><option value="calm">Calm</option><option value="dramatic">Dramatic</option></select></label>
                    <label class="arr-field"><span>Key</span><select name="tonic"></select></label>` : ''}
                ${type !== 'variation' ? `<label class="arr-field"><span>Development</span><select name="development"><option value="repeat">Repeat sections</option><option value="evolve">Evolving phrases</option></select></label>` : ''}
                ${type === 'compose' ? `<label class="arr-field"><span>Instruments</span><select name="palette"><option value="style">Style preset</option><option value="piano">Piano & strings</option><option value="electric">Electric keys & guitar</option><option value="synth">Synths</option></select></label>
                    <label class="arr-field"><span>Drum groove</span><select name="groove"><option value="style">Style preset</option><option value="euclidean">Euclidean</option></select></label>
                    <label class="arr-field"><span>Length</span><select name="bars"><option value="8">8 bars · sketch</option><option value="16" selected>16 bars · short track</option><option value="32">32 bars</option><option value="64">64 bars</option></select></label>
                    <label class="arr-field"><span>Tempo (BPM)</span><input type="number" name="bpm" required min="45" max="220" value="110"></label>` : ''}
                ${type === 'compose' ? `<label class="arr-field"><span>Use MIDI for</span><select name="sourceUse"><option value="none">No source</option><option value="notes">Melody shape</option><option value="rhythm">Rhythm</option></select></label>` : ''}
                ${type === 'variation' ? `<label class="arr-field"><span>Change</span><select name="sourceUse"><option value="all">Melody and rhythm</option><option value="notes">Melody phrasing</option><option value="rhythm">Rhythm and accents</option></select></label>` : ''}
                <label class="arr-field" data-midi-field><span>Source MIDI</span><input name="midi" type="file" accept=".mid,.midi,audio/midi,audio/x-midi"></label>
                <details><summary>Repeatable variations</summary><label class="arr-field"><span>Seed</span><input type="number" name="seed" required min="0" max="4294967295"></label><p class="muted">Use the same number and settings to recreate a result.</p></details>
                <p class="track-generator-error" role="alert" hidden></p>
            </div>
            <div class="arr-dialog-footer"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn btn-primary" type="submit">Generate track</button></div>
        </form>`;
        const form = dialog.querySelector('form');
        const fields = form.elements;
        if (fields.style) fields.style.replaceChildren(...Object.entries(TRACK_STYLES).map(([id, p]) => new Option(p.title, id)));
        if (fields.tonic) fields.tonic.replaceChildren(...TONICS.map((name, i) => new Option(name, i)));
        if (fields.bpm) fields.style.addEventListener('change', () => { fields.bpm.value = TRACK_STYLES[fields.style.value].bpm; });
        fields.seed.value = Math.floor(Math.random() * 4294967296);
        const wantsMIDI = () => type !== 'compose' || fields.sourceUse.value !== 'none';
        const showMIDI = () => {
            dialog.querySelector('[data-midi-field]').hidden = !wantsMIDI();
            fields.midi.required = wantsMIDI();
        };
        fields.sourceUse?.addEventListener('change', showMIDI);
        showMIDI();
        let result = null;
        dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
        const submit = form.querySelector('[type="submit"]');
        const error = dialog.querySelector('[role="alert"]');
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (submit.disabled) return;
            submit.disabled = true;
            error.hidden = true;
            const { style, mood, palette, groove, tonic, bars, bpm, seed, sourceUse, development } = Object.fromEntries(new FormData(form));
            try {
                let source = null;
                if (wantsMIDI()) {
                    const file = fields.midi.files[0];
                    if (file.size > 8 * 1024 * 1024) throw new Error('Choose a MIDI file of at most 8 MiB.');
                    const bytes = await file.arrayBuffer();
                    if (!dialog.open) return;
                    try { source = importMidi(bytes, file.name); }
                    catch { throw new Error('Could not read this MIDI file. Choose a valid .mid or .midi file.'); }
                }
                result = generateTrack({ type, source, sourceUse, style, mood, palette, groove, tonic, bars, bpm, seed, evolution: development === 'evolve' });
                dialog.close();
            } catch (err) {
                error.textContent = err.message;
                error.hidden = false;
            } finally {
                submit.disabled = false;
            }
        });
        dialog.addEventListener('close', () => { dialog.remove(); resolve(result); }, { once: true });
        document.body.append(dialog);
        dialog.showModal();
    });
}
