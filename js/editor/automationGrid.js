// Shared timeline coordinates: automation never fits the whole pattern to the
// viewport independently of the Piano Roll zoom/scroll.
export function automationGridStep(mode,{stepTicks=120,timeDivision=480,ticksPerBar=1920}={}){
    if(mode==='bar')return ticksPerBar;
    const fractions={'1/4':1,'1/8':.5,'1/16':.25,'1/32':.125,'1/64':.0625,'1/8T':1/3,'1/16T':1/6};
    return Math.max(1,mode in fractions?timeDivision*fractions[mode]:stepTicks);
}
export const tickToAutomationX=(tick,view)=>tick/view.stepTicks*view.stepWidth-view.scrollX;
export const automationXToTick=(x,view)=>(x+view.scrollX)/view.stepWidth*view.stepTicks;
export function automationGridLines(view,width,step){
    const start=Math.max(0,automationXToTick(0,view)),end=Math.min(view.lengthTicks,automationXToTick(width,view));
    const first=Math.ceil((start-1e-7)/step),last=Math.floor((end+1e-7)/step);
    const stride=Math.max(1,Math.ceil((last-first+1)/2000));
    const result=[];
    for(let i=first;i<=last;i+=stride){const tick=i*step;result.push({tick,x:tickToAutomationX(tick,view),bar:Math.abs(tick/view.ticksPerBar-Math.round(tick/view.ticksPerBar))<1e-6});}
    return result;
}
export function snapAutomationTick(tick,{enabled=true,step=120,lengthTicks,mode='grid',notes=[],toleranceTicks=0}={}){
    const clamp=n=>Math.max(0,Math.min(lengthTicks,n));tick=clamp(tick);
    if(!enabled)return tick;
    let best=mode==='notes'?tick:clamp(Math.round(tick/step)*step),distance=mode==='notes'?Infinity:Math.abs(best-tick);
    if(mode!=='grid')for(const note of notes)for(const edge of [note.tick,note.tick+note.dur]){
        if(edge<0||edge>lengthTicks)continue;
        const d=Math.abs(edge-tick);
        if(d<=toleranceTicks&&d<=distance){best=edge;distance=d;}
    }
    return best;
}
