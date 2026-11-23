import { splitGroups } from './channelSplit.js';
// js/editor/sequence.js

const DEFAULT_TPQ = 480;

let nextId = 0;
function makeId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6) + '_' + (++nextId).toString(36);
}

export class Sequence {
    constructor(data = {}) {
        this.version = 1;
        this.name = data.name ?? 'Untitled';
        this.tempo = data.tempo ?? 120;
        this.tempoChanges = data.tempoChanges ?? [];
        this.effects = data.effects ?? null;
        this.timeDivision = data.timeDivision ?? DEFAULT_TPQ;
        this.stepsPerBar = data.stepsPerBar ?? 16;
        this.patternLengthTicks = data.patternLengthTicks ?? this.timeDivision * 4 * 4;
        this.channels = data.channels ?? [
            { channel: 0, program: 0, isDrum: false, volume: 100, pan: 64 },
            { channel: 1, program: 0, isDrum: false, volume: 100, pan: 64 },
            { channel: 2, program: 0, isDrum: false, volume: 100, pan: 64 },
            { channel: 9, program: 0, isDrum: true,  volume: 100, pan: 64 },
        ];
        this.channelOrder = data.channelOrder ?? [];
        this.patternCounters = data.patternCounters ?? {};
        this.patterns = data.patterns ?? [];
        this.arrangement = data.arrangement ?? [];
    }

    static create() { return new Sequence(); }
    static fromJSON(input) {
        const data = typeof input === 'string' ? JSON.parse(input) : input;
        // Older saves omitted pattern.channel and could mix several tracks in one pattern.
        const seq = new Sequence(data);
        const patterns = [];
        const extraPlacements = [];
        for (const pattern of seq.patterns) {
            const notes = pattern.notes || [];
            const channel = pattern.channel ?? notes[0]?.track ?? 0;
            const byChannel = new Map([[channel, []]]);
            for (const note of notes) {
                const track = note.track ?? channel;
                if (!byChannel.has(track)) byChannel.set(track, []);
                byChannel.get(track).push({ ...note, track });
            }
            for (const [track, trackNotes] of byChannel) {
                const id = track === channel ? pattern.id : makeId('pat');
                patterns.push({ ...pattern, id, channel: track, notes: trackNotes });
                if (id === pattern.id) continue;
                for (const placement of seq.arrangement.filter(p => p.patternId === pattern.id)) {
                    extraPlacements.push({ ...placement, id: makeId('pl'), patternId: id });
                }
            }
        }
        seq.patterns = patterns;
        seq.arrangement = [...seq.arrangement, ...extraPlacements];
        return seq;
    }
    toJSON(indent = 2) {
        return JSON.stringify({
            version: this.version,
            name: this.name,
            tempo: this.tempo,
            tempoChanges: this.tempoChanges,
            effects: this.effects,
            timeDivision: this.timeDivision,
            stepsPerBar: this.stepsPerBar,
            patternLengthTicks: this.patternLengthTicks,
            channels: this.channels,
            channelOrder: this.channelOrder,
            patternCounters: this.patternCounters,
            patterns: this.patterns,
            arrangement: this.arrangement,
        }, null, indent);
    }

    getPattern(id) {
        return this.patterns.find(p => p.id === id) ?? null;
    }

    addPattern({ name = 'Pattern', lengthTicks = this.timeDivision * 4, channel = 0 } = {}) {
        const p = { id: makeId('pat'), name, lengthTicks, channel, notes: [] };
        this.patterns.push(p);
        return p;
    }

    getChannelPattern(channel) {
        return this.patterns.find(p => p.channel === channel) ?? null;
    }

    get ticksPerBar() { return Math.max(1, Math.round(this.timeDivision * this.stepsPerBar / 4)); }

    patternResizeBounds(id) {
        const pattern = this.getPattern(id);
        if (!pattern) return null;
        const bar = this.ticksPerBar;
        const lastNote = pattern.notes.reduce((end, note) => Math.max(end, note.tick + note.dur), 0);
        const minBars = Math.max(1, Math.ceil(lastNote / bar));
        let maxBars = 1024;
        const ids = new Set(this.patterns.filter(p => p.channel === pattern.channel).map(p => p.id));
        const lane = this.arrangement.filter(c => ids.has(c.patternId)).sort((a, b) => a.startTick - b.startTick);
        // Resizing one definition changes each of its placements.
        for (let i = 0; i < lane.length - 1; i++) {
            if (lane[i].patternId === id) maxBars = Math.min(maxBars, Math.floor((lane[i + 1].startTick - lane[i].startTick) / bar));
        }
        return { minBars, maxBars };
    }

    resizePattern(id, bars) {
        const pattern = this.getPattern(id);
        if (!pattern || !Number.isSafeInteger(bars) || bars < 1 || bars > 1024) throw new Error('Enter a length from 1 to 1024 bars.');
        const length = bars * this.ticksPerBar;
        if (length === pattern.lengthTicks) return false;
        const { minBars, maxBars } = this.patternResizeBounds(id);
        if (bars < minBars) throw new Error('Move or shorten notes beyond the new end first.');
        if (length > pattern.lengthTicks && bars > maxBars) {
            throw new Error('Not enough room: at least one copy would overlap the next clip.');
        }
        pattern.lengthTicks = length;
        return true;
    }

