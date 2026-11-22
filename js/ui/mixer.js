import { EFFECTS, effectSend } from '../editor/audioEffects.js';
export function openMixer({ title = 'Mixer', channels, onChange, onCommit, showPan = false, getAutomation = null, onEffects = null, onSendChange = null, onSendCommit = null } = {}) {
    const dialog = document.createElement('dialog');
    dialog.className = 'arr-dialog-box mixer-dialog app-dialog';
    dialog.setAttribute('aria-label', title);
    dialog.innerHTML = `<form method="dialog">
        <header class="arr-dialog-title mixer-header">
            <h2></h2><button class="btn mixer-toggle mixer-all" type="button" aria-pressed="false">Mute all</button>
        </header>
        <div class="arr-dialog-body mixer-list"></div>
        <footer class="arr-dialog-footer"><button class="btn btn-primary">Close</button></footer>
    </form>`;
    dialog.querySelector('h2').textContent = title;
    if (onEffects) {
        const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='Audio effects…';button.addEventListener('click',onEffects);dialog.querySelector('header').append(button);
    }
    const list = dialog.querySelector('.mixer-list');
    const all = dialog.querySelector('.mixer-all');
    const refreshRows = [];
    const refreshAll = () => {
        const count = channels.filter(channel => channel.muted).length;
        const allMuted = channels.length > 0 && count === channels.length;
        all.disabled = !channels.length;
        all.dataset.state = allMuted ? 'muted' : count ? 'mixed' : 'on';
        all.textContent = allMuted ? 'Unmute all' : 'Mute all';
        all.setAttribute('aria-pressed', String(allMuted));
    };
    all.addEventListener('click', () => {
        const mute = channels.some(channel => !channel.muted);
        for (const channel of channels) {
            if (!!channel.muted === mute) continue;
            channel.muted = mute;
            onChange(channel);
        }
        for (const refresh of refreshRows) refresh();
        refreshAll(); onCommit?.();
    });
    if (!channels.length) list.textContent = 'No channels to mix yet.';
    for (const channel of channels) {
        const row = document.createElement('div');
        row.className = `mixer-row${showPan ? ' mixer-with-pan' : ''}`;
        row.innerHTML = `<span></span><button type="button" class="btn mixer-toggle" aria-pressed="false">ON</button>
            <input type="range" min="0" max="100"><output></output>
            ${showPan ? '<label class="mixer-pan"><span>Pan</span><input type="range" min="0" max="127" value="64"><output>C</output></label>' : ''}`;
        const name = row.querySelector('span'), mute = row.querySelector('button');
        const volume = row.querySelector('input'), value = row.querySelector('output');
        name.textContent = channel.name || `Channel ${channel.channel + 1}`;
        volume.setAttribute('aria-label', `Volume ${name.textContent}`);
        const refresh = () => {
            volume.value = value.textContent = channel.volume ?? 100;
            mute.setAttribute('aria-pressed', String(!!channel.muted));
            mute.setAttribute('aria-label', `${channel.muted ? 'Unmute' : 'Mute'} ${name.textContent}`);
            mute.dataset.state = channel.muted ? 'muted' : 'on';
            mute.textContent = channel.muted ? 'Mute' : 'ON';
        };
        mute.addEventListener('click', () => {
            channel.muted = !channel.muted; refresh(); refreshAll(); onChange(channel); onCommit?.();
        });
        volume.addEventListener('input', () => {
            channel.volume = Number(volume.value); value.textContent = volume.value; onChange(channel);
        });
        volume.addEventListener('change', () => onCommit?.());
        if (showPan) {
            const pan = row.querySelector('.mixer-pan input');
            const position = row.querySelector('.mixer-pan output');
            pan.value = channel.pan ?? 64;
            pan.setAttribute('aria-label', `Pan ${name.textContent}`);
            const updatePan = () => {
                const offset = Number(pan.value) - 64;
                position.value = offset ? `${offset < 0 ? 'L' : 'R'}${Math.abs(offset)}` : 'C';
            };
            updatePan();
            pan.addEventListener('input', () => { channel.pan = Number(pan.value); updatePan(); onChange(channel); });
            pan.addEventListener('change', () => onCommit?.());
            pan.addEventListener('dblclick', () => { pan.value = 64; channel.pan = 64; updatePan(); onChange(channel); onCommit?.(); });
        }
        if (onSendChange) {
            const sends=document.createElement('div');sends.className='mixer-sends';
            for(const [id,spec] of Object.entries(EFFECTS)) {
                const row=document.createElement('label');row.textContent=spec.name;
                const slider=document.createElement('input');slider.type='range';slider.min=0;slider.max=127;slider.value=effectSend(channel,id);slider.setAttribute('aria-label',`${spec.name} send ${name.textContent}`);
                const output=document.createElement('output');output.value=slider.value;
                slider.addEventListener('input',()=>{channel.sends??={};channel.sends[id]=Number(slider.value);output.value=slider.value;onSendChange(channel);});
                slider.addEventListener('change',()=> (onSendCommit ?? onCommit)?.());row.append(slider,output);sends.append(row);
            }
            row.append(sends);
        }
        if (getAutomation) {
            const summary = getAutomation(channel);
            const details = document.createElement('div');
            details.className = 'mixer-automation';
            details.textContent = summary.length ? 'Pattern automation: ' : 'Pattern automation: none';
            for (const spec of summary) {
                const badge = document.createElement('span');
                badge.style.color = spec.color;
                badge.textContent = `${spec.name} ${spec.active}/${spec.count} active`;
                badge.title = 'Active patterns / patterns with a curve, including unplaced patterns. Not a channel audio effect.';
                details.append(badge);
            }
            row.append(details);
        }
        refreshRows.push(refresh);
        refresh(); list.append(row);
    }
    refreshAll();
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
    return dialog;
}
