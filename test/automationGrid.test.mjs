import test from 'node:test';
import assert from 'node:assert/strict';
import {automationGridStep,automationGridLines,automationXToTick,tickToAutomationX,snapAutomationTick} from '../js/editor/automationGrid.js';
const view={stepTicks:120,stepWidth:36,scrollX:81,timeDivision:480,ticksPerBar:1920,lengthTicks:7680};
test('automation and Piano Roll share the exact time-axis transform at every scroll/zoom',()=>{
 for(const zoom of [1,1.18,2,4])for(const scrollX of [0,43,810.5]){
  const v={...view,stepWidth:36*zoom,scrollX};
  for(const tick of [0,119,480,1920,7680])assert.ok(Math.abs(automationXToTick(tickToAutomationX(tick,v),v)-tick)<1e-8);
  for(const line of automationGridLines(v,1000,120)){assert.equal(line.x,line.tick/120*v.stepWidth-scrollX);assert.ok(line.x>=-1e-7&&line.x<=1000+1e-7);}
 }
 assert.equal(automationGridStep('piano',view),120);assert.equal(automationGridStep('1/8T',view),160);assert.equal(automationGridStep('bar',view),1920);
 assert.equal(automationGridStep('1/64',view),30);
});
test('X snapping supports grid, free mode, note starts/ends and pattern boundaries',()=>{
 const options={step:120,lengthTicks:1920,notes:[{tick:253,dur:111}],toleranceTicks:20};
 assert.equal(snapAutomationTick(251,options),240);
 assert.equal(snapAutomationTick(251,{...options,enabled:false}),251);
 assert.equal(snapAutomationTick(251,{...options,mode:'both'}),253);
 assert.equal(snapAutomationTick(366,{...options,mode:'notes'}),364);
 assert.equal(snapAutomationTick(700,{...options,mode:'notes'}),700);
 assert.equal(snapAutomationTick(-4,options),0);assert.equal(snapAutomationTick(2000,options),1920);
});
