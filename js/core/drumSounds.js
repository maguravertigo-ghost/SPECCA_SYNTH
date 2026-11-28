import {SoundBankLoader} from '../../main.min.js';
import {getInstalledSoundFont} from './synth.js';
import {sameInstrument} from '../editor/instruments.js';
import {mappedDrumSounds} from '../editor/soundFontDrums.js';
let source=null,pending=null;
export async function getDrumSounds(patch) {
    const file=getInstalledSoundFont();if(!file)return null;
    if(file!==source){source=file;pending=file.arrayBuffer().then(bytes=>SoundBankLoader.fromArrayBuffer(bytes,{sampleData:false}));}
    const bank=await pending;
    const preset=bank.presets.find(p=>sameInstrument(p,patch));
    return preset?mappedDrumSounds(preset):null;
}
