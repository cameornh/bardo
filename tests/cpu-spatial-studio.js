import {studioScene as referenceScene} from './scene-performance-studio.js';
// Unchanged live studio control: both blocks use the current fast exact CPU
// path. Beach-only query changes must not be credited with a studio speedup.
export async function studioScene(canvas,status){
 const scene=await referenceScene(canvas,status);
 return {...scene,metadata:{...scene.metadata,comparison:'A/A control, current live studio; no studio implementation change'},reset:()=>scene.reset(true),get time(){return scene.time;}};
}
