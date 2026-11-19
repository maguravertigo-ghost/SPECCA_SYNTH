// Bounded per-project history. UI commits after a complete edit, not each pointermove.
export function createEditHistory(limit = 40) {
    let past = [], future = [], current;
    return {
        reset(snapshot) { past = []; future = []; current = snapshot; },
        commit(snapshot) {
            if (snapshot === current) return false;
            if (current !== undefined) past.push(current);
            if (past.length > limit) past.shift();
            current = snapshot;
            future = [];
            return true;
        },
        undo() { if (!past.length) return null; future.push(current); return current = past.pop(); },
        redo() { if (!future.length) return null; past.push(current); return current = future.pop(); },
        get canUndo() { return past.length > 0; },
        get canRedo() { return future.length > 0; },
    };
}
