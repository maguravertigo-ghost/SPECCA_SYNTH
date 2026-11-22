import { initSynth, getSynth, getSequencer, getPreviewSequencer, getMidiMixChannels, prepareChipBank, applyLiveMix, applyProjectEffects } from './synth.js';
import { chipPatch } from '../editor/chiptune.js';
import { EFFECTS, effectSend } from '../editor/audioEffects.js';
let slot=null, queue=Promise.resolve(), configured=null, configuredSynth=null, configuredSequence=null, configuredMIDI=null;
export async function startManualVoice(sequence, channel, key, velocity=100, isCurrent=()=>true) {
    // Serialize setup so simultaneous first keystrokes do not allocate duplicate channels.
    const setup=queue.catch(()=>{}).then(async()=>{
        await initSynth(); await prepareChipBank(sequence);
        const synth=getSynth();
        const used=[...getMidiMixChannels(getSequencer()),...getMidiMixChannels(getPreviewSequencer())].map(c=>c.index);
        if(slot===null || used.includes(slot)) slot=Math.max(16,...used.map(i=>i+1));
        while(synth.midiChannels.length<=slot) {
            await new Promise((resolve,reject)=>{
                const id=`manual-${Date.now()}-${Math.random()}`;
                const timer=setTimeout(()=>{synth.eventHandler.removeEvent('channelAdded',id);reject(new Error('Manual keyboard channel could not start'));},5000);
                synth.eventHandler.addEvent('channelAdded',id,()=>{clearTimeout(timer);synth.eventHandler.removeEvent('channelAdded',id);resolve();});
                synth.addNewChannel();
            });
        }
        const signature=JSON.stringify({slot,channel,effects:sequence.effects});
        if(configuredSynth===synth && configuredSequence===sequence && configuredMIDI===getSequencer()?.midiData && configured===signature) return {synth,index:slot};
        const patch=channel.source==='chiptune'?chipPatch(channel.channel):channel;
        synth.midiChannels[slot].setDrums(!!patch.isDrum);
        synth.controllerChange(slot,0,patch.bankMSB??0);synth.controllerChange(slot,32,patch.bankLSB??0);
        synth.programChange(slot,patch.program??0);
        synth.controllerChange(slot,7,127);synth.controllerChange(slot,11,127);synth.controllerChange(slot,10,64);
        applyLiveMix(slot,channel);
        applyProjectEffects(sequence);
        for(const [id,spec] of Object.entries(EFFECTS)) synth.controllerChange(slot,spec.cc,effectSend(channel,id));
        configuredSynth=synth;configuredSequence=sequence;configuredMIDI=getSequencer()?.midiData;configured=signature;
        return {synth,index:slot};
    });
    queue=setup;
    const {synth,index}=await setup;
    if (!isCurrent()) return ()=>{};
    synth.noteOn(index,key,velocity);
    const release=()=>synth.noteOff(index,key);
    release.panic=()=>synth.controllerChange(index,120,0);
    return release;
}

export function silenceManualVoices() {
    configured=null;
    const synth=getSynth();
    if(!synth || slot===null)return;
    const occupied=[...getMidiMixChannels(getSequencer()),...getMidiMixChannels(getPreviewSequencer())].some(c=>c.index===slot);
    if(!occupied)synth.controllerChange(slot,120,0);
}
