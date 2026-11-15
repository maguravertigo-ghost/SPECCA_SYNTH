// js/editor/exportMidi.js
const DEFAULT_PPQ = 480;

function writeVarLen(v) {
    const b = [v & 0x7F];
    v >>= 7;
    while (v > 0) { b.unshift((v & 0x7F) | 0x80); v >>= 7; }
    return b;
}

export function writeMIDIFromSequence(sequence, opts = {}) {
    if (!sequence) throw new Error('writeMIDIFromSequence: no sequence');

    const {
        playMode        = 'track',
        activeChannel   = null,
        useAnchor       = true,
        velocity        = 90,
        stepsPerBar     = 4,
        barsPerLoop     = 4,
    } = opts;

    const ppq       = Math.max(1, sequence.timeDivision || DEFAULT_PPQ);
    const bpm       = Math.max(1, sequence.tempo || 120);
    const tempoUs   = Math.max(1, Math.round(60000000 / bpm));
    const stepTicks = Math.max(1, Math.round(ppq / 4)); // 1/16
    const totalSteps = stepsPerBar * barsPerLoop;
    const loopEnd   = totalSteps * stepTicks;

    const channels = sequence.channels || [];
    const patterns = sequence.patterns || [];

    const chanInfo = (ch) => channels.find(c => c.channel === ch) || channels[ch] || {};

    const activeChannels = new Set();
    if (playMode === 'solo' && activeChannel != null) {
        activeChannels.add(activeChannel);
    } else {
        for (const p of patterns)
            for (const n of (p.notes || []))
                if (typeof n.track === 'number') activeChannels.add(n.track);
        if (activeChannels.size === 0) {
            // пусть будет хотя бы канал 0, чтобы якорь был всегда
            activeChannels.add(0);
        }
    }

    const events = [];

    // Программы/драм-банк
    for (const ch of activeChannels) {
        const info    = chanInfo(ch);
        const isDrum  = info.isDrum || ch === 9;
        const program = info.program ?? 0;
        if (isDrum) {
            events.push({ tick: 0, type: 'cc',      ch, cc: 0,  value: 120, order: -3 });
            events.push({ tick: 0, type: 'cc',      ch, cc: 32, value: 0,   order: -2 });
            events.push({ tick: 0, type: 'program', ch, program,            order: -1 });
        } else {
            events.push({ tick: 0, type: 'program', ch, program,            order: -1 });
        }
    }

    // Ноты (клипаем по loopEnd)
    for (const p of patterns) {
        for (const n of (p.notes || [])) {
            const ch = n.track;
            if (!activeChannels.has(ch)) continue;
            const start = Math.max(0, n.tick | 0);
            if (start >= loopEnd) continue;
            const end   = Math.min(loopEnd, start + Math.max(1, n.dur | 0));
            const dur   = Math.max(1, end - start);
            const vel   = n.ghost ? 1 : (n.vel ?? velocity);
            events.push({ tick: start,       type: 'on',  ch, pitch: n.key, vel, order: 1 });
            events.push({ tick: start + dur, type: 'off', ch, pitch: n.key,     order: 0 });
        }
    }

    // НЕВИДИМАЯ НОТА: стартовый якорь на tick 0 (форсирует loop.start = 0)
    //               + конечный якорь на loopEnd - stepTicks (форсирует loop.end = loopEnd)
    if (useAnchor) {
        const endAnchorStart = Math.max(0, loopEnd - stepTicks);
        for (const ch of activeChannels) {
            events.push({ tick: 0,              type: 'on',  ch, pitch: 0, vel: 1, order: -2 });
            events.push({ tick: 1,              type: 'off', ch, pitch: 0,         order: 1 });
            events.push({ tick: endAnchorStart, type: 'on',  ch, pitch: 0, vel: 1, order: 1 });
            events.push({ tick: loopEnd,        type: 'off', ch, pitch: 0,         order: 0 });
        }
    }

    events.sort((a, b) => a.tick - b.tick || a.order - b.order);

    const td = [];
    td.push(0x00, 0xFF, 0x51, 0x03,
        (tempoUs >> 16) & 0xFF, (tempoUs >> 8) & 0xFF, tempoUs & 0xFF);
    td.push(0x00, 0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);

    let last = 0;
    for (const ev of events) {
        td.push(...writeVarLen(ev.tick - last));
        if (ev.type === 'cc')          td.push(0xB0 | (ev.ch & 0x0F), ev.cc & 0x7F, ev.value & 0x7F);
        else if (ev.type === 'program') td.push(0xC0 | (ev.ch & 0x0F), ev.program & 0x7F);
        else if (ev.type === 'on')      td.push(0x90 | (ev.ch & 0x0F), ev.pitch & 0x7F, ev.vel & 0x7F);
        else if (ev.type === 'off')     td.push(0x80 | (ev.ch & 0x0F), ev.pitch & 0x7F, 0x40);
        last = ev.tick;
    }
    td.push(0x00, 0xFF, 0x2F, 0x00);

    const header = [
        0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6,
        0, 0, 0, 1, (ppq >> 8) & 0xFF, ppq & 0xFF,
    ];
    const trackHeader = [
        0x4D, 0x54, 0x72, 0x6B,
        (td.length >> 24) & 0xFF, (td.length >> 16) & 0xFF,
        (td.length >> 8) & 0xFF, td.length & 0xFF,
    ];
    const out = new Uint8Array(header.length + trackHeader.length + td.length);
    out.set(header, 0);
    out.set(trackHeader, header.length);
    out.set(td, header.length + trackHeader.length);
    return out.buffer;
}

