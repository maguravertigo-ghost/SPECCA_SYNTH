// Procedural PCM voices rendered by the existing SoundFont voice engine.
export const CHIP_PRESETS = {
    lead: { name:'Chip Lead', wave:'pulse', duty:.5, attack:.005, decay:.12, sustain:.7, release:.08 },
    narrow: { name:'Narrow Pulse', wave:'pulse', duty:.125, attack:.003, decay:.16, sustain:.55, release:.08 },
    bass: { name:'Triangle Bass', wave:'triangle', duty:.5, attack:.003, decay:.18, sustain:.8, release:.06 },
    snare: { name:'Noise Snare', wave:'noise', duty:.5, attack:.001, decay:.12, sustain:0, release:.04 },
    hat: { name:'Noise Hat', wave:'noise', duty:.5, attack:.001, decay:.035, sustain:0, release:.015 },
};
export function chipSettings(input={}) {
    const defaults={...CHIP_PRESETS.lead, noiseKeyTrack:false, transpose:0, fine:0, pitchAmount:0, pitchTime:.12, cutoff:20000, resonance:0};
    const out={...defaults,...input};
    out.noiseKeyTrack=out.noiseKeyTrack===true;
    out.wave=['pulse','triangle','noise'].includes(out.wave)?out.wave:'pulse';
    for(const [key,min,max] of [['attack',.001,4],['decay',.005,4],['sustain',0,1],['release',.005,4],['duty',.05,.95],['transpose',-36,36],['fine',-100,100],['pitchAmount',-48,48],['pitchTime',.005,2],['cutoff',40,20000],['resonance',0,18]]) {
        out[key]=Number.isFinite(out[key])?Math.max(min,Math.min(max,out[key])):defaults[key];
    }
    out.duty=Math.round(out.duty*1000)/1000;
    out.transpose=Math.round(out.transpose);
    return out;
}
export function chipPatch(channel) {
    return {bankMSB:100+Math.floor(channel/128),bankLSB:0,program:channel%128,isDrum:false};
}
const text = s => [...new TextEncoder().encode(s)];
const u16 = n => [n&255,(n>>8)&255];
const u32 = n => [...u16(n),...u16(n>>>16)];
const name = s => [...text(s).slice(0,19),...Array(Math.max(1,20-text(s).slice(0,19).length)).fill(0)];
function chunk(id,data) { return text(id).concat(u32(data.length),data,data.length%2?[0]:[]); }
const list=(id,chunks)=>chunk('LIST',text(id).concat(chunks.flat()));
const gen=(id,value)=>[...u16(id),...u16(value)];
const timecents=seconds=>Math.round(1200*Math.log2(seconds));

export function buildChipBank(channels) {
    const voices=channels.filter(c=>c.source==='chiptune'&&c.kind!=='comment');
    if(!voices.length)return null;
    const pcm=[],samples=[],sampleMap=new Map();
    const phdr=[],pbag=[],pgen=[],inst=[],ibag=[],igen=[];
    for(const [i,channel] of voices.entries()) {
        const settings=chipSettings(channel.chip),patch=chipPatch(channel.channel);
        const sampleKey=`${settings.wave}:${settings.wave==='pulse'?settings.duty:''}`;
        let sampleId=sampleMap.get(sampleKey);
        if(sampleId===undefined) {
            sampleId=samples.length;sampleMap.set(sampleKey,sampleId);
            const start=pcm.length/2, length=settings.wave==='noise'?16384:1024;
            let random=0x12345678;
            for(let j=0;j<length;j++) {
                const phase=j/length;
                random=(Math.imul(random,1664525)+1013904223)>>>0;
                const value=settings.wave==='pulse'?(phase<settings.duty?1-settings.duty:-settings.duty):settings.wave==='triangle'?1-4*Math.abs(phase-.5):(random/4294967296*2-1)*.65;
                pcm.push(...u16(Math.round(value*24000)));
            }
            samples.push({start,end:start+length,rate:settings.wave==='noise'?22050:Math.round(130.8127825*length)});
            pcm.push(...Array(92).fill(0));
        }
        phdr.push(...name(`Chip ${channel.channel+1}`),...u16(patch.program),...u16(patch.bankMSB),...u16(i),...Array(12).fill(0));
        pbag.push(...u16(i),0,0);pgen.push(...gen(41,i));
        inst.push(...name(`Voice ${i}`),...u16(i));ibag.push(...u16(igen.length/4),0,0);
        igen.push(...gen(34,timecents(settings.attack)),...gen(36,timecents(settings.decay)),
            ...gen(37,settings.sustain<=0?1440:Math.round(-200*Math.log10(settings.sustain))),
            ...gen(38,timecents(settings.release)),...gen(48,80),...gen(54,1),...gen(58,settings.wave==='noise'?(settings.noiseKeyTrack?72:60):48));
        if(settings.wave==='noise'&&!settings.noiseKeyTrack)igen.push(...gen(56,0));
        igen.push(...gen(51,settings.transpose),...gen(52,Math.round(settings.fine)),
            ...gen(8,Math.min(13500,Math.round(1200*Math.log2(settings.cutoff/8.176)))),...gen(9,Math.round(settings.resonance*10)));
        if(settings.pitchAmount) igen.push(...gen(7,Math.round(settings.pitchAmount*100)),...gen(26,timecents(.001)),
            ...gen(28,timecents(settings.pitchTime)),...gen(29,1000),...gen(30,timecents(.005)));
        igen.push(...gen(53,sampleId));
    }
    phdr.push(...name('EOP'),0,0,0,0,...u16(voices.length),...Array(12).fill(0));
    pbag.push(...u16(voices.length),0,0);pgen.push(...gen(0,0));
    inst.push(...name('EOI'),...u16(voices.length));ibag.push(...u16(igen.length/4),0,0);igen.push(...gen(0,0));
    const shdr=[];
    for(const [i,s]of samples.entries()) shdr.push(...name(`Wave ${i}`),...u32(s.start),...u32(s.end),...u32(s.start),...u32(s.end),...u32(s.rate),60,0,0,0,1,0);
    shdr.push(...name('EOS'),...Array(26).fill(0));
    const info=list('INFO',[chunk('ifil',[2,0,1,0]),chunk('isng',text('EMU8000\0')),chunk('INAM',text('SPESSA Chiptune\0'))]);
    const sdta=list('sdta',[chunk('smpl',pcm)]);
    const pdta=list('pdta',[chunk('phdr',phdr),chunk('pbag',pbag),chunk('pmod',Array(10).fill(0)),chunk('pgen',pgen),chunk('inst',inst),chunk('ibag',ibag),chunk('imod',Array(10).fill(0)),chunk('igen',igen),chunk('shdr',shdr)]);
    return new Uint8Array(chunk('RIFF',text('sfbk').concat(info,sdta,pdta))).buffer;
}
