import {ActiveList,compactReference} from '../.native/generated/particle-compaction.mjs';
const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('No adapter; no workload submitted');
const device=await adapter.requestDevice(),report={adapter:adapter.info.description,cases:[],pass:false};
let failure;device.lost.then(x=>{failure=x.message;});device.addEventListener('uncapturederror',e=>{failure=e.error.message;});
const renderer={device,commands:[],createBuffer:d=>device.createBuffer(d),destroyResource:b=>b.destroy()};
async function bounded(p){let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Diagnostic GPU wait exceeded 2 seconds')),2000))]);}finally{clearTimeout(timer);}}
await Deno.mkdir('.native/particle-compaction',{recursive:true});
try{
 for(const kind of ['sea','grain','fine']){
  const list=new ActiveList(renderer,kind,65536);await list.prepare();
  for(const [count,pattern] of [[0,'none'],[1,'all'],[257,'sparse'],[1027,'sparse'],[65536,'none'],[65536,'all'],[65535,'sparse']]){
   const width=256,height=256,a=new Float32Array(width*height*4),v=a.slice();
   if(kind==='fine')a.fill(-1);
   for(let i=0;i<count;i++){const keep=pattern==='all'||pattern==='sparse'&&(i%7===0||i===count-1),o=(kind==='sea'?i>>1:i)*4;
    if(kind==='sea')a[o+(i&1)]=keep?.4:.01;
    else if(kind==='grain'){a[o+3]=keep?.5:i%2?2:0;v[o+3]=1;}
    else a[o+3]=keep?.8:-1;
   }
   const textures=[a,v].map(data=>{const texture=device.createTexture({size:[width,height],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});device.queue.writeTexture({texture},data,{bytesPerRow:width*16},[width,height]);return {texture,view:texture.createView(),width};});
   list.enqueue(textures[0],textures[1],count);
   const staging=device.createBuffer({size:20+count*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();
   for(const c of renderer.commands.splice(0))c.encode(encoder);
   encoder.copyBufferToBuffer(list.indirect,0,staging,0,20);if(count)encoder.copyBufferToBuffer(list.ids,0,staging,20,count*4);
   device.queue.submit([encoder.finish()]);await bounded(staging.mapAsync(GPUMapMode.READ));
   const bytes=staging.getMappedRange(),args=new Uint32Array(bytes,0,5),ids=new Float32Array(bytes,20,count),reference=compactReference(kind,count,a,v);
   const pass=args[0]===6&&args[1]===reference.length&&args[2]===0&&args[3]===0&&args[4]===0&&reference.every((id,i)=>id===ids[i]);
   const row={kind,count,pattern,active:args[1],pass};report.cases.push(row);console.log(JSON.stringify(row));
   staging.unmap();staging.destroy();textures.forEach(t=>t.texture.destroy());if(!pass||failure)throw Error('Compaction mismatch '+failure);
  }
  list.dispose();
 }
 report.pass=!failure;
}finally{await Deno.writeTextFile('.native/particle-compaction/numeric.json',JSON.stringify(report,null,2));device.destroy();}
