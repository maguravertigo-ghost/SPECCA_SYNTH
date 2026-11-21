// js/ui/projectSettings.js
import { log } from '../core/log.js';

export function openProjectSettings({ initial = {}, title = 'Project Settings', onApply, onSoundFont } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'pr-picker-overlay';
    overlay.innerHTML = `
        <div class="pr-picker-box" style="width:min(380px,100%)">
            <div class="pr-picker-title">${title}</div>
            <div style="padding:14px 16px;display:flex;flex-direction:column;gap:12px">
                <label class="pr-num" style="justify-content:space-between">
                    <span>Name</span>
                    <input id="psName" type="text" style="width:180px" >
                </label>
                <label class="pr-num" style="justify-content:space-between">
                    <span>BPM</span>
                    <input id="psBpm" type="number" min="20" max="400" step="0.01" value="${initial.bpm ?? 120}">
                </label>
                <label class="pr-num" style="justify-content:space-between">
                    <span>Bars per new pattern</span>
                    <input id="psBars" type="number" min="1" max="32" value="${initial.bars ?? 4}">
                </label>
                <label class="pr-num" style="justify-content:space-between">
                    <span>Steps / bar</span>
                    <input id="psSteps" type="number" min="1" max="16" value="${initial.steps ?? 4}">
                </label>
                ${onSoundFont ? '<div class="pr-num" style="justify-content:space-between"><span>Playback SoundFont</span><button type="button" class="btn" id="psSoundFont">Choose / change…</button></div>' : ''}
            </div>
            <div style="display:flex;gap:8px;padding:0 16px 14px;justify-content:flex-end">
                <button class="btn" id="psCancel" type="button">Cancel</button>
                <button class="btn btn-primary" id="psOk" type="button">Apply</button>
            </div>
        </div>
    `;
    overlay.querySelector('#psName').value = initial.name ?? 'Untitled';
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#psSoundFont')?.addEventListener('click', onSoundFont);
    overlay.querySelector('#psCancel').addEventListener('click', close);
    overlay.querySelector('#psOk').addEventListener('click', () => {
        const data = {
            name:  overlay.querySelector('#psName').value.trim()  || 'Untitled',
            bpm:   Math.max(20, Math.min(400, Number(overlay.querySelector('#psBpm').value)  || 120)),
            bars:  Math.max(1,  Math.min(32,  Number(overlay.querySelector('#psBars').value) || 4)),
            steps: Math.max(1,  Math.min(16,  Number(overlay.querySelector('#psSteps').value)|| 4)),
        };
        close();
        try { onApply?.(data); }
        catch (err) { log(`Project settings apply failed: ${err}`, 'error'); }
    });
    // фокус в name
    setTimeout(() => overlay.querySelector('#psName')?.focus(), 30);
    return { close };
}