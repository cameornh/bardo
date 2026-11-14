import {WaterConsumers,SeaFoamSurface,rainSurfaceHeights} from '../.native/generated/water-consumers.mjs';
const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('No GPU adapter');const device=await adapter.requestDevice();
let failure;device.lost.then(x=>failure=x.message);device.addEventListener('uncapturederror',e=>failure=e.error.message);
const renderer={device,textures:new WeakMap(),commands:[],createBuffer:d=>device.createBuffer(d),createTexture:d=>device.createTexture(d),destroyResource:r=>r.destroy()};
const report={backend:adapter.info.description,cases:[],pass:false};await Deno.mkdir('.native/water-consumers',{recursive:true});
async function wait(p){let timer;try{return await Promise.race([p,new Promise((_,r)=>timer=setTimeout(()=>r(Error('Bounded diagnostic timeout')),3000))]);}finally{clearTimeout(timer);}}
async function read(output){const size=output.width,height=output.height,row=Math.ceil(size*16/256)*256,buffer=device.createBuffer({size:row*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:output.texture},{buffer,bytesPerRow:row},[size,height]);device.queue.submit([encoder.finish()]);await wait(buffer.mapAsync(GPUMapMode.READ));const data=new Float32Array(size*height*4),source=new Float32Array(buffer.getMappedRange());for(let z=0;z<height;z++)data.set(source.subarray(z*row/4,z*row/4+size*4),z*size*4);buffer.unmap();buffer.destroy();return data;}
try{
 const gpu=await new WaterConsumers(renderer).prepare();
 for(const scenario of ['calm','wind','held','sparse','clean','bodies','shore','empty','reset','missing','partial']){
  const n=scenario==='empty'?0:1452,s=.3,lab={count:n,spacing:s,spec:{scale:10},steps:scenario==='calm'?0:8,revision:0,generation:1,sand:{revision:1},tannins:scenario==='clean'?0:1.2,balls:scenario==='bodies'?[{position:[0,.5,0],radius:.9}]:[],terrainHeight:(x,z)=>scenario==='shore'?.4+.2*z:.1};
  for(const key of ['positions','velocities','chem','surfaceMetrics'])lab[key]=new Float32Array(n*4);lab.neighborCounts=new Float32Array(n).fill(18);lab.aerationActivity=new Float32Array(n*2);
  for(let i=0;i<n;i++){const x=i%22,z=Math.floor(i/22)%22,y=Math.floor(i/484),o=i*4;lab.positions.set([-3.1+x*s,.2+y*s,-3.1+z*s,scenario==='held'&&i%5===0?1:0],o);lab.velocities.set([Math.sin(i*.17)*.4,Math.cos(i*.2)*.15,Math.cos(i*.12)*.3,0],o);lab.chem[o+1]=scenario==='clean'?0:(i%13)/13;lab.surfaceMetrics[o+3]=(i%7)/6;lab.aerationActivity[i*2]=(i%8)/9;if(scenario==='sparse'&&i%7===0)lab.neighborCounts[i]=2;}
  if(scenario==='reset'){lab.generation=3;lab.spacing=.24;lab.positions[0]=5.5;lab.positions[2]=-4.9;}
  if(scenario==='missing'){delete lab.neighborCounts;delete lab.surfaceMetrics;delete lab.aerationActivity;}
  if(scenario==='partial'){lab.neighborCounts=lab.neighborCounts.slice(0,19);lab.surfaceMetrics=lab.surfaceMetrics.slice(0,28);lab.aerationActivity=lab.aerationActivity.slice(0,12);}
  // Empty water deliberately routes to the exact reference.
  if(!n){report.cases.push({scenario,pass:!gpu.enqueue(lab,'sea'),fallback:true});continue;}
  const field={setup:()=>({dx:lab.spacing*.75}),allocateItems(){},renderGPU(){},uniforms:{uCenters:{},uChannels:{},uShapes:{}}};if(!gpu.flow(lab,field))throw Error('Flow fell back');
  if(!gpu.enqueue(lab,'sea')||!gpu.enqueue(lab,'rain'))throw Error('Unexpected safety fallback');const enc=device.createCommandEncoder();for(const cmd of renderer.commands.splice(0))cmd.encode(enc);device.queue.submit([enc.finish()]);
  const sea=new SeaFoamSurface();sea.update(lab);const rain=rainSurfaceHeights(lab,new Float32Array(128*128));
  const actual=await read(gpu.seaSurface),flow=await read(gpu.seaFlow),raindata=await read(gpu.rainSurface);let se=0,fe=0,re=0;
  for(let i=0;i<actual.length;i++){se=Math.max(se,Math.abs(actual[i]-sea.surface[i]));fe=Math.max(fe,Math.abs(flow[i]-sea.flow[i]));}for(let i=0;i<rain.length;i++)re=Math.max(re,Math.abs(raindata[i*4]-rain[i]));
  const centers=await read(gpu.flowInputs[0]),channels=await read(gpu.flowInputs[1]),shapes=await read(gpu.flowInputs[2]);let pe=0;for(let i=0;i<n;i++){const o=i*4,sigma=Math.max(.018,lab.spacing*(.65+.2*Math.min(1,Math.max(0,((lab.neighborCounts?.[i]??0)-5)/20)))*.95),expected=[...lab.positions.subarray(o,o+3),sigma,...lab.velocities.subarray(o,o+3),lab.spacing**3/((2*Math.PI)**1.5*sigma**3),0,1,0,1];for(let k=0;k<4;k++){pe=Math.max(pe,Math.abs(centers[o+k]-expected[k]),Math.abs(channels[o+k]-expected[k+4]),Math.abs(shapes[o+k]-expected[k+8]));}}
  const row={scenario,flowInputMaxError:pe,seaMaxError:se,flowMaxError:fe,rainMaxError:re,pass:pe<1e-6&&se<1e-4&&fe<1e-4&&re<2e-5&&!failure};report.cases.push(row);console.log(JSON.stringify(row));if(!row.pass)throw Error('Water surface mismatch '+failure);
 }
 gpu.dispose();report.pass=true;
}finally{await Deno.writeTextFile('.native/water-consumers/numeric.json',JSON.stringify(report,null,2));device.destroy();}
