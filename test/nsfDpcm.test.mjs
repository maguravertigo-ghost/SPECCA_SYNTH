import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {NsfMachine} from '../js/core/nsfMachine.js';
import {readNsf,appendNsfTrace} from '../js/editor/nsf.js';
import {traceNsf} from '../js/editor/nsfTrace.js';
import {createDpcmCapture} from '../js/editor/nsfDpcm.js';
import {Sequence} from '../js/editor/sequence.js';
function fixture({banked=false}={}){
 const b=new Uint8Array(128+(banked?24576:0x4011)),v=new DataView(b.buffer);
 b.set([78,69,83,77,26,1,1,1]);v.setUint16(8,0x8000,true);v.setUint16(10,0x8000,true);v.setUint16(12,0x8080,true);v.setUint16(110,16639,true);
 const code=[...(banked?[0xa9,5,0x8d,0xfc,0x5f]:[]),0xa9,15,0x8d,0x10,0x40,0xa9,64,0x8d,0x11,0x40,0xa9,0,0x8d,0x12,0x40,0xa9,1,0x8d,0x13,0x40,0xa9,16,0x8d,0x15,0x40,0x60];
 b.set(code,128);b[128+0x80]=0x60;
 if(banked){b[116]=4;b.fill(0xff,128+5*4096,128+5*4096+17);}
 else for(let i=0;i<17;i++)b[128+0x4000+i]=i%2?255:0;
 return b;
}
test('DMC fetches all sample bytes during idle CPU time and decodes delta bits in order',()=>{
 const bytes=fixture(),h=readNsf(bytes),m=new NsfMachine(bytes,h);let changes=0;m.onDac=()=>changes++;
 m.call(h.init,{init:true});m.advance(m.cpu.cycles+m.clock*.05);
 assert.equal(m.apu.dmc.currentAddress,0xc011);assert.equal(m.apu.dmc.bytesRemaining,0);assert.equal(m.apu.dmc.outputLevel,48);assert.ok(changes>=137);
});
test('DMC DMA reads the currently selected NSF bank, not a static sample copy',()=>{
 const bytes=fixture({banked:true}),h=readNsf(bytes),m=new NsfMachine(bytes,h);m.call(h.init,{init:true});m.advance(m.cpu.cycles+m.clock*.05);
 assert.equal(m.apu.dmc.currentAddress,0xc011);assert.equal(m.apu.dmc.outputLevel,126);
});
test('DPCM capture integrates frame fractions, removes constant DC and never normalizes',()=>{
 const idle=createDpcmCapture({origin:0,clock:100,seconds:1,sampleRate:100,initialLevel:64}).finish();assert.ok(idle.peak<1e-7);
 const c=createDpcmCapture({origin:0,clock:100,seconds:1,sampleRate:100,initialLevel:64});c.change(20.5,80);c.change(40.5,64);const r=c.finish();assert.equal(r.pcm.length,100);assert.ok(r.peak>.001&&r.peak<1);assert.equal(r.changes,2);assert.ok(r.pcm.slice(0,20).every(x=>Math.abs(x)<1e-7));
});
test('sample-only NSF creates a real WAV layer and an atomic audio-only append',()=>{
 const r=traceNsf(fixture(),{seconds:1});assert.equal(r.tracks.length,0);assert.ok(r.dpcmAudio?.peak>.001);
 const wav=new DataView(r.dpcmAudio.buffer);assert.equal(wav.getUint32(0),0x52494646);assert.equal(wav.getUint32(24,true),44100);
 const project=new Sequence({channels:[],timeMarkers:[{id:'m',seconds:1,name:'cue'}]}),before=project.toJSON();
 const asset={id:'d',name:'DPCM.wav',duration:1,peaks:[.1]},result=appendNsfTrace(project,r,{offsetTick:480,dpcmAsset:asset});
 assert.equal(project.toJSON(),before);assert.equal(result.audioCount,1);assert.equal(result.count,0);assert.equal(result.sequence.channels[0].kind,'audio');assert.equal(result.sequence.audioClips[0].startSeconds,.5);assert.equal(result.sequence.patterns.length,0);
 assert.deepEqual(Sequence.fromJSON(result.sequence.toJSON()).audioClips,result.sequence.audioClips);
 const excluded=traceNsf(fixture(),{seconds:1,includeDpcm:false});assert.equal(excluded.dpcmAudio,null);assert.throws(()=>appendNsfTrace(project,excluded),/No audible/);
});
test('Batman DPCM is non-silent, independent from note lanes, and can be excluded',async()=>{
 const b=await readFile(new URL('../nsf/example.nsf',import.meta.url)),r=traceNsf(b,{song:1,seconds:2}),off=traceNsf(b,{song:1,seconds:2,includeDpcm:false});
 assert.ok(r.dpcmAudio.peak>.01);assert.equal(r.dpcmAudio.buffer.byteLength,44+44100*2*4);assert.deepEqual(r.tracks,off.tracks);assert.equal(off.dpcmAudio,null);
 const noDpcm=traceNsf(b,{song:10,seconds:2});assert.equal(noDpcm.dpcmAudio,null);
});
