import { makeLightScene } from './light-transport.js';
import { tracePhotons } from './photon-map.js';
self.onmessage=({data:{id,config}})=>{
 try{
  const scene=makeLightScene(config),preview=Math.min(2048,config.photons);
  for(const count of preview<config.photons?[preview,config.photons]:[preview]){
   const result=tracePhotons(scene,{count});self.postMessage({id,scene,...result,preview:count<config.photons},[result.direct.buffer,result.caustic.buffer]);
  }
 }catch(error){self.postMessage({id,error:error.message});}
};
