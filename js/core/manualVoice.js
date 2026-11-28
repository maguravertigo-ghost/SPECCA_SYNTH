import { initSynth, getSynth, getAudioContext, getSequencer, getPreviewSequencer, getMidiMixChannels, prepareChipBank, applyLiveMix, applyProjectEffects, onBeforeSongLoad } from './synth.js';
import { chipPatch } from '../editor/chiptune.js';
import { EFFECTS, effectSend } from '../editor/audioEffects.js';
let slot=null, queue=Promise.resolve(), configured=null, configuredSynth=null, configuredSequence=null, configuredMIDI=null;
const protectedCCs=[7,10,11,91,93,94];
const occupied=()=>[...getMidiMixChannels(getSequencer()),...getMidiMixChannels(getPreviewSequencer())].map(c=>c.index);
const patchFor=channel=>channel.source==='chiptune'?chipPatch(channel.channel):channel;
const signatureFor=(sequence,channel)=>JSON.stringify({slot,channel,effects:sequence.effects});
function unlock(synth,index) {
    const ch=synth?.midiChannels[index];
    if(!ch)return;
    ch.setSystemParameter('presetLock',false);
    for(const cc of protectedCCs)ch.lockController(cc,false);
}
function ready(sequence,channel) {
    const synth=getSynth(), patch=patchFor(channel), actual=synth?.midiChannels[slot]?.patch;
    return synth && getAudioContext()?.state==='running' && configuredSynth===synth && configuredSequence===sequence && configuredMIDI===getSequencer()?.midiData && configured===signatureFor(sequence,channel)
        && !occupied().includes(slot) && actual && actual.program===(patch.program??0) && actual.bankMSB===(patch.bankMSB??0) && actual.bankLSB===(patch.bankLSB??0) && !!actual.isGMGSDrum===!!(patch.isGMGSDrum??patch.isDrum);
}
export function prepareManualVoice(sequence, channel) {
    if(ready(sequence,channel))return Promise.resolve({synth:getSynth(),index:slot});
    // Only initialization/reconfiguration is serialized, never ordinary note attacks.
    const setup=queue.catch(()=>{}).then(async()=>{
        if(ready(sequence,channel))return {synth:getSynth(),index:slot};
        await initSynth(); await prepareChipBank(sequence);
        const synth=getSynth(),used=occupied();
        if(slot===null || used.includes(slot)) {
            if(slot!==null)unlock(synth,slot);
            slot=Math.max(16,...used.map(i=>i+1));
        }
        while(synth.midiChannels.length<=slot) {
            await new Promise((resolve,reject)=>{
                const id=`manual-${Date.now()}-${Math.random()}`;
                const timer=setTimeout(()=>{synth.eventHandler.removeEvent('channelAdded',id);reject(new Error('Manual keyboard channel could not start'));},5000);
                synth.eventHandler.addEvent('channelAdded',id,()=>{clearTimeout(timer);synth.eventHandler.removeEvent('channelAdded',id);resolve();});
                synth.addNewChannel();
            });
        }
        const patch=patchFor(channel), ch=synth.midiChannels[slot];
        unlock(synth,slot);
        ch.setDrums(!!(patch.isGMGSDrum??patch.isDrum));
        synth.controllerChange(slot,0,patch.bankMSB??0);synth.controllerChange(slot,32,patch.bankLSB??0);
        synth.programChange(slot,patch.program??0);
        synth.controllerChange(slot,7,127);synth.controllerChange(slot,11,127);synth.controllerChange(slot,10,64);
        applyLiveMix(slot,channel);
        applyProjectEffects(sequence);
        for(const [id,spec] of Object.entries(EFFECTS)) synth.controllerChange(slot,spec.cc,effectSend(channel,id));
        // Loop/seek GS resets must not replace the independent live keyboard patch
        // with program 0 or reset its expression/sends. Unlock before a song load.
        ch.setSystemParameter('presetLock',true);
        for(const cc of protectedCCs)ch.lockController(cc,true);
        configuredSynth=synth;configuredSequence=sequence;configuredMIDI=getSequencer()?.midiData;configured=signatureFor(sequence,channel);
        return {synth,index:slot};
    });
    queue=setup;return setup;
}
function attack(synth,index,key,velocity,isCurrent) {
    if(!isCurrent())return ()=>{};
    synth.noteOn(index,key,velocity);
    const release=()=>synth.noteOff(index,key);
    release.panic=()=>synth.controllerChange(index,120,0);
    return release;
}
export function startManualVoice(sequence, channel, key, velocity=100, isCurrent=()=>true) {
    if(ready(sequence,channel))return attack(getSynth(),slot,key,velocity,isCurrent);
    return prepareManualVoice(sequence,channel).then(({synth,index})=>attack(synth,index,key,velocity,isCurrent));
}
export function silenceManualVoices() {
    configured=null;
    const synth=getSynth();
    if(!synth || slot===null)return;
    if(!occupied().includes(slot))synth.controllerChange(slot,120,0);
}
onBeforeSongLoad(()=>{
    silenceManualVoices();
    if(slot!==null)unlock(getSynth(),slot);
});
