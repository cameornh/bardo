import {pressureFixtures} from './bounded-pressure-fixtures.js';
import {densityKernelReady} from './native-density.js';
import {SandLab} from './lab.js';
import {makeBody} from './objects.js';
import {buildNeighbors} from './water-lab-model.js';

// At most 175 samples per fixture. No scene rendering or full-beach dispatch.
export async function verifyBoundedPressure(gpu){
 await densityKernelReady;const result=gpu.validate(pressureFixtures());if(!result.pass)return result;
 const lab=new SandLab({extensions:{has:()=>true}},{boulders:true,physicalResolution:true}),cup=makeBody('glass','cup',.3,[0,1,2]);cup.tilt=.63;cup.pitch=.41;lab.balls.push(cup);lab.setPlayer([.6,1.5,2],[0,0,0],.03,.17);lab.syncUniforms();
 const fixtures=[];
 for(const nearCup of [false,true]){
  const p=new Float32Array(175*4);for(let i=0;i<175;i++){const x=nearCup?(i%7-3)*.12:Math.sin(i*12.1)*5.5,z=nearCup?2+(Math.floor(i/35)-2)*.12:Math.cos(i*9.9)*4.9,y=nearCup?.8+(Math.floor(i/7)%5)*.12:lab.sand.height(x,z)+Math.sin(i*12.9)*.2;p.set([x,y,z,i%23===0?1:0],i*4);}
  fixtures.push({name:nearCup?'GPU cup, player and ground contacts':'GPU beach bounds and boulders',positions:p,neighbors:buildNeighbors(p,.14).data,spacing:.14,collide:p=>lab.collide(p,.14*.12),boundary:p=>lab.solid(p)});
 }
 const geometry=gpu.validateGeometry(lab,fixtures);lab.gpu.dispose();return {pass:result.pass&&geometry.pass,backend:gpu.backend,validation:result,geometry};
}
