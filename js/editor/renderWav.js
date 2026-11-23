import { WorkletSynthesizer, BasicMIDI } from '../../main.min.js';
import { exportSoundBanks,getSynth,getMasterVolume } from '../core/synth.js';
import { writeArrangementMIDI } from './exportMidi.js';
import { encodeWav } from '../core/wav.js';

export async function renderProjectWav(sequence,{sampleRate=44100,tail=8,signal,onStatus=()=>{}}={}) {
    const check=()=>{if(signal?.aborted)throw new DOMException('Export cancelled','AbortError');};
    check();onStatus('Preparing SoundFont and chiptune voices…');
    const banks=await exportSoundBanks(sequence);check();
    const midi=BasicMIDI.fromArrayBuffer(writeArrangementMIDI(sequence,{liveMix:true}),'WAV render');
    const end=sequence.arrangement.reduce((t,clip)=>Math.max(t,clip.startTick+Math.max(sequence.getPattern(clip.patternId)?.lengthTicks??0,...(sequence.getPattern(clip.patternId)?.notes??[]).map(n=>n.tick+n.dur))),0);
    if(!end)throw new Error('No placed patterns to export. Draw the patterns in the arranger first.');
    const seconds=sequence.ticksToSeconds(end)+tail;
    if(seconds>300)throw new Error('This first WAV exporter supports up to 5 minutes including the effects tail.');
    const snapshot=await getSynth().getSnapshot();check();
    // Use the live mix's linear gains, not a second quadratic MIDI volume scaling.
    const count=Math.max(16,16+Math.max(0,...midi.portChannelOffsetMap.filter(Number.isFinite)));
    const template=snapshot.midiChannels[0];
    snapshot.midiChannels=Array.from({length:count},(_,i)=>{
        const ch=structuredClone(template);ch.channel=i;ch.midiParameters.rxChannel=i;
        ch.systemParameters={...ch.systemParameters,gain:1,pan:0,isMuted:false,presetLock:false};
        ch.lockedControllers=Array(128).fill(false);
        for(const key of Object.keys(ch.lockedMIDIParameters))ch.lockedMIDIParameters[key]=false;
        return ch;
    });
    for(const info of sequence.channels){
        const offset=midi.portChannelOffsetMap[Math.floor(info.channel/16)];
        if(offset===undefined)continue;
        const index=offset+info.channel%16;
        const ch=snapshot.midiChannels[index];if(!ch)continue;
        ch.systemParameters.gain=(info.volume??100)/100;ch.systemParameters.isMuted=!!info.muted||info.kind==='comment';
        ch.systemParameters.pan=Math.max(-1,Math.min(1,((info.pan??64)-64)/((info.pan??64)>64?63:64)));
    }
    const context=new OfflineAudioContext(2,Math.ceil(seconds*sampleRate),sampleRate);
    let synth;
    try {
        await context.audioWorklet.addModule(new URL('../../spessasynth_processor.min.js',import.meta.url));check();
        synth=new WorkletSynthesizer(context,{eventsEnabled:true,convolverMode:false});
        // Offline setup is sent before rendering: do not await isReady (no audio ticks yet).
        const gain=context.createGain();gain.gain.value=getMasterVolume();synth.connect(gain);gain.connect(context.destination);
        const configured=synth.startOfflineRender({midiSequence:midi,snapshot,loopCount:0,soundBankList:banks,sequencerOptions:{skipToFirstNoteOn:false}});
        onStatus(`Rendering stereo audio · ${seconds.toFixed(1)} seconds…`);
        const suspended=context.suspend(0);
        const rendering=context.startRendering();
        await suspended;
        await synth.isReady;
        await configured;check();
        await context.resume();
        const audio=await rendering;
        check();onStatus('Encoding 16-bit WAV…');
        return {...encodeWav([audio.getChannelData(0),audio.getChannelData(1)],sampleRate),seconds};
    }finally{
        if(context.state==='suspended')await context.resume().catch(()=>{});
        synth?.destroy();
    }
}
