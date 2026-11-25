import {timelineId} from '../editor/timeline.js';
const buffers=new Map();
let database;
function db(){return database??=new Promise((resolve,reject)=>{
    const request=indexedDB.open('specca-audio-assets',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('assets');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
}).catch(error=>{database=null;throw error;});}
async function store(mode,callback){
    const database=await db();
    return new Promise((resolve,reject)=>{const transaction=database.transaction('assets',mode),request=callback(transaction.objectStore('assets'));
        transaction.oncomplete=()=>resolve(request.result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error??new Error('Audio storage cancelled'));});
}
export async function getAudioAssetFile(asset){
    const blob=await store('readonly',s=>s.get(asset.id));
    if(!blob)throw new Error(`Missing audio: ${asset.name}. Relink the WAV or reimport its NSF. Audio is stored in this browser.`);
    return blob;
}
export async function decodeAsset(asset,context){
    if(buffers.has(asset.id))return buffers.get(asset.id);
    const blob=await getAudioAssetFile(asset);
    const buffer=await context.decodeAudioData(await blob.arrayBuffer());buffers.set(asset.id,buffer);return buffer;
}
export async function importWav(file,context){
    if(file.size>100*1024*1024)throw new Error('WAV import limit: 100 MB per file.');
    const bytes=await file.arrayBuffer(),view=new DataView(bytes);
    if(bytes.byteLength<12||view.getUint32(0)!==0x52494646||view.getUint32(8)!==0x57415645)throw new Error('Choose a RIFF WAV audio file.');
    const buffer=await context.decodeAudioData(bytes);
    if(buffer.duration>1800)throw new Error('WAV import limit: 30 minutes per file.');
    const peaks=Array.from({length:Math.min(4096,buffer.length)},()=>0);
    for(let ch=0;ch<buffer.numberOfChannels;ch++){
        const data=buffer.getChannelData(ch);
        for(let i=0;i<data.length;i++){const bin=Math.min(peaks.length-1,Math.floor(i*peaks.length/data.length));peaks[bin]=Math.max(peaks[bin],Math.abs(data[i]));}
    }
    const asset={id:timelineId('wav'),name:file.name,duration:buffer.duration,sampleRate:buffer.sampleRate,peaks};
    await store('readwrite',s=>s.put(file,asset.id));buffers.set(asset.id,buffer);return asset;
}
export async function prepareAudio(sequence,context){
    const result=new Map();
    for(const asset of sequence.audioAssets??[]){if(sequence.audioClips?.some(c=>c.assetId===asset.id))result.set(asset.id,await decodeAsset(asset,context));}
    return result;
}
export function scheduleAudio(context,destination,sequence,buffers,position=0,{when=context.currentTime,end=Infinity,master=1}={}){
    const voices=[];
    for(const clip of sequence.audioClips??[]){
        const info=sequence.channels.find(c=>c.channel===clip.channel&&c.kind==='audio'),buffer=buffers.get(clip.assetId);
        if(!info||!buffer)continue;
        const first=Math.max(position,clip.startSeconds),last=Math.min(end,clip.startSeconds+clip.duration);
        if(last<=first)continue;
        const source=context.createBufferSource(),gain=context.createGain(),pan=context.createStereoPanner();
        source.buffer=buffer;gain.gain.value=info.muted?0:(info.volume??100)/100*master;
        pan.pan.value=Math.max(-1,Math.min(1,((info.pan??64)-64)/((info.pan??64)>64?63:64)));
        source.connect(gain).connect(pan).connect(destination);
        source.start(when+first-position,(clip.offsetSeconds??0)+first-clip.startSeconds,last-first);
        source.onended=()=>{source.disconnect();gain.disconnect();pan.disconnect();};
        voices.push({source,gain,pan,info});
    }
    return ()=>{for(const {source} of voices){try{source.stop();}catch{}}};
}
// The MIDI sequencer remains the transport clock. Reschedule on seeks/loop wraps.
export function createAudioFollower(context,destination,sequence,buffers,{master=()=>1}={}){
    let stop=()=>{},last=null,stamp=0,signature='';
    return {
        update(position,playing,end=Infinity){
            const now=context.currentTime;
            const mix=JSON.stringify(sequence.channels.filter(c=>c.kind==='audio').map(c=>[c.channel,c.volume,c.pan,c.muted]))+master();
            if(!playing){stop();stop=()=>{};last=null;return;}
            if(last===null||Math.abs(position-(last+now-stamp))>.06||signature!==mix){stop();stop=scheduleAudio(context,destination,sequence,buffers,position,{end,master:master()});}
            signature=mix;last=position;stamp=now;
        },
        stop(){stop();stop=()=>{};last=null;}
    };
}
