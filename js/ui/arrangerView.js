import {audioEnd, timelineId, formatTimestamp, layoutMarkers, wavePath} from '../editor/timeline.js';
import {importWav,prepareAudio,createAudioFollower,getAudioAssetFile} from '../core/audioTracks.js';
import {getAudioContext,getAudioOutput} from '../core/synth.js';
import {editTimestamp} from './timestampDialog.js';
import { chooseChannelSplit } from './splitChannelDialog.js';
import { prepareChipBank } from '../core/synth.js';
import { automationPreview, automationSummary } from '../editor/automation.js';
// js/ui/arrangerView.js
import { log, setStatus } from '../core/log.js';
import { getSequencer, applyChannelVolume, applyChannelMix, initSynth, bindMasterVolume, loadSong } from '../core/synth.js';
import { writeArrangementMIDI } from '../editor/exportMidi.js';
import { getInstrumentCatalog, mountInstrumentFields } from './instrumentFields.js';
import { confirmAction } from './dialogs.js';
import { instrumentLabel } from '../editor/instruments.js';

const CHAN_W     = 160;
const RULER_H    = 24;
const LOOP_H     = 16;
const MIN_BAR_W  = 80;

const COLORS = [
    '#4ec9b0','#dcdcaa','#c586c0','#ce9178','#569cd6','#888888',
    '#e35b5b','#6bb0ff','#4ec9ff','#ffcc00','#ff6bcb','#6bffb2',
    '#ff8c42','#f7a8b8','#9b7ede','#725fff','#4539ad','#2d8a85',
    '#00b894','#83c94e','#bbc940','#dc9862','#b97052','#e1e7ee',
];

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

