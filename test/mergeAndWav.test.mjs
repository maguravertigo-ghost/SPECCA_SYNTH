import test from 'node:test';
import assert from 'node:assert/strict';
import { Sequence } from '../js/editor/sequence.js';
import { encodeWav } from '../js/core/wav.js';
test('merge uses visual channel below, keeps target sound and all pattern placements',()=>{
 const s=new Sequence({channels:[{channel:0,program:5},{channel:1,program:40},{channel:2,source:'chiptune',chip:{wave:'triangle'}}],channelOrder:[0,2,1],patterns:[{id:'a',channel:0,notes:[{track:0,key:60}]},{id:'b',channel:2,automation:{pan:{points:[{x:0,y:.5}]}},notes:[{track:2,key:48}]},{id:'c',channel:1,notes:[]}],arrangement:[{patternId:'b',startTick:480},{patternId:'b',startTick:960},{patternId:'a',startTick:0}]});
 const placements=structuredClone(s.arrangement);assert.equal(s.mergeNextChannel(0).channel,2);
 assert.deepEqual(s.channels.map(c=>c.channel),[0,1]);assert.equal(s.channels[0].program,5);assert.equal(s.patterns[1].channel,0);assert.equal(s.patterns[1].notes[0].track,0);assert.ok(s.patterns[1].automation.pan);assert.deepEqual(s.arrangement,placements);assert.equal(s.mergeNextChannel(1),null);
 const comment=new Sequence({channels:[{channel:0},{channel:1,kind:'comment'}]});assert.equal(comment.mergeNextChannel(0),null);
});
test('WAV encoder writes interleaved stereo PCM16 with clipping diagnostics',()=>{
 const {buffer,clipped,peak}=encodeWav([new Float32Array([0,1,-1,2]),new Float32Array([.5,-.5,0,-2])],48000);
 const v=new DataView(buffer);assert.equal(new TextDecoder().decode(new Uint8Array(buffer,0,4)),'RIFF');assert.equal(v.getUint32(24,true),48000);assert.equal(v.getUint16(22,true),2);assert.equal(v.getUint16(34,true),16);assert.equal(v.getInt16(46,true),16384);assert.equal(v.getInt16(48,true),32767);assert.equal(clipped,2);assert.equal(peak,2);
});
