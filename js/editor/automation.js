export const AUTOMATION = { pan: { name: 'Pan', cc: 10, neutral: .5, color: '#65caff' }, fade: { name: 'Fade', cc: 11, neutral: 1, color: '#ffb15c' } };
const clamp = x => Math.max(0, Math.min(1, x));
export function curvePoints(curve) {
    const byTime = new Map();
    for (const p of curve?.points ?? []) if (Number.isFinite(p.x) && Number.isFinite(p.y)) byTime.set(clamp(p.x), { x: clamp(p.x), y: clamp(p.y) });
    return [...byTime.values()].sort((a,b) => a.x-b.x);
}
export function curveValue(curve, time, fallback = 1) {
    const points = curvePoints(curve);
    if (!points.length || curve?.bypass) return fallback;
    const x = clamp(time);
    if (x <= points[0].x) return points[0].y;
    for (let i=1;i<points.length;i++) if (x <= points[i].x) {
        const a=points[i-1], b=points[i]; let t=(x-a.x)/(b.x-a.x);
        // Cubic Bezier with horizontal endpoint tangents (smoothstep).
        if (curve.smooth) t=t*t*(3-2*t);
        return a.y+(b.y-a.y)*t;
    }
    return points.at(-1).y;
}
export function automationEvents(pattern, ppq=480) {
    const events=[];
    const length=pattern.lengthTicks;
    if (!(length>0)) return events;
    for (const [id, spec] of Object.entries(AUTOMATION)) {
        const curve=pattern.automation?.[id];
        if (!curve || curve.bypass || !curvePoints(curve).length) continue;
        const ticks=new Set([0, length]);
        // bounded 1/32-beat sampling; controller quantization removes redundant messages.
        const interval=Math.max(1,Math.round(ppq/32),Math.ceil(length/8192));
        for(let t=interval;t<length;t+=interval) ticks.add(t);
        for(const point of curvePoints(curve)) ticks.add(Math.round(point.x*length));
        let last=-1;
        for(const tick of [...ticks].sort((a,b)=>a-b)) {
            const value=Math.round(curveValue(curve,tick/length,spec.neutral)*127);
            if(value!==last) events.push({tick,cc:spec.cc,value});
            last=value;
        }
        events.push({tick:length,cc:spec.cc,value:Math.round(spec.neutral*127),reset:true});
    }
    return events.sort((a,b)=>a.tick-b.tick);
}

export function automationSummary(patterns) {
    return Object.entries(AUTOMATION).flatMap(([id, spec]) => {
        const matching = patterns.filter(p => curvePoints(p.automation?.[id]).length);
        if (!matching.length) return [];
        return [{ id, ...spec, count: matching.length, active: matching.filter(p => !p.automation[id].bypass).length }];
    });
}

export function automationPreview(pattern) {
    return automationSummary([pattern]).map(spec => {
        const curve = pattern.automation[spec.id];
        const path = Array.from({ length: 65 }, (_, i) => {
            const value = curveValue({ ...curve, bypass: false }, i / 64, spec.neutral);
            return `${i ? 'L' : 'M'}${(1000*i/64).toFixed(2)},${(2+18*(1-value)).toFixed(2)}`;
        }).join(' ');
        return `<path d="${path}" stroke="${spec.color}"${curve.bypass ? ' stroke-dasharray="12 8" opacity=".45"' : ''}/>`;
    }).join('');
}
