export const DRUM_ROWS = [[36,'Kick'],[38,'Snare'],[42,'Closed hat'],[46,'Open hat'],[39,'Clap'],[45,'Low tom'],[49,'Crash'],[51,'Ride']];
export function drumMatrixNotes(rows,{bars=1,ticksPerBar=1920,timeDivision=480,division=16}={}) {
    const quantum=timeDivision*4/division,lengthTicks=Math.round(bars*ticksPerBar),notes=[];
    for(const row of rows)for(const step of row.steps) {
        const tick=Math.round(step*quantum);
        if(!Number.isInteger(step)||step<0||tick>=lengthTicks||row.key<0||row.key>127)continue;
        notes.push({key:row.key,tick,dur:Math.max(1,Math.min(Math.round(quantum*.5),lengthTicks-tick)),vel:Math.max(1,Math.min(127,Math.round(row.velocity??100)))});
    }
    return notes.sort((a,b)=>a.tick-b.tick||a.key-b.key);
}
export function notesToDrumRows(notes,{timeDivision=480,division=16}={}) {
    const quantum=timeDivision*4/division,keys=[...new Set([...DRUM_ROWS.map(r=>r[0]),...notes.map(n=>n.key)])];
    return keys.map(key=>({key,name:DRUM_ROWS.find(r=>r[0]===key)?.[1]??`Note ${key}`,velocity:notes.find(n=>n.key===key)?.vel??100,steps:new Set(notes.filter(n=>n.key===key).map(n=>Math.round(n.tick/quantum)))}));
}
