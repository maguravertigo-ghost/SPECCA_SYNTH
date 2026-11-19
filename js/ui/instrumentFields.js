import { getSynth } from '../core/synth.js';
import { instrumentCatalog, instrumentFamily, instrumentLabel, sameInstrument } from '../editor/instruments.js';

export const getInstrumentCatalog = () => instrumentCatalog(getSynth()?.soundBankManager.presetList);
export const getInstrumentLabel = (channel) => instrumentLabel(channel, getInstrumentCatalog());

// Shared by the Piano Roll picker and the Arranger channel dialog.
export function mountInstrumentFields(root, current = {}) {
    root.innerHTML = `
        <label class="arr-field"><span>Category</span><select data-category>
            <option value="melodic">Instruments</option><option value="drums">Drums</option>
        </select></label>
        <label class="arr-field" data-family-row><span>Class</span><select data-family></select></label>
        <label class="arr-field"><span data-preset-label>Preset</span><select data-preset></select></label>
    `;
    const category = root.querySelector('[data-category]');
    const family = root.querySelector('[data-family]');
    const preset = root.querySelector('[data-preset]');
    const catalog = getInstrumentCatalog();
    if (!catalog.some(p => sameInstrument(p, current))) {
        catalog.push({ ...current, name: instrumentLabel(current, catalog) });
    }
    category.value = current.isDrum ? 'drums' : 'melodic';
    let choices = [];
    const refreshPresets = (selected) => {
        const drums = category.value === 'drums';
        choices = catalog.filter(p => drums ? p.isDrum : !p.isDrum && instrumentFamily(p) === family.value)
            .sort((a, b) => a.program - b.program || (a.bankMSB ?? 0) - (b.bankMSB ?? 0) || (a.bankLSB ?? 0) - (b.bankLSB ?? 0));
        preset.replaceChildren(...choices.map((p, i) => new Option(
            `${p.name}${p.bankMSB || p.bankLSB ? ` · bank ${p.bankMSB ?? 0}:${p.bankLSB ?? 0}` : ''}`, i,
        )));
        const index = choices.findIndex(p => selected && sameInstrument(p, selected));
        if (index >= 0) preset.value = index;
    };
    const refreshFamilies = (selected) => {
        const drums = category.value === 'drums';
        root.querySelector('[data-family-row]').hidden = drums;
        root.querySelector('[data-preset-label]').textContent = drums ? 'Kit' : 'Preset';
        family.replaceChildren(...[...new Set(catalog.filter(p => !p.isDrum).map(instrumentFamily))]
            .map(name => new Option(name, name)));
        if (selected && !selected.isDrum) family.value = instrumentFamily(selected);
        refreshPresets(selected);
    };
    category.addEventListener('change', () => refreshFamilies());
    family.addEventListener('change', () => refreshPresets());
    refreshFamilies(current);
    return () => {
        const p = choices[preset.selectedIndex];
        return p && { program: p.program ?? 0, isDrum: !!p.isDrum, bankMSB: p.bankMSB ?? 0,
            bankLSB: p.bankLSB ?? 0, presetName: p.name };
    };
}
