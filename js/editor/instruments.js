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
    // Keep every selectable SoundFont patch, including bank-addressed XG/GM2 kits.
    const supported = presets;
    const melodic = supported.filter(p => !p.isDrum);
    const kits = supported.filter(p => p.isDrum);
    return [
        ...(presets.length ? melodic : Array.from({ length: 128 }, (_, program) => ({
            name: `${instrumentFamily({ program })} ${program % 8 + 1}`, program, isDrum: false,
        }))),
        ...(presets.length ? kits : FALLBACK_KITS.map(([program, name]) => ({ name, program, isDrum: true }))),
    ].map(({ name, program, isDrum, isGMGSDrum = !!isDrum, bankMSB = 0, bankLSB = 0 }) => ({ name, program, isDrum, isGMGSDrum, bankMSB, bankLSB }));
}

export function sameInstrument(a, b) {
    return (a?.program ?? 0) === (b?.program ?? 0) && !!(a?.isGMGSDrum ?? a?.isDrum) === !!(b?.isGMGSDrum ?? b?.isDrum) &&
        (a?.bankMSB ?? 0) === (b?.bankMSB ?? 0) && (a?.bankLSB ?? 0) === (b?.bankLSB ?? 0);
}

export function instrumentLabel(channel, catalog) {
    if (channel?.source === 'chiptune') return `Chiptune · ${channel.chip?.name || channel.chip?.wave || 'Pulse'}`;
    if (channel?.presetName) return channel.presetName;
    return catalog.find(p => sameInstrument(p, channel))?.name ?? `${instrumentFamily(channel)} / ${channel?.program ?? 0}`;
}

// Resolve only against real loaded patches. Prefer the same program in the GM
// bank before substituting a different sound, and never turn a drum kit into a piano.
export function adaptToSoundfont(sequence, presets) {
    if (!presets?.length) return 0;
    const list = presets;
    let substitutions = 0;
    for (const channel of sequence.channels) {
        if (channel.source === 'chiptune' || channel.kind === 'comment' || channel.kind === 'audio' || channel.created === false) continue;
        const exact = list.find(p => sameInstrument(p, channel));
        if (exact) { channel.isDrum = !!exact.isDrum; channel.isGMGSDrum = exact.isGMGSDrum ?? !!exact.isDrum; continue; }
        const candidates = list.filter(p => !!p.isDrum === !!channel.isDrum);
        const fallback = candidates.find(p => p.program === channel.program && !p.bankMSB && !p.bankLSB)
            ?? candidates.find(p => p.program === channel.program)
            ?? candidates.find(p => p.program === 0 && !p.bankMSB && !p.bankLSB)
            ?? candidates[0];
        if (!fallback) continue;
        channel.sourcePatch ??= { program: channel.program, bankMSB: channel.bankMSB, bankLSB: channel.bankLSB };
        Object.assign(channel, { program: fallback.program, bankMSB: fallback.bankMSB ?? 0,
            bankLSB: fallback.bankLSB ?? 0, isGMGSDrum:fallback.isGMGSDrum ?? !!fallback.isDrum, presetName: fallback.name });
        substitutions++;
    }
    return substitutions;
}

// Explicit numbering avoids confusing MIDI's zero-based program byte with UI program numbers.
export function instrumentTooltip(channel, label) {
    if (!channel) return '';
    if (channel.source === 'chiptune') return label;
    const patch = p => `Program ${ (p.program ?? 0) + 1 } (MIDI ${p.program ?? 0}) · Bank ${p.bankMSB ?? 0}:${p.bankLSB ?? 0}`;
    const lines = [label, `${channel.isDrum ? 'Drum kit' : instrumentFamily(channel)} · ${patch(channel)}`];
    if (channel.sourcePatch) lines.push(`SoundFont fallback · original: ${patch(channel.sourcePatch)}`);
    if (Number.isInteger(channel.sourceTrack)) lines.push(`MIDI track ${channel.sourceTrack} · port ${channel.sourcePort ?? 0} · channel ${(channel.source ?? 0) + 1}`);
    return lines.join('\n');
}
