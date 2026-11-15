// js/ui/arrangerView.js
import { log } from '../core/log.js';
import { getSequencer, getSynth, resumeAudio, setMasterVolume, loadSong } from '../core/synth.js';
import { writeArrangementMIDI } from '../editor/exportMidi.js';

const CHAN_W     = 160;
const RULER_H    = 24;
const LOOP_H     = 16;
const ROW_H      = 32;
const MIN_BAR_W  = 80;
const MAX_CHANNELS = 16;

const COLORS = [
    '#4ec9b0','#dcdcaa','#c586c0','#ce9178','#569cd6','#888888',
    '#e35b5b','#6bb0ff','#4ec9ff','#ffcc00','#ff6bcb','#6bffb2',
];

const INSTRUMENTS = [
    { name: 'Piano',      program: 0,   isDrum: false },
    { name: 'Bass',       program: 33,  isDrum: false },
    { name: 'Strings',    program: 48,  isDrum: false },
    { name: 'Brass',      program: 61,  isDrum: false },
    { name: 'FX',         program: 120, isDrum: false },
    { name: 'Drums',      program: 0,   isDrum: true  },
    { name: 'Organ',      program: 19,  isDrum: false },
    { name: 'Guitar',     program: 25,  isDrum: false },
    { name: 'Flute',      program: 73,  isDrum: false },
    { name: 'Trumpet',    program: 56,  isDrum: false },
];

