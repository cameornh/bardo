import {bakeFast,extractSurfaceFast} from './sculpt-fast.js';
import {bakeCPU,extractSurface} from './sculpt.js';
self.onmessage=({data})=>{try{const surface=data.grid?(data.optimized?extractSurfaceFast:extractSurface)(data.values,data.grid,data.stamps):(data.optimized?bakeFast:bakeCPU)(data.stamps,data.spacing);self.postMessage({id:data.id,surface});}catch(e){self.postMessage({id:data.id,error:e.message});}};
