import { AUTOMATION, curvePoints, curveValue } from '../editor/automation.js';
import {automationGridStep,automationGridLines,automationXToTick,tickToAutomationX,snapAutomationTick} from '../editor/automationGrid.js';

export function mountAutomationEditor({ host, button, getPattern, getViewport, onWheel, onCommit }) {
    const panel=document.createElement('section'); panel.className='automation-editor'; panel.hidden=true;
    panel.innerHTML=`<div class="automation-tools"><strong>Pattern automation</strong><select aria-label="Automation parameter"><option value="pan">Pan</option><option value="fade">Fade</option></select>
    <select aria-label="Curve preset"><option value="">Preset…</option><option value="up">Rise / Left → Right</option><option value="down">Fall / Right → Left</option><option value="center">Neutral</option></select>
    <label><input type="checkbox" data-smooth> Smooth</label><label><input type="checkbox" data-bypass> Bypass</label><button type="button" data-remove>Remove curve</button>
    <div class="automation-grid-tools"><label>X grid <select data-grid-x aria-label="Automation X grid"><option value="piano">Piano Roll</option><option value="1/4">1/4</option><option value="1/8">1/8</option><option value="1/16">1/16</option><option value="1/32">1/32</option><option value="1/64">1/64</option><option value="1/8T">1/8 triplet</option><option value="1/16T">1/16 triplet</option><option value="bar">Bar</option></select></label>
    <label>Y grid (px) <input data-grid-y aria-label="Automation Y grid pixels" type="number" min="4" max="160" step="1" value="20"></label>
    <button type="button" role="switch" aria-checked="true" data-snap>Snap X: ON</button>
    <label>Snap to <select data-snap-mode aria-label="Automation snap target"><option value="grid">Grid</option><option value="both">Grid + note edges</option><option value="notes">Note edges</option></select></label><label><input type="checkbox" data-note-guides checked> Note guides</label></div></div>
    <div class="automation-plot"><svg preserveAspectRatio="none" tabindex="0" aria-label="Automation curve editor"></svg><output data-point-status></output></div>
    <small>Same time axis / zoom / scroll as Piano Roll. Click to add · drag points · right-click a point to delete · Alt: temporarily free X · Esc: cancel drag. Y is always free. Fade: bottom 0%, top 100%. Pan: bottom L, middle C, top R.</small>`;
    host.append(panel);
    const $=s=>panel.querySelector(s),svg=$('svg'),plot=$('.automation-plot'),tools=$('.automation-tools'),footer=$('small');
    const selects=tools.querySelectorAll(':scope > select'),smooth=$('[data-smooth]'),bypass=$('[data-bypass]'),gridX=$('[data-grid-x]'),gridY=$('[data-grid-y]'),snap=$('[data-snap]'),target=$('[data-snap-mode]'),guides=$('[data-note-guides]'),status=$('[data-point-status]');
    let active=false,drag=null,signature='',lastView=null;
    let snapping=true;
    try{const prefs=JSON.parse(localStorage.getItem('spessa-automation-grid-v1'));if(prefs){if([...gridX.options].some(o=>o.value===prefs.x))gridX.value=prefs.x;if(Number.isInteger(prefs.y)&&prefs.y>=4&&prefs.y<=160)gridY.value=prefs.y;snapping=prefs.snap!==false;if(['grid','both','notes'].includes(prefs.target))target.value=prefs.target;guides.checked=prefs.guides!==false;}}catch{}
    const remember=()=>{try{localStorage.setItem('spessa-automation-grid-v1',JSON.stringify({x:gridX.value,y:Number(gridY.value),snap:snapping,target:target.value,guides:guides.checked}));}catch{}};
    const id=()=>selects[0].value;
    const curve=()=>getPattern()?.automation?.[id()];
    const ensure=()=>{const p=getPattern();if(!p)return null;p.automation??={};return p.automation[id()]??={points:[{x:0,y:AUTOMATION[id()].neutral},{x:1,y:AUTOMATION[id()].neutral}]};};
    function viewport(){const p=getPattern();return {labelWidth:0,headerHeight:20,rowHeight:20,scrollY:0,stepTicks:120,stepWidth:40,scrollX:0,timeDivision:480,ticksPerBar:1920,...getViewport?.(),lengthTicks:p?.lengthTicks??1,noteCount:p?.notes?.length??0};}
    function cancel(){if(!drag)return;const d=drag;drag=null;if(d.previous===undefined){delete d.pattern.automation[d.id];if(!Object.keys(d.pattern.automation).length)delete d.pattern.automation;}else d.pattern.automation[d.id]=d.previous;status.value='Drag cancelled';render();}
    function render(){
        const p=getPattern();if(drag&&drag.pattern!==p)cancel();
        button.hidden=!p;button.disabled=!p;
        const labels=Object.entries(AUTOMATION).filter(([key])=>p?.automation?.[key]).map(([key,s])=>`${s.name}${p.automation[key].bypass?' (off)':''}`);
        button.textContent=`Automation${labels.length?' · '+labels.join(' / '):''}`;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
        panel.hidden=!active||!p;if(panel.hidden)return;
        const c=curve(),spec=AUTOMATION[id()],view=viewport();lastView=view;
        smooth.checked=!!c?.smooth;bypass.checked=!!c?.bypass;
        snap.textContent=`Snap X: ${snapping?'ON':'OFF'}`;snap.setAttribute('aria-checked',String(snapping));target.disabled=!snapping;
        const top=tools.offsetTop+tools.offsetHeight+8,bottom=footer.offsetHeight+8;
        plot.style.left=`${view.labelWidth}px`;plot.style.top=`${top}px`;plot.style.bottom=`${bottom}px`;
        const width=plot.clientWidth,height=plot.clientHeight;if(!width||!height)return;
        svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.style.color=spec.color;
        const step=automationGridStep(gridX.value,view),lines=automationGridLines(view,width,step);
        let html=`<g class="automation-grid-x">${lines.map(l=>`<path d="M${l.x} 0V${height}" data-tick="${l.tick}" class="${l.bar?'is-bar':''}"/>`).join('')}</g>`;
        const yStep=Math.max(4,Math.min(160,Number(gridY.value)||view.rowHeight)),phase=((view.headerHeight-view.scrollY-top)%yStep+yStep)%yStep;
        html+='<g class="automation-grid-y">';for(let y=phase;y<=height;y+=yStep)html+=`<path d="M0 ${y}H${width}"/>`;html+='</g>';
        html+=`<path d="M0 ${height/2}H${width}" class="automation-neutral"/>`;
        if(guides.checked){
            html+='<g class="automation-note-guides">';
            for(const n of p.notes??[]){const a=tickToAutomationX(n.tick,view),b=tickToAutomationX(n.tick+n.dur,view);if(b<0||a>width)continue;
                html+=`<path d="M${a} 0V${height}M${b} 0V${height}"/><path d="M${Math.max(0,a)} ${height-5}H${Math.min(width,b)}" class="note-span"/>`;}
            html+='</g>';
        }
        const first=Math.max(0,automationXToTick(0,view)),end=Math.min(p.lengthTicks,automationXToTick(width,view));
        const segments=Math.min(2000,Math.max(100,Math.ceil(width/3)));
        const sampleTicks=new Set(Array.from({length:segments+1},(_,i)=>first+(end-first)*i/segments));
        for(const point of curvePoints(c)){const tick=point.x*p.lengthTicks;if(tick>=first&&tick<=end)sampleTicks.add(tick);}
        const path=first<=end?[...sampleTicks].sort((a,b)=>a-b).map((tick,i)=>`${i?'L':'M'}${tickToAutomationX(tick,view)},${height*(1-curveValue(c,tick/p.lengthTicks,spec.neutral))}`).join(' '):'';
        html+=`<path d="${path}" class="automation-curve-path"/>`;
        for(const [i,point] of curvePoints(c).entries()){const x=tickToAutomationX(point.x*p.lengthTicks,view);if(x< -7||x>width+7)continue;html+=`<circle cx="${x}" cy="${(1-point.y)*height}" r="6" fill="${spec.color}" data-index="${i}"/>`;}
        svg.innerHTML=html;
        svg.dataset.scrollX=view.scrollX;svg.dataset.stepWidth=view.stepWidth;svg.dataset.stepTicks=view.stepTicks;svg.dataset.gridStep=step;
        signature=JSON.stringify([view,width,height,top,bottom]);
    }
    const commit=()=>{onCommit();render();};
    button.addEventListener('click',()=>{cancel();active=!active;render();});
    selects[0].addEventListener('change',()=>{cancel();render();});
    selects[1].addEventListener('change',()=>{if(!selects[1].value)return;const c=ensure();if(!c)return;const v=selects[1].value;c.points=[{x:0,y:v==='center'?AUTOMATION[id()].neutral:v==='up'?0:1},{x:1,y:v==='center'?AUTOMATION[id()].neutral:v==='up'?1:0}];selects[1].value='';commit();});
    smooth.addEventListener('change',()=>{const c=ensure();if(c){c.smooth=smooth.checked;commit();}});
    bypass.addEventListener('change',()=>{const c=ensure();if(c){c.bypass=bypass.checked;commit();}});
    $('[data-remove]').addEventListener('click',()=>{const p=getPattern();if(p?.automation){delete p.automation[id()];commit();}});
    for(const field of [gridX,gridY,target,guides])field.addEventListener('change',()=>{if(field===gridY&&!gridY.validity.valid){gridY.value=lastView?.rowHeight??20;}remember();render();});
    gridY.addEventListener('input',()=>{if(gridY.validity.valid&&gridY.value){remember();render();}});
    target.title='Note edges snap within 10 screen pixels. Grid mode snaps across the whole timeline.';
    snap.addEventListener('click',()=>{snapping=!snapping;remember();render();});
    function position(e){
        const r=svg.getBoundingClientRect(),v=viewport(),p=getPattern(),raw=automationXToTick(e.clientX-r.left,v);
        const tick=snapAutomationTick(raw,{enabled:snapping&&!e.altKey,step:automationGridStep(gridX.value,v),lengthTicks:p.lengthTicks,mode:target.value,notes:p.notes,toleranceTicks:10/v.stepWidth*v.stepTicks});
        const y=Math.max(0,Math.min(1,1-(e.clientY-r.top)/r.height));
        status.value=`Tick ${Number(tick.toFixed(3))} · ${id()==='fade'?`${(y*100).toFixed(1)}%`:y===.5?'C':`${y<.5?'L':'R'} ${(Math.abs(y-.5)*200).toFixed(1)}%`}`;
        return {x:tick/p.lengthTicks,y};
    }
    svg.addEventListener('pointerdown',e=>{
        if(e.button!==0||drag)return;e.preventDefault();const p=getPattern();if(!p)return;
        const previous=curve()===undefined?undefined:structuredClone(curve()),c=ensure();c.points=curvePoints(c);
        const index=e.target.dataset.index,point=index===undefined?position(e):c.points[Number(index)];if(!point)return;
        if(index===undefined)c.points.push(point);
        drag={pattern:p,id:id(),point,previous,pointerId:e.pointerId};svg.setPointerCapture(e.pointerId);svg.focus();
    });
    svg.addEventListener('pointermove',e=>{if(drag&&drag.pointerId===e.pointerId){Object.assign(drag.point,position(e));render();}});
    svg.addEventListener('pointerup',e=>{
        if(!drag||drag.pointerId!==e.pointerId)return;const d=drag;drag=null;
        const c=d.pattern.automation[d.id];c.points=curvePoints({...c,points:c.points.filter(p=>p===d.point||Math.abs(p.x-d.point.x)>1e-10)});
        if(JSON.stringify(c)!==JSON.stringify(d.previous))commit();else render();
    });
    svg.addEventListener('pointercancel',cancel);svg.addEventListener('lostpointercapture',()=>{if(drag)cancel();});
    svg.addEventListener('keydown',e=>{if(e.key==='Escape'&&drag){e.preventDefault();e.stopPropagation();cancel();}});
    svg.addEventListener('contextmenu',e=>{e.preventDefault();const index=e.target.dataset.index;if(index!==undefined&&curve()){curve().points=curvePoints(curve()).filter((_,i)=>i!==Number(index));commit();}});
    if(onWheel)svg.addEventListener('wheel',onWheel,{passive:false});
    const observer=new ResizeObserver(()=>{if(active)render();});observer.observe(host);observer.observe(tools);
    return {refresh:render,syncViewport(){if(!active||panel.hidden)return;const view=viewport(),top=tools.offsetTop+tools.offsetHeight+8,bottom=footer.offsetHeight+8;if(signature!==JSON.stringify([view,plot.clientWidth,plot.clientHeight,top,bottom]))render();},destroy(){cancel();observer.disconnect();panel.remove();}};
}