    createChannelPattern(channel) {
        const prefix = `${channel + 1}.`;
        const highest = this.patterns.reduce((max, p) => {
            if (p.channel !== channel || !p.name?.startsWith(prefix)) return max;
            const number = Number(p.name.slice(prefix.length));
            return Number.isSafeInteger(number) ? Math.max(max, number) : max;
        }, this.patternCounters[channel] ?? 0);
        this.patternCounters[channel] = highest + 1;
        return this.addPattern({ name: `${prefix}${highest + 1}`, channel, lengthTicks: this.patternLengthTicks });
    }

    ensureChannelPattern(channel) {
        return this.getChannelPattern(channel) ?? this.createChannelPattern(channel);
    }

    orderedChannels() {
        const channels = new Map(this.channels.filter(c => c.created !== false).sort((a,b) => a.channel - b.channel).map(c => [c.channel, c]));
        const ordered = [];
        for (const id of this.channelOrder) {
            if (!channels.has(id)) continue;
            ordered.push(channels.get(id));
            channels.delete(id);
        }
        return [...ordered, ...channels.values()];
    }

    moveChannel(channel, step) {
        const order = this.orderedChannels().map(c => c.channel);
        const index = order.indexOf(channel), other = index + step;
        if (index < 0 || other < 0 || other >= order.length) return false;
        [order[index], order[other]] = [order[other], order[index]];
        this.channelOrder = order;
        return true;
    }

    cloneChannel(channel) {
        const source = this.channels.find(c => c.channel === channel && c.created !== false);
        if (!source) return null;
        const used = new Set(this.orderedChannels().map(c => c.channel));
        // Free MIDI lane, independent of the visual position; never remap existing notes.
        const lanes = Array.from({ length: 128 * 16 }, (_, i) => i);
        const lane = lanes.find(i => !used.has(i) && (i % 16 === 9) === !!source.isDrum && (source.isDrum ? i < 16 : true))
            ?? lanes.find(i => !used.has(i));
        if (lane === undefined) return null;
        const name = `${source.name || `Ch ${channel + 1}`} (copy)`;
        const order = [...used];
        order.splice(order.indexOf(channel) + 1, 0, lane);
        this.channelOrder = order;
        const clone = { ...structuredClone(source), channel: lane, name, created: true };
        this.channels = this.channels.filter(c => c.channel !== lane);
        this.channels.push(clone);
        delete this.patternCounters[lane];
        const originals = this.patterns.filter(p => p.channel === channel);
        const copies = new Map();
        for (const original of originals) {
            const copy = this.createChannelPattern(lane);
            const suffix = original.name?.replace(/^\d+\.\d+\s*(?:·\s*)?/, '');
            if (suffix) copy.name += ` · ${suffix}`;
            copy.lengthTicks = original.lengthTicks;
            if (original.automation) copy.automation = structuredClone(original.automation);
            if (original.comment !== undefined) copy.comment = original.comment;
            copy.notes = original.notes.map(n => ({ ...n, id: makeId('n'), track: lane }));
            copies.set(original.id, copy.id);
        }
        for (const clip of [...this.arrangement]) {
            if (copies.has(clip.patternId)) this.placePattern(copies.get(clip.patternId), clip.startTick);
        }
        return clone;
    }

    splitChannel(channel, mode = 'families') {
        const source=this.channels.find(c=>c.channel===channel&&c.created!==false);
        if(!source||source.kind==='comment')return [];
        const patterns=this.patterns.filter(p=>p.channel===channel);
        const groups=splitGroups(patterns,{mode,isDrum:source.isDrum});
        if(groups.length<2)return [];
        const order=this.orderedChannels().map(c=>c.channel), used=new Set(order);
        const free=Array.from({length:128*16},(_,i)=>i).filter(i=>!used.has(i));
        if(free.length<groups.length-1)throw new Error('Not enough free MIDI channels to split this part.');
        // Plan the complete split before changing the project. Repeats reuse each
        // new subpattern, so later note edits still update every repeated clip.
        const base=structuredClone(source), placements=[...this.arrangement];
        const originalNotes=new Map(patterns.map(p=>[p.id,structuredClone(p.notes)]));
        const result=[];
        for(const [index,group] of groups.entries()) {
            const lane=index===0?channel:free[index-1];
            const info={...structuredClone(base),channel:lane,name:`${base.name||'Channel'} · ${group.name}`,created:true};
            result.push(info);
            const keys=new Set(group.keys);
            for(const original of patterns) {
                const notes=originalNotes.get(original.id).filter(n=>keys.has(n.key));
                if(index===0) { original.notes=notes.map(n=>({...n,track:lane}));continue; }
                if(!notes.length)continue;
                const copy={...structuredClone(original),id:makeId('pat'),channel:lane,
                    name:`${original.name} · ${group.name}`,
                    notes:notes.map(n=>({...n,id:makeId('n'),track:lane}))};
                this.patterns.push(copy);
                for(const placement of placements.filter(p=>p.patternId===original.id))this.arrangement.push({...placement,id:makeId('pl'),patternId:copy.id});
            }
        }
        const lanes=new Set(result.map(c=>c.channel));
        this.channels=this.channels.filter(c=>!lanes.has(c.channel));
        this.channels.push(...result);
        order.splice(order.indexOf(channel),1,...result.map(c=>c.channel));this.channelOrder=order;
        for(const info of result)delete this.patternCounters[info.channel];
        return result;
    }

