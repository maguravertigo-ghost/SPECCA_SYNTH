const databaseName = 'spessa-soundfonts';
let dbPromise;
function database() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('fonts', { keyPath: 'id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    return dbPromise;
}
async function access(mode, operation) {
    const db = await database();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('fonts', mode);
        const request = operation(tx.objectStore('fonts'));
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = tx.onerror = () => reject(tx.error ?? request.error);
    });
}
export const listFonts = () => access('readonly', store => store.getAll());
export const saveFont = record => access('readwrite', store => store.put(record));
export const removeFont = id => access('readwrite', store => store.delete(id));
export const activeFontId = () => { try { return localStorage.getItem('spessa-active-font'); } catch { return null; } };
export function setActiveFont(id) {
    if (id) localStorage.setItem('spessa-active-font', id);
    else localStorage.removeItem('spessa-active-font');
}
export async function openSavedFont(record, requestAccess = false) {
    if (record.blob) return { file: record.blob, state: 'Saved in this browser' };
    if (!record.handle) return { state: 'Missing' };
    try {
        const opts = { mode: 'read' };
        const permission = requestAccess ? await record.handle.requestPermission(opts) : await record.handle.queryPermission(opts);
        if (permission !== 'granted') return { state: 'Permission required' };
        return { file: await record.handle.getFile(), state: 'Available on disk' };
    } catch (error) {
        return { state: error.name === 'NotFoundError' ? 'File moved or deleted' : 'File cannot be read' };
    }
}
