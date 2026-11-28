import { CHIP_PRESETS, chipSettings } from '../editor/chiptune.js';
import { getSynth } from '../core/synth.js';
import { instrumentCatalog, instrumentFamily, instrumentLabel, sameInstrument } from '../editor/instruments.js';

export const getInstrumentCatalog = () => instrumentCatalog(getSynth()?.presetList?.filter(p => !(/^Chip \d+$/.test(p.name) && p.bankMSB>=100 && p.bankMSB<=115)));
export const getInstrumentLabel = (channel) => instrumentLabel(channel, getInstrumentCatalog());

// Shared by the Piano Roll picker and the Arranger channel dialog.
export function mountInstrumentFields(root, current = {}, { allowComment = false } = {}) {
    root.innerHTML = `
        <label class="arr-field"><span>Category</span><select data-category>
            <option value="chip">Chiptune Synth</option><option value="melodic">SoundFont instruments</option><option value="drums">Drums</option>
            ${allowComment ? '<option value="comment">Comment</option>' : ''}
        </select></label>
        <label class="arr-field" data-bank-row><span>Bank / variation</span><select data-bank></select></label>
        <label class="arr-field" data-family-row><span>Class</span><select data-family></select></label>
        <label class="arr-field" data-preset-row><span data-preset-label>Preset</span><select data-preset></select></label>
    `;
    const searchRow=document.createElement('label');searchRow.className='arr-field';searchRow.innerHTML='<span>Search presets (all banks / classes)</span><input type="search" data-preset-search placeholder="Name or program number…">';root.querySelector('[data-bank-row]').before(searchRow);
    const search=searchRow.querySelector('input');
    const help=document.createElement('p');help.className='muted preset-number-help';help.textContent='Choose the preset by name. Program 1–128 is the instrument number (MIDI stores 0–127). Bank MSB:LSB selects a variation, not the program. Gaps mean this SoundFont has no preset at that address. All banks / All classes show the full category.';root.append(help);
    const chipPanel = document.createElement('div');
    chipPanel.dataset.chipPanel='';
    chipPanel.innerHTML=`<label class="arr-field"><span>Chip preset</span><select data-chip-preset></select></label>
        <label class="arr-field"><span>Wave</span><select data-chip-wave><option value="pulse">Pulse</option><option value="triangle">Triangle</option><option value="noise">Noise</option></select></label>
        ${[['duty','Pulse width (0–1)',.05,.95,.001],['attack','Attack (s)',.001,4,.001],['decay','Decay (s)',.005,4,.005],['sustain','Sustain',0,1,.01],['release','Release (s)',.005,4,.005]].map(([id,label,min,max,step])=>`<div class="arr-field chip-parameter"><span>${label}</span><div class="chip-value-controls"><input type="number" aria-label="${label}" data-chip-${id} min="${min}" max="${max}" step="${step}"><input type="range" aria-label="${label} slider" data-chip-slider="${id}" min="${min}" max="${max}" step="${step}"></div></div>`).join('')}
        <p class="muted">Procedural looped waves + ADSR. Polyphonic, not a hardware NES emulator. Uses the same mixer, automation and effects sends.</p>`;
    root.append(chipPanel);
    const chipPreset=root.querySelector('[data-chip-preset]');
    chipPreset.replaceChildren(new Option('Custom',''),...Object.entries(CHIP_PRESETS).map(([id,p])=>new Option(p.name,id)));
    let chipConfig=chipSettings(current.chip);
    let chipName=current.chip?.name || CHIP_PRESETS.lead.name;
    const syncChipSliders=()=>{
        for(const slider of chipPanel.querySelectorAll('[data-chip-slider]')) {
            const number=root.querySelector(`[data-chip-${slider.dataset.chipSlider}]`);
            if(Number.isFinite(number.valueAsNumber)) slider.value=number.value;
        }
    };
    for(const slider of chipPanel.querySelectorAll('[data-chip-slider]')) {
        const number=root.querySelector(`[data-chip-${slider.dataset.chipSlider}]`);
        slider.addEventListener('input',()=>{number.value=slider.value;});
        number.addEventListener('input',syncChipSliders);
    }
    const fillChip=settings=>{chipConfig=chipSettings(settings);chipName=settings.name;for(const id of ['wave','duty','attack','decay','sustain','release'])root.querySelector(`[data-chip-${id}]`).value=settings[id];syncChipSliders();};
    fillChip(chipSettings(current.chip));
    chipPreset.addEventListener('change',()=>{if(CHIP_PRESETS[chipPreset.value])fillChip(CHIP_PRESETS[chipPreset.value]);});
    const category = root.querySelector('[data-category]');
    const bank = root.querySelector('[data-bank]');
    const bankKey = p => `${p.bankMSB ?? 0}:${p.bankLSB ?? 0}`;
    const family = root.querySelector('[data-family]');
    const preset = root.querySelector('[data-preset]');
    const catalog = getInstrumentCatalog().filter(p => !(/^Chip \d+$/.test(p.name) && p.bankMSB>=100 && p.bankMSB<=115));
    if (!catalog.some(p => sameInstrument(p, current))) {
        catalog.push({ ...current, name: instrumentLabel(current, catalog) });
    }
    category.value = allowComment && current.kind === 'comment' ? 'comment' : current.source === 'chiptune' ? 'chip' : current.isDrum ? 'drums' : 'melodic';
    let choices = [];
    const available = () => catalog.filter(p => !!p.isDrum === (category.value === 'drums') && (search.value.trim() || !bank.value || bankKey(p) === bank.value));
    const refreshPresets = (selected) => {
        const drums = category.value === 'drums';
        choices = available().filter(p => drums || !family.value || search.value.trim() || instrumentFamily(p) === family.value).filter(p=>!search.value.trim()||`${p.name} ${p.program+1}`.toLowerCase().includes(search.value.trim().toLowerCase()))
            .sort((a, b) => a.program - b.program || (a.bankMSB ?? 0) - (b.bankMSB ?? 0) || (a.bankLSB ?? 0) - (b.bankLSB ?? 0));
        preset.replaceChildren(...choices.map((p, i) => new Option(
            `${p.name} · Program ${p.program+1} (MIDI ${p.program}) · Bank ${p.bankMSB??0}:${p.bankLSB??0}`, i,
        )));
        const index = choices.findIndex(p => selected && sameInstrument(p, selected));
        if (index >= 0) preset.value = index;
        preset.title=preset.selectedOptions[0]?.textContent??'';
    };
    const refreshFamilies = (selected) => {
        const drums = category.value === 'drums';
        root.querySelector('[data-family-row]').hidden = drums || category.value === 'comment';
        root.querySelector('[data-preset-label]').textContent = drums ? 'Kit' : 'Preset';
        family.replaceChildren(new Option('All classes',''),...[...new Set(available().filter(p => !p.isDrum).map(instrumentFamily))]
            .map(name => new Option(name, name)));
        family.value='';
        refreshPresets(selected);
    };
    const refreshBanks = selected => {
        const keys = [...new Set(catalog.filter(p => !!p.isDrum === (category.value === 'drums')).map(bankKey))]
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        bank.replaceChildren(new Option('All banks', ''), ...keys.map(key => new Option(`Bank ${key} · ${catalog.filter(p=>bankKey(p)===key&&!!p.isDrum===(category.value==='drums')).length} presets`, key)));
        root.querySelector('[data-bank-row]').hidden = category.value === 'comment' || keys.length < 2;
        root.querySelector('[data-preset-row]').hidden = category.value === 'comment';
        bank.value='';
        refreshFamilies(selected);
        chipPanel.hidden = category.value !== 'chip';
        searchRow.hidden=['chip','comment'].includes(category.value);
        help.hidden=searchRow.hidden;
        if (category.value === 'chip') for(const row of root.querySelectorAll('[data-bank-row],[data-family-row],[data-preset-row]')) row.hidden=true;
    };
    preset.addEventListener('change',()=>{preset.title=preset.selectedOptions[0]?.textContent??'';});
    search.addEventListener('input',()=>refreshPresets());
    category.addEventListener('change', () => {search.value='';refreshBanks();});
    bank.addEventListener('change', () => refreshFamilies());
    family.addEventListener('change', () => refreshPresets());
    refreshBanks(current);
    const read = () => {
        if (category.value === 'comment') return { kind: 'comment' };
        if (category.value === 'chip') {
            const chip={...chipConfig,name:chipName};
            for(const id of ['wave','duty','attack','decay','sustain','release']) { const value=root.querySelector(`[data-chip-${id}]`).value; chip[id]=id==='wave'?value:Number(value); }
            return {source:'chiptune',chip:chipSettings(chip),isDrum:false,isGMGSDrum:false,program:current.program??80,bankMSB:current.bankMSB??0,bankLSB:current.bankLSB??0,kind:'instrument'};
        }
        const p = choices[preset.selectedIndex];
        return p && { source: 'soundfont', chip: null, program: p.program ?? 0, isDrum: !!p.isDrum, isGMGSDrum:p.isGMGSDrum ?? !!p.isDrum, bankMSB: p.bankMSB ?? 0,
            bankLSB: p.bankLSB ?? 0, presetName: p.name, ...(allowComment ? { kind: 'instrument' } : {}) };
    };
    read.category = category;
    return read;
}
