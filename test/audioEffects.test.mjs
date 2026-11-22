import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultEffects,effectMessages,effectSend } from '../js/editor/audioEffects.js';
import { Sequence } from '../js/editor/sequence.js';
import { writeArrangementMIDI } from '../js/editor/exportMidi.js';
test('effect settings have safe bounds, independent defaults and valid GS checksums',()=>{
 const settings=defaultEffects();settings.delay.feedback=10000;settings.reverb.enabled=false;
 const messages=effectMessages(settings);
 assert.equal(defaultEffects().delay.feedback,84);
 for(const m of messages){assert.equal(m.at(-1),247);assert.equal(m.slice(4,-1).reduce((a,b)=>a+b,0)%128,0);assert.ok(m.slice(4,-1).every(v=>v>=0&&v<=127));}
 assert.equal(messages.find(m=>m[6]===0x33)[7],0);
 assert.equal(messages.find(m=>m[6]===0x59)[7],110);
 assert.equal(effectSend({},'reverb'),40);assert.equal(effectSend({sends:{delay:200}},'delay'),127);
 assert.deepEqual(effectMessages(null),[]);
});
test('effects and per-channel sends survive save; arrangement encodes sends and processors',()=>{
 const seq=new Sequence({effects:defaultEffects(),channels:[{channel:0,sends:{delay:90,chorus:70,reverb:80}}],patterns:[{id:'p',channel:0,lengthTicks:1920,notes:[{track:0,key:60,tick:0,dur:480,vel:90}]}],arrangement:[{patternId:'p',startTick:0}]});
 const restored=Sequence.fromJSON(seq.toJSON());assert.deepEqual(restored.effects,seq.effects);assert.deepEqual(restored.channels,seq.channels);
 const a=new Uint8Array(writeArrangementMIDI(seq));for(const [cc,v] of [[91,80],[93,70],[94,90]])assert.ok(a.some((x,i)=>x===176&&a[i+1]===cc&&a[i+2]===v));
 assert.ok(a.some((x,i)=>x===0x40&&a[i+1]===1&&a[i+2]===0x59&&a[i+3]===84));
});
