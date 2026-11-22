// Split an unwrapped performance into local loop segments and quantize at note-off.
export function recordedSegments(start,end,length,quantum=1) {
    if(!(length>0)||!Number.isFinite(start)||!Number.isFinite(end)||end<start)return [];
    const q=Math.max(1,quantum), result=[];
    // A held note spanning many loops needs at most one full-loop segment plus its edges.
    end=Math.min(end,start+length*2);
    for(let cursor=start;cursor<Math.max(end,start+1);) {
        const local=((cursor%length)+length)%length;
        const available=length-local;
        const span=Math.min(available,Math.max(1,end-cursor));
        const tick=Math.max(0,Math.min(length-1,Math.round(Math.round(local/q)*q)));
        const release=Math.min(length,Math.max(tick+1,Math.round(Math.round((local+span)/q)*q)));
        result.push({tick,dur:release-tick});
        cursor+=span;
    }
    return result;
}
