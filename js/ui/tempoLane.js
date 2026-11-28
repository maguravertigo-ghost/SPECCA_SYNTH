import {tempoPoints,setTempoPoint,deleteTempoPoint} from '../editor/tempoMap.js';

// A conductor lane, deliberately separate from instrument channels and their clips.
export function renderTempoLane(host,{sequence,width,tickToX,xToTick,ticksPerBar,getCursorTick,getSnapBars,onCommit}) {
    host.title='Global tempo map · click a point to edit · double-click empty space to add · Snap bars controls insertion';
    const points=tempoPoints(sequence),height=80,left=160;
    const lo=Math.min(60,...points.map(p=>p.tempo)),hi=Math.max(180,...points.map(p=>p.tempo));
    const y=bpm=>height-14-(bpm-lo)/(hi-lo)*(height-28);
    const x=tick=>tickToX(tick)-left;
    let path=`M0 ${y(sequence.tempo)}`;
    for(const p of points.slice(1))path+=`H${x(p.tick)}V${y(p.tempo)}`;
    path+=`H${width-left}`;
    host.innerHTML=`<div class="arr-tempo-heading"><button type="button" data-tempo-initial title="Edit initial tempo">Tempo · BPM</button><output data-tempo-current></output><button type="button" class="btn" data-tempo-add title="Add a tempo change at playhead">+ At playhead</button></div><div class="arr-tempo-grid"><svg width="${width-left}" height="${height}" aria-label="Tempo map. Click a point to edit; double-click empty space to add."><path class="arr-tempo-path" d="${path}"/>${points.map(p=>`<g data-tempo-tick="${p.tick}" role="button" tabindex="0" aria-label="${p.tempo} BPM at tick ${p.tick}"><title>${p.tempo} BPM · B${1+Math.floor(p.tick/ticksPerBar)} · tick ${p.tick} · click to edit</title><rect x="${x(p.tick)-7}" y="${Math.max(0,y(p.tempo)-22)}" width="80" height="32" fill="transparent"/><circle cx="${x(p.tick)}" cy="${y(p.tempo)}" r="5"/><text x="${x(p.tick)+9}" y="${Math.max(12,y(p.tempo)-8)}">${Number(p.tempo.toFixed(2))}</text></g>`).join('')}</svg></div>`;
    async function editPoint(point,tick=point?.tick??getCursorTick()) {
        const previousFocus=document.activeElement;
        const dialog=document.createElement('dialog');dialog.className='app-dialog arr-dialog-box tempo-point-dialog';dialog.setAttribute('aria-label',point?'Edit tempo point':'Add tempo point');
        dialog.innerHTML=`<form method="dialog"><h2 class="arr-dialog-title">${point?'Edit':'Add'} tempo point</h2><div class="arr-dialog-body"><label class="arr-field">Tick<input data-tick type="number" min="0" step="1" required></label><output data-position></output><label class="arr-field">BPM<input data-bpm type="number" min="4" max="1000" step="any" required></label><p class="muted">Tempo holds until the next point (MIDI Set Tempo). Tick 0 is the initial tempo. Applying at an occupied tick replaces that point. WAV audio stays at its original speed.</p></div><footer class="arr-dialog-footer">${point?.tick>0?'<button type="button" class="btn" data-delete>Delete point</button>':''}<button type="button" class="btn" data-cancel>Cancel</button><button type="submit" value="apply" class="btn btn-primary">Apply</button></footer></form>`;
        const position=dialog.querySelector('[data-tick]'),bpm=dialog.querySelector('[data-bpm]');
        position.value=Math.round(tick);position.disabled=point?.tick===0;bpm.value=point?.tempo??sequence.tempoAt(tick);
        const refresh=()=>{const t=Number(position.value);dialog.querySelector('[data-position]').value=`B${1+Math.floor(t/ticksPerBar)} · beat ${Number((1+(t%ticksPerBar)/sequence.timeDivision).toFixed(3))} · ${sequence.ticksToSeconds(t).toFixed(3)} s (before edit)`;};position.oninput=refresh;refresh();
        dialog.querySelector('[data-cancel]').onclick=()=>dialog.close('cancel');
        dialog.querySelector('[data-delete]')?.addEventListener('click',()=>dialog.close('delete'));
        dialog.addEventListener('close',()=>{
            const result=dialog.returnValue;
            const nextTick=Number(position.value),nextBpm=Number(bpm.value);
            dialog.remove();previousFocus?.focus();
            if(result==='apply' && (!point||point.tick!==nextTick||point.tempo!==nextBpm))onCommit(()=>setTempoPoint(sequence,point?.tick??null,nextTick,nextBpm));
            if(result==='delete')onCommit(()=>deleteTempoPoint(sequence,point.tick));
        },{once:true});document.body.append(dialog);dialog.showModal();bpm.focus();bpm.select();
    }
    host.querySelector('[data-tempo-initial]').onclick=()=>editPoint(points[0]);
    host.querySelector('[data-tempo-add]').onclick=()=>{const tick=Math.round(getCursorTick());editPoint(points.find(p=>p.tick===tick),tick);};
    for(const group of host.querySelectorAll('[data-tempo-tick]')) {
        const point=points.find(p=>p.tick===Number(group.dataset.tempoTick));
        group.addEventListener('click',e=>{e.stopPropagation();editPoint(point);});
        group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();editPoint(point);}});
    }
    const svg=host.querySelector('svg');
    svg.addEventListener('dblclick',e=>{
        if(e.target.closest('[data-tempo-tick]'))return;
        const raw=xToTick(e.clientX-svg.getBoundingClientRect().left+left);
        const step=getSnapBars()?ticksPerBar:1;
        const tick=Math.max(0,Math.round(raw/step)*step);
        editPoint(points.find(p=>p.tick===tick),tick);
    });
}
