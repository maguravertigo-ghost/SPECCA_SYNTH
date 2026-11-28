import test from 'node:test';
import assert from 'node:assert/strict';
import {tempoPoints,setTempoPoint,deleteTempoPoint} from '../js/editor/tempoMap.js';
import {Sequence} from '../js/editor/sequence.js';
import {writeArrangementMIDI} from '../js/editor/exportMidi.js';
import {importMidi} from '../js/editor/importMidi.js';

test('tempo point editing keeps a sorted unique map, tick-zero base and exact time conversion',()=>{
 const s=new Sequence({tempo:120});setTempoPoint(s,null,3840,150);setTempoPoint(s,null,1920,60);
 assert.deepEqual(tempoPoints(s),[{tick:0,tempo:120},{tick:1920,tempo:60},{tick:3840,tempo:150}]);
 assert.equal(s.ticksToSeconds(3840),6);assert.equal(s.secondsToTicks(6),3840);
 setTempoPoint(s,3840,1920,90);assert.deepEqual(s.tempoChanges,[{tick:1920,tempo:90}]);
 setTempoPoint(s,0,0,100);assert.equal(s.tempo,100);assert.throws(()=>deleteTempoPoint(s,0));assert.throws(()=>setTempoPoint(s,0,120,60));
 const before=s.toJSON();assert.throws(()=>setTempoPoint(s,null,-1,50));assert.throws(()=>setTempoPoint(s,null,50,0));assert.equal(s.toJSON(),before);
 deleteTempoPoint(s,1920);assert.equal(s.tempoChanges.length,0);
});

test('edited tempo map survives project and MIDI roundtrip without creating an instrument channel',()=>{
 const s=new Sequence({tempo:120,channels:[{channel:0,program:0}],tempoChanges:[{tick:1920,tempo:90},{tick:3840,tempo:150}]});
 const p=s.addPattern({channel:0,lengthTicks:7680});s.addNote(p.id,{track:0,key:60,tick:0,dur:7000});s.placePattern(p.id,0);
 const copy=Sequence.fromJSON(s.toJSON());assert.deepEqual(copy.tempoChanges,s.tempoChanges);
 const midi=importMidi(writeArrangementMIDI(s));assert.equal(midi.channels.filter(c=>c.created).length,1);
 for(const tick of [0,1920,2500,3840,6500])assert.ok(Math.abs(midi.tempoAt(tick)-s.tempoAt(tick))<.001);
 for(const tick of [0,1920,2500,3840,6500])assert.ok(Math.abs(copy.secondsToTicks(copy.ticksToSeconds(tick))-tick)<1e-8);
});
