import {NsfMachine} from '../core/nsfMachine.js';
import {readNsf,createNsfCollector} from './nsf.js';
export function traceNsf(input,{song=1,seconds=30}={},progress=()=>{}){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input),header=readNsf(bytes);
    if(!Number.isInteger(song)||song<1||song>header.songs)throw new Error('Choose a valid NSF song number.');
    if(!Number.isFinite(seconds)||seconds<1||seconds>180)throw new Error('Choose an import duration from 1 to 180 seconds.');
    const machine=new NsfMachine(bytes,header),collector=createNsfCollector();
    machine.call(header.init,{init:true,song});
    const origin=machine.cpu.cycles,interval=header.speed/1000000;let nextPlay=0,nextSample=0,lastProgress=-1;
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
    return {...collector.finish(seconds),header,song,seconds,dpcm:machine.dpcm};
}
