// NSF-only host for JSNES 3.0.0 CPU/APU (Apache-2.0). No PPU or game ROM execution.
import CPU from '../node_modules/jsnes/src/cpu.js';
import PAPU from '../node_modules/jsnes/src/papu/index.js';
export class NsfMachine {
    constructor(bytes,header){
        this.clock=1789772.5;this.header=header;this.retriggers=[0,0,0,0];this.dpcm=false;this.dacChanges=0;this.lastDac=null;
        const nes={opts:{sampleRate:240,emulateSound:false,onAudioSample:null},gameGenie:{enabled:false,patches:[]}};
        this.cpu=nes.cpu=new CPU(nes);
        this.cpu.mem.fill(0);this.cpu.REG_SP=0xfd;
        this.cpu.ppu={dotTarget:0,nextEventDot:Infinity,nmiOutput:false,nmiAtPoll:false,catchUp(){},runCycleExact(){this.nextEventDot=Infinity;}};
        this.apu=nes.papu=new PAPU(nes);this.cpu.papu=this.apu;
        const payload=bytes.subarray(128),banked=header.banks.some(Boolean);
        const rom=new Uint8Array(Math.ceil(((header.load&4095)+payload.length)/4096)*4096);rom.set(payload,header.load&4095);
        const mapBank=(slot,bank)=>{const data=rom.subarray(bank*4096,(bank+1)*4096);this.cpu.mem.fill(0,0x8000+slot*4096,0x9000+slot*4096);this.cpu.mem.set(data,0x8000+slot*4096);};
        nes.mmap={readsPrgFromCpuMem:()=>true,load:addr=>addr===0x4015?this.apu.readReg(addr):this.cpu.mem[addr],write:(addr,value)=>{
            if(addr>=0x4000&&addr<=0x4017){
                if(addr===0x4014||addr===0x4016)return;
                if([0x4003,0x4007,0x400b,0x400f].includes(addr))this.retriggers[(addr-0x4003)/4]++;
                if(addr===0x4015&&(value&16))this.dpcm=true;
                if(addr===0x4011&&value!==this.lastDac){if(this.lastDac!==null)this.dacChanges++;this.lastDac=value;if(this.dacChanges>16)this.dpcm=true;}
                this.apu.writeReg(addr,value);
            }else if(banked&&addr>=0x5ff8&&addr<=0x5fff)mapBank(addr-0x5ff8,value);
            else if(addr>=0x6000)this.cpu.mem[addr]=value;
        }};
        if(banked){for(let i=0;i<8;i++)mapBank(i,header.banks[i]);}
        else this.cpu.mem.set(payload,header.load);
        this.cpu._updateCartridgeLoader();
        this.apu.writeReg(0x4015,0x0f);this.apu.writeReg(0x4017,0x40);
    }
    call(address,{init=false,song=1,maxCycles=2000000}={}){
        const cpu=this.cpu,start=cpu.cycles;
        // A fake JSR return address outside the NSF memory range. RTS lands at $5000.
        cpu.REG_SP=0xfd;cpu.mem[0x1fd]=0x4f;cpu.mem[0x1fc]=0xff;cpu.REG_SP=0xfb;cpu.REG_PC=address;
        if(init){cpu.REG_ACC=song-1;cpu.REG_X=0;cpu.REG_Y=0;}
        while(cpu.REG_PC!==0x5000){if(cpu.cycles-start>maxCycles)throw new Error('NSF routine did not return within the CPU budget. This driver is not supported.');cpu.emulate();}
        this.apu.catchUp(cpu.cycles);
    }
    advance(cycle){if(cycle>this.cpu.cycles){this.cpu.cycles=Math.ceil(cycle);this.apu.catchUp(this.cpu.cycles);if(this.cpu.irqFlags&&!this.cpu.F_INTERRUPT)throw new Error('IRQ-driven NSF playback is not supported by this host.');}}
    snapshot(){
        const a=this.apu,states=[];
        for(const s of [a.square1,a.square2]){
            const mute=!s.isEnabled||!s.lengthCounter||s.progTimerMax<8||(!s.sweepMode&&s.progTimerMax+(s.progTimerMax>>s.sweepShiftAmount)>0x7ff);
            states.push({frequency:this.clock/(16*(s.progTimerMax+1)),volume:mute?0:s.masterVolume,duty:[.125,.25,.5,.75][s.dutyMode],timer:s.progTimerMax});
        }
        const t=a.triangle,n=a.noise;
        states.push({frequency:this.clock/(32*(t.progTimerMax+1)),volume:t.isEnabled&&t.lengthCounter&&t.linearCounter&&t.progTimerMax>1?15:0,timer:t.progTimerMax});
        states.push({frequency:0,volume:n.isEnabled&&n.lengthCounter?n.masterVolume:0,timer:n.progTimerMax,short:!!n.randomMode});
        return states.map((s,i)=>({...s,retrigger:this.retriggers[i]}));
    }
}
