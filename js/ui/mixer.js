export function openMixer({ title = 'Mixer', channels, onChange, onCommit, showPan = false } = {}) {
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
        refreshRows.push(refresh);
        refresh(); list.append(row);
    }
    refreshAll();
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
    return dialog;
}
