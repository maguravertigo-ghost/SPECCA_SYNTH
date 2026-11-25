export function openWavExport({render,download}) {
    const dialog=document.createElement('dialog');dialog.className='arr-dialog-box app-dialog';dialog.setAttribute('aria-label','Export WAV');
    dialog.innerHTML=`<form><h2 class="arr-dialog-title">Export stereo WAV</h2><div class="arr-dialog-body"><p>Whole arrangement · current SoundFont, Chiptune, WAV audio, automation and FX · includes master volume. Playback stops during export.</p><label class="arr-field"><span>Sample rate</span><select name="rate"><option value="44100">44.1 kHz</option><option value="48000">48 kHz</option></select></label><label class="arr-field"><span>FX tail (seconds)</span><input name="tail" type="number" min="0" max="30" step="1" value="8" required></label><p>16-bit PCM, stereo. No normalization. Choose a longer tail for long reverbs/delays. Limit: 5 minutes including tail.</p><p role="status" data-status></p></div><div class="arr-dialog-footer"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn btn-primary" type="submit">Export WAV</button></div></form>`;
    const form=dialog.querySelector('form'),status=dialog.querySelector('[data-status]'),button=form.querySelector('[type="submit"]'),cancel=dialog.querySelector('[data-cancel]');
    let busy=false,controller;
    const abort=()=>{if(busy){controller.abort();status.textContent='Cancelling render…';cancel.disabled=true;}else dialog.close();};
    cancel.addEventListener('click',abort);dialog.addEventListener('cancel',event=>{event.preventDefault();abort();});
    form.addEventListener('submit',async event=>{
        event.preventDefault();if(busy)return;
        busy=true;controller=new AbortController();button.disabled=true;
        const rate=form.elements.rate,tail=form.elements.tail;
        const options={sampleRate:Number(rate.value),tail:Number(tail.value),signal:controller.signal,onStatus:text=>status.textContent=text};
        rate.disabled=tail.disabled=true;
        try{
            const result=await render(options);
            download(result.buffer);
            status.textContent=`WAV exported · ${result.seconds.toFixed(1)} s${result.clipped?` · WARNING: ${result.clipped} clipped samples. Lower master volume and export again.`:' · No clipped samples.'}`;
        }catch(error){status.textContent=error.name==='AbortError'?'Export cancelled.':`Export failed: ${error.message}`;}
        finally{busy=false;button.disabled=false;rate.disabled=tail.disabled=false;cancel.disabled=false;cancel.textContent='Close';}
    });
    dialog.addEventListener('close',()=>{controller?.abort();dialog.remove();},{once:true});document.body.append(dialog);dialog.showModal();return dialog;
}
