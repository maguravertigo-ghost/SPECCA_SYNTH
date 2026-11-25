import {formatTimestamp} from '../editor/timeline.js';
export function editTimestamp({title='Time marker',name='',seconds=0,withName=true}={}){
    return new Promise(resolve=>{
        const ms=Math.max(0,Math.round(seconds*1000)),dialog=document.createElement('dialog');
        dialog.className='app-dialog arr-dialog-box timestamp-dialog';dialog.setAttribute('aria-label',title);
        dialog.innerHTML=`<form method="dialog"><h2 class="arr-dialog-title"></h2><div class="arr-dialog-body"><label class="arr-field" data-name-row><span>Name</span><input data-marker-name maxlength="120" required></label><div class="timestamp-fields">${[['minutes','Minutes',Math.floor(ms/60000),9999],['seconds','Seconds',Math.floor(ms/1000)%60,59],['milliseconds','Milliseconds',ms%1000,999]].map(([id,label,value,max])=>`<label><span>${label}</span><input type="number" data-time="${id}" aria-label="${label}" min="0" max="${max}" step="1" value="${value}" required></label>`).join('<b>:</b>')}</div><output data-formatted></output><p class="muted">Minutes : seconds : milliseconds. Type a value or use ↑ / ↓ for steps of 1.</p></div><footer class="arr-dialog-footer"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn btn-primary" value="apply">Apply</button></footer></form>`;
        dialog.querySelector('h2').textContent=title;
        const input=dialog.querySelector('[data-marker-name]');input.value=name;input.required=withName;dialog.querySelector('[data-name-row]').hidden=!withName;
        const value=()=>Number(dialog.querySelector('[data-time="minutes"]').value)*60+Number(dialog.querySelector('[data-time="seconds"]').value)+Number(dialog.querySelector('[data-time="milliseconds"]').value)/1000;
        const refresh=()=>{dialog.querySelector('[data-formatted]').value=formatTimestamp(value());};
        dialog.addEventListener('input',refresh);refresh();
        dialog.querySelector('[data-cancel]').onclick=()=>dialog.close('cancel');
        dialog.addEventListener('close',()=>{resolve(dialog.returnValue==='apply'?{name:input.value.trim()||'Marker',seconds:value()}:null);dialog.remove();},{once:true});
        document.body.append(dialog);dialog.showModal();(withName?input:dialog.querySelector('[data-time]')).focus();
    });
}