    mergeNextChannel(channel) {
        const ordered = this.orderedChannels();
        const target = ordered.find(c => c.channel === channel);
        const source = ordered[ordered.indexOf(target) + 1];
        if (!target || !source || target.kind === 'comment' || source.kind === 'comment') return null;
        // Retain pattern identities and every placement, including overlapping clips.
        for (const pattern of this.patterns.filter(p => p.channel === source.channel)) {
            pattern.channel = target.channel;
            for (const note of pattern.notes) note.track = target.channel;
        }
        this.channels = this.channels.filter(c => c !== source);
        this.channelOrder = this.channelOrder.filter(c => c !== source.channel);
        delete this.patternCounters[source.channel];
        return source;
    }

    swapChannels(first, second) {
        const swap = channel => channel === first ? second : channel === second ? first : channel;
        for (const channel of this.channels) channel.channel = swap(channel.channel);
        for (const pattern of this.patterns) {
            pattern.channel = swap(pattern.channel);
            for (const note of pattern.notes) note.track = swap(note.track);
        }
    }

    removePattern(id) {
        this.patterns = this.patterns.filter(p => p.id !== id);
        this.arrangement = this.arrangement.filter(a => a.patternId !== id);
    }

    addNote(patternId, { track, key, vel = 100, tick, dur = this.timeDivision / 2 }) {
        const p = this.getPattern(patternId);
        if (!p) throw new Error('No pattern ' + patternId);
        const n = { id: makeId('n'), track, key, vel, tick, dur };
        p.notes.push(n);
        return n;
    }

    removeNote(patternId, noteId) {
        const p = this.getPattern(patternId);
        if (!p) return false;
        const before = p.notes.length;
        p.notes = p.notes.filter(n => n.id !== noteId);
        return p.notes.length !== before;
    }

    placePattern(patternId, startTick) {
        const pl = { id: makeId('pl'), patternId, startTick };
        this.arrangement.push(pl);
        return pl;
    }

    tempoAt(tick) {
        let tempo = this.tempo;
        for (const change of this.tempoChanges) {
            if (change.tick > tick) break;
            tempo = change.tempo;
        }
        return tempo;
    }

    ticksToSeconds(tick) {
        let time = 0, last = 0, tempo = this.tempo;
        for (const change of this.tempoChanges) {
            if (change.tick > tick) break;
            time += (change.tick - last) * 60 / (tempo * this.timeDivision);
            last = change.tick;
            tempo = change.tempo;
        }
        return time + (tick - last) * 60 / (tempo * this.timeDivision);
    }

    secondsToTicks(seconds) {
        let tick = 0, tempo = this.tempo;
        for (const change of this.tempoChanges) {
            const duration = (change.tick - tick) * 60 / (tempo * this.timeDivision);
            if (seconds < duration) break;
            seconds -= duration;
            tick = change.tick;
            tempo = change.tempo;
        }
        return tick + seconds * tempo * this.timeDivision / 60;
    }

    // Плоский список событий в секундах. Сортирован.
    flatten() {
        const events = [];
        const visual = new Set(this.channels.filter(c => c.kind === 'comment').map(c => c.channel));
        for (const place of this.arrangement) {
            const p = this.getPattern(place.patternId);
            if (!p || visual.has(p.channel)) continue;
            for (const n of p.notes) {
                const absTick = place.startTick + n.tick;
                const absStart = this.ticksToSeconds(absTick);
                const absEnd = this.ticksToSeconds(absTick + n.dur);
                const ch = this.channels.find(c => c.channel === n.track);
                if (!ch) continue;
                events.push({ type: 'on',  time: absStart,          channel: ch.channel, key: n.key, vel: n.vel });
                events.push({ type: 'off', time: absEnd, channel: ch.channel, key: n.key });
            }
        }
        events.sort((a, b) => a.time - b.time || (a.type === 'off' ? -1 : 1));
        return events;
    }

    getDurationSeconds() {
        let maxTick = 0;
        for (const place of this.arrangement) {
            const p = this.getPattern(place.patternId);
            if (!p) continue;
            maxTick = Math.max(maxTick, place.startTick + p.lengthTicks);
        }
        return this.ticksToSeconds(maxTick);
    }
}