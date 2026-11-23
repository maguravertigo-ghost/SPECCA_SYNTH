import test from 'node:test';
import assert from 'node:assert/strict';
import { Sequence } from '../js/editor/sequence.js';
import {splitGroups} from '../js/editor/channelSplit.js';
const fixture=()=>new Sequence({channels:[{channel:9,isDrum:true,name:'Kit',program:0,volume:80,sends:{reverb:33}},{channel:2,name:'Bass'}],channelOrder:[9,2],patterns:[{id:'p',name:'Beat',channel:9,lengthTicks:1920,automation:{fade:{points:[{x:0,y:1}]}},notes:[36,38,42,46,49,54].map((key,i)=>({id:`n${i}`,track:9,key,tick:i*120,dur:60,vel:70+i}))},{id:'u',name:'Unplaced',channel:9,lengthTicks:960,notes:[{id:'un',track:9,key:36,tick:0,dur:120,vel:100}]}],arrangement:[{id:'a',patternId:'p',startTick:0},{id:'b',patternId:'p',startTick:1920}]});
test('split drums into families preserves all notes, repetitions and independent mix/automation',()=>{
 const s=fixture(),parts=s.splitChannel(9);
 assert.equal(parts.length,5);assert.ok(parts[0].name.includes('Kick'));assert.deepEqual(s.orderedChannels().map(c=>c.channel),[...parts.map(c=>c.channel),2]);
 assert.equal(s.patterns.flatMap(p=>p.notes).length,7);
 for(const c of parts){assert.equal(c.isDrum,true);assert.equal(c.volume,80);assert.ok(s.patterns.filter(p=>p.channel===c.channel).every(p=>p.notes.every(n=>n.track===c.channel)));}
 assert.equal(s.arrangement.length,10);assert.equal(new Set(s.arrangement.map(p=>p.id)).size,10);
 const hats=s.patterns.find(p=>p.notes.some(n=>n.key===42));assert.deepEqual(hats.notes.map(n=>n.key),[42,46]);assert.equal(s.arrangement.filter(p=>p.patternId===hats.id).length,2);
 parts[1].sends.reverb=0;assert.equal(parts[0].sends.reverb,33);
 hats.automation.fade.points[0].y=0;assert.equal(s.getPattern('p').automation.fade.points[0].y,1);
 assert.equal(s.arrangement.filter(p=>p.patternId==='u').length,0);
});
test('per-note split separates closed/open hats and single-sound or empty parts are no-ops',()=>{
 const s=fixture();assert.equal(s.splitChannel(9,'notes').length,6);
 const snapshot=s.toJSON();assert.deepEqual(s.splitChannel(9,'notes'),[]);assert.equal(s.toJSON(),snapshot);
 assert.deepEqual(splitGroups([{notes:[{key:60},{key:64}]}],{isDrum:false}).map(g=>g.keys),[[60],[64]]);
});

test('split refuses exhausted MIDI lanes without changing the project',()=>{
 const s=fixture();s.channels=Array.from({length:2048},(_,channel)=>({channel,isDrum:channel===9}));s.channelOrder=[];
 const snapshot=s.toJSON();assert.throws(()=>s.splitChannel(9),/Not enough/);assert.equal(s.toJSON(),snapshot);
});
