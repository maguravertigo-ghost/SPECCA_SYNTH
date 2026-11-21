import assert from 'node:assert/strict';
import test from 'node:test';
import { openSavedFont } from '../js/core/fontLibrary.js';

test('remembered local copies are usable without filesystem permissions', async () => {
    const blob = new File(['font'], 'local.sf2');
    assert.deepEqual(await openSavedFont({ blob }), { file: blob, state: 'Saved in this browser' });
});

test('file links report inaccessible and missing files, and only request permission from an explicit action', async () => {
    const file = new File(['font'], 'linked.sf2');
    let requested = 0;
    const handle = {
        queryPermission: async () => 'prompt',
        requestPermission: async () => { requested++; return 'granted'; },
        getFile: async () => file,
    };
    assert.deepEqual(await openSavedFont({ handle }), { state: 'Permission required' });
    assert.equal(requested, 0);
    assert.deepEqual(await openSavedFont({ handle }, true), { file, state: 'Available on disk' });
    assert.equal(requested, 1);
    handle.queryPermission = async () => 'granted';
    handle.getFile = async () => { throw new DOMException('moved', 'NotFoundError'); };
    assert.deepEqual(await openSavedFont({ handle }), { state: 'File moved or deleted' });
});
