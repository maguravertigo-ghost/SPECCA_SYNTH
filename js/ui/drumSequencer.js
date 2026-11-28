import {getInstrumentCatalog} from './instrumentFields.js';
import {sameInstrument} from '../editor/instruments.js';
import {drumMatrixNotes,notesToDrumRows} from '../editor/drumSequencer.js';

export function openDrumSequencer({sequence,pattern,channel,onAudition,onSilence}) {
    return new Promise(resolve=>{
        const dialog=document.createElement('dialog');dialog.className='app-dialog arr-dialog-box drum-sequencer';dialog.setAttribute('aria-label','Drum sequencer');
        dialog.innerHTML=`<header class="arr-dialog-title">Drum sequencer</header><div class="drum-controls"><label>Drum kit <select data-kit aria-label="Drum kit"></select></label><label>Bars <select data-bars aria-label="Loop bars">${[1,2,3,4,5,6,7,8].map(n=>`<option>${n}</option>`).join('')}</select></label><label>Grid <select data-division aria-label="Drum grid"><option value="8">1/8</option><option value="16" selected>1/16</option><option value="32">1/32</option></select></label><label>Preview BPM <input data-bpm type="number" min="20" max="400" value="${Math.max(20,Math.min(400,sequence.tempo))}" aria-label="Drum preview BPM"></label><button type="button" class="btn" data-play>▶ Preview</button><button type="button" class="btn" data-clear>Clear steps</button></div><div class="drum-matrix" tabindex="0" aria-label="Drum step matrix"></div><div class="drum-controls"><label>Note (0–127) <input type="number" min="0" max="127" value="35" data-note aria-label="Add drum note"></label><button type="button" class="btn" data-add>Add row</button><label>Existing notes <select data-operation aria-label="Drum send mode"><option value="replace">Replace</option><option value="append">Keep and add</option></select></label></div><p class="drum-help muted">Click steps to toggle. Click a row name to audition. Velocity is per row. Draft starts from existing notes rounded to this grid; longer notes are shown as triggers. Replace sets pattern length to the chosen loop; Keep and add preserves existing notes and length. Preview uses a constant BPM, not the arrangement tempo map.</p><footer class="arr-dialog-footer"><button type="button" class="btn" data-cancel>Cancel</button><button type="button" class="btn btn-primary" data-send>Send to Piano Roll</button></footer>`;
        const $=s=>dialog.querySelector(s),matrix=$('.drum-matrix'),kit=$('[data-kit]'),bars=$('[data-bars]'),division=$('[data-division]'),play=$('[data-play]');
        const kits=getInstrumentCatalog().filter(p=>p.isDrum);if(!kits.some(p=>sameInstrument(p,channel)))kits.unshift({...channel,name:channel.presetName||'Current kit'});
        kit.replaceChildren(...kits.map((p,i)=>new Option(`${p.name} · ${p.bankMSB??0}:${p.bankLSB??0} · #${p.program+1}`,i)));
        kit.value=String(Math.max(0,kits.findIndex(p=>sameInstrument(p,channel))));bars.value=String(Math.min(8,Math.max(1,Math.ceil(pattern.lengthTicks/sequence.ticksPerBar))));
        const rows=notesToDrumRows(pattern.notes,{timeDivision:sequence.timeDivision});
        let timer=null,epoch=0;
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
                const audition=document.createElement('button');audition.type='button';audition.className='btn';audition.textContent=`${row.name} (${row.key})`;audition.title='Audition this note (GM name; custom kits may map it differently)';audition.onclick=()=>hit(row.key,row.velocity);
                const vel=document.createElement('input');vel.type='number';vel.min='1';vel.max='127';vel.value=row.velocity;vel.setAttribute('aria-label',`Velocity ${row.key}`);vel.onchange=()=>{row.velocity=Math.max(1,Math.min(127,Number(vel.value)||100));vel.value=row.velocity;};label.append(audition,vel);line.append(label);
                for(let step=0;step<count;step++){
                    const button=document.createElement('button');button.type='button';button.className='drum-step';button.dataset.step=step;button.dataset.key=row.key;button.classList.toggle('is-bar',step%perBar<.001);button.classList.toggle('is-beat',step%(Number(division.value)/4)===0);button.setAttribute('aria-label',`${row.name} step ${step+1}`);button.setAttribute('aria-pressed',String(row.steps.has(step)));button.title=`${row.name} · B${1+Math.floor(step/perBar)} · step ${step+1}`;
                    button.onclick=()=>{row.steps.has(step)?row.steps.delete(step):row.steps.add(step);button.setAttribute('aria-pressed',String(row.steps.has(step)));};line.append(button);
                }
                matrix.append(line);
            }
        }
        let previousDivision=16;
        division.onchange=()=>{stop();const ratio=Number(division.value)/previousDivision;for(const row of rows)row.steps=new Set([...row.steps].map(s=>Math.round(s*ratio)));previousDivision=Number(division.value);render();};bars.onchange=()=>{stop();render();};kit.onchange=stop;
        $('[data-clear]').onclick=()=>{stop();for(const row of rows)row.steps.clear();render();};
        $('[data-add]').onclick=()=>{const input=$('[data-note]');if(!input.validity.valid)return;const key=Number(input.value);if(!rows.some(r=>r.key===key)){rows.push({key,name:`Note ${key}`,velocity:100,steps:new Set()});render();}};
        play.onclick=()=>{
            if(timer!==null){stop();return;}const bpm=$('[data-bpm]');if(!bpm.validity.valid)return;
            stop();play.textContent='■ Stop';let step=0;const token=epoch;
            const advance=()=>{if(!dialog.open||token!==epoch)return;matrix.querySelectorAll('.drum-step').forEach(b=>b.classList.toggle('is-playing',Number(b.dataset.step)===step));for(const row of rows)if(row.steps.has(step))hit(row.key,row.velocity);step=(step+1)%steps();timer=setTimeout(advance,60000/Number(bpm.value)*4/Number(division.value));};advance();
        };
        $('[data-cancel]').onclick=()=>dialog.close('cancel');
        $('[data-send]').onclick=()=>dialog.close('send');
        dialog.addEventListener('close',()=>{stop();const result=dialog.returnValue==='send'?{notes:drumMatrixNotes(rows,{bars:Number(bars.value),ticksPerBar:sequence.ticksPerBar,timeDivision:sequence.timeDivision,division:Number(division.value)}),patch:patch(),lengthTicks:Number(bars.value)*sequence.ticksPerBar,replace:$('[data-operation]').value==='replace'}:null;dialog.remove();resolve(result);},{once:true});
        document.body.append(dialog);render();dialog.showModal();kit.focus();
    });
}
