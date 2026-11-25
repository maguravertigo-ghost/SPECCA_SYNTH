import test from 'node:test';
import assert from 'node:assert/strict';
import {Sequence} from '../js/editor/sequence.js';
import {formatTimestamp,layoutMarkers,audioEnd,wavePath} from '../js/editor/timeline.js';
import {writeArrangementMIDI,writePatternMixMIDI} from '../js/editor/exportMidi.js';
import {BasicMIDI} from 'spessasynth_core';

test('absolute-time markers and audio references roundtrip and do not move with BPM',()=>{
 const sequence=new Sequence({channels:[{channel:0,kind:'audio'}],audioAssets:[{id:'a',name:'vocal.wav',duration:4,peaks:[.5]}],audioClips:[{id:'c',channel:0,assetId:'a',startSeconds:1.125,duration:4}],timeMarkers:[{id:'m',name:'Verse',seconds:2.341}]});
 const copy=Sequence.fromJSON(sequence.toJSON());assert.deepEqual(copy.audioAssets,sequence.audioAssets);assert.deepEqual(copy.audioClips,sequence.audioClips);assert.deepEqual(copy.timeMarkers,sequence.timeMarkers);
 copy.tempo=85;assert.equal(copy.getDurationSeconds(),5.125);assert.equal(copy.timeMarkers[0].seconds,2.341);
 assert.equal(formatTimestamp(62.003),'01 : 02 : 003');assert.equal(formatTimestamp(59.9996),'01 : 00 : 000');
 assert.equal(audioEnd(copy),5.125);
 const clone=copy.cloneChannel(0);assert.equal(clone.kind,'audio');assert.equal(copy.audioClips.length,2);assert.notEqual(copy.audioClips[0].id,copy.audioClips[1].id);
 assert.equal(copy.mergeNextChannel(0),null);assert.deepEqual(copy.splitChannel(0),[]);
});

test('marker labels use separate pixel lanes for intersections and near misses',()=>{
 const result=layoutMarkers([{id:'a',seconds:1},{id:'b',seconds:1.01},{id:'c',seconds:2.05},{id:'d',seconds:2.1}],t=>t*100,()=>100,10);
 assert.deepEqual(result.map(p=>p.lane),[0,1,2,0]);
 for(let i=0;i<result.length;i++)for(let j=i+1;j<result.length;j++)if(result[i].lane===result[j].lane)assert.ok(result[j].x>=result[i].x+result[i].width+10);
 assert.match(wavePath([1,.5],1,2,x=>x*10),/^M12.50 5.00v38.00/);
});

test('audio-only arrangement has a MIDI transport clock but no fake notes, MIX includes reference audio',()=>{
 const sequence=new Sequence({channels:[{channel:0,kind:'audio'},{channel:1}],audioClips:[{channel:0,startSeconds:0,duration:3}],patterns:[{id:'p',channel:1,lengthTicks:1920,notes:[]}],arrangement:[{patternId:'p',startTick:0}]});
 const midi=BasicMIDI.fromArrayBuffer(writeArrangementMIDI(sequence,{liveMix:true}));
 assert.ok(midi.duration>=3);assert.equal(midi.tracks.flatMap(t=>t.events).filter(e=>(e.statusByte&240)===144).length,0);assert.ok(writePatternMixMIDI(sequence,'p',{liveMix:true}).midi);
});

test('audio scheduling preserves source rate, offsets, pan/mute and transport discontinuities',async()=>{
 const {scheduleAudio,createAudioFollower}=await import('../js/core/audioTracks.js');
 const calls=[],nodes=[];
 const context={currentTime:10,createBufferSource(){const n={connect(){return this;},disconnect(){},start(...args){calls.push(args);},stop(){this.stopped=true;}};nodes.push(n);return n;},createGain(){return {gain:{value:0},connect(){return this;},disconnect(){}};},createStereoPanner(){return {pan:{value:0},connect(){return this;},disconnect(){}};}};
 const sequence={channels:[{channel:0,kind:'audio',volume:80,pan:0}],audioClips:[{assetId:'a',channel:0,startSeconds:2,duration:4,offsetSeconds:.5}]};
 const buffers=new Map([['a',{}]]),stop=scheduleAudio(context,{},sequence,buffers,3,{end:5});
 assert.deepEqual(calls,[[10,1.5,2]]);assert.equal(nodes[0].playbackRate,undefined);stop();assert.ok(nodes[0].stopped);
 const follower=createAudioFollower(context,{},sequence,buffers);follower.update(3,true);const count=calls.length;
 context.currentTime+=.02;follower.update(3.02,true);assert.equal(calls.length,count);
 context.currentTime+=.02;follower.update(2,true);assert.equal(calls.length,count+1);
 follower.update(2,false);assert.ok(nodes.at(-1).stopped);
});

test('WAV import rejects invalid files and oversized input before decoding or saving',async()=>{
 const {importWav}=await import('../js/core/audioTracks.js');
 const context={decodeAudioData(){throw new Error('Decoder must not run');}};
 await assert.rejects(importWav({size:101*1024*1024},context),/100 MB/);
 await assert.rejects(importWav({size:12,arrayBuffer:async()=>new ArrayBuffer(12)},context),/RIFF WAV/);
});
