// Playhead timecode is hours:minutes:seconds, with optional millisecond precision.
export function formatPlayheadTime(seconds) {
    const ms = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 1000));
    const pad = (n, width = 2) => String(n).padStart(width, '0');
    const base = `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}`;
    return ms % 1000 ? `${base}.${pad(ms % 1000, 3)}` : base;
}

export function parsePlayheadTime(value) {
    const match = /^(\d{2,}):([0-5]\d):([0-5]\d)(?:[.,](\d{1,3}))?$/.exec(value.trim());
    if (!match) return null;
    const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number((match[4] || '').padEnd(3, '0')) / 1000;
    return Number.isFinite(seconds) ? seconds : null;
}

export function snapPlayheadTick(tick, ticksPerBar, enabled) {
    return Math.max(0, enabled ? Math.round(tick / ticksPerBar) * ticksPerBar : tick);
}
