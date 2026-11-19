export function openMixer({ title = 'Mixer', channels, onChange, onCommit } = {}) {
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
        row.className = 'mixer-row';
        row.innerHTML = `<span></span><button type="button" class="btn mixer-toggle" aria-pressed="false">ON</button>
            <input type="range" min="0" max="100"><output></output>`;
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
        refreshRows.push(refresh);
        refresh(); list.append(row);
    }
    refreshAll();
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
    return dialog;
}
