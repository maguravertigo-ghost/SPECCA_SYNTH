export function encodeWav(channels, sampleRate) {
    if(channels.length!==2||channels[0].length!==channels[1].length)throw new Error('Expected stereo PCM');
    const frames=channels[0].length, dataBytes=frames*4;
    const buffer=new ArrayBuffer(44+dataBytes),v=new DataView(buffer);
    const text=(offset,s)=>{for(let i=0;i<s.length;i++)v.setUint8(offset+i,s.charCodeAt(i));};
    text(0,'RIFF');v.setUint32(4,36+dataBytes,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,dataBytes,true);
    let peak=0, clipped=0;
    for(let i=0;i<frames;i++)for(let ch=0;ch<2;ch++){
        const raw=Number.isFinite(channels[ch][i])?channels[ch][i]:0;
        peak=Math.max(peak,Math.abs(raw));if(Math.abs(raw)>1)clipped++;
        const s=Math.max(-1,Math.min(1,raw));v.setInt16(44+(i*2+ch)*2,Math.round(s*(s<0?32768:32767)),true);
    }
    return {buffer,peak,clipped};
}
