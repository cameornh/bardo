import {SandLab} from '../src/sand-lab/lab.js';
import {bodyRayHit} from '../src/sand-lab/body-ray.js';
import {bodyNormal} from '../src/sand-lab/objects.js';
import {beachHeight} from '../src/sand-lab/sand.js';
import * as THREE from 'three';
// A bounded CPU reference of the real initial body layout. This deliberately
// does not instantiate the lab's water renderer or any graphics compute pass.
document.querySelector('#run').onclick=async()=>{
 document.querySelector('#run').disabled=true;
 const lab=new SandLab({extensions:{has:()=>false}},{boulders:true}),canvas=document.querySelector('#view'),ctx=canvas.getContext('2d'),image=ctx.createImageData(canvas.width,canvas.height),camera=new THREE.PerspectiveCamera(55,canvas.width/canvas.height,.025,150),counts=[0,0,0];
 camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();const eye=camera.position.toArray(),sun=new THREE.Vector3(-.4,.8,.3).normalize().toArray();
 for(let y=0;y<canvas.height;y++){
  for(let x=0;x<canvas.width;x++){
   const ray=new THREE.Vector3((x+.5)/canvas.width*2-1,1-(y+.5)/canvas.height*2,1).unproject(camera).sub(camera.position).normalize().toArray(),point=t=>eye.map((v,k)=>v+ray[k]*t);let ground=Infinity;
   for(let t=.01;t<22;){const p=point(t),d=p[1]-beachHeight(p[0],p[2]);if(d<.003){if(Math.abs(p[0])<5.5&&Math.abs(p[2])<4.9)ground=t;break;}t+=Math.max(.015,d*.65);}
   let nearest=ground,index=-1;lab.balls.forEach((b,i)=>{const t=bodyRayHit(eye,ray,b,nearest,0);if(t<nearest){nearest=t;index=i;}});
   let color=Number.isFinite(ground)?[.63,.57,.43]:[.50,.66,.75];
   if(index>=0){const n=bodyNormal(point(nearest),lab.balls[index]),light=.28+.95*Math.max(0,n.reduce((s,v,k)=>s+v*sun[k],0));color=lab.balls[index].color.map(v=>Math.sqrt(v)*light);counts[index]++;}
   const water=(1.35-eye[1])/ray[1];if(water>0&&water<nearest){const p=point(water);if(Math.abs(p[0])<5.5&&Math.abs(p[2])<4.9&&beachHeight(p[0],p[2])<1.35)color=color.map((v,k)=>v*.2+[.09,.30,.40][k]*.8);}
   image.data.set([...color.map(v=>Math.round(Math.min(1,v)*255)),255],(y*canvas.width+x)*4);
  }
  if(y%24===0){ctx.putImageData(image,0,0);await new Promise(requestAnimationFrame);}
 }
 ctx.putImageData(image,0,0);
 document.querySelector('#result').textContent=JSON.stringify({backend:'CPU reference; no WebGL',boulders:lab.balls.length,visiblePixels:counts,fixed:lab.balls.every(b=>b.fixed),embedded:lab.balls.every(b=>{const h=lab.sand.height(b.position[0],b.position[2]);return b.position[1]-b.radius<h&&b.position[1]+b.radius>h;}),waterSamples:lab.count,pass:counts.every(n=>n>30)},null,2);
};
