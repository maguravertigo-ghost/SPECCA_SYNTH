export const PROJECT_STORAGE_KEY = 'spessa_projects_v1';
export function readProjectLibrary(storage = localStorage) {
    try {
        const data = JSON.parse(storage.getItem(PROJECT_STORAGE_KEY));
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch { return {}; }
}
export function writeProjectLibrary(projects, storage = localStorage) {
    storage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(projects));
}
export function copyProjectEntry(projects, source, destination, { move = false } = {}) {
    destination = destination.trim();
    if (!Object.hasOwn(projects, source)) throw new Error('This saved project no longer exists.');
    if (!destination) throw new Error('Enter a project name.');
    if (destination === source && move) return projects;
    if (Object.hasOwn(projects, destination)) throw new Error('A project with this name already exists. Choose another name.');
    const result = { ...projects, [destination]: { ...structuredClone(projects[source]), timestamp: Date.now() } };
    result[destination].seq.name = destination;
    if (move) delete result[source];
    return result;
}
export function projectCopyName(projects, name) {
    let copy = `${name} — copy`, index = 2;
    while (Object.hasOwn(projects, copy)) copy = `${name} — copy ${index++}`;
    return copy;
}
