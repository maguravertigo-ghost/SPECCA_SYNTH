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
        // A short tap must not collapse to a 1-tick, effectively inaudible note.
        // Keep the onset on the last valid grid line, including at the loop edge.
        const lastGrid=Math.min(length-1,Math.round(Math.floor((length-1)/q)*q));
        const tick=Math.max(0,Math.min(lastGrid,Math.round(Math.round(local/q)*q)));
        const release=Math.min(length,Math.max(tick+Math.max(1,Math.round(q)),Math.round(Math.round((local+span)/q)*q)));
        result.push({tick,dur:release-tick});
        cursor+=span;
    }
    return result;
}
