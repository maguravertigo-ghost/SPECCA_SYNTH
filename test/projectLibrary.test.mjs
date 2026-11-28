import test from 'node:test';
import assert from 'node:assert/strict';
import {readProjectLibrary,writeProjectLibrary,copyProjectEntry,projectCopyName} from '../js/editor/projectLibrary.js';

test('project library renames and clones saved compositions without modifying their music or audio references', () => {
    const projects = {Song:{timestamp:1,seq:{name:'Song',patterns:[{notes:[{tick:120,key:60}]}],audioAssets:[{id:'wav'}],audioClips:[{assetId:'wav'}]}}};
    const cloned = copyProjectEntry(projects,'Song','Song — copy');
    assert.equal(cloned['Song — copy'].seq.name,'Song — copy');
    assert.deepEqual(cloned['Song — copy'].seq.audioAssets,projects.Song.seq.audioAssets);
    cloned['Song — copy'].seq.patterns[0].notes[0].key=72;
    assert.equal(projects.Song.seq.patterns[0].notes[0].key,60);
    assert.equal(projectCopyName(cloned,'Song'),'Song — copy 2');
    const renamed = copyProjectEntry(projects,'Song','New name',{move:true});
    assert.equal(Object.hasOwn(renamed,'Song'),false);assert.equal(renamed['New name'].seq.name,'New name');
    assert.equal(projects.Song.seq.name,'Song');
    assert.throws(()=>copyProjectEntry(cloned,'Song','Song — copy'),/already exists/);
    assert.throws(()=>copyProjectEntry(projects,'Missing','Name'),/no longer exists/);
    assert.throws(()=>copyProjectEntry(projects,'Song','  '),/Enter a project name/);
    const safe = copyProjectEntry(projects,'Song','__proto__');assert.equal(Object.hasOwn(safe,'__proto__'),true);
});

test('library handles empty storage and propagates quota failures without deleting existing data', () => {
    let data=null;const storage={getItem:()=>data,setItem:(_key,value)=>{data=value;}};
    assert.deepEqual(readProjectLibrary(storage),{});
    for(const invalid of ['null','[]','42','{bad']) {data=invalid;assert.deepEqual(readProjectLibrary(storage),{});}
    const projects={Example:{seq:{name:'Example'}}};writeProjectLibrary(projects,storage);assert.deepEqual(readProjectLibrary(storage),projects);
    const before=data;storage.setItem=()=>{throw new Error('Quota exceeded');};
    assert.throws(()=>writeProjectLibrary(copyProjectEntry(projects,'Example','Copy'),storage),/Quota/);assert.equal(data,before);
});
