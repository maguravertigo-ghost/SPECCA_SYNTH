// Isolated DMC/DAC output, not the mixed pulse/triangle/noise signal.
// Integrate level steps over each PCM frame to avoid sample-edge aliasing.
const dac=level=>level>0?159.79/(22638/level+100):0;
export function createDpcmCapture({origin,clock,seconds,sampleRate=44100,initialLevel=0}){
    const pcm=new Float32Array(Math.ceil(seconds*sampleRate));
    let cursor=0,index=0,area=0,value=dac(initialLevel),changes=0,lastLevel=initialLevel;
    function advance(cycle){
        const end=Math.max(cursor,Math.min(pcm.length,(cycle-origin)*sampleRate/clock));
        while(cursor<end){const edge=Math.min(end,index+1);area+=value*(edge-cursor);cursor=edge;if(cursor>=index+1){pcm[index++]=area;area=0;}}
    }
    return {
        change(cycle,level){advance(cycle);if(level!==lastLevel)changes++;lastLevel=level;value=dac(level);},
        finish(){
            advance(origin+pcm.length*clock/sampleRate);
            // DMC output holds its last DC value even when disabled. Remove DC,
            // preserving the dynamics (no normalization). Not a full NES mixer.
            const alpha=Math.exp(-2*Math.PI*40/sampleRate);let previous=dac(initialLevel),filtered=0,peak=0;
            for(let i=0;i<pcm.length;i++){const raw=pcm[i];filtered=alpha*(filtered+raw-previous);previous=raw;pcm[i]=filtered;peak=Math.max(peak,Math.abs(filtered));}
            return {pcm,peak,changes,sampleRate,seconds};
        }
    };
}
