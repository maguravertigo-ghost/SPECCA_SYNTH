// Shared Roland GS processors. Values use the synth's documented GS scales.
export const EFFECTS = {
    reverb: { name: 'Reverb', cc: 91, parameters: {
        character: ['Space (0 room — 5 plate)', 0x31, 0, 5, 4],
        time: ['Decay', 0x34, 0, 127, 64],
        preDelayTime: ['Pre-delay (ms)', 0x37, 0, 127, 0],
        preLowpass: ['Damping', 0x32, 0, 7, 0],
        level: ['Return level', 0x33, 0, 127, 64],
    } },
    chorus: { name: 'Chorus', cc: 93, parameters: {
        rate: ['Rate', 0x3d, 0, 127, 3], depth: ['Depth', 0x3e, 0, 127, 19],
        delay: ['Delay', 0x3c, 0, 127, 80], feedback: ['Feedback', 0x3b, 0, 100, 8],
        preLowpass: ['Damping', 0x39, 0, 7, 0], level: ['Return level', 0x3a, 0, 127, 64],
    } },
    delay: { name: 'Delay', cc: 94, parameters: {
        timeCenter: ['Time (GS scale, not milliseconds)', 0x52, 1, 115, 97],
        timeRatioLeft: ['Left time ratio (24 = 100%)', 0x53, 1, 120, 24],
        timeRatioRight: ['Right time ratio (24 = 100%)', 0x54, 1, 120, 36],
        feedback: ['Feedback (64 = none)', 0x59, 64, 110, 84],
        preLowpass: ['Damping', 0x51, 0, 7, 0], level: ['Return level', 0x58, 0, 127, 64],
    } },
};
export function defaultEffects() {
    return Object.fromEntries(Object.entries(EFFECTS).map(([id,s])=>[id,{enabled:true,...Object.fromEntries(Object.entries(s.parameters).map(([key,p])=>[key,p[4]]))}]));
}
export function effectSend(channel,id) {
    const raw=channel.sends?.[id] ?? (id==='reverb'?40:0);
    return Number.isFinite(raw)?Math.max(0,Math.min(127,Math.round(raw))):0;
}
export function effectMessages(settings) {
    if (!settings) return [];
    const messages=[];
    for(const [id,spec] of Object.entries(EFFECTS)) {
        const values=settings[id]??{};
        for(const [key,[,address,min,max,fallback]] of Object.entries(spec.parameters)) {
            const raw=values[key];
            const value=key==='level'&&values.enabled===false?0:Number.isFinite(raw)?Math.max(min,Math.min(max,Math.round(raw))):fallback;
            const data=[0x40,0x01,address,value];
            messages.push([0x41,0x10,0x42,0x12,...data,(-data.reduce((a,b)=>a+b,0))&127,0xf7]);
        }
    }
    // Parallel sends only: no hidden chorus→delay/reverb or delay→reverb routing.
    for(const address of [0x3f,0x40,0x5a]) {
        const data=[0x40,1,address,0];
        messages.push([0x41,0x10,0x42,0x12,...data,(-data.reduce((a,b)=>a+b,0))&127,0xf7]);
    }
    // Enable both stereo delay returns in addition to the center tap.
    for(const address of [0x55,0x56,0x57]) {
        const data=[0x40,1,address,100];
        messages.push([0x41,0x10,0x42,0x12,...data,(-data.reduce((a,b)=>a+b,0))&127,0xf7]);
    }
    return messages;
}
