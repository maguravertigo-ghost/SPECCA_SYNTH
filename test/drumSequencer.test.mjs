import test from 'node:test';
import assert from 'node:assert/strict';
import {drumMatrixNotes,notesToDrumRows} from '../js/editor/drumSequencer.js';
import {instrumentCatalog,adaptToSoundfont,sameInstrument} from '../js/editor/instruments.js';
import {Sequence} from '../js/editor/sequence.js';
import {writeArrangementMIDI} from '../js/editor/exportMidi.js';
import {importMidi} from '../js/editor/importMidi.js';

test('step matrix converts to exact MIDI notes in 4/4 and 3/4 with row velocity',()=>{
 const rows=[{key:36,velocity:110,steps:new Set([0,4,8,12,16])},{key:38,velocity:80,steps:new Set([4,12])}];
 const notes=drumMatrixNotes(rows,{bars:1});assert.equal(notes.length,6);assert.deepEqual(notes.filter(n=>n.key===36).map(n=>n.tick),[0,480,960,1440]);assert.ok(notes.filter(n=>n.key===38).every(n=>n.vel===80));assert.ok(notes.every(n=>n.dur===60));
 const waltz=drumMatrixNotes(rows,{bars:1,ticksPerBar:1440});assert.equal(waltz.length,4);assert.ok(waltz.every(n=>n.tick<1440));
 const draft=notesToDrumRows([{key:90,tick:127,dur:12,vel:75}]);assert.ok(draft.some(r=>r.key===90&&r.steps.has(1)&&r.velocity===75));
});

test('all selectable banks including XG kits stay selectable, keep exact wire drum addressing and roundtrip',()=>{
 const presets=[{name:'Variant',program:5,bankMSB:2,bankLSB:3,isDrum:false,isGMGSDrum:false},{name:'XG Kit',program:4,bankMSB:127,bankLSB:0,isDrum:true,isGMGSDrum:false}];
 const catalog=instrumentCatalog(presets);assert.equal(catalog.length,2);assert.ok(catalog.some(p=>p.name==='XG Kit'));
 const s=new Sequence({channels:[{channel:9,...catalog[1]}]});const p=s.addPattern({channel:9,lengthTicks:1920});s.addNote(p.id,{track:9,key:36,tick:0,dur:120});s.placePattern(p.id,0);
 const imported=importMidi(writeArrangementMIDI(s));const ch=imported.channels.find(c=>c.created);assert.equal(ch.bankMSB,127);assert.equal(ch.program,4);
 assert.equal(adaptToSoundfont(imported,presets),0);assert.equal(ch.isDrum,true);assert.equal(ch.isGMGSDrum,false);assert.ok(sameInstrument(ch,catalog[1]));assert.equal(ch.sourcePatch,undefined);
});

test('muted sequencer rows are not sent as notes',()=>{
 assert.deepEqual(drumMatrixNotes([{key:36,muted:true,steps:new Set([0])}]),[]);
});
