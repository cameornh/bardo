import { emissionRay } from './photon-map.js';

export function photonInputs(scene,count){
 const width=Math.min(256,2**Math.ceil(Math.log2(Math.sqrt(count)))),height=Math.ceil(count/width);
 const origins=new Float32Array(width*height*4),directions=new Float32Array(origins.length);
 for(let i=0;i<count;i++){const ray=emissionRay(scene,i,count);origins.set([...ray.origin,ray.channel],i*4);directions.set([...ray.direction,ray.power],i*4);}
 return {origins,directions,width,height};
}

export function photonKernel(size,radius){
 const data=new Float32Array(size*3*4);
 for(let row=0;row<3;row++){
  const sigma=Math.max(.35,radius*size/(row===2?6:12)),support=Math.ceil(3*sigma);
  if(support>20)throw new Error('Photon gather exceeds the GPU kernel support.');
  for(let source=0;source<size;source++){
   let sum=0;for(let j=-support;j<=support;j++)if(source+j>=0&&source+j<size)sum+=Math.exp(-.5*(j/sigma)**2);
   data.set([sum,sigma,0,0],(source+row*size)*4);
  }
 }
 return data;
}

export function photonGPUAvailability({floatTargets,floatBlend,attachments,vertexTextures,device=''}){
 if(/swiftshader|llvmpipe|softpipe|software rasterizer/i.test(device))return 'Browser is using a software graphics device';
 if(!floatTargets)return 'Floating-point render targets unavailable';
 if(!floatBlend)return '32-bit floating-point blending unavailable';
 if(attachments<3)return 'Three simultaneous float attachments unavailable';
 if(vertexTextures<1)return 'Vertex texture sampling unavailable';
 return null;
}

export function photonLedger(losses,received,emitted){
 const ledger={emitted,absorbed:losses[0],escaped:losses[1],truncated:losses[2],interfaces:Math.round(losses[3]),tir:Math.round(received[0]),receiver:received[1],direct:received[2],caustic:received[3]};
 const accounted=ledger.absorbed+ledger.escaped+ledger.truncated+ledger.receiver;
 if(!Object.values(ledger).every(Number.isFinite)||Math.abs(accounted-emitted)>Math.max(.0001,emitted*.001))throw new Error(`GPU photon energy check failed (${accounted.toFixed(3)} / ${emitted.toFixed(3)} W)`);
 return ledger;
}
