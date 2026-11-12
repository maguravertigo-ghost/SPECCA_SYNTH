# Editor foundation — roadmap

## Goal
A MIDI music editor in the spirit of Music 2000 / Bosca Ceoil / Fruity Loops / eJay:
low-friction tools for composing MIDI music.

## Architecture (planned modules)

- `sequence.js`   — editable sequence model
                   Sequence { tracks[], patterns[], tempoMap, meta }
                   Bridges to spessasynth's MIDISequence for playback & export.
- `pattern.js`    — per-pattern sparse note storage
- `instruments.js`— channel/instrument mapping (patch, drum flag)
                   pulls from synth.soundBankManager.presetList
- `pianoroll.js`  — canvas piano roll (grid, zoom, drag/resize, velocity)
- `stepgrid.js`   — 16/32-step drum sequencer
- `timeline.js`   — arrangement view (place / loop patterns)
- `mixer.js`      — per-channel vol/pan/mute/solo + FX sends
                   (via synth.controllerChange)
- `toolbar.js`    — project commands, tempo, quantize, undo/redo
- `project.js`    — save/load (v1 JSON, v2 .mid export, v3 .rmi)
- `playback.js`   — editor playhead driver
                   (mode A: feed MIDISequence to Sequencer;
                    mode B: live noteOn/noteOff for editing during playback)

## Milestones

- [x] Core player (SF2 load, sequencer, transport, playlist)
- [ ] Sequence model + JSON save/load
- [ ] Piano roll (single track, single pattern)
- [ ] Step grid + drum kit
- [ ] Timeline / arrangement
- [ ] Mixer
- [ ] Export to .mid