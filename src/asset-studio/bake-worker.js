import {bakeCPU,extractSurface} from './sculpt.js';
self.onmessage=({data})=>{try{const surface=data.grid?extractSurface(data.values,data.grid,data.stamps):bakeCPU(data.stamps,data.spacing);self.postMessage({id:data.id,surface});}catch(e){self.postMessage({id:data.id,error:e.message});}};
