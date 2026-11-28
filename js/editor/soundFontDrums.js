// Key/velocity coverage is derived from actual preset+instrument zones, not GM assumptions.
export function mappedDrumSounds(preset) {
    const found=new Map();
    const range=(zone,global,id)=>zone[id]?.min>=0?zone[id]:(global?.[id]??{min:0,max:127});
    for(const pz of preset.zones??[]) {
        const instrument=pz.instrument;if(!instrument)continue;
        const pk=range(pz,preset.globalZone,'keyRange'),pv=range(pz,preset.globalZone,'velRange');
        for(const iz of instrument.zones??[]) {
            if(!iz.sample)continue;
            const ik=range(iz,instrument.globalZone,'keyRange'),iv=range(iz,instrument.globalZone,'velRange');
            const min=Math.max(1,pv.min,iv.min),max=Math.min(127,pv.max,iv.max);if(min>max)continue;
            for(let key=Math.max(0,pk.min,ik.min);key<=Math.min(127,pk.max,ik.max);key++) {
                if(!found.has(key))found.set(key,{key,names:new Set(),velocities:[]});
                const sound=found.get(key);sound.names.add(iz.sample.name||instrument.name||`Note ${key}`);sound.velocities.push({min,max});
            }
        }
    }
    return [...found.values()].sort((a,b)=>a.key-b.key).map(s=>({...s,name:[...s.names].join(' / '),names:undefined}));
}
export function mappedVelocity(sound,preferred=100) {
    if(!sound?.velocities?.length)return preferred;
    if(sound.velocities.some(r=>preferred>=r.min&&preferred<=r.max))return preferred;
    return sound.velocities.reduce((best,r)=>{const value=Math.max(r.min,Math.min(r.max,preferred));return Math.abs(value-preferred)<Math.abs(best-preferred)?value:best;},sound.velocities[0].min);
}
