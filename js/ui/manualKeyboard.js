const names=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const codes=['KeyZ','KeyS','KeyX','KeyD','KeyC','KeyV','KeyG','KeyB','KeyH','KeyN','KeyJ','KeyM','KeyQ','Digit2','KeyW','Digit3','KeyE','KeyR','Digit5','KeyT','Digit6','KeyY','Digit7','KeyU','KeyI'];
const hints=['Z','S','X','D','C','V','G','B','H','N','J','M','Q','2','W','3','E','R','5','T','6','Y','7','U','I'];
export function mountManualKeyboard({host,button,getContext,startVoice,onStart,onEnd,onFlush,onRecordChange,onError}) {
    const panel=document.createElement('section');panel.className='manual-keyboard';panel.hidden=true;
    panel.innerHTML=`<div class="manual-tools"><strong>Live keyboard</strong><button type="button" data-octave="-1" aria-label="Octave down">− Oct</button><output data-octave-label></output><button type="button" data-octave="1" aria-label="Octave up">+ Oct</button><label>Velocity <input type="range" min="1" max="127" value="100" aria-label="Keyboard velocity"></label><button type="button" data-rec aria-pressed="false">● REC</button><button type="button" data-panic>All notes off</button></div><div class="manual-keys" role="group" aria-label="Playable piano keyboard"></div><small>Lower octave: Z S X D C V G B H N J M · upper: Q 2 W 3 E R 5 T 6 Y 7 U I · octave: −/+ buttons · click/touch keys to play · REC records only during playback. Physical key positions work with Russian layout too.</small>`;
    host.append(panel);
    let base=48,visible=false,armed=false,identity=null;
    const held=new Map(), keys=panel.querySelector('.manual-keys');
    const rec=panel.querySelector('[data-rec]');
    const allowed=()=>visible&&getContext()?.enabled&&!document.querySelector('dialog[open],.arr-dialog-overlay')&&!document.hidden;
    function draw(){
        keys.replaceChildren();let whites=0;
        const totalWhites=Array.from({length:Math.min(127,base+24)-base+1},(_,i)=>base+i).filter(key=>![1,3,6,8,10].includes(key%12)).length;
        for(let key=base;key<=Math.min(127,base+24);key++) {
            const black=[1,3,6,8,10].includes(key%12),offset=key-base;
            const b=document.createElement('button');b.type='button';b.dataset.note=key;b.className=`manual-key ${black?'black':'white'}`;
            b.style.left=`${black?whites*100/totalWhites-2.1:whites*100/totalWhites}%`;b.style.width=`${black?4.2:100/totalWhites}%`;
            if(!black)whites++;
            b.setAttribute('aria-label',`${names[key%12]}${Math.floor(key/12)-1}`);b.setAttribute('aria-pressed',String([...held.values()].some(v=>v.key===key)));
            b.innerHTML=`<span>${names[key%12]}${Math.floor(key/12)-1}</span><small>${hints[offset]??''}</small>`;
            b.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();b.setPointerCapture(e.pointerId);press(`pointer:${e.pointerId}`,key);});
            b.addEventListener('pointerup',e=>release(`pointer:${e.pointerId}`));b.addEventListener('pointercancel',e=>release(`pointer:${e.pointerId}`));
            b.addEventListener('keydown',e=>{if(e.code==='Enter'||e.code==='Space'){e.preventDefault();if(!e.repeat)press(`button:${key}`,key);}});
            b.addEventListener('keyup',e=>{if(e.code==='Enter'||e.code==='Space'){e.preventDefault();release(`button:${key}`);}});
            keys.append(b);
        }
        panel.querySelector('[data-octave-label]').textContent=`${names[base%12]}${Math.floor(base/12)-1}–${names[Math.min(127,base+24)%12]}${Math.floor(Math.min(127,base+24)/12)-1}`;
    }
    function highlight(){for(const b of keys.children)b.setAttribute('aria-pressed',String([...held.values()].some(v=>v.key===Number(b.dataset.note))));}
    async function press(id,key){
        if(!allowed()||held.has(id))return;
        // One manual voice per pitch, even when mouse and computer key overlap.
        if([...held.values()].some(v=>v.key===key))return;
        const context=getContext();const voice={key,ended:false,release:null,record:null};held.set(id,voice);highlight();
        try {
            const velocity=Number(panel.querySelector('[aria-label="Keyboard velocity"]').value);
            const releaseVoice=await startVoice(context,key,velocity,()=>!voice.ended&&allowed()&&getContext()?.identity===context.identity);
            if(voice.ended||!allowed()||getContext()?.identity!==context.identity){releaseVoice();return;}
            voice.release=releaseVoice;
            voice.record=onStart?.(key,armed,velocity);
        }catch(error){held.delete(id);voice.ended=true;highlight();onError?.(error);}
    }
    function release(id){const voice=held.get(id);if(!voice)return;held.delete(id);voice.ended=true;voice.release?.();if(voice.record)onEnd?.(voice.key,voice.record);highlight();}
    function flush(){for(const id of [...held.keys()]){held.get(id)?.release?.panic?.();release(id);}onFlush?.();}
    button.addEventListener('click',()=>{flush();visible=!visible;panel.hidden=!visible;button.classList.toggle('active',visible);button.setAttribute('aria-pressed',String(visible));if(!visible)setArmed(false);});
    function setArmed(value){if(armed===value)return;flush();armed=value;rec.classList.toggle('recording',armed);rec.setAttribute('aria-pressed',String(armed));onRecordChange?.(armed);}
    rec.addEventListener('click',()=>setArmed(!armed));
    panel.querySelector('[data-panic]').addEventListener('click',flush);
    for(const b of panel.querySelectorAll('[data-octave]'))b.addEventListener('click',()=>{flush();base=Math.max(0,Math.min(108,base+Number(b.dataset.octave)*12));draw();});
    const down=e=>{
        if(!allowed()||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||e.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
        const offset=codes.indexOf(e.code);if(offset<0||base+offset>127)return;
        e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)press(e.code,base+offset);
    };
    const up=e=>{if(held.has(e.code)){e.preventDefault();release(e.code);}};
    const blur=()=>flush();
    const focus=()=>{if(document.activeElement?.closest('input,textarea,select,dialog'))flush();};
    document.addEventListener('keydown',down,true);document.addEventListener('keyup',up,true);window.addEventListener('blur',blur);document.addEventListener('visibilitychange',blur);document.addEventListener('focusin',focus);
    // A modal can open without moving focus immediately; release voices in that case too.
    const observer=new MutationObserver(()=>{if(held.size&&!allowed())flush();});observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
    draw();
    return {flush, get armed(){return armed;}, refresh(){const context=getContext();if(context?.identity!==identity||!context?.enabled){flush();identity=context?.identity;setArmed(false);}button.hidden=!context?.enabled;if(!context?.enabled){visible=false;panel.hidden=true;button.setAttribute('aria-pressed','false');button.classList.remove('active');}},destroy(){flush();observer.disconnect();document.removeEventListener('keydown',down,true);document.removeEventListener('keyup',up,true);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',blur);document.removeEventListener('focusin',focus);panel.remove();}};
}
