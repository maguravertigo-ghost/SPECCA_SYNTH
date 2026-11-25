import {traceNsf} from './nsfTrace.js';
self.onmessage=event=>{
    try{const result=traceNsf(event.data.buffer,event.data.options,percent=>self.postMessage({type:'progress',percent}));self.postMessage({type:'result',result},result.dpcmAudio?[result.dpcmAudio.buffer]:[]);}
    catch(error){self.postMessage({type:'error',message:error.message||String(error)});}
};
