import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditHistory } from '../js/editor/history.js';
import { Sequence } from '../js/editor/sequence.js';

test('pattern numbering follows the channel, survives deletion and project round trips', () => {
    const seq = new Sequence({ patternLengthTicks: 1920 });
    seq.addPattern({ name: '10.2', channel: 9 });
    const third = seq.createChannelPattern(9);
    assert.equal(third.name, '10.3');
    assert.equal(third.lengthTicks, 1920);
    seq.placePattern(third.id, 0);
    seq.placePattern(third.id, 1920);
    seq.removePattern(third.id);
    assert.equal(seq.arrangement.length, 0);
    assert.equal(seq.getChannelPattern(9).name, '10.2');
    const restored = Sequence.fromJSON(seq.toJSON());
    assert.equal(restored.createChannelPattern(9).name, '10.4');
    assert.equal(restored.createChannelPattern(0).name, '1.1');
});

test('history ignores identical edits and invalidates redo after branching', () => {
    const history = createEditHistory(2);
    history.reset('a');
    assert.equal(history.commit('a'), false);
    history.commit('b'); history.commit('c'); history.commit('d');
    assert.equal(history.undo(), 'c');
    assert.equal(history.undo(), 'b');
    assert.equal(history.canUndo, false);
    assert.equal(history.redo(), 'c');
    history.commit('e');
    assert.equal(history.canRedo, false);
    assert.equal(history.redo(), null);
    history.reset('another project');
    assert.equal(history.canUndo, false);
});
