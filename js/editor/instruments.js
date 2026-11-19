const FAMILIES = [
    'Piano', 'Chromatic percussion', 'Organ', 'Guitar', 'Bass', 'Strings', 'Ensemble', 'Brass',
    'Reed', 'Pipe', 'Synth lead', 'Synth pad', 'Synth effects', 'Ethnic', 'Percussive', 'Sound effects',
];

const FALLBACK_KITS = [
    [0, 'Standard'], [8, 'Room'], [16, 'Power'], [24, 'Electronic'], [25, '808/909'],
    [32, 'Jazz'], [40, 'Brush'], [48, 'Orchestral'],
];

export function instrumentFamily({ program = 0, isDrum = false } = {}) {
    return isDrum ? 'Drum kits' : FAMILIES[Math.floor(program / 8)] || FAMILIES[0];
}

export function instrumentCatalog(presets = []) {
    // The GS MIDI writer supports the SoundFont's GM/GS drum kits.
    const supported = presets.filter(p => !p.isDrum || p.isGMGSDrum);
    const melodic = supported.filter(p => !p.isDrum);
    const kits = supported.filter(p => p.isDrum);
    return [
        ...(melodic.length ? melodic : Array.from({ length: 128 }, (_, program) => ({
            name: `${instrumentFamily({ program })} ${program % 8 + 1}`, program, isDrum: false,
        }))),
        ...(kits.length ? kits : FALLBACK_KITS.map(([program, name]) => ({ name, program, isDrum: true }))),
    ].map(({ name, program, isDrum, bankMSB = 0, bankLSB = 0 }) => ({ name, program, isDrum, bankMSB, bankLSB }));
}

export function sameInstrument(a, b) {
    return (a?.program ?? 0) === (b?.program ?? 0) && !!a?.isDrum === !!b?.isDrum &&
        (a?.bankMSB ?? 0) === (b?.bankMSB ?? 0) && (a?.bankLSB ?? 0) === (b?.bankLSB ?? 0);
}

export function instrumentLabel(channel, catalog) {
    if (channel?.presetName) return channel.presetName;
    return catalog.find(p => sameInstrument(p, channel))?.name ?? `${instrumentFamily(channel)} / ${channel?.program ?? 0}`;
}

// Resolve only against real loaded patches. Prefer the same program in the GM
// bank before substituting a different sound, and never turn a drum kit into a piano.
export function adaptToSoundfont(sequence, presets) {
    if (!presets?.length) return 0;
    const list = presets.filter(p => !p.isDrum || p.isGMGSDrum);
    let substitutions = 0;
    for (const channel of sequence.channels) {
        if (channel.kind === 'comment' || channel.created === false || list.some(p => sameInstrument(p, channel))) continue;
        const candidates = list.filter(p => !!p.isDrum === !!channel.isDrum);
        const fallback = candidates.find(p => p.program === channel.program && !p.bankMSB && !p.bankLSB)
            ?? candidates.find(p => p.program === channel.program)
            ?? candidates.find(p => p.program === 0 && !p.bankMSB && !p.bankLSB)
            ?? candidates[0];
        if (!fallback) continue;
        channel.sourcePatch ??= { program: channel.program, bankMSB: channel.bankMSB, bankLSB: channel.bankLSB };
        Object.assign(channel, { program: fallback.program, bankMSB: fallback.bankMSB ?? 0,
            bankLSB: fallback.bankLSB ?? 0, presetName: fallback.name });
        substitutions++;
    }
    return substitutions;
}
