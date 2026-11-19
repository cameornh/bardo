import {NativeDensity} from '../../../sand-lab/native-density.js';
import {surfaceConstraints} from '../surface-constraints.js';
let module;
export async function setContactKernel(bytes){const candidate=await WebAssembly.compile(bytes);const names=new Set(WebAssembly.Module.exports(candidate).map(e=>e.name));for(const name of ['boundaryBatch','contactBatch','activePairs','activeDensity','correction','memory'])if(!names.has(name))throw Error('Incomplete contact kernel');module=candidate;}
export const contactKernelReady=typeof window==='undefined'?Promise.resolve(false):fetch(new URL('./density.wasm',import.meta.url)).then(r=>{if(!r.ok)throw Error(r.status);return r.arrayBuffer();}).then(setContactKernel).then(()=>true).catch(()=>false);
export function installContactBatch(lab){
 if(!lab.bulkFields)return;lab.optimizations.contactHeightReuse??=true;
 lab.bulkFields.surfaceConstraints=(...args)=>surfaceConstraints(...args,{kernelOverride:module&&lab.optimizations.contactHeightReuse!==false&&!lab.optimizations.simdParticles?(lab.reusedContactKernel??=new NativeDensity(module)):null});
}
