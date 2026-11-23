import { splitGroups } from '../editor/channelSplit.js';
export function chooseChannelSplit(sequence,channel) {
    const patterns=sequence.patterns.filter(p=>p.channel===channel.channel);
    return new Promise(resolve=>{
        const dialog=document.createElement('dialog');dialog.className='arr-dialog-box app-dialog channel-split-dialog';dialog.setAttribute('aria-label','Split channel');
        dialog.innerHTML=`<form method="dialog"><h2 class="arr-dialog-title">Split channel</h2><div class="arr-dialog-body"><p data-name></p><label class="arr-field"><span>Split by</span><select name="mode">${channel.isDrum?'<option value="families">Drum categories</option>':''}<option value="notes">Each MIDI note / sound</option></select></label><p data-preview></p><p>Keep the current sound and timing; choose Chiptune or other instruments afterwards. New channels are placed together here. The original channel becomes the first group. Undo restores the original part.</p></div><div class="arr-dialog-footer"><button class="btn" value="cancel">Cancel</button><button class="btn btn-primary" value="split">Split</button></div></form>`;
        dialog.querySelector('[data-name]').textContent=channel.name||`Channel ${channel.channel+1}`;
        const select=dialog.querySelector('select'),button=dialog.querySelector('[value="split"]');
        const refresh=()=>{const groups=splitGroups(patterns,{mode:select.value,isDrum:channel.isDrum});button.disabled=groups.length<2;dialog.querySelector('[data-preview]').textContent=groups.length?`${groups.length} channel(s): ${groups.map(g=>g.name).join(', ')}`:'No notes to split.';};
        select.addEventListener('change',refresh);refresh();
        dialog.addEventListener('close',()=>{const result=dialog.returnValue==='split'?select.value:null;dialog.remove();resolve(result);},{once:true});document.body.append(dialog);dialog.showModal();
    });
}
