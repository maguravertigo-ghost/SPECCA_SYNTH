import assert from 'node:assert/strict';
import test from 'node:test';
import { BasicMIDI } from '../main.min.js';
import { zipStoredFiles } from '../js/core/zipStore.js';
import { Sequence } from '../js/editor/sequence.js';
import { writeChannelMIDIFiles } from '../js/editor/exportMidi.js';
import { importMidi } from '../js/editor/importMidi.js';
import { appendMidiChannels } from '../js/editor/appendMidiChannels.js';

function source() {
    const s = new Sequence({ tempo: 126, tempoChanges: [{ tick: 1920, tempo: 96 }], channels: [
        { channel: 4, name: 'Соло / Lead', program: 73, muted: true }, { channel: 18, name: 'Drums', isDrum: true, program: 0 },
        { channel: 2, name: 'Notes', kind: 'comment' }, { channel: 3, name: 'Empty' },
    ], channelOrder: [4, 18, 2, 3] });
    for (const [ch, key] of [[4, 72], [18, 36], [2, 68], [3, 88]]) {
        const p = s.addPattern({ channel: ch, lengthTicks: 1920 });
        s.addNote(p.id, { track: ch, key, tick: 240, dur: 120 });
        if (ch === 3) continue; // unplaced
        s.placePattern(p.id, 1920);
        if (ch === 4) s.placePattern(p.id, 3840);
    }
    return s;
}

test('channel files each carry one independent aligned part; comments and unplaced drafts are omitted', () => {
    const s = source(), before = s.toJSON();
    const files = writeChannelMIDIFiles(s);
    assert.deepEqual(files.map(f => f.name), ['01 - Соло _ Lead.mid', '02 - Drums.mid']);
    const decode = data => BasicMIDI.fromArrayBuffer(data);
    const [lead, drums] = files.map(f => decode(f.data));
    assert.deepEqual(lead.tracks[1].events.filter(e => e.statusByte === 0x90).map(e => [e.ticks, e.data[0]]), [[2160, 72], [4080, 72]]);
    assert.deepEqual(drums.tracks[1].events.filter(e => e.statusByte === 0x99).map(e => [e.ticks, e.data[0]]), [[2160, 36]]);
    assert.equal(lead.tracks[1].events.find(e => e.statusByte === 0xc0)?.data[0], 73);
    assert.equal(lead.tracks[1].events.find(e => e.statusByte === 0xb0 && e.data[0] === 7)?.data[1], 127);
    assert.deepEqual(lead.tempoChanges, drums.tempoChanges);
    assert.equal(s.toJSON(), before);
});

test('the ZIP contains individual MIDI payloads and a matching directory with UTF-8 names', () => {
    const files = writeChannelMIDIFiles(source());
    const archive = zipStoredFiles(files);
    const view = new DataView(archive.buffer);
    const eocd = archive.length - 22;
    assert.equal(view.getUint32(eocd, true), 0x06054b50);
    assert.equal(view.getUint16(eocd + 10, true), 2);
    let central = view.getUint32(eocd + 16, true);
    for (const file of files) {
        assert.equal(view.getUint32(central, true), 0x02014b50);
        const length = view.getUint16(central + 28, true);
        assert.equal(new TextDecoder().decode(archive.subarray(central + 46, central + 46 + length)), file.name);
        const local = view.getUint32(central + 42, true);
        assert.equal(view.getUint32(local, true), 0x04034b50);
        const start = local + 30 + view.getUint16(local + 26, true);
        assert.deepEqual(archive.slice(start, start + file.data.byteLength), new Uint8Array(file.data));
        central += 46 + length;
    }
    const example = zipStoredFiles([{ name: 'check', data: new TextEncoder().encode('123456789') }]);
    assert.equal(new DataView(example.buffer).getUint32(14, true), 0xcbf43926);
});

test('adding stems keeps the target tempo and existing channels, and scales note/clip ticks to the target PPQ', () => {
    const project = new Sequence({ name: 'Destination', tempo: 88, timeDivision: 240, channels: [{ channel: 0, name: 'Existing', program: 0 }] });
    const p = project.createChannelPattern(0);
    project.addNote(p.id, { track: 0, key: 59, tick: 0, dur: 20 });
    project.placePattern(p.id, 0);
    const before = project.toJSON();
    const sources = writeChannelMIDIFiles(source()).map(f => importMidi(f.data, f.name));
    const { sequence, count } = appendMidiChannels(project, sources);
    assert.equal(count, 2);
    assert.equal(sequence.tempo, 88);
    assert.equal(sequence.name, 'Destination');
    assert.equal(sequence.orderedChannels()[0].name, 'Existing');
    assert.equal(sequence.arrangement[0].patternId, p.id);
    assert.equal(project.toJSON(), before);
    const [lead, drums] = sequence.orderedChannels().slice(1);
    const copy = sequence.getChannelPattern(lead.channel);
    assert.deepEqual(sequence.arrangement.filter(pl => pl.patternId === copy.id).map(pl => pl.startTick), [960, 1920]);
    assert.deepEqual(copy.notes.map(n => [n.key, n.tick, n.dur, n.track]), [[72, 120, 60, lead.channel]]);
    assert.equal(drums.isDrum, true);
});
