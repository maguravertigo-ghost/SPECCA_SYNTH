import { EFFECTS, defaultEffects } from '../editor/audioEffects.js';
export function openAudioEffects({getSequence,onChange,onCommit}) {
    const sequence=getSequence();
    const dialog=document.createElement('dialog');dialog.className='arr-dialog-box app-dialog audio-effects-dialog';dialog.setAttribute('aria-label','Shared audio effects');
    dialog.innerHTML='<h2 class="arr-dialog-title">Shared audio effects</h2><div class="arr-dialog-body"><p>Parallel Reverb / Chorus / Delay buses. Set each channel’s sends in the mixer. These parameters affect every channel sent to the bus.</p><div class="audio-effects-panels"></div><p class="muted">GS parameter scales unless stated otherwise. Delay tempo sync and independent insert effects are not available yet.</p></div><form method="dialog" class="arr-dialog-footer"><button class="btn btn-primary">Close</button></form>';
    const panels=dialog.querySelector('.audio-effects-panels');
    let changed=false;
    const values=()=>sequence.effects??defaultEffects();
    const edit=()=>{sequence.effects??=defaultEffects();changed=true;};
    for(const [id,spec] of Object.entries(EFFECTS)) {
        const group=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent=spec.name;group.append(legend);
        const label=document.createElement('label'),enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=values()[id]?.enabled!==false;
        enabled.setAttribute('aria-label',`Enable ${spec.name}`);label.append(enabled,' Enabled');group.append(label);
        enabled.addEventListener('change',()=>{edit();sequence.effects[id].enabled=enabled.checked;onChange();onCommit();changed=false;});
        for(const [key,[title,,min,max,fallback]] of Object.entries(spec.parameters)) {
            const row=document.createElement('label');row.className='effect-parameter';const text=document.createElement('span');text.textContent=title;
            const control=document.createElement('input');control.type='range';control.min=min;control.max=max;control.step=1;control.value=values()[id]?.[key]??fallback;control.setAttribute('aria-label',`${spec.name} ${key}`);
            const output=document.createElement('output');output.value=control.value;row.append(text,control,output);group.append(row);
            control.addEventListener('input',()=>{edit();sequence.effects[id][key]=Number(control.value);output.value=control.value;onChange();});
            control.addEventListener('change',()=>{if(changed){onCommit();changed=false;}});
        }
        panels.append(group);
    }
    dialog.addEventListener('close',()=>{if(changed)onCommit();dialog.remove();},{once:true});document.body.append(dialog);dialog.showModal();return dialog;
}
