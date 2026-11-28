import test from 'node:test';
import assert from 'node:assert/strict';
import {mappedDrumSounds,mappedVelocity} from '../js/editor/soundFontDrums.js';
const range=(min,max)=>({min,max});
test('mapped sound index intersects preset/instrument keys and velocities and keeps all custom keys',()=>{
 const p={globalZone:{keyRange:range(0,127),velRange:range(0,127)},zones:[{keyRange:range(20,90),velRange:range(30,110),instrument:{globalZone:{keyRange:range(0,127),velRange:range(0,127)},zones:[{keyRange:range(23,24),velRange:range(80,120),sample:{name:'Custom bell'}},{keyRange:range(84,84),velRange:range(1,45),sample:{name:'Click'}},{keyRange:range(40,40),velRange:range(111,127),sample:{name:'Unreachable'}}]}}]};
 const sounds=mappedDrumSounds(p);assert.deepEqual(sounds.map(s=>s.key),[23,24,84]);assert.equal(sounds[0].name,'Custom bell');assert.deepEqual(sounds[0].velocities,[{min:80,max:110}]);assert.equal(mappedVelocity(sounds[0],100),100);assert.equal(mappedVelocity(sounds[2],100),45);assert.equal(mappedVelocity(sounds[0],20),80);
 assert.deepEqual(mappedDrumSounds({zones:[]}),[]);
});
