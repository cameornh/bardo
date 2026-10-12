import { solveDiffusion } from './subsurface.js';
self.onmessage=({data:{id,samples,light,split}})=>{
 try{
  const start=performance.now(),results=samples.map(sample=>({id:sample.id,...solveDiffusion(sample,light,{split})}));
  self.postMessage({id,results,ms:performance.now()-start},results.map(r=>r.data.buffer));
 }catch(error){self.postMessage({id,error:String(error.stack||error)});}
};