export function mountArranger(rootEl, { getSequence, getChannelPattern, onSelectPattern, onOpenChannel, onEdit, onMixer } = {}) {
    if (!rootEl) return null;

    rootEl.innerHTML = `
        <div class="arr-shell">
            <div class="arr-toolbar" aria-label="Arrangement playback">
                <button id="arrMixer" class="arr-control" type="button" title="Project mixer" aria-label="Project mixer"><span class="material-icon" aria-hidden="true">tune</span></button>
                <div class="arr-transport-group" role="group" aria-label="Transport">
                    <button id="arrHome" class="arr-control" type="button" title="To start" aria-label="To start"><span class="material-icon" aria-hidden="true">skip_previous</span></button>
                    <button id="arrPlay" class="arr-control arr-primary" type="button" title="Play" aria-label="Play"><span class="material-icon" aria-hidden="true">play_arrow</span></button>
                    <button id="arrPause" class="arr-control" type="button" title="Pause" aria-label="Pause"><span class="material-icon" aria-hidden="true">pause</span></button>
                    <button id="arrStop" class="arr-control" type="button" title="Stop" aria-label="Stop"><span class="material-icon" aria-hidden="true">stop</span></button>
                    <button id="arrEnd" class="arr-control" type="button" title="To end" aria-label="To end"><span class="material-icon" aria-hidden="true">skip_next</span></button>
                </div>
                <output id="arrTime" class="arr-time">0:00.0 / 0:00.0</output>
                <div class="arr-toolbar-options">
                    <button id="arrAutomationView" type="button" class="arr-control" aria-pressed="false" title="Show pattern automation curves">Automation view</button>
                    <div class="arr-transport-group" role="group" aria-label="Loop range">
                        <button id="arrLoopAll" class="arr-control" type="button" aria-label="Loop entire track" title="Loop entire track">
                            <svg class="arr-fit-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 5v14m18-14v14M6 12h12m-9-3-3 3 3 3m6-6 3 3-3 3"/>
                            </svg>
                        </button>
                        <button aria-label="Loop" title="Loop" id="arrLoopBtn" class="arr-control arr-loop active" type="button" aria-pressed="true"><span class="material-icon" aria-hidden="true">repeat</span></button>
                    </div>
                    <label class="arr-volume" title="Master volume">
                        <span>Volume</span>
                        <input id="arrMasterVol" type="range" min="0" max="100" value="100">
                    </label>
                </div>
            </div>
            <div class="arr-body">
                <div class="arr-content" id="arrContent">
                    <div class="arr-loop-markers" id="arrLoopMarkers" style="height:${LOOP_H}px">
                        <div class="arr-loop-range" id="arrLoopRange"></div>
                        <div class="arr-loop-mark start" id="arrLoopStart" data-edge="start" title="Loop start"><span class="material-icon" aria-hidden="true">arrow_right</span></div>
                        <div class="arr-loop-mark end" id="arrLoopEnd" data-edge="end" title="Loop end"><span class="material-icon" aria-hidden="true">arrow_left</span></div>
                    </div>
                    <div class="arr-ruler" id="arrRuler" style="height:${RULER_H}px"></div>
                    <div class="arr-rows" id="arrRows"></div>
                    <div class="arr-playhead" id="arrPlayhead"></div>
                </div>
            </div>
            <div class="arr-marker-tools"><button class="btn" type="button" id="arrImportWav" title="WAV at playhead · original speed · stored in this browser">Import WAV…</button><input type="file" accept=".wav,audio/wav" id="arrWavFile" hidden><span>Time markers</span><button class="btn" type="button" id="arrAddMarker">+ At playhead</button><button class="btn" type="button" id="arrPrevMarker" aria-label="Previous marker">◀</button><button class="btn" type="button" id="arrNextMarker" aria-label="Next marker">▶</button><button class="btn" type="button" id="arrEditMarker">Edit…</button><button class="btn" type="button" id="arrDeleteMarker">Delete</button></div><div class="arr-marker-strip" id="arrMarkerStrip" aria-label="Time markers"><div id="arrMarkerLabels"></div></div>
            <div class="arr-edit-hint">Channel name: edit notes <span>•</span> Grid: draw <span>•</span> Drag: move <span>•</span> Right click: erase</div>
        </div>
    `;

    const $ = (s) => rootEl.querySelector(s);
    const body        = $('.arr-body');
    const content     = $('#arrContent');
    const ruler       = $('#arrRuler');
    const rows        = $('#arrRows');
    const playhead    = $('#arrPlayhead');
    const loopRange   = $('#arrLoopRange');
    const loopStartEl = $('#arrLoopStart');
    const loopEndEl   = $('#arrLoopEnd');
    const timeEl      = $('#arrTime');
    const playBtn     = $('#arrPlay');
    const pauseBtn    = $('#arrPause');
    const loopBtn     = $('#arrLoopBtn');
    const loopAllBtn  = $('#arrLoopAll');

    $('#arrAutomationView').addEventListener('click', () => {
        const button = $('#arrAutomationView');
        const active = button.getAttribute('aria-pressed') !== 'true';
        button.setAttribute('aria-pressed', String(active));
        button.classList.toggle('active', active);
        rootEl.classList.toggle('show-automation', active);
    });

    const state = {
        loopEnabled: true,
        loopStartTick: 0,
        loopEndTick: null, // null = end of arrangement; equal explicit markers = no loop
        dragMode: null,
        dragClip: null,
        paint: null,
        visible: true,
        cursorTick: 0,
    };

    let audioFollower=null,selectedMarker=null,audioDrag=null,relinkChannel=null;
    let rafId = 0;
    let dirty = true;
    let muteTimer = null;
    let playbackRequest = 0;
    let loadedSequence = null;
    let loading = false;
    let reloadTimer;
    let reloadPending = false;
    let playbackDirty = false;
    let pausedByUser = false;
    let lastFramePlaying = false;
    let seekingUntil = 0;

    const markDirty = () => { dirty = true; };
    const getSeq     = () => (typeof getSequence === 'function' ? getSequence() : null);
    const timeDiv    = () => getSeq()?.timeDivision || 480;
    const tpb        = () => getSeq()?.ticksPerBar ?? timeDiv() * 4;
    const totalBars = () => Math.max(8, Math.ceil(arrangementDurationTick() / tpb()), Math.ceil(state.loopEndTick / tpb())) + 1;
    let layoutBarWidth = MIN_BAR_W;
    let viewportWidth = 0;
    const followAnchor = () => CHAN_W + Math.max(0, viewportWidth - CHAN_W) / 2;
    const barW = () => state.paint?.barWidth ?? layoutBarWidth;
    const tickToX    = (tick) => CHAN_W + (tick / tpb()) * barW();
    const xToTick    = (x)    => Math.max(0, ((x - CHAN_W) / barW()) * tpb());
    const xToBar     = (x)    => Math.max(0, Math.floor((x - CHAN_W) / barW()));

    const chanColor = (idx) => {
        const s = getSeq();
        const ch = s?.channels?.find(c => c.channel === idx);
        return ch?.color || COLORS[idx % COLORS.length];
    };

    let durationTick = 0, audibleEnd = 0;
    const measureArrangement = () => {
        const song = getSeq();
        if (!song) return { end: 0, playable: 0 };
        const patterns = new Map(song.patterns.map(p => [p.id, p]));
        const comments = new Set(song.channels.filter(c => c.kind === 'comment').map(c => c.channel));
        let playable = song.secondsToTicks(audioEnd(song)), end = Math.max(playable,...song.timeMarkers.map(m=>song.secondsToTicks(m.seconds)));
        for (const clip of song.arrangement) {
            const pattern = patterns.get(clip.patternId);
            if (!pattern) continue;
            const stop = clip.startTick + pattern.lengthTicks;
            end = Math.max(end, stop);
            if (!comments.has(pattern.channel) && pattern.notes.length) playable = Math.max(playable, stop);
        }
        return { end, playable };
    };
    const arrangementDurationTick = () => dirty ? measureArrangement().end : durationTick;
    const playableDurationTick = () => dirty ? measureArrangement().playable : audibleEnd;
    const effectiveLoopEnd = () => state.loopEndTick ?? playableDurationTick();
    const hasLoop = () => state.loopEnabled && effectiveLoopEnd() > state.loopStartTick;
    const updateLoopButton = () => {
        loopAllBtn.disabled = !playableDurationTick();
        loopBtn.classList.toggle('active', hasLoop());
        loopBtn.setAttribute('aria-pressed', String(hasLoop()));
    };
    const updatePlayback = () => {
        playbackDirty = true;
        clearTimeout(reloadTimer);
        const seq = getSequencer();
        if (loadedSequence === getSeq() && seq && !seq.paused && !seq.isFinished) {
            reloadTimer = setTimeout(() => play(true), 100);
        } else if (loading) reloadPending = true;
    };
    const edit = (audible = true) => { onEdit?.(); if (audible) updatePlayback(); markDirty(); };
    const isCommentChannel = channel => getSeq()?.channels.find(c => c.channel === channel)?.kind === 'comment';

    async function editMarker(marker=null){
        const song=getSeq();if(!song)return;
        const result=await editTimestamp({title:marker?'Edit time marker':'Create time marker',name:marker?.name??`Marker ${song.timeMarkers.length+1}`,seconds:marker?.seconds??song.ticksToSeconds(state.cursorTick)});
        if(!result||song!==getSeq()||(marker&&!song.timeMarkers.includes(marker)))return;
        if(marker)Object.assign(marker,result);else {marker={id:timelineId('mark'),...result};song.timeMarkers.push(marker);}
        selectedMarker=marker.id;edit(false);
    }
    async function deleteMarker(marker){
        const song=getSeq();if(!marker||!await confirmAction('Delete time marker',`Delete “${marker.name}”?`)||song!==getSeq())return;
        song.timeMarkers=song.timeMarkers.filter(m=>m!==marker);selectedMarker=null;edit(false);
    }
    function actionMenu(title,actions){
        const dialog=document.createElement('dialog');dialog.className='app-dialog arr-dialog-box arr-context-menu';dialog.setAttribute('aria-label',title);
        const heading=document.createElement('h2');heading.className='arr-dialog-title';heading.textContent=title;dialog.append(heading);
        for(const [label,action] of [...actions,['Close',()=>{}]]){const button=document.createElement('button');button.type='button';button.className='arr-menu-item';button.textContent=label;button.onclick=()=>{dialog.close();action();};dialog.append(button);}
        dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
    }
    function renderMarkers(){
        const song=getSeq(),strip=$('#arrMarkerStrip'),labels=$('#arrMarkerLabels');
        content.querySelector('.arr-time-marker-lines')?.remove();
        if(!song)return;
        const measure=document.createElement('canvas').getContext('2d');measure.font='12px sans-serif';
        const placed=layoutMarkers(song.timeMarkers,t=>tickToX(song.secondsToTicks(t)),m=>Math.ceil(measure.measureText('⚑ '+m.name+' · '+formatTimestamp(m.seconds)).width)+32);
        const height=Math.max(36,Math.min(190,(1+Math.max(0,...placed.map(p=>p.lane)))*28+8));
        strip.style.height=height+'px';labels.style.height=Math.max(height,(1+Math.max(0,...placed.map(p=>p.lane)))*28+8)+'px';
        labels.style.width=content.style.width;labels.style.transform=`translateX(${-body.scrollLeft}px)`;
        labels.innerHTML=placed.map(({marker:m,x,width,lane})=>`<button type="button" class="arr-time-marker${selectedMarker===m.id?' selected':''}" data-marker="${escapeHtml(m.id)}" style="left:${x}px;bottom:${lane*28+4}px;width:${width}px" title="${escapeHtml(m.name)} · ${formatTimestamp(m.seconds)}">⚑ ${escapeHtml(m.name)} · ${formatTimestamp(m.seconds)}</button>`).join('');
        const lines=document.createElement('div');lines.className='arr-time-marker-lines';
        lines.style.clipPath=`inset(0 0 0 ${CHAN_W+body.scrollLeft}px)`;
        lines.innerHTML=placed.map(({x})=>`<i style="left:${x}px"></i>`).join('');content.append(lines);
        for(const button of labels.querySelectorAll('[data-marker]')){
            const marker=song.timeMarkers.find(m=>m.id===button.dataset.marker);
            button.onclick=()=>{selectedMarker=marker.id;seekTick(song.secondsToTicks(marker.seconds),true);renderMarkers();};
            button.ondblclick=()=>editMarker(marker);
            button.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();selectedMarker=marker.id;renderMarkers();actionMenu(marker.name,[['Go to marker',()=>seekTick(song.secondsToTicks(marker.seconds),true)],['Edit name / time…',()=>editMarker(marker)],['Create at playhead…',()=>editMarker()],['Delete marker',()=>deleteMarker(marker)]]);};
        }
        $('#arrEditMarker').disabled=$('#arrDeleteMarker').disabled=!song.timeMarkers.some(m=>m.id===selectedMarker);
    }
    body.addEventListener('scroll',renderMarkers,{passive:true});
    $('#arrMarkerStrip').oncontextmenu=e=>{e.preventDefault();actionMenu('Time markers',[['Create at playhead…',()=>editMarker()]]);};
    $('#arrAddMarker').onclick=()=>editMarker();
    $('#arrEditMarker').onclick=()=>editMarker(getSeq().timeMarkers.find(m=>m.id===selectedMarker));
    $('#arrDeleteMarker').onclick=()=>deleteMarker(getSeq().timeMarkers.find(m=>m.id===selectedMarker));
    for(const [id,direction] of [['arrPrevMarker',-1],['arrNextMarker',1]])$('#'+id).onclick=()=>{
        const song=getSeq(),position=song.ticksToSeconds(state.cursorTick),markers=[...song.timeMarkers].sort((a,b)=>a.seconds-b.seconds);
        const marker=direction>0?markers.find(m=>m.seconds>position+.0005):markers.filter(m=>m.seconds<position-.0005).at(-1);
        if(marker){selectedMarker=marker.id;seekTick(song.secondsToTicks(marker.seconds),true);renderMarkers();}
    };
    async function editAudioChannel(channel){
        const song=getSeq(),info=song.channels.find(c=>c.channel===channel),clip=song.audioClips.find(c=>c.channel===channel);if(!info||!clip)return;
        const result=await editTimestamp({title:'Audio channel · start time',name:info.name,seconds:clip.startSeconds});
        if(!result||song!==getSeq()||!song.channels.includes(info))return;
        haltPlayback();info.name=result.name;clip.startSeconds=result.seconds;edit();
    }
    function openAudioMenu(info){
        const song=getSeq();
        actionMenu(info.name,[['Edit name / start time…',()=>editAudioChannel(info.channel)],['Download source WAV…',async()=>{
            try{const clip=song.audioClips.find(c=>c.channel===info.channel),asset=song.audioAssets.find(a=>a.id===clip?.assetId);if(!asset)return;
                const file=await getAudioAssetFile(asset),url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=asset.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_');link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
            }catch(error){setStatus(error.message);}
        }],['Replace / relink WAV…',()=>{relinkChannel=info;$('#arrWavFile').click();}],['Mixer…',()=>onMixer?.()],['Clone audio channel',()=>{haltPlayback();song.cloneChannel(info.channel);edit();}],['Move up',()=>{song.moveChannel(info.channel,-1);edit(false);}],['Move down',()=>{song.moveChannel(info.channel,1);edit(false);}],['Delete audio channel',async()=>{
            if(!await confirmAction('Delete audio channel',`Delete ${info.name} and its audio clip?`)||song!==getSeq())return;
            haltPlayback();song.channels=song.channels.filter(c=>c!==info);song.channelOrder=song.channelOrder.filter(id=>id!==info.channel);song.audioClips=song.audioClips.filter(c=>c.channel!==info.channel);edit();
        }]]);
    }
    $('#arrImportWav').onclick=()=>{relinkChannel=null;$('#arrWavFile').click();};
    $('#arrWavFile').onchange=async e=>{
        const file=e.target.files[0];e.target.value='';if(!file)return;
        const song=getSeq(),position=song.ticksToSeconds(state.cursorTick),replacement=relinkChannel;relinkChannel=null;haltPlayback();
        $('#arrImportWav').disabled=true;
        try{
            setStatus('Decoding WAV and drawing waveform…');
            await initSynth();const asset=await importWav(file,getAudioContext());if(song!==getSeq())return;
            if(replacement){
                if(!song.channels.includes(replacement))return;
                song.audioAssets.push(asset);
                for(const clip of song.audioClips.filter(c=>c.channel===replacement.channel)){clip.assetId=asset.id;clip.offsetSeconds=0;clip.duration=asset.duration;}
                edit();setStatus('Audio file replaced; start position preserved.');return;
            }
            const used=new Set(song.channels.map(c=>c.channel)),lane=Array.from({length:2048},(_,i)=>i).find(i=>!used.has(i));if(lane===undefined)throw new Error('No free channel for audio.');
            song.channelOrder=[...song.orderedChannels().map(c=>c.channel),lane];
            song.audioAssets.push(asset);song.channels.push({channel:lane,kind:'audio',source:'audio',name:file.name,volume:100,pan:64,muted:false,created:true});
            song.audioClips.push({id:timelineId('audio'),assetId:asset.id,channel:lane,startSeconds:position,offsetSeconds:0,duration:asset.duration});
            edit();setStatus('WAV imported at playhead · audio stored in this browser; Save preserves its reference.');
        }catch(error){setStatus(error.message);log(`WAV import: ${error}`,'error');}finally{$('#arrImportWav').disabled=false;}
    };

    // ==================================================================
    // Render
    // ==================================================================
    const renderRuler = () => {
        const bars = totalBars();
        const bw = barW();
        let html = `<div class="arr-chan-spacer" style="width:${CHAN_W}px"></div>`;
        for (let b = 0; b < bars; b++) {
            const accent = b % 4 === 0 ? ' accent' : '';
            html += `<div class="arr-bar${accent}" data-bar="${b}" style="width:${bw}px">B${b + 1}</div>`;
        }
        ruler.innerHTML = html;

        const loopEnd = effectiveLoopEnd();
        const sx = tickToX(state.loopStartTick);
        const ex = tickToX(loopEnd);
        loopStartEl.style.left = (sx - 6) + 'px';
        loopEndEl.style.left   = (ex - 6) + 'px';
        loopRange.style.left   = sx + 'px';
        loopRange.style.width  = (ex - sx) + 'px';
        const show = state.loopEnabled;
        loopRange.style.display   = hasLoop() ? 'block' : 'none';
        loopStartEl.style.zIndex = sx === ex ? '2' : '';
        updateLoopButton();
        loopStartEl.style.display = show ? 'block' : 'none';
        loopEndEl.style.display   = show ? 'block' : 'none';

        const width = CHAN_W + bars * bw;
        content.style.width = `${width}px`;
        // A little scrollable space past the end lets the final bars reach the center too.
        const farthestHead = tickToX(Math.max(playableDurationTick(), loopEnd));
        const tail = Math.max(0, farthestHead + (viewportWidth - followAnchor()) - width);
        content.style.setProperty('--arr-follow-tail', `${Math.ceil(tail)}px`);
        content.style.setProperty('--bar-w', bw + 'px');
    };

    const focusPattern = (channel, id) => {
        onSelectPattern?.(channel, id);
        const header = rows.querySelector(`.arr-chan[data-channel="${channel}"]`);
        if (header) header.title = channelTooltip(channel);
    };
    const channelTooltip = channel => getSeq()?.channels.find(c=>c.channel===channel)?.kind==='audio' ? 'WAV audio · click to edit start time, name and mix · right-click for options' : `Ch ${channel + 1} · Draw: ${getChannelPattern?.(channel)?.name ?? 'New pattern'} · Right-click for options`;

    const renderRows = () => {
        const s = getSeq();
        if (!s) { rows.innerHTML = ''; return; }
        const channels = s.orderedChannels();
        const catalog = getInstrumentCatalog();
        const patterns = new Map(s.patterns.map(p => [p.id, p]));
        const byChannel = new Map(channels.map(c => [c.channel, []]));
        for (const pl of s.arrangement) {
            const pat = patterns.get(pl.patternId);
            if (pat) byChannel.get(pat.channel)?.push([pl, pat]);
        }
        const thumbnails = new Map();
        const patternPreview = (pat) => {
            if (thumbnails.has(pat.id)) return thumbnails.get(pat.id);
            if (!pat.notes.length) return '';
            const visibleNotes = pat.notes.slice(0, 128);
            const pitches = visibleNotes.map(n => n.key);
            const high = Math.max(...pitches), low = Math.min(...pitches);
            const scale = 1000 / Math.max(1, pat.lengthTicks);
            const path = visibleNotes.map(n => {
                const x = Math.round(n.tick * scale);
                const y = 2 + Math.round((high - n.key) * 17 / Math.max(1, high - low));
                return `M${x} ${y}h${Math.max(9, Math.round(n.dur * scale))}`;
            }).join('');
            const svg = `<svg class="arr-clip-notes" viewBox="0 0 1000 22" preserveAspectRatio="none" aria-hidden="true"><path d="${path}"/></svg>`;
            thumbnails.set(pat.id, svg);
            return svg;
        };
        let html = '';

        for (const ch of channels) {
            const i = ch.channel;
            const color = chanColor(i);
            const muted = !!ch.muted;
            const comment = ch.kind === 'comment';
            html += `<div class="arr-row${comment ? ' arr-comment-row' : ''}" data-channel="${i}">`;
            html += `  <div class="arr-chan" data-channel="${i}" style="width:${CHAN_W}px" role="button" tabindex="0" title="${escapeHtml(channelTooltip(i))}">`;
            if (!comment) html += `    <span class="arr-dot" data-channel="${i}"
                            style="background:${muted ? 'transparent' : '#1a7f37'};
                                   border-color:${muted ? '#666' : '#1a7f37'};"></span>`;
            html += `    <div class="arr-chan-info">`;
            html += `      <div class="arr-chan-name">${escapeHtml(ch.name || ('Ch ' + (i + 1)))}</div>`;
            html += `      <div class="arr-chan-pat">${escapeHtml(comment ? 'Comment' : ch.kind==='audio' ? ch.nsfSource?.voice==='dpcm'?'DPCM audio · sampled layer':'WAV audio · original speed' : instrumentLabel(ch, catalog))}</div>`;
            html += `    </div>`;
            html += `    <span class="arr-chan-bar" style="background:${color}"></span>`;
            html += `  </div>`;
            html += `  <div class="arr-clips" data-channel="${i}" style="--bar-w:${barW()}px">`;
            for (const [pl, pat] of byChannel.get(i)) {
                const selected = state.selectedPlacement === pl.id ? ' selected' : '';
                const left = tickToX(pl.startTick) - CHAN_W;
                const right = tickToX(pl.startTick + pat.lengthTicks) - CHAN_W;
                const w = Math.max(8, right - left);
                const text = pat.comment?.trim() || '';
                const label = comment && text ? `${pat.name} · ${text.replace(/\s+/g, ' ')}` : pat.name;
                const handle = comment ? `<span class="arr-clip-resize" title="Drag to resize the comment pattern" aria-hidden="true"><i class="material-icon">swap_horiz</i></span>` : '';
                const summary = comment ? [] : automationSummary([pat]);
                const badges = summary.map(spec => `<span style="color:${spec.color}"${spec.active ? '' : ' class="is-bypassed"'}>${spec.name}${spec.active ? '' : ' off'}</span>`).join(' · ');
                const curves = summary.length ? `<svg class="arr-automation-curves" viewBox="0 0 1000 22" preserveAspectRatio="none" aria-hidden="true">${automationPreview(pat)}</svg>` : '';
                const automationHint = summary.length ? ' · Automation: ' + summary.map(s => s.name + (s.active ? '' : ' (bypassed)')).join(', ') : '';
                const hint = comment ? `${pat.name} · ${text || 'Notes'}` : `${pat.name} · ${pat.notes.length} notes${automationHint}`;
                html += `<div class="arr-clip${selected}${comment ? ' arr-comment-clip' : ''}" data-placement="${escapeHtml(pl.id)}"
                              data-channel="${i}"
                              style="left:${left}px;width:${w}px;background:${color}"
                              title="${escapeHtml(hint)}">${comment ? '' : patternPreview(pat)}${curves}${badges ? `<span class="arr-automation-badges">${badges}</span>` : ''}<span class="arr-clip-label">${escapeHtml(label)}</span>${handle}</div>`;
            }
            if(ch.kind==='audio')for(const clip of s.audioClips.filter(c=>c.channel===i)){
                const asset=s.audioAssets.find(a=>a.id===clip.assetId);if(!asset)continue;
                const first=tickToX(s.secondsToTicks(clip.startSeconds))-CHAN_W,last=tickToX(s.secondsToTicks(clip.startSeconds+clip.duration))-CHAN_W;
                const path=wavePath(asset.peaks??[],clip.startSeconds,clip.startSeconds+clip.duration,t=>tickToX(s.secondsToTicks(t))-CHAN_W-first);
                html+=`<div class="arr-audio-clip" data-audio-clip="${escapeHtml(clip.id)}" style="left:${first}px;width:${Math.max(2,last-first)}px" title="${escapeHtml(asset.name)} · ${formatTimestamp(clip.startSeconds)}"><svg width="100%" height="48" aria-label="WAV waveform"><path d="${path}"/></svg><span>${escapeHtml(asset.name)}</span></div>`;
            }
            html += `  </div>`;
            html += `</div>`;
        }

        html += `<div class="arr-row arr-add-row"><div class="arr-chan"><button type="button" class="btn" id="arrAddChannel" title="Add channel">+ ADD</button></div></div>`;
        rows.innerHTML = html;
        wireRowEvents();
    };

    const renderPlayhead = (follow = true) => {
        const song = getSeq();
        if (!song) return;
        const seq = loadedSequence === song ? getSequencer?.() : null;
        const playing = !!seq && !seq.paused && !seq.isFinished;
        const end = Math.max(playableDurationTick(), seq ? song.secondsToTicks(seq.duration) : 0);
        if (playing && !loading && state.dragMode !== 'seek' && performance.now() >= seekingUntil) {
            state.cursorTick = Math.max(0, Math.min(end, song.secondsToTicks(seq.currentTime)));
        } else if (lastFramePlaying && seq?.isFinished && !loading) {
            state.cursorTick = end;
        }
        audioFollower?.update(seq?.currentTime??0,playing&&!loading,hasLoop()?song.ticksToSeconds(effectiveLoopEnd()):Infinity);
        lastFramePlaying = playing;
        const x = tickToX(state.cursorTick);
        let scrollLeft = body.scrollLeft;
        if (follow && playing && !loading && !state.dragMode && !state.paint && viewportWidth > CHAN_W) {
            const anchor = followAnchor();
            if (x > scrollLeft + anchor || x < scrollLeft + CHAN_W) {
                body.scrollLeft = Math.max(0, x - anchor);
                scrollLeft = body.scrollLeft;
            }
        }
        playhead.style.transform = `translateX(${x - 1}px)`;
        playhead.style.display = x >= scrollLeft + CHAN_W ? 'block' : 'none';
        ruler.dataset.playheadTick = String(Math.round(state.cursorTick));
        const fmt = (seconds) => {
            const s = Math.max(0, seconds || 0);
            const m = Math.floor(s / 60);
            return `${m}:${Math.floor(s - m * 60).toString().padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;
        };
        const timeText = `${fmt(song.ticksToSeconds(state.cursorTick))} / ${fmt(song.ticksToSeconds(end))}`;
        if (timeEl.textContent !== timeText) timeEl.textContent = timeText;
    };

    const render = () => {
        if (!dirty || state.dragClip || audioDrag) return;
        ({ end: durationTick, playable: audibleEnd } = measureArrangement());
        dirty = false;
        viewportWidth = body.clientWidth;
        layoutBarWidth = Math.max(MIN_BAR_W, (viewportWidth - CHAN_W) / totalBars());
        renderRuler();
        renderRows();
        renderMarkers();
    };

    // ==================================================================
    // Event wiring
    // ==================================================================
    const wireRowEvents = () => {
        // The header opens the channel; a timeline double-click opens an exact clip.
        rows.querySelectorAll('.arr-row[data-channel] .arr-chan').forEach(header => {
            const row = header.closest('.arr-row');
            const activate = () => {const ch=Number(row.dataset.channel);if(getSeq().channels.find(c=>c.channel===ch)?.kind==='audio')editAudioChannel(ch);else onOpenChannel?.(ch);};
            header.addEventListener('click', activate);
            header.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                e.stopPropagation();
                activate();
            });
            header.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openChannelContextMenu(Number(row.dataset.channel));
            });
        });

        // Mute dot — single toggle, double toggle-all
        rootEl.querySelectorAll('.arr-dot').forEach(dot => {
            dot.addEventListener('click', (e) => {
                e.stopPropagation();
                if (muteTimer) { clearTimeout(muteTimer); muteTimer = null; return; }
                muteTimer = setTimeout(() => {
                    muteTimer = null;
                    const ch = Number(dot.dataset.channel);
                    toggleMuteChannel(ch);
                    onEdit?.(); markDirty();
                }, 220);
            });
            dot.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                if (muteTimer) { clearTimeout(muteTimer); muteTimer = null; }
                const ch = Number(dot.dataset.channel);
                const s = getSeq();
                const target = s.channels.find(c => c.channel === ch);
                const targetState = !!target?.muted;
                s.channels.forEach(c => {
                    if (c.created === false || c.kind === 'comment') return;
                    c.muted = targetState;    // копируем состояние этой точки на все
                    applyChannel(c.channel);
                });
                onEdit?.(); markDirty();
            });
        });

    };

    const clipsAt = (channel, start, length, except) => {
        const s = getSeq();
        return s.arrangement.some(pl => {
            if (pl === except) return false;
            const pat = s.getPattern(pl.patternId);
            return pat?.channel === channel && pl.startTick < start + length && pl.startTick + pat.lengthTicks > start;
        });
    };
    const paintGrid = (e) => {
        const paint = state.paint;
        if (!paint || paint.sequence !== getSeq()) return;
        const grid = e.target.closest?.('.arr-clips[data-channel]');
        if (!grid || !rows.contains(grid) || Number(grid.dataset.channel) !== paint.channel) return;
        const s = paint.sequence;
        if (paint.erase) {
            const id = e.target.closest('.arr-clip')?.dataset.placement;
            if (id && s.arrangement.some(p => p.id === id)) {
                s.arrangement = s.arrangement.filter(p => p.id !== id);
                paint.changed = true;
                markDirty();
            }
        } else {
            const bar = Math.max(0, Math.floor((e.clientX - grid.getBoundingClientRect().left) / paint.barWidth));
            if (bar === paint.lastBar || bar >= paint.bars) return;
            const pat = getChannelPattern?.(paint.channel) ?? s.ensureChannelPattern(paint.channel);
            const start = bar * tpb();
            if (!clipsAt(paint.channel, start, pat.lengthTicks)) {
                s.placePattern(pat.id, start);
                paint.changed = true;
                markDirty();
            }
            paint.lastBar = bar;
        }
    };

    rows.addEventListener('click', (e) => {
        if (!e.target.closest('#arrAddChannel')) return;
        const slot = getSeq().channels.reduce((next, ch) => Math.max(next, ch.channel + 1), 0);
        if (slot < 2048) openChannelDialog({ slot, isNew: true });
        else setStatus('No free MIDI port/channel');
    });
    rows.addEventListener('dblclick', (e) => {
        const audio=e.target.closest('[data-audio-clip]');if(audio){editAudioChannel(Number(audio.closest('[data-channel]').dataset.channel));return;}
        const clip = e.target.closest('.arr-clip');
        if (!clip || e.target.closest('.arr-clip-resize')) return;
        const placement = getSeq()?.arrangement.find(p => p.id === clip.dataset.placement);
        if (placement) onOpenChannel?.(Number(clip.dataset.channel), placement.patternId, placement);
    });

    rows.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.button !== 2) return;
        const grid = e.target.closest('.arr-clips[data-channel]');
        const s = getSeq();
        if (!grid || !s) return;
        if(s.channels.find(c=>c.channel===Number(grid.dataset.channel))?.kind==='audio'){
            const el=e.target.closest('[data-audio-clip]');if(!el)return;
            if(e.button===2){e.preventDefault();openAudioMenu(s.channels.find(c=>c.channel===Number(grid.dataset.channel)));return;}
            const clip=s.audioClips.find(c=>c.id===el.dataset.audioClip);if(!clip)return;
            e.preventDefault();audioDrag={song:s,clip,el,pointerId:e.pointerId,x:e.clientX,scroll:body.scrollLeft,start:clip.startSeconds,bw:barW(),moved:false};return;
        }
        e.preventDefault();
        const clip = e.target.closest('.arr-clip');
        const channel = Number(grid.dataset.channel);
        if (clip && e.button === 0) {
            const placement = s.arrangement.find(p => p.id === clip.dataset.placement);
            if (!placement) return;
            state.selectedPlacement = placement.id;
            focusPattern(channel, placement.patternId);
            rows.querySelector('.arr-clip.selected')?.classList.remove('selected');
            clip.classList.add('selected');
            if (e.target.closest('.arr-clip-resize')) {
                const pattern = s.getPattern(placement.patternId);
                if (!pattern) return;
                const { minBars, maxBars } = s.patternResizeBounds(pattern.id);
                state.dragMode = 'resize-clip';
                state.dragClip = { sequence: s, placement, channel, barWidth: barW(),
                    minBars, maxBars, initialBars: pattern.lengthTicks / tpb(), nextBars: null,
                    startClientX: e.clientX, scrollLeft: body.scrollLeft, origWidth: parseFloat(clip.style.width),
                    el: clip, pointerId: e.pointerId };
                clip.classList.add('resizing');
                return;
            }
            state.dragMode = 'move-clip';
            state.dragClip = { sequence: s, placement, channel, barWidth: barW(),
                gridLeft: grid.getBoundingClientRect().left,
                startClientX: e.clientX, origLeft: parseFloat(clip.style.left), el: clip,
                pointerId: e.pointerId, moved: false };
            clip.classList.add('dragging');
        } else {
            state.paint = { sequence: s, channel, erase: e.button === 2, pointerId: e.pointerId,
                barWidth: barW(), bars: totalBars() };
            paintGrid(e);
        }
    });

    // ==================================================================
    // Mute
    // ==================================================================
    const applyChannel = (ch) => {
        const s = getSeq();
        const info = s?.channels?.find(c => c.channel === ch);
        if (!info || info.kind === 'comment') return;
        if (loadedSequence === s) applyChannelVolume(info);
    };

    const toggleMuteChannel = (ch) => {
        const s = getSeq();
        const info = s?.channels?.find(c => c.channel === ch);
        if (!info) return;
        info.muted = !info.muted;
        applyChannel(ch);
    };

    // ==================================================================
    // Dialogs (channel creation + context menu)
    // ==================================================================
    const closeAllOverlays = () => {
        document.querySelectorAll('.arr-dialog-overlay').forEach(el => el.remove());
    };

    const openChannelDialog = ({ slot, isNew = true }) => {
        closeAllOverlays();
        const s = getSeq();
        if (!s) return;
        const existing = s.channels.find(c => c.channel === slot);
        const isExisting = !isNew && existing;
        const wasAudible = existing?.kind !== 'comment';

        const overlay = document.createElement('div');
        overlay.className = 'arr-dialog-overlay';
        overlay.innerHTML = `
            <div class="arr-dialog-box">
                <div class="arr-dialog-title">${isExisting ? 'Channel' : 'New Channel'}</div>
                <div class="arr-dialog-body">
                    <label class="arr-field">
                        <span>Name</span>
                        <input id="dlgName" type="text" value="${escapeHtml(existing?.name || ('Ch ' + (slot + 1)))}">
                    </label>
                    <div id="dlgInstrument"></div>
                    <label class="arr-field">
                        <span>Color</span>
                        <div class="arr-colors" id="dlgColors">
                            ${COLORS.map((c, idx) => `<button type="button" aria-label="Color ${idx + 1}" title="${c}" class="arr-color ${existing?.color === c ? 'active' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}
                        </div>
                    </label>
                    <label class="arr-field" id="dlgVolField">
                        <span>Volume</span>
                        <input id="dlgVol" type="range" min="0" max="100" value="${existing?.volume ?? 100}" style="flex:1">
                        <span id="dlgVolVal" class="arr-num">${existing?.volume ?? 100}</span>
                    </label>
                </div>
                <div class="arr-dialog-footer">
                    <button class="btn" id="dlgCancel" type="button">Cancel</button>
                    <button class="btn btn-primary" id="dlgOk" type="button">${isExisting ? 'Save' : 'Create'}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const readInstrument = mountInstrumentFields(overlay.querySelector('#dlgInstrument'), existing ?? { isDrum: slot === 9 }, { allowComment: true });
        const updateCategory = () => { overlay.querySelector('#dlgVolField').hidden = readInstrument.category.value === 'comment'; };
        readInstrument.category.addEventListener('change', updateCategory); updateCategory();
        let chosenColor = existing?.color || COLORS[slot % COLORS.length];
        overlay.querySelectorAll('.arr-color').forEach(el => {
            el.addEventListener('click', () => {
                chosenColor = el.dataset.color;
                overlay.querySelectorAll('.arr-color').forEach(x => x.classList.toggle('active', x === el));
            });
        });

        const volInput = overlay.querySelector('#dlgVol');
        const volVal = overlay.querySelector('#dlgVolVal');
        volInput.addEventListener('input', () => { volVal.textContent = volInput.value; });

        overlay.querySelector('#dlgCancel').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        overlay.querySelector('#dlgOk').addEventListener('click', () => {
            const name = overlay.querySelector('#dlgName').value.trim() || ('Ch ' + (slot + 1));
            const inst = readInstrument();
            if (!inst) return;
            const vol = Number(volInput.value);
            let chObj = s.channels.find(c => c.channel === slot);
            if (!chObj) {
                chObj = { channel: slot };
                s.channels.push(chObj);
            }
            chObj.name = name;
            Object.assign(chObj, inst);
            chObj.color = chosenColor;
            chObj.volume = vol;
            chObj.pan = chObj.pan ?? 64;
            chObj.muted = chObj.muted ?? false;
            chObj.created = true;

            if (loadedSequence === s) applyChannelVolume(inst.kind === 'comment' ? { ...chObj, muted: true } : chObj);
            overlay.remove();
            edit(inst.kind !== 'comment' || (isExisting && wasAudible));
        });
    };

    const openChannelContextMenu = (ch) => {
        closeAllOverlays();
        const s = getSeq();
        const info = s.channels.find(c => c.channel === ch);
        if (!info) return;
        if(info.kind==='audio'){openAudioMenu(info);return;}

        const dialog = document.createElement('dialog');
        dialog.className = 'arr-dialog-box arr-context-menu app-dialog';
        const name = info.name || `Ch ${ch + 1}`;
        dialog.setAttribute('aria-label', name);
        dialog.innerHTML = `
            <h2 class="arr-dialog-title"></h2>
            <button type="button" class="arr-menu-item arr-pattern-focus" data-act="pattern" aria-expanded="false"></button>
            <div class="arr-pattern-options" hidden></div>
            <div class="arr-menu-sep"></div>
            <button type="button" class="arr-menu-item" data-act="edit">Edit channel…</button>
            <button type="button" class="arr-menu-item" data-act="clone">Clone channel</button>
            <button type="button" class="arr-menu-item" data-act="split">Split channel…</button>
            <button type="button" class="arr-menu-item" data-act="merge">Merge channels ↓…</button>
            <button type="button" class="arr-menu-item" data-act="up">Move up</button>
            <button type="button" class="arr-menu-item" data-act="down">Move down</button>
            <div class="arr-menu-sep"></div>
            <button type="button" class="arr-menu-item danger" data-act="delete">Delete channel</button>
            <button type="button" class="arr-menu-item" data-act="cancel">Cancel</button>`;
        dialog.querySelector('h2').textContent = name;
        const order = s.orderedChannels();
        const below = order[order.indexOf(info) + 1];
        dialog.querySelector('[data-act="merge"]').disabled = !below || info.kind === 'comment' || below.kind === 'comment' || below.kind === 'audio';
        dialog.querySelector('[data-act="split"]').disabled = info.kind === 'comment';
        const focus = dialog.querySelector('[data-act="pattern"]');
        const active = getChannelPattern?.(ch);
        focus.textContent = `Draw pattern: ${active?.name ?? 'New pattern'} ▾`;
        const options = dialog.querySelector('.arr-pattern-options');
        for (const pattern of s.patterns.filter(p => p.channel === ch)) {
            const option = document.createElement('button');
            option.type = 'button'; option.className = 'arr-menu-item'; option.textContent = pattern.name;
            option.setAttribute('aria-pressed', String(pattern.id === active?.id));
            option.addEventListener('click', () => {
                focusPattern(ch, pattern.id);
                state.selectedPlacement = null;
                markDirty(); dialog.close();
            });
            options.append(option);
        }
        if (!options.childElementCount) options.textContent = 'No patterns yet. Draw or open the channel to create one.';
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        document.body.append(dialog); dialog.showModal();
        dialog.querySelectorAll('[data-act]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const act = btn.dataset.act;
                if (act === 'pattern') {
                    options.hidden = !options.hidden;
                    focus.setAttribute('aria-expanded', String(!options.hidden));
                    if (!options.hidden) options.querySelector('[aria-pressed="true"],button')?.focus();
                    return;
                }
                dialog.close();
                if (act === 'edit') {
                    openChannelDialog({ slot: ch, isNew: false });
                } else if (act === 'clone') {
                    const copy = s.cloneChannel(ch);
                    if (copy) {
                        focusPattern(copy.channel, s.getChannelPattern(copy.channel)?.id);
                        edit(info.kind !== 'comment');
                    } else setStatus('No free MIDI channel for a copy.');
                } else if (act === 'split') {
                    const mode = await chooseChannelSplit(s, info);
                    if (!mode || getSeq() !== s || !s.channels.includes(info)) return;
                    try {
                        stop();
                        const channels = s.splitChannel(ch, mode);
                        if (channels.length) { focusPattern(ch, active?.id ?? s.getChannelPattern(ch)?.id); edit(); setStatus(`Split into ${channels.length} channels`); }
                    } catch (error) { setStatus(error.message); }
                } else if (act === 'merge') {
                    const message = `Move all patterns and notes from ${below.name || 'the channel below'} into ${name}, then delete the lower channel? ${name}'s instrument, volume and effects sends will be used. Clip positions and pattern automation are retained; overlapping automation will share one channel. Undo can restore both channels.`;
                    if (!await confirmAction('Merge channels', message) || getSeq() !== s || s.orderedChannels()[s.orderedChannels().indexOf(info)+1] !== below) return;
                    stop();
                    if (s.mergeNextChannel(ch)) { focusPattern(ch, active?.id ?? s.getChannelPattern(ch)?.id); edit(); }
                } else if (act === 'delete') {
                    if (!await confirmAction('Delete channel', `Delete ${name} and all its patterns and clips?`) || getSeq() !== s) return;
                    s.channels = s.channels.filter(c => c.channel !== ch);
                    s.channelOrder = s.channelOrder.filter(id => id !== ch);
                    s.patterns = s.patterns.filter(p => p.channel !== ch);
                    const alivePatIds = new Set(s.patterns.map(p => p.id));
                    s.arrangement = s.arrangement.filter(pl => alivePatIds.has(pl.patternId));
                    edit(info.kind !== 'comment');
                } else if (act === 'up' || act === 'down') {
                    if (s.moveChannel(ch, act === 'up' ? -1 : 1)) edit(false);
                }
            });
        });
    };

    const onWindowPointerMove = (e) => {
        if(audioDrag?.pointerId===e.pointerId){
            const d=audioDrag,dx=e.clientX-d.x+body.scrollLeft-d.scroll;
            if(Math.abs(dx)>3)d.moved=true;
            if(d.moved){const tick=d.song.secondsToTicks(d.start)+dx/d.bw*tpb();d.next=Math.round(Math.max(0,d.song.ticksToSeconds(tick))*1000)/1000;d.el.style.left=`${tickToX(d.song.secondsToTicks(d.next))-CHAN_W}px`;}
            return;
        }
        if (state.paint?.pointerId === e.pointerId) paintGrid(e);
        const d = state.dragClip;
        if (d?.pointerId === e.pointerId && state.dragMode === 'resize-clip') {
            if (d.maxBars < d.minBars) return;
            const deltaBars = Math.round((e.clientX - d.startClientX + body.scrollLeft - d.scrollLeft) / d.barWidth);
            const bars = deltaBars ? Math.max(d.minBars, Math.min(d.maxBars, Math.round(d.initialBars) + deltaBars)) : d.initialBars;
            d.nextBars = bars === d.initialBars ? null : bars;
            d.el.style.width = `${d.nextBars == null ? d.origWidth : d.nextBars * d.barWidth}px`;
            return;
        }
        if (d && d.pointerId === e.pointerId) {
            const dx = e.clientX - d.startClientX;
            if (Math.abs(dx) > 3) d.moved = true;
            if (d.moved) {
                const scrollDelta = d.gridLeft - d.el.parentElement.getBoundingClientRect().left;
                const bar = Math.max(0, Math.round((d.origLeft + dx + scrollDelta) / d.barWidth));
                d.nextTick = bar * tpb();
                d.el.style.left = `${bar * d.barWidth}px`;
            }
        }
        if (state.dragMode === 'seek' && e.pointerId === state.seekPointer) {
            const rect = ruler.getBoundingClientRect();
            seekTick(xToTick(e.clientX - rect.left), false, false);
        }
        if (state.dragMode === 'loop-start' || state.dragMode === 'loop-end') {
            const rect = ruler.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const tick = Math.round(xToTick(x) / tpb()) * tpb();
            if (state.dragMode === 'loop-start') {
                state.loopStartTick = Math.max(0, Math.min(tick, effectiveLoopEnd()));
            } else {
                state.loopEndTick = Math.max(tick, state.loopStartTick);
            }
            markDirty();
        }
    };

    const onWindowPointerUp = (e) => {
        if(audioDrag?.pointerId===e.pointerId){const d=audioDrag;audioDrag=null;if(d.moved&&e.type!=='pointercancel'&&d.song===getSeq()){haltPlayback();d.clip.startSeconds=d.next;edit();}else markDirty();return;}
        if (state.dragMode === 'seek') {
            if (e.pointerId !== state.seekPointer) return;
            state.dragMode = null;
            state.seekPointer = null;
            if (e.type !== 'pointercancel') seekTo(e.clientX - ruler.getBoundingClientRect().left);
            return;
        }
        if (state.paint?.pointerId === e.pointerId) {
            const changed = state.paint.changed;
            const audible = !isCommentChannel(state.paint.channel);
            state.paint = null;
            if (changed) edit(audible);
            else markDirty();
        }
        const d = state.dragClip;
        if (d && d.pointerId !== e.pointerId) return;
        if (d && state.dragMode === 'resize-clip') {
            state.dragMode = null; state.dragClip = null;
            d.el.classList.remove('resizing');
            d.el.style.width = `${d.origWidth}px`;
            if (e.type !== 'pointercancel' && d.nextBars != null && d.sequence === getSeq()) {
                try { if (d.sequence.resizePattern(d.placement.patternId, d.nextBars)) edit(false); }
                catch (error) { setStatus(error.message); }
            }
            return;
        }
        if (d) {
            const pattern = d.sequence.getPattern(d.placement.patternId);
            if (e.type !== 'pointercancel' && d.moved && pattern && d.sequence === getSeq() &&
                !clipsAt(d.channel, d.nextTick, pattern.lengthTicks, d.placement)) {
                if (d.placement.startTick !== d.nextTick) { d.placement.startTick = d.nextTick; edit(!isCommentChannel(d.channel)); }
            }
            d.el.classList.remove('dragging');
            if (d.moved) markDirty();
        }
        if (state.dragMode === 'loop-start' || state.dragMode === 'loop-end') updatePlayback();
        state.dragMode = null;
        state.dragClip = null;
    };

    // ==================================================================
    // Ruler / loop
    // ==================================================================
    const seekTick = (tick, reveal = false, commit = true) => {
        const song = getSeq();
        if (!song) return;
        const seq = loadedSequence === song ? getSequencer?.() : null;
        state.cursorTick = Math.max(0, Math.min(arrangementDurationTick() || (totalBars() * tpb()), tick));
        if (commit && !loading && seq && !seq.paused && !seq.isFinished) {
            seekingUntil = performance.now() + 100;
            audioFollower?.stop();
            seq.currentTime = Math.min(seq.duration, song.ticksToSeconds(state.cursorTick));
        }
        if (reveal) {
            const x = tickToX(state.cursorTick);
            if (x < body.scrollLeft + CHAN_W || x >= body.scrollLeft + body.clientWidth) {
                body.scrollLeft = Math.max(0, x - CHAN_W - 16);
            }
        }
        renderPlayhead();
    };
    const seekTo = (x) => seekTick(xToTick(x));

    const onRulerDown = (e) => {
        const rect = ruler.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < CHAN_W + body.scrollLeft) return;
        if (e.button !== 0) return;
        state.dragMode = 'seek';
        state.seekPointer = e.pointerId;
        seekTick(xToTick(x), false, false);
        e.preventDefault();
    };

    ruler.addEventListener('pointerdown', onRulerDown);
    ruler.addEventListener('contextmenu', (e) => e.preventDefault());

    $('#arrLoopMarkers').addEventListener('contextmenu', e => {
        e.preventDefault();
        const x = e.clientX - ruler.getBoundingClientRect().left;
        if (x < CHAN_W + body.scrollLeft) return;
        const tick = Math.round(xToTick(x) / tpb()) * tpb();
        state.loopStartTick = state.loopEndTick = tick;
        state.loopEnabled = true;
        updatePlayback(); markDirty();
    });

    [['#arrLoopStart', 'loop-start'], ['#arrLoopEnd', 'loop-end']].forEach(([sel, mode]) => {
        const el = $(sel);
        el.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            state.dragMode = mode;
        });
    });

    // Global right-click prevent (system menu) on the arranger
    rootEl.addEventListener('contextmenu', (e) => e.preventDefault());

    // ==================================================================
    // Transport
    // ==================================================================
    const updateTransportUI = () => {
        const seq = getSequencer?.();
        const loaded = !!seq && loadedSequence === getSeq() && !seq.isFinished;
        playBtn.classList.toggle('active', loaded && !seq.paused);
        pauseBtn.classList.toggle('active', loaded && pausedByUser && seq.paused);
        playBtn.disabled = loading || !playableDurationTick() || (loaded && !seq.paused);
        pauseBtn.disabled = !loaded || seq.paused;
    };

    const play = async (reload = false) => {
        const s = getSeq();
        if (rootEl.inert) return;
        if (!playableDurationTick()) { if (reload === true) stop(); return; }
        if (loading) { if (reload === true) reloadPending = true; return; }
        const request = ++playbackRequest;
        loading = true;
        updateTransportUI();
        const current = () => request === playbackRequest && state.visible && !rootEl.inert && s === getSeq();

        try {
            await initSynth();
            await prepareChipBank(s);
            const audioBuffers=await prepareAudio(s,getAudioContext());
            if (!current()) return;
            const seq = getSequencer();
            const resume = !playbackDirty && reload !== true && loadedSequence === s && pausedByUser && !seq.isFinished;
            if (reload === true && !seq.paused && !seq.isFinished) state.cursorTick = s.secondsToTicks(seq.currentTime);
            const loop = hasLoop() ? { start: state.loopStartTick, end: effectiveLoopEnd() } : null;
            if (!resume) {
                playbackDirty = false;
                const midi = writeArrangementMIDI(s, { loop, liveMix: true });
                if (!await loadSong(midi, 'arrangement', seq, current)) return;
                loadedSequence = s;
            }
            pausedByUser = false;
            seq.loopCount = loop ? Infinity : 0;
            // Time is set after loading, even when the ruler was clicked before the first Play.
            if (state.cursorTick >= playableDurationTick() || s.ticksToSeconds(state.cursorTick) >= seq.duration ||
                (loop && state.loopEndTick !== null && (state.cursorTick < loop.start || state.cursorTick >= loop.end))) {
                state.cursorTick = loop?.start ?? 0;
            }
            const position = Math.min(seq.duration, s.ticksToSeconds(state.cursorTick));
            if (position > 0 || resume) seq.currentTime = position;
            seekingUntil = performance.now() + 100;
            applyChannelMix(s);
            audioFollower?.stop();
            audioFollower=createAudioFollower(getAudioContext(),getAudioOutput(),s,audioBuffers);
            seq.play();
            audioFollower.update(position,true,loop?s.ticksToSeconds(loop.end):Infinity);
        } catch (err) {
            if (current()) { setStatus(err.message); log(`Arranger play: ${err}`, 'error'); }
        } finally {
            if (request === playbackRequest) {
                loading = false;
                if (reloadPending) { reloadPending = false; updatePlayback(); }
            }
            updateTransportUI();
        }
    };

    const pause = () => {
        renderPlayhead(false);
        audioFollower?.stop();
        clearTimeout(reloadTimer); reloadPending = false;
        if (loading) { playbackRequest++; loading = false; playbackDirty = true; }
        pausedByUser = true;
        getSequencer()?.pause();
        updateTransportUI();
    };

    const haltPlayback = () => {
        audioFollower?.stop();
        playbackRequest++;
        clearTimeout(reloadTimer); reloadPending = false;
        loading = pausedByUser = lastFramePlaying = false;
        const seq = getSequencer?.();
        seq?.pause();
        return seq;
    };

    const stop = (revealStart = false) => {
        const seq = haltPlayback();
        state.cursorTick = 0;
        if (revealStart) body.scrollLeft = 0;
        if (seq) { try { seq.currentTime = 0; } catch {} }
        renderPlayhead(false);
        updateTransportUI();
    };

    const goEnd = () => {
        // Seeking a running sequencer past the loop's end wraps it immediately.
        // Stop playback and position only the editor; leave the loop intact for Play.
        haltPlayback();
        seekTick(playableDurationTick() || arrangementDurationTick(), true, false);
        updateTransportUI();
    };

    const goHome = () => {
        const seq = loadedSequence === getSeq() ? getSequencer() : null;
        const keepPlaying = loading || (!!seq && !seq.paused && !seq.isFinished);
        // An explicit restart leaves a partial loop without throwing its markers away.
        // A whole-track loop can stay on: it does not trap the transport after Home.
        if (hasLoop() && (state.loopStartTick > 0 || effectiveLoopEnd() < playableDurationTick())) {
            state.loopEnabled = false;
            if (seq) seq.loopCount = 0;
            markDirty();
        }
        clearTimeout(reloadTimer); reloadPending = false;
        // Supersede any queued edit reload or seek. Reload from tick zero on Play
        // instead of reusing the live sequencer's old position and controller state.
        if (loading) { playbackRequest++; loading = false; }
        playbackDirty = true;
        body.scrollLeft = 0;
        seekingUntil = performance.now() + 100;
        seekTick(0, false, false);
        if (keepPlaying) play();
    };

    playBtn?.addEventListener('click', () => play());
    $('#arrMixer')?.addEventListener('click', () => onMixer?.());
    pauseBtn?.addEventListener('click', pause);
    $('#arrStop')?.addEventListener('click', () => stop(true));
    $('#arrHome')?.addEventListener('click', goHome);
    $('#arrEnd')?.addEventListener('click', goEnd);
    loopAllBtn.addEventListener('click', () => {
        if (!playableDurationTick()) return;
        if (state.loopEnabled && state.loopStartTick === 0 && state.loopEndTick === null) return;
        state.loopEnabled = true;
        state.loopStartTick = 0;
        state.loopEndTick = null;
        updatePlayback(); markDirty();
    });
    loopBtn?.addEventListener('click', () => {
        state.loopEnabled = !state.loopEnabled;
        if (state.loopEnabled && state.loopStartTick === effectiveLoopEnd()) {
            state.loopStartTick = 0; state.loopEndTick = null;
        }
        updatePlayback(); markDirty();
    });
    bindMasterVolume($('#arrMasterVol'));

    // ==================================================================
    // Keyboard
    // ==================================================================
    document.addEventListener('keydown', (e) => {
        if (!state.visible || rootEl.inert || document.querySelector('dialog[open], .arr-dialog-overlay, .pr-picker-overlay:not(.hidden)')) return;
        const active = document.activeElement;
        if (active && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(active.tagName)) return;

        if (e.key === ' ') {
            e.preventDefault();
            const seq = getSequencer?.();
            if (seq && loadedSequence === getSeq() && !seq.paused && !seq.isFinished) pause();
            else play();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            seekTick(state.cursorTick + (e.key === 'ArrowLeft' ? -tpb() : tpb()), true);
        }
    });

    // ==================================================================
    // rAF + Resize
    // ==================================================================
    const tick = () => {
        if (state.visible) {
            render();
            renderPlayhead();
            updateTransportUI();
        }
        rafId = requestAnimationFrame(tick);
    };

    const ro = new ResizeObserver(() => { markDirty(); });
    ro.observe(body);

    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);

    // Init
    requestAnimationFrame(() => { markDirty(); tick(); });

    return {
        root: rootEl,
        refresh: () => { markDirty(); },
        refreshAudio: updatePlayback,
        play, pause, stop,
        getCursorTick: () => state.cursorTick,
        importWav: () => {relinkChannel=null;$('#arrWavFile').click();},
        reset() {
            audioFollower?.stop();audioFollower=null;selectedMarker=null;
            loadedSequence = null;
            state.loopStartTick = state.cursorTick = 0;
            state.loopEndTick = null;
            state.selectedPlacement = null;
            body.scrollTo(0, 0);
            markDirty();
        },
        setVisible(v) {
            if (!v) {
                stop();
                loadedSequence = null;
            }
            state.visible = v;
        },
        destroy() {
            audioFollower?.stop();
            cancelAnimationFrame(rafId);
            ro.disconnect();
            window.removeEventListener('pointermove', onWindowPointerMove);
            window.removeEventListener('pointerup', onWindowPointerUp);
            window.removeEventListener('pointercancel', onWindowPointerUp);
            if (muteTimer) clearTimeout(muteTimer);
        },
    };
}