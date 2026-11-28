export function tempoPoints(sequence) {
    return [{tick:0,tempo:sequence.tempo}, ...sequence.tempoChanges.filter(p=>p.tick>0)].sort((a,b)=>a.tick-b.tick);
}
export function setTempoPoint(sequence, originalTick, tick, tempo) {
    if (!Number.isFinite(tick) || tick<0 || !Number.isFinite(tempo) || tempo<=0) throw new Error('Invalid tempo point');
    tick=Math.round(tick);
    if (originalTick===0 && tick!==0) throw new Error('The initial tempo must stay at tick zero');
    const points=sequence.tempoChanges.filter(p=>p.tick!==originalTick&&p.tick!==tick&&p.tick>0);
    if(tick===0)sequence.tempo=tempo;else points.push({tick,tempo});
    sequence.tempoChanges=points.sort((a,b)=>a.tick-b.tick);
}
export function deleteTempoPoint(sequence,tick) {
    if(tick===0)throw new Error('The initial tempo cannot be deleted');
    sequence.tempoChanges=sequence.tempoChanges.filter(p=>p.tick!==tick);
}
