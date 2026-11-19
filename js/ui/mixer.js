export function openMixer({ title = 'Mixer', channels, onChange, onCommit } = {}) {
    const dialog = document.createElement('dialog');
    dialog.className = 'arr-dialog-box mixer-dialog';
    dialog.innerHTML = `<form method="dialog"><h2 class="arr-dialog-title"></h2><div class="arr-dialog-body mixer-list"></div>
        <div class="arr-dialog-footer"><button class="btn btn-primary">Close</button></div></form>`;
    dialog.querySelector('h2').textContent = title;
    const list = dialog.querySelector('.mixer-list');
    if (!channels.length) list.textContent = 'No channels to mix yet.';
    for (const channel of channels) {
        const row = document.createElement('div');
        row.className = 'mixer-row';
        row.innerHTML = `<span></span><button type="button" class="btn" aria-pressed="false">Mute</button>
            <input type="range" min="0" max="100"><output></output>`;
        const name = row.querySelector('span'), mute = row.querySelector('button');
        const volume = row.querySelector('input'), value = row.querySelector('output');
        name.textContent = channel.name || `Channel ${channel.channel + 1}`;
        mute.setAttribute('aria-label', `Mute ${name.textContent}`);
        volume.setAttribute('aria-label', `Volume ${name.textContent}`);
        const refresh = () => {
            volume.value = value.textContent = channel.volume ?? 100;
            mute.setAttribute('aria-pressed', String(!!channel.muted));
            mute.classList.toggle('active', !!channel.muted);
        };
        mute.addEventListener('click', () => {
            channel.muted = !channel.muted; refresh(); onChange(channel); onCommit?.();
        });
        volume.addEventListener('input', () => {
            channel.volume = Number(volume.value); value.textContent = volume.value; onChange(channel);
        });
        volume.addEventListener('change', () => onCommit?.());
        refresh(); list.append(row);
    }
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
    return dialog;
}
