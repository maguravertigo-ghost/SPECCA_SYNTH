import { AUTOMATION, curvePoints, curveValue } from '../editor/automation.js';

export function mountAutomationEditor({ host, button, getPattern, onCommit }) {
    const panel=document.createElement('section'); panel.className='automation-editor'; panel.hidden=true;
    panel.innerHTML=`<div class="automation-tools"><strong>Pattern automation</strong><select aria-label="Automation parameter"><option value="pan">Pan</option><option value="fade">Fade</option></select>
    <select aria-label="Curve preset"><option value="">Preset…</option><option value="up">Rise / Left → Right</option><option value="down">Fall / Right → Left</option><option value="center">Neutral</option></select>
    <label><input type="checkbox" data-smooth> Smooth</label><label><input type="checkbox" data-bypass> Bypass</label><button type="button" data-remove>Remove curve</button></div>
    <svg viewBox="0 0 1000 300" preserveAspectRatio="none" tabindex="0" aria-label="Automation curve editor"></svg>
    <small>Whole pattern: left → right. Click to add · drag points · right-click a point to delete. Fade: bottom 0%, top 100%. Pan: bottom L, middle C, top R.</small>`;
    host.append(panel);
    const svg=panel.querySelector('svg'), selects=panel.querySelectorAll('select'), smooth=panel.querySelector('[data-smooth]'), bypass=panel.querySelector('[data-bypass]');
    let active=false, drag=null, changed=false;
    const id=()=>selects[0].value;
    const curve=()=>getPattern()?.automation?.[id()];
    const ensure=()=>{const p=getPattern();if(!p)return null;p.automation??={};return p.automation[id()]??={points:[{x:0,y:AUTOMATION[id()].neutral},{x:1,y:AUTOMATION[id()].neutral}]};};
    function render(){
        const p=getPattern(); button.hidden=!p;button.disabled=!p;
        const labels=Object.entries(AUTOMATION).filter(([key])=>p?.automation?.[key]).map(([key,s])=>`${s.name}${p.automation[key].bypass?' (off)':''}`);
        button.textContent=`Automation${labels.length?' · '+labels.join(' / '):''}`;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
        panel.hidden=!active||!p;
        const c=curve(), spec=AUTOMATION[id()];smooth.checked=!!c?.smooth;bypass.checked=!!c?.bypass;
        svg.style.color=spec.color;
        const path=Array.from({length:201},(_,i)=>`${i?'L':'M'}${i*5},${300*(1-curveValue(c,i/200,spec.neutral))}`).join(' ');
        svg.innerHTML=`<path d="M0 150H1000 M250 0V300 M500 0V300 M750 0V300" stroke="#ffffff30" fill="none"/><path d="${path}" stroke="currentColor" stroke-width="3" fill="none"/>`;
        for(const [i,p] of curvePoints(c).entries()) {const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('cx',p.x*1000);dot.setAttribute('cy',(1-p.y)*300);dot.setAttribute('r',7);dot.setAttribute('fill',spec.color);dot.dataset.index=i;svg.append(dot);}
    }
    const commit=()=>{onCommit();render();};
    button.addEventListener('click',()=>{active=!active;render();});
    selects[0].addEventListener('change',render);
    selects[1].addEventListener('change',()=>{if(!selects[1].value)return;const c=ensure();if(!c)return;const v=selects[1].value;c.points=[{x:0,y:v==='center'?AUTOMATION[id()].neutral:v==='up'?0:1},{x:1,y:v==='center'?AUTOMATION[id()].neutral:v==='up'?1:0}];selects[1].value='';commit();});
    smooth.addEventListener('change',()=>{const c=ensure();if(c){c.smooth=smooth.checked;commit();}});
    bypass.addEventListener('change',()=>{const c=ensure();if(c){c.bypass=bypass.checked;commit();}});
    panel.querySelector('[data-remove]').addEventListener('click',()=>{const p=getPattern();if(p?.automation){delete p.automation[id()];commit();}});
    function position(e){const r=svg.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,1-(e.clientY-r.top)/r.height))};}
    svg.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();const c=ensure();if(!c)return;c.points=curvePoints(c);const index=e.target.dataset.index;drag=index===undefined?position(e):c.points[Number(index)];if(index===undefined)c.points.push(drag);changed=true;svg.setPointerCapture(e.pointerId);render();});
    svg.addEventListener('pointermove',e=>{if(drag){Object.assign(drag,position(e));render();}});
    function end(){if(!drag)return;drag=null;if(changed){changed=false;const c=curve();if(c)c.points=curvePoints(c);commit();}}
    svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',end);
    svg.addEventListener('contextmenu',e=>{e.preventDefault();const index=e.target.dataset.index;if(index!==undefined&&curve()){curve().points=curvePoints(curve()).filter((_,i)=>i!==Number(index));commit();}});
    return {refresh:render};
}
