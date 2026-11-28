import {getDrumSounds} from '../core/drumSounds.js';
import {mappedVelocity} from '../editor/soundFontDrums.js';
import {getInstrumentCatalog} from './instrumentFields.js';
import {sameInstrument} from '../editor/instruments.js';
import {drumMatrixNotes,notesToDrumRows} from '../editor/drumSequencer.js';

export function openDrumSequencer({sequence,pattern,channel,onAudition,onSilence}) {
    return new Promise(resolve=>{
        const dialog=document.createElement('dialog');dialog.className='app-dialog arr-dialog-box drum-sequencer';dialog.setAttribute('aria-label','Drum sequencer');
        dialog.innerHTML=`<header class="arr-dialog-title">Drum sequencer</header><div class="drum-controls"><label>Drum kit <select data-kit aria-label="Drum kit"></select></label><label>Bars <select data-bars aria-label="Loop bars">${[1,2,3,4,5,6,7,8].map(n=>`<option>${n}</option>`).join('')}</select></label><label>Grid <select data-division aria-label="Drum grid"><option value="8">1/8</option><option value="16" selected>1/16</option><option value="32">1/32</option></select></label><label>Preview BPM <input data-bpm type="number" min="20" max="400" value="${Math.max(20,Math.min(400,sequence.tempo))}" aria-label="Drum preview BPM"></label><button type="button" class="btn" data-play>▶ Preview</button><button type="button" class="btn" data-clear>Clear steps</button><button type="button" class="btn" data-repeat>Repeat first bar</button></div><div class="drum-matrix" tabindex="0" aria-label="Drum step matrix"></div><div class="drum-controls"><label>Mapped sound <select data-note aria-label="Add drum note"></select></label><label>Find sound <input type="search" data-sound-search aria-label="Find drum sound"></label><label><input type="checkbox" data-all-keys>All MIDI keys</label><button type="button" class="btn" data-audition-sound>▶ Sound</button><button type="button" class="btn" data-add>Add row</button><button type="button" class="btn" data-add-all>Add all mapped sounds</button><output data-sound-status role="status"></output><label>Existing notes <select data-operation aria-label="Drum send mode"><option value="replace">Replace</option><option value="append">Keep and add</option></select></label></div><p class="drum-help muted">Left-drag to draw, right-drag to erase. Click a row name to audition. Velocity is per row. Draft starts from existing notes rounded to this grid; longer notes are shown as triggers. Replace sets pattern length to the chosen loop; Keep and add preserves existing notes and length. Preview uses a constant BPM, not the arrangement tempo map.</p><footer class="arr-dialog-footer"><button type="button" class="btn" data-cancel>Cancel</button><button type="button" class="btn btn-primary" data-send>Send to Piano Roll</button></footer>`;
        const $=s=>dialog.querySelector(s),matrix=$('.drum-matrix'),kit=$('[data-kit]'),bars=$('[data-bars]'),division=$('[data-division]'),play=$('[data-play]');
        const kits=getInstrumentCatalog().filter(p=>p.isDrum);if(!kits.some(p=>sameInstrument(p,channel)))kits.unshift({...channel,name:channel.presetName||'Current kit'});
        kit.replaceChildren(...kits.map((p,i)=>new Option(`${p.name} · Program ${p.program+1} (MIDI ${p.program}) · Bank ${p.bankMSB??0}:${p.bankLSB??0}`,i)));
        kit.value=String(Math.max(0,kits.findIndex(p=>sameInstrument(p,channel))));bars.value=String(Math.min(8,Math.max(1,Math.ceil(pattern.lengthTicks/sequence.ticksPerBar))));
        const rows=notesToDrumRows(pattern.notes,{timeDivision:sequence.timeDivision});
        let timer=null,epoch=0,sounds=null,mapRequest=0,brush=null;
        const steps=()=>Math.ceil(Number(bars.value)*sequence.ticksPerBar/(sequence.timeDivision*4/Number(division.value)));
        const patch=()=>{const p=kits[Number(kit.value)];return {source:'soundfont',chip:null,isDrum:true,isGMGSDrum:p.isGMGSDrum??true,program:p.program??0,bankMSB:p.bankMSB??0,bankLSB:p.bankLSB??0,presetName:p.name};};
        function stop(){epoch++;clearTimeout(timer);timer=null;play.textContent='▶ Preview';matrix.querySelectorAll('.is-playing').forEach(e=>e.classList.remove('is-playing'));onSilence?.();}
        async function hit(key,velocity){try{const token=epoch;const release=await onAudition(patch(),key,velocity,()=>dialog.open&&epoch===token);if(epoch!==token||!dialog.open){release?.();return;}setTimeout(()=>release?.(),90);}catch(error){stop();play.textContent='Preview unavailable';play.title=error.message;}}
        function render(){
            const count=steps(),perBar=sequence.ticksPerBar/(sequence.timeDivision*4/Number(division.value));
            matrix.style.setProperty('--drum-steps',count);
            matrix.innerHTML='';
            const ruler=document.createElement('div');ruler.className='drum-row drum-step-header';
            const corner=document.createElement('span');corner.className='drum-row-label';corner.textContent='Drum / velocity';ruler.append(corner);
            for(let i=0;i<count;i++){const label=document.createElement('span');label.textContent=i%perBar<.001?`B${1+Math.floor(i/perBar)}`:String(i%perBar+1);ruler.append(label);}matrix.append(ruler);
            for(const row of rows){
                const line=document.createElement('div');line.className='drum-row';
                const label=document.createElement('div');label.className='drum-row-label';
                const audition=document.createElement('button');audition.type='button';audition.className='btn';const sound=sounds?.find(s=>s.key===row.key);audition.textContent=`${row.key} · ${sound?.name||row.name}`;audition.title=`${row.name} · MIDI note ${row.key}\n${sound?.name||'No mapped sample found / metadata unavailable'}${sound?'\nVelocity '+sound.velocities.map(r=>`${r.min}–${r.max}`).join(', '):''}`;line.classList.toggle('is-unmapped',sounds!==null&&!sound);audition.onclick=()=>hit(row.key,row.velocity);
                const vel=document.createElement('input');vel.type='number';vel.min='1';vel.max='127';vel.value=row.velocity;vel.setAttribute('aria-label',`Velocity ${row.key}`);vel.onchange=()=>{row.velocity=Math.max(1,Math.min(127,Number(vel.value)||100));vel.value=row.velocity;};const mute=document.createElement('button');mute.type='button';mute.className='btn drum-row-mute';mute.textContent=row.muted?'M':'ON';mute.title='Mute row in preview and Send';mute.setAttribute('aria-pressed',String(!!row.muted));mute.onclick=()=>{row.muted=!row.muted;mute.textContent=row.muted?'M':'ON';mute.setAttribute('aria-pressed',String(row.muted));};
                const actions=document.createElement('select');actions.setAttribute('aria-label',`Actions ${row.key}`);actions.innerHTML='<option value="">Row…</option><option value="clear">Clear</option><option value="4">Every 4 steps</option><option value="2">Every 2 steps</option><option value="1">Every step</option><option value="remove">Remove row</option>';actions.onchange=()=>{if(actions.value==='remove')rows.splice(rows.indexOf(row),1);else if(actions.value==='clear')row.steps.clear();else if(actions.value)row.steps=new Set(Array.from({length:steps()},(_,i)=>i).filter(i=>i%Number(actions.value)===0));render();};
                label.append(audition,vel,mute,actions);line.append(label);
                for(let step=0;step<count;step++){
                    const button=document.createElement('button');button.type='button';button.className='drum-step';button.dataset.step=step;button.dataset.key=row.key;button.classList.toggle('is-bar',step%perBar<.001);button.classList.toggle('is-beat',step%(Number(division.value)/4)===0);button.setAttribute('aria-label',`${row.name} step ${step+1}`);button.setAttribute('aria-pressed',String(row.steps.has(step)));button.title=`${row.name} · B${1+Math.floor(step/perBar)} · step ${step+1}`;
                    button.onpointerdown=e=>{if(e.button!==0&&e.button!==2)return;e.preventDefault();brush={erase:e.button===2||row.steps.has(step),pointerId:e.pointerId};paint(button);};
                    button.onpointerenter=()=>{if(brush)paint(button);};button.oncontextmenu=e=>{e.preventDefault();row.steps.delete(step);button.setAttribute('aria-pressed','false');};
                    button.onclick=e=>{if(e.detail===0){row.steps.has(step)?row.steps.delete(step):row.steps.add(step);button.setAttribute('aria-pressed',String(row.steps.has(step)));}};line.append(button);
                }
                matrix.append(line);
            }
        }
        function paint(button){const row=rows.find(r=>r.key===Number(button.dataset.key)),step=Number(button.dataset.step);if(!row)return;brush.erase?row.steps.delete(step):row.steps.add(step);button.setAttribute('aria-pressed',String(row.steps.has(step)));}
        const endBrush=()=>{brush=null;};window.addEventListener('pointerup',endBrush);window.addEventListener('pointercancel',endBrush);window.addEventListener('blur',endBrush);dialog.addEventListener('contextmenu',e=>{if(e.target.closest('.drum-matrix'))e.preventDefault();});
        function fillSounds(){
            const query=$('[data-sound-search]').value.toLowerCase(),all=$('[data-all-keys]').checked||sounds===null;
            const entries=all?Array.from({length:128},(_,key)=>sounds?.find(s=>s.key===key)??{key,name:'Unmapped / unverified'}):sounds;
            $('[data-note]').replaceChildren(...entries.filter(s=>`${s.key} ${s.name}`.toLowerCase().includes(query)).map(s=>new Option(`${s.key} · ${s.name}`,s.key)));
            $('[data-add]').disabled=!$('[data-note]').options.length;$('[data-audition-sound]').disabled=$('[data-add]').disabled;$('[data-add-all]').disabled=!sounds?.length;
        }
        async function loadSounds(){
            const request=++mapRequest;$('[data-sound-status]').value='Reading mapped sounds…';
            try{const result=await getDrumSounds(patch());if(request!==mapRequest||!dialog.open)return;sounds=result;for(const row of rows){const sound=sounds?.find(s=>s.key===row.key);if(sound)row.velocity=mappedVelocity(sound,row.velocity);}$('[data-sound-status]').value=sounds===null?'No key map for this preset. Keys are unverified.':`${sounds.length} mapped notes · names from SoundFont samples`;}catch(error){if(request!==mapRequest||!dialog.open)return;sounds=null;$('[data-sound-status]').value=`Key map unavailable: ${error.message}`;}
            fillSounds();render();
        }
        $('[data-sound-search]').oninput=fillSounds;$('[data-all-keys]').onchange=fillSounds;
        const addSound=sound=>{if(!rows.some(r=>r.key===sound.key))rows.push({key:sound.key,name:sound.name,velocity:mappedVelocity(sound),steps:new Set()});};
        $('[data-audition-sound]').onclick=()=>{if(!$('[data-note]').options.length)return;const key=Number($('[data-note]').value);hit(key,mappedVelocity(sounds?.find(s=>s.key===key)));};
        $('[data-add-all]').onclick=()=>{for(const sound of sounds??[])addSound(sound);render();};
        $('[data-repeat]').onclick=()=>{stop();const perBar=sequence.ticksPerBar/(sequence.timeDivision*4/Number(division.value));for(const row of rows){const first=[...row.steps].filter(s=>s<perBar);row.steps=new Set();for(let bar=0;bar<Number(bars.value);bar++)for(const step of first)row.steps.add(Math.round(step+bar*perBar));}render();};
        let previousDivision=16;
        division.onchange=()=>{stop();const ratio=Number(division.value)/previousDivision;for(const row of rows)row.steps=new Set([...row.steps].map(s=>Math.round(s*ratio)));previousDivision=Number(division.value);render();};bars.onchange=()=>{stop();render();};kit.onchange=()=>{stop();sounds=null;fillSounds();loadSounds();};
        $('[data-clear]').onclick=()=>{stop();for(const row of rows)row.steps.clear();render();};
        $('[data-add]').onclick=()=>{if(!$('[data-note]').options.length)return;const key=Number($('[data-note]').value);addSound(sounds?.find(s=>s.key===key)??{key,name:`Note ${key}`});render();};
        play.onclick=()=>{
            if(timer!==null){stop();return;}const bpm=$('[data-bpm]');if(!bpm.validity.valid)return;
            stop();play.textContent='■ Stop';let step=0;const token=epoch;
            const advance=()=>{if(!dialog.open||token!==epoch)return;matrix.querySelectorAll('.drum-step').forEach(b=>b.classList.toggle('is-playing',Number(b.dataset.step)===step));for(const row of rows)if(!row.muted&&row.steps.has(step))hit(row.key,row.velocity);step=(step+1)%steps();timer=setTimeout(advance,60000/Number(bpm.value)*4/Number(division.value));};advance();
        };
        $('[data-cancel]').onclick=()=>dialog.close('cancel');
        $('[data-send]').onclick=()=>dialog.close('send');
        dialog.addEventListener('close',()=>{stop();mapRequest++;window.removeEventListener('pointerup',endBrush);window.removeEventListener('pointercancel',endBrush);window.removeEventListener('blur',endBrush);const result=dialog.returnValue==='send'?{notes:drumMatrixNotes(rows,{bars:Number(bars.value),ticksPerBar:sequence.ticksPerBar,timeDivision:sequence.timeDivision,division:Number(division.value)}),patch:patch(),lengthTicks:Number(bars.value)*sequence.ticksPerBar,replace:$('[data-operation]').value==='replace'}:null;dialog.remove();resolve(result);},{once:true});
        document.body.append(dialog);render();dialog.showModal();kit.focus();fillSounds();loadSounds();
    });
}
