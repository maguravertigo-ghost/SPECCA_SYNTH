import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readNsf,createNsfCollector,appendNsfTrace} from '../js/editor/nsf.js';
import {traceNsf} from '../js/editor/nsfTrace.js';
import {Sequence} from '../js/editor/sequence.js';
import {SoundBankLoader} from 'spessasynth_core';
import {buildChipBank} from '../js/editor/chiptune.js';
function fixture({banked=false,hang=false}={}){
 const b=new Uint8Array(128+(banked?12288:256)),v=new DataView(b.buffer);b.set([78,69,83,77,26,1,2,1]);v.setUint16(8,0x8000,true);v.setUint16(10,0x8000,true);v.setUint16(12,0x8040,true);v.setUint16(110,16639,true);
 const init=[0xa9,1,0x8d,0x15,0x40,0xa9,0xbf,0x8d,0,0x40,0xa9,8,0x8d,1,0x40,0xa9,253,0x8d,2,0x40,0xa9,8,0x8d,3,0x40,0x60];
 b.set(hang?[0x4c,0,0x80]:init,128);b[128+0x40]=0x60;
 if(banked){b[113]=1;b[128+8192]=253;b[128+4096]=100;b.set([0xa9,2,0x8d,0xf9,0x5f,0xad,0,0x90,0x8d,2,0x40,0x60],128+0x40);}
 return b;
}
test('NSF header validates format, songs, chip, region, rate and address bounds',()=>{
 const b=fixture();assert.equal(readNsf(b).songs,2);
 for(const [offset,value,pattern] of [[5,2,/version/],[6,0,/song/],[123,1,/expansion/],[122,1,/PAL/],[9,0x50,/address/]]){const bad=b.slice();bad[offset]=value;assert.throws(()=>readNsf(bad),pattern);}
 assert.throws(()=>readNsf(new Uint8Array(128)),/NSF/);
 const rate=b.slice();rate[110]=1;rate[111]=0;assert.throws(()=>readNsf(rate),/rate/);
});
test('6502 APU trace reconstructs a known A4 note, gate and constant envelope',()=>{
 const r=traceNsf(fixture(),{seconds:1});assert.equal(r.tracks.length,1);assert.equal(r.dpcm,false);
 const track=r.tracks[0];assert.equal(track.voice,0);assert.equal(track.duty,.5);assert.equal(track.notes[0].key,69);assert.ok(track.notes[0].end>0);assert.equal(track.notes[0].levels[0].value,1);
 assert.throws(()=>traceNsf(fixture(),{song:3,seconds:1}),/song/);assert.throws(()=>traceNsf(fixture(),{seconds:181}),/duration/);
 assert.throws(()=>traceNsf(fixture({hang:true}),{seconds:1}),/CPU budget/);
});
test('NSF bank writes remap executable/data memory before tracing pitches',()=>{
 const r=traceNsf(fixture({banked:true}),{seconds:1});assert.equal(r.tracks[0].notes[0].key,69);
});
test('collector preserves envelope within notes, separates retriggers and duty changes',()=>{
 const c=createNsfCollector(),silent={frequency:440,volume:0,retrigger:0,timer:253,duty:.5};
 const sample=(time,changes)=>c.sample([{...silent,volume:15,...changes},silent,silent,silent],time);
 sample(0,{});sample(.1,{volume:8});sample(.2,{retrigger:1});sample(.3,{retrigger:2,duty:.25});sample(.4,{volume:0});
 const r=c.finish(.5);assert.equal(r.tracks.length,2);assert.equal(r.tracks.find(t=>t.duty===.5).notes.length,2);assert.equal(r.tracks.find(t=>t.duty===.5).notes[0].levels.length,2);assert.equal(r.tracks.find(t=>t.duty===.25).notes[0].end,.4);
});
test('real Batman NSF has independent emulated notes, song selection, expressions and atomic append',async()=>{
 const bytes=await readFile(new URL('../nsf/example.nsf',import.meta.url)),header=readNsf(bytes);assert.equal(header.title,'Batman');assert.equal(header.songs,11);
 const first=traceNsf(bytes,{song:1,seconds:10}),second=traceNsf(bytes,{song:2,seconds:10});assert.deepEqual(new Set(first.tracks.map(t=>t.voice)),new Set([0,1,2,3]));assert.notDeepEqual(first.tracks.find(t=>t.voice===0).notes.map(n=>n.key),second.tracks.find(t=>t.voice===0).notes.map(n=>n.key));
 const project=new Sequence({tempo:100,channels:[{channel:0,name:'Existing'}],timeMarkers:[{id:'m',seconds:2,name:'cue'}]});const snapshot=project.toJSON();
 const {sequence,count,noteCount}=appendNsfTrace(project,first,{offsetTick:1920,title:header.title,song:1});assert.equal(count,4);assert.ok(noteCount>100);assert.equal(project.toJSON(),snapshot);assert.equal(sequence.channels[0].name,'Existing');assert.deepEqual(sequence.timeMarkers,project.timeMarkers);
 for(const p of sequence.patterns){assert.ok(p.notes.every(n=>n.tick>=0&&n.dur>0&&n.tick+n.dur<=p.lengthTicks));assert.ok(p.automation.fade.points.length);}
 const onset=sequence.arrangement.reduce((min,c)=>Math.min(min,sequence.ticksToSeconds(c.startTick+sequence.getPattern(c.patternId).notes[0].tick)),Infinity);assert.ok(onset>=project.ticksToSeconds(1920));
 assert.deepEqual(Sequence.fromJSON(sequence.toJSON()).channels,sequence.channels);
 const noise=sequence.channels.find(c=>c.nsfSource?.voice===3);assert.ok(noise.chip.noiseKeyTrack);
 const bank=SoundBankLoader.fromArrayBuffer(buildChipBank([noise]));const gens=new Map(bank.presets[0].zones[0].instrument.zones[0].generators.map(g=>[g.type,g.value]));assert.equal(gens.get(58),72);assert.equal(gens.has(56),false);
});