// js/editor/exportMidi.js — добавить в конец файла
export function writeArrangementMIDI(sequence) {
    if (!sequence) throw new Error('writeArrangementMIDI: no sequence');

    const ppq       = Math.max(1, sequence.timeDivision || 480);
    const bpm       = Math.max(1, sequence.tempo || 120);
    const tempoUs   = Math.max(1, Math.round(60000000 / bpm));
    const channels  = sequence.channels || [];
    const patterns  = sequence.patterns || [];
    const placements= sequence.arrangement || [];

    const chanInfo = (ch) => channels.find(c => c.channel === ch) || {};

    const events = [];
    const activeChannels = new Set();

    // Ноты: для каждого плейсмента берём ноты паттерна и сдвигаем по startTick
    for (const pl of placements) {
        const pat = patterns.find(p => p.id === pl.patternId);
        if (!pat) continue;
        for (const n of (pat.notes || [])) {
            const ch = n.track;
            if (typeof ch !== 'number') continue;
            activeChannels.add(ch);
            const start = pl.startTick + Math.max(0, n.tick | 0);
            const dur   = Math.max(1, n.dur | 0);
            const vel   = n.ghost ? 1 : (n.vel ?? 90);
            events.push({ tick: start,       type: 'on',  ch, pitch: n.key, vel, order: 1 });
            events.push({ tick: start + dur, type: 'off', ch, pitch: n.key,     order: 0 });
        }
    }

    // Программы
    for (const ch of activeChannels) {
        const info    = chanInfo(ch);
        const isDrum  = info.isDrum || ch === 9;
        const program = info.program ?? 0;
        if (isDrum) {
            events.push({ tick: 0, type: 'cc',      ch, cc: 0,  value: 120, order: -3 });
            events.push({ tick: 0, type: 'cc',      ch, cc: 32, value: 0,   order: -2 });
            events.push({ tick: 0, type: 'program', ch, program,            order: -1 });
        } else {
            events.push({ tick: 0, type: 'program', ch, program,            order: -1 });
        }
    }

    events.sort((a, b) => a.tick - b.tick || a.order - b.order);

    const td = [];
    td.push(0x00, 0xFF, 0x51, 0x03,
        (tempoUs >> 16) & 0xFF, (tempoUs >> 8) & 0xFF, tempoUs & 0xFF);
    td.push(0x00, 0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);

    let last = 0;
    for (const ev of events) {
        td.push(...writeVarLen(ev.tick - last));
        if (ev.type === 'cc')           td.push(0xB0 | (ev.ch & 0x0F), ev.cc & 0x7F, ev.value & 0x7F);
        else if (ev.type === 'program') td.push(0xC0 | (ev.ch & 0x0F), ev.program & 0x7F);
        else if (ev.type === 'on')      td.push(0x90 | (ev.ch & 0x0F), ev.pitch & 0x7F, ev.vel & 0x7F);
        else if (ev.type === 'off')     td.push(0x80 | (ev.ch & 0x0F), ev.pitch & 0x7F, 0x40);
        last = ev.tick;
    }
    td.push(0x00, 0xFF, 0x2F, 0x00);

    const header = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ppq >> 8) & 0xFF, ppq & 0xFF];
    const trackHeader = [
        0x4D, 0x54, 0x72, 0x6B,
        (td.length >> 24) & 0xFF, (td.length >> 16) & 0xFF,
        (td.length >> 8)  & 0xFF, td.length         & 0xFF,
    ];
    const out = new Uint8Array(header.length + trackHeader.length + td.length);
    out.set(header, 0);
    out.set(trackHeader, header.length);
    out.set(td, header.length + trackHeader.length);
    return out.buffer;
}