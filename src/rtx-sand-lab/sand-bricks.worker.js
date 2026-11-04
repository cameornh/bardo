import {buildSandBricks} from './sand-bricks.js';
self.onmessage=({data:{id,shape}})=>{
 const bricks=buildSandBricks(shape);
 self.postMessage({id,bricks},[bricks.masks.buffer]);
};
