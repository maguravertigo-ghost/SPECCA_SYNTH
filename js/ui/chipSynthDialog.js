import {chipSettings, CHIP_PRESETS} from '../editor/chiptune.js';
import {startManualVoice,silenceManualVoices} from '../core/manualVoice.js';
import {prepareChipBank} from '../core/synth.js';
const parameters=[
 ['duty','Pulse width (%)',5,95,.1,100],['attack','Attack (s)',.001,4,.001,1],['decay','Decay (s)',.005,4,.005,1],
 ['sustain','Sustain (%)',0,100,1,100],['release','Release (s)',.005,4,.005,1],
 ['transpose','Transpose (semitones)',-36,36,1,1],['fine','Fine tune (cents)',-100,100,1,1],
 ['pitchAmount','Pitch sweep (semitones)',-48,48,.1,1],['pitchTime','Pitch decay (s)',.005,2,.005,1],
 ['cutoff','Low-pass cutoff (Hz)',40,20000,10,1],['resonance','Resonance (dB)',0,18,.1,1],
];
export function openChipSynth({sequence,channel,onApply}) {
    const original=channel;
    const draft={...structuredClone(channel),source:'chiptune',isDrum:false,chip:chipSettings(channel.chip)};
    const preview={...sequence,channels:sequence.channels.map(c=>c===channel?draft:c)};
    const dialog=document.createElement('dialog');dialog.className='arr-dialog-box app-dialog chip-synth-dialog';dialog.setAttribute('aria-label','Chiptune Synth');
    dialog.innerHTML=`<form method="dialog"><h2 class="arr-dialog-title">Chiptune Synth</h2><div class="arr-dialog-body"><div class="chip-synth-top"><label>Preset <select data-preset><option value="">Custom</option></select></label><label>Wave <select data-wave><option value="pulse">Pulse</option><option value="triangle">Triangle</option><option value="noise">Noise</option></select></label></div><div class="chip-graphs"><figure><figcaption>Generator wave</figcaption><svg data-wave-graph viewBox="0 0 400 120" aria-label="Waveform preview"></svg></figure><figure><figcaption>Volume ADSR · drag A / D–S / R</figcaption><svg data-envelope viewBox="0 0 400 120" aria-label="ADSR editor"></svg></figure><figure><figcaption>Pitch sweep → tuned note</figcaption><svg data-pitch-graph viewBox="0 0 400 120" aria-label="Pitch envelope preview"></svg></figure></div><div class="chip-synth-parameters">${parameters.map(([id,label,min,max,step])=>`<label class="chip-synth-parameter"><span>${label}</span><input type="number" data-value="${id}" min="${min}" max="${max}" step="${step}" aria-label="${label}"><input type="range" data-range="${id}" min="${min}" max="${max}" step="${step}" aria-label="${label} slider"></label>`).join('')}</div><div class="chip-preview-keys"><strong>Preview</strong>${[36,48,60,64,67,72].map(key=>`<button type="button" data-test-note="${key}">${['C','E','G'][key%12===4?1:key%12===7?2:0]}${Math.floor(key/12)-1}</button>`).join('')}<button type="button" data-off>All notes off</button></div><p data-status role="status">Play test notes while adjusting. Settings affect new notes, not an already held voice. Pattern playback is stopped while this draft is edited.</p></div><div class="arr-dialog-footer"><button class="btn" value="cancel">Cancel</button><button class="btn btn-primary" value="apply">Apply</button></div></form>`;
    const preset=dialog.querySelector('[data-preset]'),wave=dialog.querySelector('[data-wave]');
    preset.append(...Object.entries(CHIP_PRESETS).map(([key,p])=>new Option(p.name,key)));
    let closed=false,drag=null;const held=new Map(),pending=new Set();
    const stop=()=>{for(const entry of held.values()){entry.ended=true;entry.release?.();}held.clear();for(const button of dialog.querySelectorAll('[data-test-note]'))button.classList.remove('active');silenceManualVoices();};
    function graphs(){
        const s=draft.chip;
        let seed=71;
        const path=Array.from({length:401},(_,i)=>{const x=i/400;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const y=s.wave==='pulse'?(x<s.duty?1-s.duty:-s.duty):s.wave==='triangle'?1-4*Math.abs(x-.5):(seed/4294967296*2-1)*.65;return `${i?'L':'M'}${i},${60-y*48}`;}).join(' ');
        dialog.querySelector('[data-wave-graph]').innerHTML=`<path d="M0 60H400" class="chip-axis"/><path d="${path}" class="chip-wave-path"/>`;
        const total=s.attack+s.decay+1+s.release;
        const a=10+380*s.attack/total,d=a+380*s.decay/total,r=390-380*s.release/total,y=110-100*s.sustain;
        dialog.querySelector('[data-envelope]').innerHTML=`<path d="M10 110L${a} 10L${d} ${y}L${r} ${y}L390 110" class="chip-env-path"/>${[['a',a,10],['ds',d,y],['r',r,y]].map(([id,x,y])=>`<circle data-handle="${id}" cx="${x}" cy="${y}" r="7"/>`).join('')}`;
        const amount=60-s.pitchAmount;dialog.querySelector('[data-pitch-graph]').innerHTML=`<path d="M0 60H400" class="chip-axis"/><path d="M10 ${amount}Q${10+380*s.pitchTime/2/3} 60 ${10+380*s.pitchTime/2} 60H390" class="chip-pitch-path"/>`;
    }
    function refresh(){
        wave.value=draft.chip.wave;
        for(const [id,,,,,scale] of parameters)for(const selector of ['data-value','data-range'])dialog.querySelector(`[${selector}="${id}"]`).value=Number((draft.chip[id]*scale).toFixed(3));
        dialog.querySelector('[data-range="duty"]').disabled=dialog.querySelector('[data-value="duty"]').disabled=draft.chip.wave!=='pulse';graphs();
    }
    function change(id,value){draft.chip=chipSettings({...draft.chip,[id]:value});preset.value='';graphs();}
    for(const [id,,,,,scale] of parameters){
        const number=dialog.querySelector(`[data-value="${id}"]`),slider=dialog.querySelector(`[data-range="${id}"]`);
        number.addEventListener('input',()=>{if(number.value!==''&&number.validity.valid){slider.value=number.value;change(id,number.valueAsNumber/scale);}});
        slider.addEventListener('input',()=>{number.value=slider.value;change(id,Number(slider.value)/scale);});
    }
    wave.addEventListener('change',()=>{change('wave',wave.value);refresh();});
    preset.addEventListener('change',()=>{if(CHIP_PRESETS[preset.value]){draft.chip=chipSettings(CHIP_PRESETS[preset.value]);refresh();}});
    const envelope=dialog.querySelector('[data-envelope]');
    envelope.addEventListener('pointerdown',e=>{if(!e.target.dataset.handle)return;e.preventDefault();const s=draft.chip;drag={id:e.target.dataset.handle,total:s.attack+s.decay+1+s.release,attack:s.attack};envelope.setPointerCapture(e.pointerId);});
    envelope.addEventListener('pointermove',e=>{if(!drag)return;const rect=envelope.getBoundingClientRect(),x=Math.max(0,Math.min(1,((e.clientX-rect.left)/rect.width*400-10)/380)),level=Math.max(0,Math.min(1,1-((e.clientY-rect.top)/rect.height*120-10)/100));
        if(drag.id==='a')change('attack',x*drag.total);
        if(drag.id==='ds'){change('decay',x*drag.total-drag.attack);change('sustain',level);}
        if(drag.id==='r')change('release',(1-x)*drag.total);
        refresh();
    });
    for(const event of ['pointerup','pointercancel'])envelope.addEventListener(event,()=>{drag=null;});
    for(const button of dialog.querySelectorAll('[data-test-note]')){
        button.addEventListener('pointerdown',async e=>{if(e.button!==0)return;e.preventDefault();button.setPointerCapture(e.pointerId);const token={ended:false,release:null};held.set(button,token);button.classList.add('active');try{
            const task=Promise.resolve(startManualVoice(preview,draft,Number(button.dataset.testNote),100,()=>!closed&&!token.ended));
            pending.add(task);let release;try{release=await task;}finally{pending.delete(task);}
            token.release=release;if(token.ended)release();
        }catch(error){dialog.querySelector('[data-status]').textContent=error.message;}});
        const end=()=>{const token=held.get(button);if(token){token.ended=true;token.release?.();held.delete(button);}button.classList.remove('active');};
        button.addEventListener('pointerup',end);button.addEventListener('pointercancel',end);
    }
    dialog.querySelector('[data-off]').addEventListener('click',stop);
    window.addEventListener('blur',stop);
    dialog.addEventListener('close',async()=>{closed=true;stop();window.removeEventListener('blur',stop);
        try{await Promise.allSettled([...pending]);if(dialog.returnValue==='apply'){onApply({...original,source:'chiptune',isDrum:false,chip:chipSettings(draft.chip)});}await prepareChipBank(sequence);}catch(error){console.error(error);}finally{dialog.remove();}
    },{once:true});
    refresh();document.body.append(dialog);dialog.showModal();return dialog;
}
