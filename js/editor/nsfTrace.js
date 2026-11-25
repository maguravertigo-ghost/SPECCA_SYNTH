import {createDpcmCapture} from './nsfDpcm.js';
import {encodeWav} from '../core/wav.js';
import {NsfMachine} from '../core/nsfMachine.js';
import {readNsf,createNsfCollector} from './nsf.js';
export function traceNsf(input,{song=1,seconds=30,includeDpcm=true}={},progress=()=>{}){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input),header=readNsf(bytes);
    if(!Number.isInteger(song)||song<1||song>header.songs)throw new Error('Choose a valid NSF song number.');
    if(!Number.isFinite(seconds)||seconds<1||seconds>180)throw new Error('Choose an import duration from 1 to 180 seconds.');
    const machine=new NsfMachine(bytes,header),collector=createNsfCollector();
    machine.call(header.init,{init:true,song});
    const origin=machine.cpu.cycles,interval=header.speed/1000000;let nextPlay=0,nextSample=0,lastProgress=-1;
    const capture=includeDpcm?createDpcmCapture({origin,clock:machine.clock,seconds,initialLevel:machine.apu.dmc.outputLevel}):null;
    if(capture)machine.onDac=(cycle,level)=>capture.change(cycle,level);
    while(nextSample<seconds){
        if(nextPlay<=nextSample){
            machine.advance(origin+nextPlay*machine.clock);machine.call(header.play,{maxCycles:Math.ceil(machine.clock*.05)});nextPlay+=interval;
            if(machine.cpu.cycles>origin+nextPlay*machine.clock+50)throw new Error('NSF play routine exceeds its playback interval. This driver is not supported.');
        }else{
            machine.advance(origin+nextSample*machine.clock);
            collector.sample(machine.snapshot(),Math.min(seconds,(machine.cpu.cycles-origin)/machine.clock));
            const percent=Math.floor(nextSample/seconds*100);
            if(percent!==lastProgress){lastProgress=percent;progress(percent);}
            nextSample+=1/240;
        }
    }
    machine.advance(origin+seconds*machine.clock);
    let dpcmAudio=null;
    if(capture){const audio=capture.finish();if(audio.changes&&audio.peak>1e-5)dpcmAudio={buffer:encodeWav([audio.pcm,audio.pcm],audio.sampleRate).buffer,peak:audio.peak,sampleRate:audio.sampleRate,seconds};}
    return {...collector.finish(seconds),header,song,seconds,dpcm:machine.dpcm,dpcmAudio};
}
