import {rotate,length,clamp} from './water-lab-model.js';
export const MATERIALS={glass:{ratio:.22,color:[.75,.94,1]},mirror:{ratio:1,color:[.92,.94,1]},rock:{ratio:2.65,color:[.35,.27,.19]},light:{ratio:1,color:[1,.48,.12]}};
export function bodyLocal(p,b){return rotate(p.map((v,k)=>v-b.position[k]),b.tilt||0,b.spin||0,true,b.pitch||0);}
export function bodyDistance(p,b){const q=bodyLocal(p,b);if(b.shape!=='cup')return length(q)-b.radius;const r=b.radius,rad=Math.hypot(q[0],q[2]),wall=r*.16;return Math.min(Math.max(Math.abs(rad-r*.84)-wall,Math.abs(q[1])-r),Math.max(rad-r,Math.abs(q[1]+r)-wall));}
export function bodyNormal(p,b){const e=.002,n=[0,1,2].map(k=>{const a=p.slice(),c=p.slice();a[k]+=e;c[k]-=e;return bodyDistance(a,b)-bodyDistance(c,b);}),l=length(n)||1;return n.map(v=>v/l);}
export function makeBody(kind,shape,radius,position,velocity=[0,0,0]){const m=MATERIALS[kind];return {kind,shape,radius,position:position.slice(),velocity:velocity.slice(),color:m.color.slice(),ratio:m.ratio,tilt:0,pitch:0,spin:0,omega:[0,0,0],submerged:0,held:false};}
export function recolorLatest(bodies,color){const b=bodies.at(-1);if(b)b.color=color.map(v=>clamp(v,0,1));return b;}
export function bodyVolume(b){return Math.PI*b.radius**3*(b.shape==='cup'?1.84*(1-.68**2)+.32:4/3);}

// Support of the hollow cup's outside wall and bottom, including orientation.
export function bodySupport(b,direction){if(b.shape!=='cup')return b.radius;const axis=rotate([0,1,0],b.tilt||0,b.spin||0,false,b.pitch||0),along=axis.reduce((sum,v,k)=>sum+v*direction[k],0),radial=b.radius*Math.sqrt(Math.max(0,1-along*along));return Math.max(radial+b.radius*Math.abs(along),radial-b.radius*along+b.radius*.16*Math.abs(along));}
export function resolveSandContacts(parcels,bodies,dt){for(const p of parcels){if(p.held)continue;const r=Math.cbrt(p.mass/(p.packing*4*Math.PI/3));for(const b of bodies){if(Math.hypot(...p.position.map((v,k)=>v-b.position[k]))>b.radius*1.5+r)continue;for(let iteration=0;iteration<3;iteration++){const d=bodyDistance(p.position,b);if(d>=r)break;const n=bodyNormal(p.position,b),vn=p.velocity.reduce((sum,v,k)=>sum+(v-b.velocity[k])*n[k],0);for(let k=0;k<3;k++){p.position[k]+=n[k]*(r-d+.0001);if(vn<0){const impulse=-vn*n[k];p.velocity[k]+=impulse;if(!b.held)b.velocity[k]-=impulse*Math.min(.25,p.mass/(bodyVolume(b)*b.ratio));}}}}}}
