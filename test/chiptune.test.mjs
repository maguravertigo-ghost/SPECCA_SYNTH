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