export function mountArranger(rootEl, { getSequence, onOpenPattern } = {}) {
    if (!rootEl) return null;

    rootEl.innerHTML = `
        <div class="arr-shell">
            <div class="arr-toolbar">
                <button id="arrHome"  class="pr-t-btn" type="button" title="To start">|◄</button>
                <button id="arrPlay"  class="pr-t-btn" type="button" title="Play">▶</button>
                <button id="arrPause" class="pr-t-btn" type="button" title="Pause">❚❚</button>
                <button id="arrStop"  class="pr-t-btn" type="button" title="Stop">■</button>
                <button id="arrEnd"   class="pr-t-btn" type="button" title="To end">►|</button>
                <span class="pr-sep"></span>
                <span id="arrTime" class="arr-time">0:00.0 / 0:00.0</span>
                <span class="pr-sep"></span>
                <button id="arrLoopBtn" class="pr-t-btn active" type="button">Loop ⭮</button>
                <span class="pr-sep"></span>
                <label class="pr-num" title="Master volume">
                    <span>Vol</span>
                    <input id="arrMasterVol" type="range" min="0" max="100" value="100" style="width:100px">
                </label>
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
        </div>
    `;

    const $ = (s) => rootEl.querySelector(s);
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
        drawStart: null,
        drawEnd: null,
        visible: true,
    };

    let rafId = 0;
    let dirty = true;
    let muteTimer = null;

    const markDirty = () => { dirty = true; };
    const getSeq     = () => (typeof getSequence === 'function' ? getSequence() : null);
    const timeDiv    = () => getSeq()?.timeDivision || 480;
    const tpb        = () => timeDiv() * 4;
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
    const availW     = () => content.clientWidth - CHAN_W;
    const barW       = () => Math.max(MIN_BAR_W, availW() / totalBars());
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

    const getOrCreatePatternForChannel = (seq, ch) => {
        let pat = seq.patterns?.find(p => p.channel === ch);
        if (!pat) {
            pat = seq.addPattern({
                name: `Pattern ${(seq.patterns?.length || 0) + 1}`,
                lengthTicks: tpb() * 4,
                channel: ch,
            });
        }
        return pat;
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

        content.style.setProperty('--bar-w', bw + 'px');
    };

    const renderRows = () => {
        const s = getSeq();
        if (!s) { rows.innerHTML = ''; return; }
        const channels = s.channels || [];
        let html = '';

        for (let i = 0; i < MAX_CHANNELS; i++) {
            const ch = channels.find(c => c.channel === i);
            const created = !!ch && ch.created !== false;
            const color = chanColor(i);
            const muted = !!ch?.muted;

            if (!created) {
                // Empty slot
                html += `<div class="arr-row arr-row-empty" data-slot="${i}">`;
                html += `  <div class="arr-chan" style="width:${CHAN_W}px">`;
                html += `    <span class="arr-radio"></span>`;
                html += `    <span class="arr-chan-name muted">— empty —</span>`;
                html += `  </div>`;
                html += `  <div class="arr-clips" style="--bar-w:${barW()}px"></div>`;
                html += `</div>`;
                continue;
            }

            // Filled channel row
            const pats = (s.patterns || []).filter(p => p.channel === i);
            const firstPat = pats[0];
            const placements = (s.arrangement || []).filter(pl => {
                const pat = s.patterns?.find(p => p.id === pl.patternId);
                return pat?.channel === i;
            });

            html += `<div class="arr-row" data-channel="${i}">`;
            html += `  <div class="arr-chan" data-channel="${i}" style="width:${CHAN_W}px">`;
            html += `    <span class="arr-dot" data-channel="${i}"
                            style="background:${muted ? 'transparent' : '#1a7f37'};
                                   border-color:${muted ? '#666' : '#1a7f37'};"></span>`;
            html += `    <div class="arr-chan-info">`;
            html += `      <div class="arr-chan-name">${ch.name || ('Ch ' + (i + 1))}</div>`;
            if (firstPat) html += `      <div class="arr-chan-pat">${firstPat.name}</div>`;
            html += `    </div>`;
            html += `    <span class="arr-chan-bar" style="background:${color}"></span>`;
            html += `  </div>`;
            html += `  <div class="arr-clips" data-channel="${i}" style="--bar-w:${barW()}px">`;
            for (const pl of placements) {
                const pat = s.patterns.find(p => p.id === pl.patternId);
                const left = tickToX(pl.startTick) - CHAN_W;
                const right = tickToX(pl.startTick + pat.lengthTicks) - CHAN_W;
                const w = Math.max(8, right - left);
                html += `<div class="arr-clip" data-placement="${pl.id}" data-pattern="${pat.id}"
                              data-channel="${i}"
                              style="left:${left}px;width:${w}px;background:${color}"
                              title="${pat.name}"></div>`;
            }
            html += `  </div>`;
            html += `</div>`;
        }

        rows.innerHTML = html;
        wireRowEvents();
    };

    const renderPlayhead = () => {
        const seq = getSequencer?.();
        if (!seq) return;
        const total = totalBars() * tpb();
        const cur = seq.currentTime || 0;
        const dur = seq.duration || 1;
        const tick = (cur / dur) * total;
        const x = tickToX(tick);
        playhead.style.transform = `translateX(${x - 1}px)`;
        playhead.style.display = x >= CHAN_W ? 'block' : 'none';
        const fmt = (s) => {
            if (!isFinite(s)) s = 0;
            const m = Math.floor(s / 60);
            return `${m}:${Math.floor(s - m * 60).toString().padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;
        };
        timeEl.textContent = `${fmt(cur)} / ${fmt(dur)}`;
    };

    const render = () => {
        if (!dirty) return;
        dirty = false;
        renderRuler();
        renderRows();
        renderPlayhead();
    };

    // ==================================================================
    // Event wiring
    // ==================================================================
    const wireRowEvents = () => {
        // Empty slot click → channel dialog
        rootEl.querySelectorAll('.arr-row-empty').forEach(row => {
            row.addEventListener('click', () => {
                const slotIdx = Number(row.dataset.slot);
                openChannelDialog({ slot: slotIdx, isNew: true });
            });
        });

        // Click channel name → piano roll (auto-place block if none exists)
        rootEl.querySelectorAll('.arr-chan').forEach(el => {
            const ch = Number(el.dataset.channel);
            if (isNaN(ch)) return;
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const s = getSeq();
                if (!s) return;
                const pat = getOrCreatePatternForChannel(s, ch);
                // Если плейсментов для этого паттерна нет — ставим один на bar 0
                const hasPlacement = s.arrangement?.some(pl => pl.patternId === pat.id);
                if (!hasPlacement) s.placePattern(pat.id, 0);
                markDirty();
                onOpenPattern?.(pat.id);
            });
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openChannelContextMenu(ch);
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

        // Clip events
        rootEl.querySelectorAll('.arr-clip').forEach(clip => {
            const plId = clip.dataset.placement;
            clip.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                e.preventDefault();
                const rect = clip.parentElement.getBoundingClientRect();
                state.dragMode = 'move-clip';
                state.dragClip = {
                    plId,
                    origLeft: parseInt(clip.style.left, 10) || 0,
                    startClientX: e.clientX,
                    el: clip,
                };
                clip.classList.add('dragging');
            });
            clip.addEventListener('click', (e) => {
                if (state.dragClip?.moved) return;  // don't open after drag
                e.stopPropagation();
                const pid = clip.dataset.pattern;
                onOpenPattern?.(pid);
            });
            clip.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const s = getSeq();
                if (!s) return;
                s.arrangement = s.arrangement.filter(x => x.id !== plId);
                markDirty();
            });
        });

        // Empty grid → клик ставит блок (плейсмент) с паттерном канала
        rootEl.querySelectorAll('.arr-clips').forEach(grid => {
            const ch = Number(grid.dataset.channel);
            if (isNaN(ch)) return;
            grid.addEventListener('click', (e) => {
                if (e.button !== 0) return;
                if (e.target !== grid) return;
                e.preventDefault();
                const s = getSeq();
                if (!s) return;
                const rect = grid.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const bar = Math.max(0, Math.floor(x / barW()));
                const pat = getOrCreatePatternForChannel(s, ch);
                s.placePattern(pat.id, bar * tpb());
                markDirty();
            });
            grid.addEventListener('contextmenu', (e) => {
                // ПКМ по пустому — намеренно ничего не делаем
                // (удаление — только по самому блоку)
                if (e.target === grid) e.preventDefault();
            });
        });
    };

    // ==================================================================
    // Mute
    // ==================================================================
    const applyChannel = (ch) => {
        const s = getSeq();
        const info = s?.channels?.find(c => c.channel === ch);
        if (!info) return;
        const synth = getSynth?.();
        if (!synth) return;
        const vol = info.muted ? 0 : (info.volume ?? 100);
        try { synth.controllerChange(ch, 7, Math.round(vol * 127 / 100)); } catch {}
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
                        <input id="dlgName" type="text" value="${existing?.name || ('Ch ' + (slot + 1))}">
                    </label>
                    <label class="arr-field">
                        <span>Instrument</span>
                        <select id="dlgInst">
                            ${INSTRUMENTS.map((i, idx) => {
                                const sel = (existing?.program === i.program && !!existing?.isDrum === i.isDrum) ? 'selected' : '';
                                return `<option value="${idx}" ${sel}>${i.name}</option>`;
                            }).join('')}
                        </select>
                    </label>
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
            const inst = INSTRUMENTS[Number(overlay.querySelector('#dlgInst').value)];
            const vol = Number(volInput.value);
            let chObj = s.channels.find(c => c.channel === slot);
            if (!chObj) {
                chObj = { channel: slot };
                s.channels.push(chObj);
            }
            chObj.name = name;
            chObj.program = inst.program;
            chObj.isDrum = inst.isDrum;
            chObj.color = chosenColor;
            chObj.volume = vol;
            chObj.pan = chObj.pan ?? 64;
            chObj.muted = chObj.muted ?? false;
            chObj.created = true;

            const synth = getSynth?.();
            if (synth) {
                try {
                    if (!inst.isDrum) synth.programChange(slot, inst.program);
                    synth.controllerChange(slot, 7, Math.round(vol * 127 / 100));
                } catch {}
            }
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
                <div class="arr-dialog-title">${info.name || ('Ch ' + (ch + 1))}</div>
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
                    // Swap channel numbers
                    const a = sorted[idx], b = sorted[swapIdx];
                    const tmpCh = a.channel;
                    a.channel = b.channel;
                    b.channel = tmpCh;
                    // Swap patterns' channel field
                    s.patterns.forEach(p => {
                        if (p.channel === tmpCh) p.channel = a.channel;
                        else if (p.channel === a.channel) p.channel = tmpCh;
                    });
                    markDirty();
                }
            });
        });
    };

    const openClipContextMenu = (plId) => {
        closeAllOverlays();
        const s = getSeq();
        const pl = s.arrangement.find(x => x.id === plId);
        const pat = pl && s.patterns.find(p => p.id === pl.patternId);
        if (!pl || !pat) return;

        const overlay = document.createElement('div');
        overlay.className = 'arr-dialog-overlay';
        overlay.innerHTML = `
            <div class="arr-dialog-box arr-context-menu">
                <div class="arr-dialog-title">${pat.name}</div>
                <button class="arr-menu-item" data-act="open">Open in Piano Roll</button>
                <button class="arr-menu-item" data-act="delete">Delete</button>
                <div class="arr-menu-sep"></div>
                <button class="arr-menu-item" data-act="cancel">Cancel</button>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        overlay.querySelectorAll('.arr-menu-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const act = btn.dataset.act;
                overlay.remove();
                if (act === 'open') onOpenPattern?.(pat.id);
                else if (act === 'delete') {
                    s.arrangement = s.arrangement.filter(x => x.id !== plId);
                    markDirty();
                }
            });
        });
    };

    // ==================================================================
    // Drag handlers (grid: draw clip; clip: move)
    // ==================================================================
    const onWindowPointerMove = (e) => {
        if (state.dragMode === 'move-clip' && state.dragClip) {
            const d = state.dragClip;
            const dx = e.clientX - d.startClientX;
            const newLeft = d.origLeft + dx;
            d.el.style.left = newLeft + 'px';
            d.moved = Math.abs(dx) > 3;
        }
        if (state.dragMode === 'seek') {
            const rect = ruler.getBoundingClientRect();
            seekTo(e.clientX - rect.left);
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
        if (state.dragMode === 'move-clip' && state.dragClip) {
            const d = state.dragClip;
            if (d.moved) {
                const newLeft = parseInt(d.el.style.left, 10) || 0;
                const newBar = Math.max(0, Math.round(newLeft / barW()));
                const pl = getSeq()?.arrangement.find(x => x.id === d.plId);
                if (pl) pl.startTick = newBar * tpb();
                markDirty();
            }
            d.el.classList.remove('dragging');
        }
        state.dragMode = null;
        state.dragClip = null;
    };

    // ==================================================================
    // Ruler / loop
    // ==================================================================
    const seekTo = (x) => {
        const seq = getSequencer?.();
        if (!seq) return;
        const tick = xToTick(x);
        const total = totalBars() * tpb();
        if (total <= 0) return;
        try { seq.currentTime = (tick / total) * seq.duration; } catch {}
        renderPlayhead();
    };

    const onRulerDown = (e) => {
        const rect = ruler.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < CHAN_W) return;
        if (e.button === 2) {
            e.preventDefault();
            const bar = xToBar(x);
            state.loopStartTick = bar * tpb();
            state.loopEndTick   = state.loopStartTick + tpb();
            state.loopEnabled   = true;
            loopBtn.classList.add('active');
            const seq = getSequencer?.();
            if (seq) seq.loopCount = Infinity;
            markDirty();
            return;
        }
        state.dragMode = 'seek';
        seekTo(x);
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
        const playing = !seq.paused && !seq.isFinished;
        playBtn.classList.toggle('active', playing);
        pauseBtn.classList.toggle('active', seq.paused && !seq.isFinished);
    };

    const play = async () => {
        const seq = getSequencer?.();
        const s   = getSeq();
        if (!seq || !s) return;
        if (!s.arrangement?.length) return;

        await resumeAudio();
        try {
            const midi = writeArrangementMIDI(s);
            await loadSong(midi, 'arrangement');
        } catch (err) {
            log(`Arranger: load failed: ${err}`, 'error');
            return;
        }
        seq.loopCount = 0;   // manual loop handled in tick()
        seq.play();
        updateTransportUI();
    };

    const pause = () => { try { getSequencer?.()?.pause(); } catch {} updateTransportUI(); };

    const stop = () => {
        const seq = getSequencer?.();
        if (!seq) return;
        try { seq.pause(); seq.currentTime = 0; } catch {}
        updateTransportUI();
    };

    playBtn?.addEventListener('click', play);
    pauseBtn?.addEventListener('click', pause);
    $('#arrStop')?.addEventListener('click', stop);
    $('#arrHome')?.addEventListener('click', () => { const s = getSequencer?.(); if (s) try { s.currentTime = 0; } catch {} renderPlayhead(); });
    $('#arrEnd')?.addEventListener('click', () => { const s = getSequencer?.(); if (s) try { s.currentTime = s.duration; } catch {} renderPlayhead(); });
    loopBtn?.addEventListener('click', () => {
        state.loopEnabled = !state.loopEnabled;
        loopBtn.classList.toggle('active', state.loopEnabled);
        const seq = getSequencer?.();
        if (seq) seq.loopCount = state.loopEnabled ? Infinity : 0;
        markDirty();
    });
    $('#arrMasterVol')?.addEventListener('input', (e) => setMasterVolume(Number(e.target.value) / 100));

    // ==================================================================
    // Keyboard
    // ==================================================================
    document.addEventListener('keydown', (e) => {
        if (rootEl.style.display === 'none') return;
        const active = document.activeElement;
        if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;

        if (e.key === ' ') {
            e.preventDefault();
            const seq = getSequencer?.();
            if (!seq) return;
            if (!seq.paused && !seq.isFinished) pause();
            else play();
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            const s = getSequencer?.();
            if (s) { try { s.currentTime = Math.max(0, s.currentTime - (s.duration / totalBars())); } catch {} }
            renderPlayhead();
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            const s = getSequencer?.();
            if (s) { try { s.currentTime = Math.min(s.duration, s.currentTime + (s.duration / totalBars())); } catch {} }
            renderPlayhead();
        }
    });

    // ==================================================================
    // rAF + Resize
    // ==================================================================
    const checkPlaybackBounds = () => {
        const seq = getSequencer?.();
        if (!seq || seq.paused || seq.isFinished) return;
        const totalTick = arrangementDurationTick();
        if (totalTick <= 0) return;
        const curTick = (seq.currentTime / seq.duration) * totalTick;

        if (state.loopEnabled) {
            const endTick = effectiveLoopEnd();
            if (endTick > state.loopStartTick && curTick >= endTick) {
                const newTime = (state.loopStartTick / totalTick) * seq.duration;
                try { seq.currentTime = newTime; } catch {}
            }
        } else if (curTick >= totalTick - 1) {
            // Дошли до конца — стоп
            try { seq.pause(); seq.currentTime = seq.duration; } catch {}
            updateTransportUI();
        }
    };

    const tick = () => {
        render();
        renderPlayhead();
        updateTransportUI();
        checkPlaybackBounds();
        rafId = requestAnimationFrame(tick);
    };

    const ro = new ResizeObserver(() => { markDirty(); });
    ro.observe(content);

    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);

    // Init
    requestAnimationFrame(() => { markDirty(); tick(); });

    return {
        root: rootEl,
        refresh: () => { markDirty(); },
        play, pause, stop,
        setVisible: (v) => { state.visible = v; },
        destroy() {
            cancelAnimationFrame(rafId);
            ro.disconnect();
            window.removeEventListener('pointermove', onWindowPointerMove);
            window.removeEventListener('pointerup', onWindowPointerUp);
            if (muteTimer) clearTimeout(muteTimer);
        },
    };
}