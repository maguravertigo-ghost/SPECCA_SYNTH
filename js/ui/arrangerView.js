// js/ui/arrangerView.js
import { log, setStatus } from '../core/log.js';
import { getSequencer, applyChannelVolume, resumeAudio, bindMasterVolume, loadSong } from '../core/synth.js';
import { writeArrangementMIDI } from '../editor/exportMidi.js';
import { getInstrumentCatalog, mountInstrumentFields } from './instrumentFields.js';
import { instrumentLabel } from '../editor/instruments.js';

const CHAN_W     = 160;
const RULER_H    = 24;
const LOOP_H     = 16;
const MIN_BAR_W  = 80;
const MIN_CHANNEL_ROWS = 16;

const COLORS = [
    '#4ec9b0','#dcdcaa','#c586c0','#ce9178','#569cd6','#888888',
    '#e35b5b','#6bb0ff','#4ec9ff','#ffcc00','#ff6bcb','#6bffb2',
];

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

export function mountArranger(rootEl, { getSequence, getChannelPattern, onSelectPattern, onOpenChannel } = {}) {
    if (!rootEl) return null;

    rootEl.innerHTML = `
        <div class="arr-shell">
            <div class="arr-toolbar" aria-label="Arrangement playback">
                <div class="arr-transport-group" role="group" aria-label="Transport">
                    <button id="arrHome" class="arr-control" type="button" title="To start" aria-label="To start">⏮</button>
                    <button id="arrPlay" class="arr-control arr-primary" type="button" title="Play" aria-label="Play">▶</button>
                    <button id="arrPause" class="arr-control" type="button" title="Pause" aria-label="Pause">Ⅱ</button>
                    <button id="arrStop" class="arr-control" type="button" title="Stop" aria-label="Stop">■</button>
                    <button id="arrEnd" class="arr-control" type="button" title="To end" aria-label="To end">⏭</button>
                </div>
                <output id="arrTime" class="arr-time">0:00.0 / 0:00.0</output>
                <div class="arr-toolbar-options">
                    <button id="arrLoopBtn" class="arr-control arr-loop active" type="button" aria-pressed="true">↻ Loop</button>
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
                        <div class="arr-loop-mark start" id="arrLoopStart" data-edge="start">▼</div>
                        <div class="arr-loop-mark end" id="arrLoopEnd" data-edge="end">▼</div>
                    </div>
                    <div class="arr-ruler" id="arrRuler" style="height:${RULER_H}px"></div>
                    <div class="arr-rows" id="arrRows"></div>
                    <div class="arr-playhead" id="arrPlayhead"></div>
                </div>
            </div>
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

    const state = {
        loopEnabled: true,
        loopStartTick: 0,
        loopEndTick: 0,   // 0 = автоматически до конца аранжировки
        dragMode: null,
        dragClip: null,
        paint: null,
        visible: true,
        cursorTick: 0,
    };

    let rafId = 0;
    let dirty = true;
    let muteTimer = null;
    let playbackRequest = 0;
    let loadedSequence = null;
    let loading = false;
    let pausedByUser = false;
    let lastFramePlaying = false;
    let seekingUntil = 0;

    const markDirty = () => { dirty = true; };
    const getSeq     = () => (typeof getSequence === 'function' ? getSequence() : null);
    const timeDiv    = () => getSeq()?.timeDivision || 480;
    const tpb        = () => Math.max(1, Math.round(timeDiv() * (getSeq()?.stepsPerBar || 16) / 4));
    const totalBars  = () => {
        const s = getSeq();
        let maxBar = 8;
        if (s?.arrangement) {
            for (const pl of s.arrangement) {
                const pat = s.patterns?.find(p => p.id === pl.patternId);
                if (!pat) continue;
                maxBar = Math.max(maxBar, Math.ceil((pl.startTick + pat.lengthTicks) / tpb()));
            }
        }
        const loopEndBar = Math.ceil(state.loopEndTick / tpb());
        return Math.max(8, maxBar, loopEndBar) + 1;
    };
    const availW     = () => body.clientWidth - CHAN_W;
    const barW       = () => state.paint?.barWidth ?? Math.max(MIN_BAR_W, availW() / totalBars());
    const tickToX    = (tick) => CHAN_W + (tick / tpb()) * barW();
    const xToTick    = (x)    => Math.max(0, ((x - CHAN_W) / barW()) * tpb());
    const xToBar     = (x)    => Math.max(0, Math.floor((x - CHAN_W) / barW()));

    const chanColor = (idx) => {
        const s = getSeq();
        const ch = s?.channels?.find(c => c.channel === idx);
        return ch?.color || COLORS[idx % COLORS.length];
    };

    const arrangementDurationTick = () => {
        const s = getSeq();
        if (!s?.arrangement?.length) return 0;
        let maxTick = 0;
        for (const pl of s.arrangement) {
            const pat = s.patterns?.find(p => p.id === pl.patternId);
            if (pat) maxTick = Math.max(maxTick, pl.startTick + pat.lengthTicks);
        }
        return maxTick;
    };

    const effectiveLoopEnd = () => {
        return state.loopEndTick > state.loopStartTick
            ? state.loopEndTick
            : arrangementDurationTick();
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
        loopRange.style.display   = show ? 'block' : 'none';
        loopStartEl.style.display = show ? 'block' : 'none';
        loopEndEl.style.display   = show ? 'block' : 'none';

        content.style.width = `${CHAN_W + bars * bw}px`;
        content.style.setProperty('--bar-w', bw + 'px');
    };

    const renderRows = () => {
        const s = getSeq();
        if (!s) { rows.innerHTML = ''; return; }
        const channels = s.channels || [];
        const catalog = getInstrumentCatalog();
        const patterns = new Map(s.patterns.map(p => [p.id, p]));
        const rowCount = Math.max(MIN_CHANNEL_ROWS, channels.reduce((max, c) => Math.max(max, c.channel + 1), 0));
        const byChannel = Array.from({ length: rowCount }, () => []);
        for (const pl of s.arrangement) {
            const pat = patterns.get(pl.patternId);
            if (pat && byChannel[pat.channel]) byChannel[pat.channel].push([pl, pat]);
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

        for (let i = 0; i < rowCount; i++) {
            const ch = channels.find(c => c.channel === i);
            const created = !!ch && ch.created !== false;
            const color = chanColor(i);
            const muted = !!ch?.muted;

            if (!created) {
                // Empty slot
                html += `<div class="arr-row arr-row-empty" data-slot="${i}">`;
                html += `  <div class="arr-chan" style="width:${CHAN_W}px" role="button" tabindex="0" aria-label="Create channel ${i + 1}">`;
                html += `    <span class="arr-radio"></span>`;
                html += `    <span class="arr-chan-name muted">— empty —</span>`;
                html += `  </div>`;
                html += `  <div class="arr-clips" style="--bar-w:${barW()}px"></div>`;
                html += `</div>`;
                continue;
            }

            html += `<div class="arr-row" data-channel="${i}">`;
            html += `  <div class="arr-chan" data-channel="${i}" style="width:${CHAN_W}px" role="button" tabindex="0" title="Ch ${i + 1} · Edit notes in Piano Roll">`;
            html += `    <span class="arr-dot" data-channel="${i}"
                            style="background:${muted ? 'transparent' : '#1a7f37'};
                                   border-color:${muted ? '#666' : '#1a7f37'};"></span>`;
            html += `    <div class="arr-chan-info">`;
            html += `      <div class="arr-chan-name">${escapeHtml(ch.name || ('Ch ' + (i + 1)))}</div>`;
            html += `      <div class="arr-chan-pat">${escapeHtml(instrumentLabel(ch, catalog))}</div>`;
            html += `    </div>`;
            html += `    <span class="arr-chan-bar" style="background:${color}"></span>`;
            html += `  </div>`;
            html += `  <div class="arr-clips" data-channel="${i}" style="--bar-w:${barW()}px">`;
            for (const [pl, pat] of byChannel[i]) {
                const selected = state.selectedPlacement === pl.id ? ' selected' : '';
                const left = tickToX(pl.startTick) - CHAN_W;
                const right = tickToX(pl.startTick + pat.lengthTicks) - CHAN_W;
                const w = Math.max(8, right - left);
                html += `<div class="arr-clip${selected}" data-placement="${escapeHtml(pl.id)}"
                              data-channel="${i}"
                              style="left:${left}px;width:${w}px;background:${color}"
                              title="${escapeHtml(pat.name)} · ${pat.notes.length} notes">${patternPreview(pat)}<span>${escapeHtml(pat.name)}</span></div>`;
            }
            html += `  </div>`;
            html += `</div>`;
        }

        rows.innerHTML = html;
        wireRowEvents();
    };

    const renderPlayhead = () => {
        const song = getSeq();
        if (!song) return;
        const seq = loadedSequence === song ? getSequencer?.() : null;
        const playing = !!seq && !seq.paused && !seq.isFinished;
        const end = Math.max(arrangementDurationTick(), seq ? song.secondsToTicks(seq.duration) : 0);
        if (playing && !loading && state.dragMode !== 'seek' && performance.now() >= seekingUntil) {
            state.cursorTick = Math.max(0, Math.min(end, song.secondsToTicks(seq.currentTime)));
        } else if (lastFramePlaying && seq?.isFinished && !loading) {
            state.cursorTick = end;
        }
        lastFramePlaying = playing;
        const x = tickToX(state.cursorTick);
        playhead.style.transform = `translateX(${x - 1}px)`;
        playhead.style.display = x >= CHAN_W && x >= body.scrollLeft + CHAN_W ? 'block' : 'none';
        ruler.dataset.playheadTick = String(Math.round(state.cursorTick));
        const fmt = (seconds) => {
            const s = Math.max(0, seconds || 0);
            const m = Math.floor(s / 60);
            return `${m}:${Math.floor(s - m * 60).toString().padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;
        };
        timeEl.textContent = `${fmt(song.ticksToSeconds(state.cursorTick))} / ${fmt(song.ticksToSeconds(end))}`;
    };

    const render = () => {
        if (!dirty || state.dragClip) return;
        dirty = false;
        renderRuler();
        renderRows();
        renderPlayhead();
    };

    // ==================================================================
    // Event wiring
    // ==================================================================
    const wireRowEvents = () => {
        // The header opens the channel. Timeline interactions never change views.
        rows.querySelectorAll('.arr-chan').forEach(header => {
            const row = header.closest('.arr-row');
            const activate = () => {
                if (row.dataset.slot !== undefined) openChannelDialog({ slot: Number(row.dataset.slot) });
                else onOpenChannel?.(Number(row.dataset.channel));
            };
            header.addEventListener('click', activate);
            header.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                e.stopPropagation();
                activate();
            });
            header.addEventListener('contextmenu', (e) => {
                if (row.dataset.channel === undefined) return;
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
                    toggleMuteChannel(ch, null);
                    markDirty();
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
                    if (c.created === false) return;
                    c.muted = targetState;    // копируем состояние этой точки на все
                    applyChannel(c.channel);
                });
                markDirty();
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
                markDirty();
            }
        } else {
            const bar = Math.max(0, Math.floor((e.clientX - grid.getBoundingClientRect().left) / paint.barWidth));
            if (bar === paint.lastBar || bar >= paint.bars) return;
            const pat = getChannelPattern?.(paint.channel) ?? s.ensureChannelPattern(paint.channel);
            const start = bar * tpb();
            if (!clipsAt(paint.channel, start, pat.lengthTicks)) {
                s.placePattern(pat.id, start);
                markDirty();
            }
            paint.lastBar = bar;
        }
    };

    rows.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.button !== 2) return;
        const grid = e.target.closest('.arr-clips[data-channel]');
        const s = getSeq();
        if (!grid || !s) return;
        e.preventDefault();
        const clip = e.target.closest('.arr-clip');
        const channel = Number(grid.dataset.channel);
        if (clip && e.button === 0) {
            const placement = s.arrangement.find(p => p.id === clip.dataset.placement);
            if (!placement) return;
            state.selectedPlacement = placement.id;
            onSelectPattern?.(channel, placement.patternId);
            rows.querySelector('.arr-clip.selected')?.classList.remove('selected');
            clip.classList.add('selected');
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
        if (!info) return;
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
                            ${COLORS.map((c, idx) => `<span class="arr-color ${existing?.color === c ? 'active' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}
                        </div>
                    </label>
                    <label class="arr-field">
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

        const readInstrument = mountInstrumentFields(overlay.querySelector('#dlgInstrument'), existing ?? { isDrum: slot === 9 });
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

            if (loadedSequence === s) applyChannelVolume(chObj);
            overlay.remove();
            markDirty();
        });
    };

    const openChannelContextMenu = (ch) => {
        closeAllOverlays();
        const s = getSeq();
        const info = s.channels.find(c => c.channel === ch);
        if (!info) return;

        const overlay = document.createElement('div');
        overlay.className = 'arr-dialog-overlay';
        overlay.innerHTML = `
            <div class="arr-dialog-box arr-context-menu">
                <div class="arr-dialog-title">${escapeHtml(info.name || ('Ch ' + (ch + 1)))}</div>
                <button class="arr-menu-item" data-act="edit">Edit channel…</button>
                <button class="arr-menu-item" data-act="up">Move up</button>
                <button class="arr-menu-item" data-act="down">Move down</button>
                <div class="arr-menu-sep"></div>
                <button class="arr-menu-item danger" data-act="delete">Delete channel</button>
                <button class="arr-menu-item" data-act="cancel">Cancel</button>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        overlay.querySelectorAll('.arr-menu-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const act = btn.dataset.act;
                overlay.remove();
                if (act === 'edit') {
                    openChannelDialog({ slot: ch, isNew: false });
                } else if (act === 'delete') {
                    if (!confirm(`Delete "${info.name}"?`)) return;
                    // Remove channel from list
                    s.channels = s.channels.filter(c => c.channel !== ch);
                    // Remove all patterns on this channel
                    s.patterns = s.patterns.filter(p => p.channel !== ch);
                    // Remove all placements of those patterns
                    const alivePatIds = new Set(s.patterns.map(p => p.id));
                    s.arrangement = s.arrangement.filter(pl => alivePatIds.has(pl.patternId));
                    markDirty();
                } else if (act === 'up' || act === 'down') {
                    const channels = s.channels.filter(c => c.created !== false);
                    const sorted = [...channels].sort((a, b) => a.channel - b.channel);
                    const idx = sorted.findIndex(c => c.channel === ch);
                    const swapIdx = act === 'up' ? idx - 1 : idx + 1;
                    if (swapIdx < 0 || swapIdx >= sorted.length) return;
                    s.swapChannels(sorted[idx].channel, sorted[swapIdx].channel);
                    markDirty();
                }
            });
        });
    };

    const onWindowPointerMove = (e) => {
        if (state.paint?.pointerId === e.pointerId) paintGrid(e);
        const d = state.dragClip;
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
                state.loopStartTick = Math.max(0, Math.min(tick, effectiveLoopEnd() - tpb()));
            } else {
                state.loopEndTick = Math.max(tick, state.loopStartTick + tpb());
            }
            markDirty();
        }
    };

    const onWindowPointerUp = (e) => {
        if (state.dragMode === 'seek') {
            if (e.pointerId !== state.seekPointer) return;
            state.dragMode = null;
            state.seekPointer = null;
            if (e.type !== 'pointercancel') seekTo(e.clientX - ruler.getBoundingClientRect().left);
            return;
        }
        if (state.paint?.pointerId === e.pointerId) {
            const previousWidth = state.paint.barWidth;
            state.paint = null;
            if (Math.abs(barW() - previousWidth) > 0.01) markDirty();
        }
        const d = state.dragClip;
        if (d && d.pointerId !== e.pointerId) return;
        if (d) {
            const pattern = d.sequence.getPattern(d.placement.patternId);
            if (e.type !== 'pointercancel' && d.moved && pattern && d.sequence === getSeq() &&
                !clipsAt(d.channel, d.nextTick, pattern.lengthTicks, d.placement)) {
                d.placement.startTick = d.nextTick;
            }
            d.el.classList.remove('dragging');
            if (d.moved) markDirty();
        }
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
        state.cursorTick = Math.max(0, Math.min(arrangementDurationTick() || (totalBars() * tpb()), Math.round(tick)));
        if (commit && !loading && seq && !seq.paused && !seq.isFinished) {
            seekingUntil = performance.now() + 100;
            seq.currentTime = Math.min(seq.duration, song.ticksToSeconds(state.cursorTick));
        }
        if (reveal) {
            const x = tickToX(state.cursorTick);
            if (x < body.scrollLeft + CHAN_W || x > body.scrollLeft + body.clientWidth) {
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
        if (e.button === 2) {
            e.preventDefault();
            const bar = xToBar(x);
            state.loopStartTick = bar * tpb();
            state.loopEndTick   = state.loopStartTick + tpb();
            state.loopEnabled   = true;
            loopBtn.classList.add('active');
            loopBtn.setAttribute('aria-pressed', 'true');
            const seq = getSequencer?.();
            if (seq) seq.loopCount = Infinity;
            markDirty();
            return;
        }
        if (e.button !== 0) return;
        state.dragMode = 'seek';
        state.seekPointer = e.pointerId;
        seekTick(xToTick(x), false, false);
        e.preventDefault();
    };

    ruler.addEventListener('pointerdown', onRulerDown);
    ruler.addEventListener('contextmenu', (e) => e.preventDefault());

    [['#arrLoopStart', 'loop-start'], ['#arrLoopEnd', 'loop-end']].forEach(([sel, mode]) => {
        const el = $(sel);
        el.addEventListener('pointerdown', (e) => {
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
        if (!seq) return;
        const loaded = loadedSequence === getSeq() && !seq.isFinished;
        playBtn.classList.toggle('active', loaded && !seq.paused);
        pauseBtn.classList.toggle('active', loaded && pausedByUser && seq.paused);
        playBtn.disabled = loading || !getSeq()?.arrangement.length || (loaded && !seq.paused);
        pauseBtn.disabled = !loaded || seq.paused;
    };

    const play = async () => {
        const seq = getSequencer?.();
        const s   = getSeq();
        if (!seq || !s?.arrangement.length || loading || rootEl.inert) return;
        const resume = loadedSequence === s && pausedByUser && !seq.isFinished;
        const request = ++playbackRequest;
        loading = true;
        updateTransportUI();
        const current = () => request === playbackRequest && state.visible && !rootEl.inert && s === getSeq();
        const end = Math.max(effectiveLoopEnd(), state.loopStartTick + tpb());
        const loop = { start: state.loopStartTick, end };
        try {
            await resumeAudio();
            if (!current()) return;
            if (!resume) {
                const midi = writeArrangementMIDI(s, { loop, respectMute: true });
                if (!await loadSong(midi, 'arrangement', seq, current)) return;
                loadedSequence = s;
            }
            pausedByUser = false;
            seq.loopCount = state.loopEnabled ? Infinity : 0;
            // Time is set after loading, even when the ruler was clicked before the first Play.
            if (s.ticksToSeconds(state.cursorTick) >= seq.duration) state.cursorTick = 0;
            const position = Math.min(seq.duration, s.ticksToSeconds(state.cursorTick));
            if (position > 0 || resume) seq.currentTime = position;
            seekingUntil = performance.now() + 100;
            seq.play();
        } catch (err) {
            if (current()) { setStatus(err.message); log(`Arranger play: ${err}`, 'error'); }
        } finally {
            if (request === playbackRequest) loading = false;
            updateTransportUI();
        }
    };

    const pause = () => {
        renderPlayhead();
        pausedByUser = true;
        getSequencer()?.pause();
        updateTransportUI();
    };

    const stop = () => {
        playbackRequest++;
        loading = pausedByUser = lastFramePlaying = false;
        state.cursorTick = 0;
        const seq = getSequencer?.();
        if (!seq) return;
        try { seq.pause(); seq.currentTime = 0; } catch {}
        updateTransportUI();
    };

    playBtn?.addEventListener('click', play);
    pauseBtn?.addEventListener('click', pause);
    $('#arrStop')?.addEventListener('click', stop);
    $('#arrHome')?.addEventListener('click', () => seekTick(0, true));
    $('#arrEnd')?.addEventListener('click', () => seekTick(arrangementDurationTick(), true));
    loopBtn?.addEventListener('click', () => {
        state.loopEnabled = !state.loopEnabled;
        loopBtn.classList.toggle('active', state.loopEnabled);
        loopBtn.setAttribute('aria-pressed', String(state.loopEnabled));
        const seq = getSequencer?.();
        if (seq) seq.loopCount = state.loopEnabled ? Infinity : 0;
        markDirty();
    });
    bindMasterVolume($('#arrMasterVol'));

    // ==================================================================
    // Keyboard
    // ==================================================================
    document.addEventListener('keydown', (e) => {
        if (!state.visible || rootEl.inert || document.querySelector('.arr-dialog-overlay, .pr-picker-overlay:not(.hidden)')) return;
        const active = document.activeElement;
        if (active && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(active.tagName)) return;

        if (e.key === ' ') {
            e.preventDefault();
            const seq = getSequencer?.();
            if (!seq) return;
            if (loadedSequence === getSeq() && !seq.paused && !seq.isFinished) pause();
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
        play, pause, stop,
        reset() {
            loadedSequence = null;
            state.loopStartTick = state.loopEndTick = state.cursorTick = 0;
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
            cancelAnimationFrame(rafId);
            ro.disconnect();
            window.removeEventListener('pointermove', onWindowPointerMove);
            window.removeEventListener('pointerup', onWindowPointerUp);
            window.removeEventListener('pointercancel', onWindowPointerUp);
            if (muteTimer) clearTimeout(muteTimer);
        },
    };
}