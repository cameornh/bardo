import * as THREE from 'three';

// Grow storage with the population. There is no gameplay spawn cap.
export class BodyTexture {
 constructor(){this.capacity=0;this.width=256;this.texture=null;this.update([]);}
 update(bodies){const height=2**Math.ceil(Math.log2(Math.max(1,Math.ceil(bodies.length*2/this.width))));if(height*this.width>this.capacity){this.texture?.dispose();this.capacity=height*this.width;this.data=new Float32Array(this.capacity*4);this.texture=new THREE.DataTexture(this.data,this.width,height,THREE.RGBAFormat,THREE.FloatType);}
  bodies.forEach((b,i)=>{this.data.set([...b.position,b.radius],i*8);this.data.set([...b.velocity,b.mass||0],i*8+4);});this.texture.needsUpdate=true;
 }
 dispose(){this.texture.dispose();}
}
export function solveBallContacts(balls){const grid=new Map(),size=1.2;let contacts=0;
 for(let i=0;i<balls.length;i++){const a=balls[i],cell=a.position.map(v=>Math.floor(v/size));for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)for(const j of grid.get(`${cell[0]+x},${cell[1]+y},${cell[2]+z}`)||[]){const b=balls[j],d=a.position.map((v,k)=>v-b.position[k]),length=Math.hypot(...d),overlap=a.radius+b.radius-length;if(overlap<=0)continue;const n=length>1e-6?d.map(v=>v/length):[1,0,0],ia=1/a.mass,ib=1/b.mass,speed=n.reduce((v,x,k)=>v+x*(a.velocity[k]-b.velocity[k]),0),impulse=Math.max(0,-1.2*speed/(ia+ib));for(let k=0;k<3;k++){a.position[k]+=n[k]*overlap*ia/(ia+ib);b.position[k]-=n[k]*overlap*ib/(ia+ib);a.velocity[k]+=n[k]*impulse*ia;b.velocity[k]-=n[k]*impulse*ib;}contacts++;}const key=cell.join(',');if(!grid.has(key))grid.set(key,[]);grid.get(key).push(i);}
 return contacts;
}
export const BODY_GLSL=`
uniform sampler2D uBodies;uniform int uBallCount;
vec4 body(int i){int id=i*2;return texelFetch(uBodies,ivec2(id%256,id/256),0);}
vec4 bodyVelocity(int i){int id=i*2+1;return texelFetch(uBodies,ivec2(id%256,id/256),0);}
`;
