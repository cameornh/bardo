// Optional live-only CPU arithmetic. Unsupported SIMD or missing binaries fall
// back to the existing scalar Wasm path; no GPU resources are created here.
const modules={};
export async function loadSIMDKernel(name,bytes){
 try{modules[name]=await WebAssembly.compile(bytes);return true;}
 catch{delete modules[name];return false;}
}
export const simdKernel=name=>modules[name]||null;
let ready;
// Called only by live startup. Importing old field fixtures does no new work.
export function prepareSIMDKernels(){return ready??=Promise.all([
 ['pressure',new URL('./pressure.wasm',import.meta.url)],
 ['density',new URL('./density.wasm',import.meta.url)],
].map(async([name,url])=>{try{const r=await fetch(url);return r.ok&&await loadSIMDKernel(name,await r.arrayBuffer());}catch{return false;}}));}
