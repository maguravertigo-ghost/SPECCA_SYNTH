import test from 'node:test';
import assert from 'node:assert/strict';
import { curveValue, curvePoints, automationEvents } from '../js/editor/automation.js';
import { Sequence } from '../js/editor/sequence.js';
import { writePatternMIDI, writePatternMixMIDI, writeArrangementMIDI } from '../js/editor/exportMidi.js';

test('curves clamp, sort and interpolate cubic eased segments',()=>{
 const c={points:[{x:1,y:1},{x:0,y:0}],smooth:true};
 assert.equal(curveValue(c,.5),.5);assert.equal(curveValue(c,.25),.15625);
 assert.equal(curveValue({...c,bypass:true},.2,.5),.5);
 assert.deepEqual(curvePoints({points:[{x:NaN,y:0},{x:2,y:-1}]}),[{x:1,y:0}]);
});
test('automation is bounded, resets after a clip and survives project round trip',()=>{
 const p={lengthTicks:1920,automation:{fade:{points:[{x:0,y:1},{x:1,y:0}]},pan:{points:[{x:0,y:0},{x:1,y:1}]}}};
 const events=automationEvents(p);assert.ok(events.length>100);
 assert.ok(events.every(e=>e.tick>=0&&e.tick<=1920&&e.value>=0&&e.value<=127));
 assert.deepEqual(events.filter(e=>e.reset).map(e=>[e.cc,e.value]),[[10,64],[11,127]]);
 const seq=new Sequence({patterns:[{...p,id:'p',channel:0,notes:[{track:0,key:60,tick:0,dur:1920,vel:90}]}],arrangement:[{id:'a',patternId:'p',startTick:0},{id:'b',patternId:'p',startTick:1920}]});
 assert.deepEqual(Sequence.fromJSON(seq.toJSON()).patterns[0].automation,p.automation);
 for(const bytes of [writePatternMIDI(seq,'p'),writePatternMixMIDI(seq,'p',{placementId:'b'}).midi,writeArrangementMIDI(seq)]) {
  const a=new Uint8Array(bytes);assert.ok(a.some((v,i)=>v===0xb0&&a[i+1]===11&&a[i+2]===0));
 }
});

test('automation summary distinguishes active, bypassed and empty curves', async()=>{
 const {automationSummary,automationPreview}=await import('../js/editor/automation.js');
 const patterns=[{automation:{pan:{points:[{x:0,y:0},{x:1,y:1}]} }},{automation:{pan:{bypass:true,points:[{x:0,y:.5}]},fade:{points:[]}}}];
 const summary=automationSummary(patterns);
 assert.equal(summary.length,1);assert.equal(summary[0].count,2);assert.equal(summary[0].active,1);
 assert.ok(automationPreview(patterns[0]).includes('#65caff'));
 assert.ok(automationPreview(patterns[1]).includes('stroke-dasharray'));
 assert.equal(automationPreview({}),'');
});
