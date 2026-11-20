import {SculptCachePool} from './sculpt-incremental.js';
import {bakeFast,extractSurfaceFast} from './sculpt-fast.js';
import {bakeCPU,extractSurface} from './sculpt.js';
const cache=new SculptCachePool();
self.onmessage=({data})=>{try{
 if(data.incremental&&data.optimized&&data.key){const result=cache.update(data.key,data.stamps,data.spacing,data.grid?{grid:data.grid,values:data.values}:undefined);self.postMessage({id:data.id,...result});}
 else{cache.drop(data.key);const surface=data.grid?(data.optimized?extractSurfaceFast:extractSurface)(data.values,data.grid,data.stamps):(data.optimized?bakeFast:bakeCPU)(data.stamps,data.spacing);self.postMessage({id:data.id,surface,stats:{mode:'full reference'}});}
}catch(e){cache.drop(data.key);self.postMessage({id:data.id,error:e.message});}};
