import {buildCollisionMesh} from './collision-mesh.js';
self.onmessage=({data:{id,shape}})=>{
 try{const mesh=buildCollisionMesh(shape);self.postMessage({id,mesh},[mesh.values.buffer]);}
 catch(error){self.postMessage({id,error:String(error)});}
};
