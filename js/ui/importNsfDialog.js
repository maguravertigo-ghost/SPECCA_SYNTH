import {readNsf} from '../editor/nsf.js';
export function chooseNsfImport({offsetTick=0}={}){
    return new Promise(resolve=>{
        const dialog=document.createElement('dialog');dialog.className='arr-dialog-box app-dialog nsf-import-dialog';dialog.setAttribute('aria-label','Import NSF as notes');
        dialog.innerHTML=`<form><h2 class="arr-dialog-title">Import NSF as editable notes</h2><div class="arr-dialog-body"><label class="arr-field"><span>NSF file</span><input data-nsf-file type="file" accept=".nsf" required></label><p data-nsf-info class="muted">NSF v1 · NTSC · standard NES APU. NSFe, expansion chips and .nes game ROMs are not supported yet.</p><label class="arr-field"><span>Song</span><select data-nsf-song disabled></select></label><label class="arr-field"><span>Duration (s)</span><input data-nsf-duration type="number" min="1" max="180" step="1" value="30" required></label><label class="arr-field"><span>Place at</span><select data-nsf-offset><option value="0">Project start</option><option value="cursor">Arranger playhead</option></select></label><p class="muted">Emulates the music driver locally. Extracts Pulse 1 / Pulse 2 / Triangle / Noise as editable Chiptune notes with volume curves. Pulse duty changes use separate lanes. No automatic tempo detection: timing follows the current project's tempo map.</p><div class="arr-field"><span>DPCM layer</span><label><input data-nsf-dpcm type="checkbox" checked> Include as separate audio channel</label></div><p class="muted">DPCM is sampled audio, not editable piano-roll notes. The other four voices remain real notes; Fade controls their volume. DPCM audio is stored in this browser, like imported WAV.</p><p class="muted">Approximation, not bit-perfect NES playback: pitch is rounded to semitones; slides/arpeggios become short notes. Noise uses procedural noise. DPCM is captured from the emulated DAC, not converted to guessed drum notes. Keep an original recording for comparison.</p><progress data-nsf-progress max="100" value="0" hidden></progress><p data-nsf-status role="status"></p><ul data-nsf-tracks></ul></div><footer class="arr-dialog-footer"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn" type="submit" data-analyze disabled>Extract / preview</button><button class="btn btn-primary" type="button" data-import disabled>Import channels</button></footer></form>`;
        const $=selector=>dialog.querySelector(selector),file=$('[data-nsf-file]'),song=$('[data-nsf-song]'),duration=$('[data-nsf-duration]'),offset=$('[data-nsf-offset]'),dpcm=$('[data-nsf-dpcm]'),analyze=$('[data-analyze]'),apply=$('[data-import]'),status=$('[data-nsf-status]'),progress=$('[data-nsf-progress]'),list=$('[data-nsf-tracks]');
        let buffer=null,header=null,worker=null,result=null,answer=null,fileRequest=0,closed=false;
        const invalidate=()=>{result=null;apply.disabled=true;list.replaceChildren();};
        file.addEventListener('change',async()=>{
            const request=++fileRequest;invalidate();buffer=header=null;analyze.disabled=true;song.disabled=true;
            const selected=file.files[0];if(!selected)return;
            try{
                if(selected.size>4*1024*1024)throw new Error('NSF size limit: 4 MB.');
                const bytes=await selected.arrayBuffer();if(closed||request!==fileRequest)return;
                header=readNsf(bytes);buffer=bytes;
                $('[data-nsf-info]').textContent=`${header.title||selected.name} · ${header.artist||'Unknown artist'} · ${header.songs} songs · NTSC`;
                song.replaceChildren(...Array.from({length:header.songs},(_,i)=>new Option(`Song ${i+1}`,i+1)));song.value=header.startSong;song.disabled=false;analyze.disabled=false;status.textContent='Choose a song and duration, then extract a preview.';
            }catch(error){status.textContent=error.message;}
        });
        for(const field of [song,duration,offset,dpcm])field.addEventListener('input',invalidate);
        function finish(){worker?.terminate();worker=null;file.disabled=duration.disabled=offset.disabled=dpcm.disabled=false;song.disabled=!header;analyze.disabled=!buffer;progress.hidden=true;}
        $('form').addEventListener('submit',event=>{
            event.preventDefault();if(!buffer||worker||!duration.validity.valid)return;
            invalidate();file.disabled=song.disabled=duration.disabled=offset.disabled=dpcm.disabled=analyze.disabled=true;progress.hidden=false;progress.value=0;status.textContent='Emulating NSF CPU / APU…';
            try{
                worker=new Worker(new URL('../editor/nsfWorker.js',import.meta.url),{type:'module'});
                worker.onmessage=event=>{
                    if(event.data.type==='progress'){progress.value=event.data.percent;status.textContent=`Extracting notes · ${event.data.percent}%`;return;}
                    if(event.data.type==='error'){status.textContent=event.data.message;finish();return;}
                    result=event.data.result;finish();
                    let notes=0;
                    for(const track of result.tracks){notes+=track.notes.length;const item=document.createElement('li');item.textContent=`${['Pulse 1','Pulse 2','Triangle','Noise'][track.voice]}${track.voice<2?' · '+track.duty*100+'% duty':''}: ${track.notes.length} notes`;list.append(item);}
                    const warnings=[];
                    if(result.dpcmAudio){const item=document.createElement('li');item.textContent=`DPCM / DAC: separate audio layer · ${result.dpcmAudio.seconds} s (not piano-roll notes)`;list.append(item);}
                    else if(result.dpcm)warnings.push(dpcm.checked?'DPCM detected, but no audible DAC changes in this range.':'DPCM detected — excluded by your selection.');
                    if(result.shortNoise)warnings.push('Short-mode noise is approximated.');
                    if(result.outOfRange)warnings.push('Some pitches outside MIDI 0–127 were skipped.');
                    status.textContent=`${notes} notes in ${result.tracks.length} lanes${result.dpcmAudio?' + DPCM audio':''} · ${result.seconds} s. ${warnings.join(' ')}`;
                    apply.disabled=!notes&&!result.dpcmAudio;
                };
                worker.onerror=event=>{event.preventDefault();status.textContent=event.message||'NSF worker failed. No project changes were made.';finish();};
                worker.postMessage({buffer,options:{song:Number(song.value),seconds:Number(duration.value),includeDpcm:dpcm.checked}});
            }catch(error){status.textContent=error.message;finish();}
        });
        apply.onclick=()=>{if(!result)return;answer={trace:result,offsetTick:offset.value==='cursor'?offsetTick:0};dialog.close();};
        $('[data-cancel]').onclick=()=>dialog.close();
        dialog.addEventListener('close',()=>{closed=true;fileRequest++;worker?.terminate();dialog.remove();resolve(answer);},{once:true});
        document.body.append(dialog);dialog.showModal();
    });
}
