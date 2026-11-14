import {terrainCeilings,BOUNDS_WGSL} from '../.native/generated/empty-space.mjs';
const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('No GPU adapter');const device=await adapter.requestDevice();
let failure;device.lost.then(x=>failure=x.message);device.addEventListener('uncapturederror',e=>failure=e.error.message);
const report={backend:adapter.info.description,cases:[],pass:false};await Deno.mkdir('.native/empty-space',{recursive:true});
async function wait(p){let timer;try{return await Promise.race([p,new Promise((_,r)=>timer=setTimeout(()=>r(Error('Bounded diagnostic timeout')),3000))]);}finally{clearTimeout(timer);}}
try{
 const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:device.createShaderModule({code:BOUNDS_WGSL}),entryPoint:'main'}});
 for(const n of [2,17,31,42,128,256])for(const edited of [false,true]){
  const data=new Float32Array(n*n*4);for(let i=0;i<n*n;i++)data[i*4]=Math.sin(i*.17)*2+Math.cos(i*.057);if(edited)data[(Math.floor(n*n*.49))*4]=9;
  const input=device.createTexture({size:[n,n],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),output=device.createTexture({size:[8,8],format:'r32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC}),buffer=device.createBuffer({size:8*256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  device.queue.writeTexture({texture:input},data,{bytesPerRow:n*16},[n,n]);const enc=device.createCommandEncoder(),pass=enc.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:input.createView()},{binding:1,resource:output.createView()}]}));pass.dispatchWorkgroups(8,8);pass.end();enc.copyTextureToBuffer({texture:output},{buffer,bytesPerRow:256},[8,8]);device.queue.submit([enc.finish()]);await wait(buffer.mapAsync(GPUMapMode.READ));const a=new Float32Array(buffer.getMappedRange()),b=terrainCeilings(data,n);let max=0;for(let z=0;z<8;z++)for(let x=0;x<8;x++)max=Math.max(max,Math.abs(a[z*64+x]-b[z*8+x]));const row={n,edited,maxError:max,pass:max<1e-6&&!failure};report.cases.push(row);console.log(JSON.stringify(row));buffer.unmap();for(const v of [input,output,buffer])v.destroy();if(!row.pass)throw Error('Ceiling mismatch '+failure);
 }report.pass=true;
}finally{await Deno.writeTextFile('.native/empty-space/numeric.json',JSON.stringify(report,null,2));device.destroy();}
