// Absolute-time objects deliberately do not follow tempo changes.
export const timelineId = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
export const audioEnd = sequence => (sequence.audioClips ?? []).reduce((end,c)=>Math.max(end,c.startSeconds+c.duration),0);
export function formatTimestamp(seconds) {
    const ms=Math.max(0,Math.round(seconds*1000));
    return `${String(Math.floor(ms/60000)).padStart(2,'0')} : ${String(Math.floor(ms/1000)%60).padStart(2,'0')} : ${String(ms%1000).padStart(3,'0')}`;
}
// Each occupied lane is tested in pixels, including a minimum separation.
export function layoutMarkers(markers, position, measure, gap=10) {
    const edges=[];
    return [...markers].sort((a,b)=>a.seconds-b.seconds||a.id.localeCompare(b.id)).map(marker=>{
        const x=position(marker.seconds),width=measure(marker);
        let lane=edges.findIndex(edge=>edge+gap<=x);
        if(lane<0)lane=edges.length;
        edges[lane]=x+width;
        return {marker,x,width,lane};
    });
}
export function wavePath(peaks,start,end,toX) {
    return peaks.map((peak,i)=>{const x=toX(start+(end-start)*(i+.5)/peaks.length);return `M${x.toFixed(2)} ${(24-peak*19).toFixed(2)}v${(peak*38).toFixed(2)}`;}).join('');
}
