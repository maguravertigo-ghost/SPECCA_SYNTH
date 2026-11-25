import {Sequence} from './sequence.js';
import {chipSettings} from './chiptune.js';

export function readNsf(input){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    if(bytes.length<128||String.fromCharCode(...bytes.subarray(0,5))!=='NESM\x1a')throw new Error('Choose an NSF file (NESM header). NSFe and .nes game ROMs are not supported by this importer yet.');
    if(bytes.length>4*1024*1024)throw new Error('NSF size limit: 4 MB.');
    if(bytes[5]!==1)throw new Error('Only NSF version 1 is supported in this first importer.');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),word=i=>view.getUint16(i,true);
    const text=i=>new TextDecoder('windows-1252').decode(bytes.subarray(i,i+32)).split('\0')[0].trim();
    if(!bytes[6]||!bytes[7]||bytes[7]>bytes[6])throw new Error('Invalid NSF song count / starting song.');
    if(bytes[123])throw new Error('This NSF uses an expansion sound chip. Only the standard NES 2A03 APU is supported.');
    if((bytes[122]&3)===1)throw new Error('PAL-only NSF is not supported yet. This importer currently emulates NTSC timing.');
    const header={version:bytes[5],songs:bytes[6],startSong:bytes[7],title:text(14),artist:text(46),copyright:text(78),load:word(8),init:word(10),play:word(12),speed:word(110)||16639,banks:[...bytes.subarray(112,120)]};
    if(header.load<0x6000||header.init<0x6000||header.play<0x6000)throw new Error('Unsupported NSF load/init/play address (must be $6000 or higher).');
    if(bytes.length===128||(!header.banks.some(Boolean)&&header.load+bytes.length-128>65536))throw new Error('Invalid or oversized unbanked NSF payload.');
    if(header.speed<1000)throw new Error('Unsupported NSF playback rate (below 1 millisecond per call).');
    if(header.banks.some(Boolean)&&header.load<0x8000)throw new Error('Banked NSF loading below $8000 is not supported.');
    return header;
}

// Aggregate emulated state, not audio pitch detection. Volume changes are kept as
// per-note expression samples; only pitch, pulse duty, gate/retrigger split a note.
export function createNsfCollector(){
    const tracks=new Map(),active=[null,null,null,null];let outOfRange=0,shortNoise=false,noteCount=0;
    function finish(i,time){const n=active[i];if(n){n.end=time;if(n.end>n.start){if(++noteCount>50000)throw new Error('NSF extraction exceeds 50,000 notes. Choose a shorter duration.');tracks.get(n.variant).notes.push(n);}active[i]=null;}}
    return {
        sample(states,time){states.forEach((s,i)=>{
            let pitch=i===3?72+12*Math.log2(1789772.5/Math.max(1,s.timer)/22050):69+12*Math.log2(s.frequency/440);
            const key=Math.round(pitch),variant=`${i}:${i<2?s.duty:''}`;
            const audible=s.volume>0&&Number.isFinite(pitch)&&key>=0&&key<=127;
            if(s.volume>0&&!audible)outOfRange++;
            if(i===3&&s.short&&audible)shortNoise=true;
            let n=active[i];
            if(n&&(!audible||n.key!==key||n.variant!==variant||n.retrigger!==s.retrigger)){finish(i,time);n=null;}
            if(!audible)return;
            if(!tracks.has(variant))tracks.set(variant,{voice:i,duty:s.duty,variant,notes:[]});
            if(!n){n={start:time,end:time,key,variant,retrigger:s.retrigger,timer:s.timer,cents:Math.round((pitch-key)*100),levels:[{time,value:s.volume/15}]};active[i]=n;}
            else if(n.levels.at(-1).value!==s.volume/15)n.levels.push({time,value:s.volume/15});
        });},
        finish(time){for(let i=0;i<4;i++)finish(i,time);return {tracks:[...tracks.values()].filter(t=>t.notes.length).sort((a,b)=>a.voice-b.voice||(a.duty??0)-(b.duty??0)),outOfRange,shortNoise};}
    };
}

export function appendNsfTrace(project,trace,{offsetTick=0,title='NSF',song=1}={}){
    const sequence=Sequence.fromJSON(project.toJSON(0)),order=sequence.orderedChannels().map(c=>c.channel),used=new Set(sequence.channels.map(c=>c.channel));
    const origin=sequence.ticksToSeconds(offsetTick),toTick=seconds=>Math.max(0,Math.round(sequence.secondsToTicks(origin+seconds)));
    const chunk=sequence.ticksPerBar*8;let count=0,noteCount=0;
    for(const track of trace.tracks){
        const lane=Array.from({length:2048},(_,i)=>i).find(i=>!used.has(i)&&i%16!==9);if(lane===undefined)throw new Error('Not enough free channels for NSF import.');
        used.add(lane);order.push(lane);
        const label=['Pulse 1','Pulse 2','Triangle','Noise'][track.voice]+(track.voice<2?` · ${track.duty*100}%`:'');
        const chip=chipSettings({name:`NES ${label}`,wave:track.voice===2?'triangle':track.voice===3?'noise':'pulse',duty:track.duty??.5,attack:.001,decay:.005,sustain:1,release:.005,noiseKeyTrack:track.voice===3});
        sequence.channels.push({channel:lane,name:`${title} #${song} · ${label}`,source:'chiptune',kind:'instrument',chip,program:80,isDrum:false,volume:80,pan:64,muted:false,created:true,nsfSource:{song,voice:track.voice,...(track.duty===undefined?{}:{duty:track.duty})}});
        const patterns=new Map(),levels=new Map();
        for(const note of track.notes){
            let first=toTick(note.start),end=Math.max(first+1,toTick(note.end));
            // Fixed eight-bar editable clips. A crossing note is tied by adjacent
            // note segments, since this editor has no cross-pattern ties.
            while(first<end){
                const start=Math.floor(first/chunk)*chunk,last=Math.min(end,start+chunk);
                if(!patterns.has(start)){const p=sequence.createChannelPattern(lane);p.lengthTicks=chunk;patterns.set(start,p);levels.set(start,[]);sequence.placePattern(p.id,start);}
                const p=patterns.get(start),n=sequence.addNote(p.id,{track:lane,key:note.key,vel:100,tick:first-start,dur:last-first});
                n.nsf={timer:note.timer,cents:note.cents,voice:track.voice};
                const points=levels.get(start),samples=note.levels.map(l=>({tick:toTick(l.time),value:l.value}));
                const initial=samples.filter(l=>l.tick<=first).at(-1)?.value??samples[0].value;
                points.push({tick:first-start,value:initial});
                for(const l of samples)if(l.tick>first&&l.tick<last)points.push({tick:l.tick-start,value:l.value});
                points.push({tick:last-start,value:0});first=last;noteCount++;
            }
        }
        for(const [start,p] of patterns){
            const points=levels.get(start).sort((a,b)=>a.tick-b.tick),byTick=new Map(points.map(l=>[l.tick,l.value]));
            const result=[];let previous=0;
            for(const [tick,value] of byTick){if(tick>0)result.push({x:Math.max(0,tick-1)/p.lengthTicks,y:previous});result.push({x:tick/p.lengthTicks,y:value});previous=value;}
            if(result.length)p.automation={fade:{points:result,smooth:false,bypass:false}};
        }
        count++;
    }
    if(!count)throw new Error('No audible standard NES notes were found in the selected time range. Try another song or a longer duration.');
    sequence.channelOrder=order;
    return {sequence,count,noteCount};
}
