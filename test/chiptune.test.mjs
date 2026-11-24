import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundBankLoader } from 'spessasynth_core';
import {buildChipBank,CHIP_PRESETS,chipSettings,chipPatch} from '../js/editor/chiptune.js';
import {Sequence} from '../js/editor/sequence.js';
test('procedural chip bank loads every wave with separate ADSR and correct patch routing',()=>{
 const channels=Object.values(CHIP_PRESETS).map((chip,i)=>({channel:i+16,source:'chiptune',chip}));
 const bank=SoundBankLoader.fromArrayBuffer(buildChipBank(channels));
 assert.equal(bank.presets.length,5);assert.equal(bank.samples.length,4);
 for(const c of channels) {const patch=chipPatch(c.channel);const p=bank.presets.find(p=>p.program===patch.program&&p.bankMSB===patch.bankMSB);assert.ok(p);assert.ok(p.zones.length);}
 const restored=Sequence.fromJSON(new Sequence({channels}).toJSON());assert.deepEqual(restored.channels,channels);
 assert.equal(chipSettings({attack:NaN,release:-1}).release,.005);
 assert.equal(buildChipBank([{channel:0,source:'soundfont'}]),null);
});

test('chip playback patch and portable MIDI fallback are intentionally different',async()=>{
 const {writeArrangementMIDI}=await import('../js/editor/exportMidi.js');
 const channel={channel:0,source:'chiptune',chip:{...CHIP_PRESETS.lead}};
 const seq=new Sequence({channels:[channel],patterns:[{id:'p',channel:0,lengthTicks:1920,notes:[{track:0,key:60,tick:0,dur:480,vel:90}]}],arrangement:[{patternId:'p',startTick:0}]});
 const internal=new Uint8Array(writeArrangementMIDI(seq,{liveMix:true}));
 const portable=new Uint8Array(writeArrangementMIDI(seq));
 assert.ok(internal.some((v,i)=>v===176&&internal[i+1]===0&&internal[i+2]===100));
 assert.ok(portable.some((v,i)=>v===192&&portable[i+1]===80));
 const clone=seq.cloneChannel(0);assert.ok(clone);
 const copy=seq.channels.find(c=>c.channel!==0);copy.chip.attack=1;
 assert.notEqual(copy.chip.attack,seq.channels[0].chip.attack);
});

test('continuous pulse and extended controls clamp safely and survive project roundtrip',()=>{
 const chip=chipSettings({duty:.333,transpose:-12,fine:27,pitchAmount:-24,pitchTime:.3,cutoff:1500,resonance:4.5});
 assert.equal(chip.duty,.333);
 const sequence=new Sequence({channels:[{channel:0,source:'chiptune',chip}]});
 assert.deepEqual(Sequence.fromJSON(sequence.toJSON()).channels[0].chip,chip);
 const bounded=chipSettings({duty:1,transpose:-90,fine:NaN,cutoff:0,resonance:50,pitchAmount:99});
 assert.equal(bounded.duty,.95);assert.equal(bounded.transpose,-36);assert.equal(bounded.fine,0);
 assert.equal(bounded.cutoff,40);assert.equal(bounded.resonance,18);assert.equal(bounded.pitchAmount,48);
});

test('chip soundbank encodes tuning, filter and pitch envelope without changing default note pitch',()=>{
 const chip=chipSettings({duty:.333,transpose:-12,fine:27,pitchAmount:-24,pitchTime:.3,cutoff:1500,resonance:4.5});
 const bank=SoundBankLoader.fromArrayBuffer(buildChipBank([{channel:0,source:'chiptune',chip}]));
 const gens=new Map(bank.presets[0].zones[0].instrument.zones[0].generators.map(g=>[g.type,g.value]));
 assert.equal(gens.get(51),-12);assert.equal(gens.get(52),27);assert.equal(gens.get(7),-2400);
 assert.equal(gens.get(9),45);assert.equal(gens.get(29),1000);
 assert.equal(gens.get(28),Math.round(1200*Math.log2(.3)));
 assert.equal(gens.get(8),Math.round(1200*Math.log2(1500/8.176)));
 assert.equal(gens.get(58),48);
 const defaults=chipSettings();assert.equal(defaults.transpose,0);assert.equal(defaults.fine,0);assert.equal(defaults.pitchAmount,0);
 // One 1024-frame period at this rate and MIDI root 48 stays within 0.01 cent of C3.
 const sample=bank.samples[0];
 assert.ok(Math.abs(1200*Math.log2(sample.sampleRate/1024/130.8127825))<.01);
});
