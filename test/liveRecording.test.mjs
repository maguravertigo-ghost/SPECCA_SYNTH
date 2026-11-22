import test from 'node:test';
import assert from 'node:assert/strict';
import { recordedSegments } from '../js/editor/liveRecording.js';
test('live notes snap to the grid and split at the loop boundary',()=>{
 assert.deepEqual(recordedSegments(13,246,1920,120),[{tick:0,dur:240}]);
 assert.deepEqual(recordedSegments(1800,2040,1920,120),[{tick:1800,dur:120},{tick:0,dur:120}]);
 assert.deepEqual(recordedSegments(1900,1901,1920,120),[{tick:1919,dur:1}]);
 assert.deepEqual(recordedSegments(1,0,1920),[]);
 assert.deepEqual(recordedSegments(0,100,0),[]);
 for(const [start,end]of [[0,0],[0,1920*10],[1919,1922],[83,478]]){
  const notes=recordedSegments(start,end,1920,40);
  assert.ok(notes.length>0&&notes.every(n=>Number.isInteger(n.tick)&&Number.isInteger(n.dur)&&n.tick>=0&&n.dur>0&&n.tick+n.dur<=1920));
 }
});


test('third-step quantization still produces integer MIDI ticks',()=>{
 const notes=recordedSegments(43,193,400,25/3);
 assert.ok(notes.every(n=>Number.isInteger(n.tick)&&Number.isInteger(n.dur)));
});
