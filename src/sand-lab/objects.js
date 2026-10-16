import {rotate,length,clamp} from './water-lab-model.js';
// Still denser than water, but a dry rock cup's air capacity can support its
// shell: density < (shell volume + cavity volume) / shell volume (~1.65).
export const MATERIALS={glass:{ratio:.22,color:[.75,.94,1]},mirror:{ratio:1,color:[.92,.94,1]},rock:{ratio:1.3,color:[.35,.27,.19]},light:{ratio:1,color:[1,.48,.12]}};
export function bodyLocal(p,b){return rotate(p.map((v,k)=>v-b.position[k]),b.tilt||0,b.spin||0,true,b.pitch||0);}
export function bodyDistance(p,b){const q=bodyLocal(p,b);if(b.shape!=='cup')return length(q)-b.radius;const r=b.radius,rad=Math.hypot(q[0],q[2]),wall=r*.16;return Math.min(Math.max(Math.abs(rad-r*.84)-wall,Math.abs(q[1])-r),Math.max(rad-r,Math.abs(q[1]+r)-wall));}
export function bodyNormal(p,b){const e=.002,n=[0,1,2].map(k=>{const a=p.slice(),c=p.slice();a[k]+=e;c[k]-=e;return bodyDistance(a,b)-bodyDistance(c,b);}),l=length(n)||1;return n.map(v=>v/l);}
export function makeBody(kind,shape,radius,position,velocity=[0,0,0]){const m=MATERIALS[kind];return {kind,shape,radius,position:position.slice(),velocity:velocity.slice(),color:m.color.slice(),ratio:m.ratio,tilt:0,pitch:0,spin:0,omega:[0,0,0],submerged:0,airVolume:shape==='cup'?Math.PI*radius**3*1.84*.68**2:0,waterVolume:0,held:false};}
export function recolorLatest(bodies,color){const b=bodies.at(-1);if(b)b.color=color.map(v=>clamp(v,0,1));return b;}
export function bodyVolume(b){return Math.PI*b.radius**3*(b.shape==='cup'?1.84*(1-.68**2)+.32:4/3);}
export function cupCapacity(b){return Math.PI*b.radius**3*1.84*.68**2;}
export function cupContains(p,b){const q=bodyLocal(p,b),r=b.radius;return Math.hypot(q[0],q[2])<.68*r&&q[1]>-.84*r&&q[1]<r;}
const CUP_COLUMNS=Array.from({length:32},(_,i)=>{const r=Math.sqrt((i+.5)/32),a=i*2.399963229728653;return [r*Math.cos(a),r*Math.sin(a)];});
// Archimedes on the closed outer envelope, with the actual carried water
// added to the mass. Flooded cups therefore lose their air contribution;
// no special upward force, air refill timer or deleted water is involved.
export function cupHydrostatics(b,surface,containedWater=0){
 const r=b.radius,axis=rotate([0,1,0],b.tilt||0,b.spin||0,false,b.pitch||0),volume=2.16*Math.PI*r**3,water=clamp(containedWater,0,cupCapacity(b));let fraction=0;
 for(const [x,z] of CUP_COLUMNS){const center=rotate([x*r,-.08*r,z*r],b.tilt||0,b.spin||0,false,b.pitch||0),dy=surface-b.position[1]-center[1],span=Math.abs(axis[1])*2.16*r;fraction+=span>1e-7?clamp(.5+dy/span,0,1):Number(dy>=0);}
 fraction/=CUP_COLUMNS.length;const displaced=volume*fraction,mass=bodyVolume(b)*b.ratio+water;
 return {submerged:fraction,displaced,waterVolume:water,airVolume:cupCapacity(b)-water,mass,buoyancy:displaced/mass};
}

// Support of the hollow cup's outside wall and bottom, including orientation.
export function bodySupport(b,direction){if(b.shape!=='cup')return b.radius;const axis=rotate([0,1,0],b.tilt||0,b.spin||0,false,b.pitch||0),along=axis.reduce((sum,v,k)=>sum+v*direction[k],0),radial=b.radius*Math.sqrt(Math.max(0,1-along*along));return Math.max(radial+b.radius*Math.abs(along),radial-b.radius*along+b.radius*.16*Math.abs(along));}
export function resolveSandContacts(parcels,bodies,dt){
 for(const p of parcels){if(p.held||p.mass<=0)continue;const r=Math.cbrt(p.mass/(p.packing*4*Math.PI/3));
  for(const b of bodies){if(Math.hypot(...p.position.map((v,k)=>v-b.position[k]))>b.radius*1.5+r)continue;
   for(let iteration=0;iteration<3;iteration++){const d=bodyDistance(p.position,b);if(d>=r)break;const n=bodyNormal(p.position,b);
    if(p.anchored){
     // Bonded sand is terrain: move the free body out of the deposit instead
     // of reviving/moving the clay's individual SDF support primitives.
     if(b.held)break;const inward=b.velocity.reduce((sum,v,k)=>sum+v*n[k],0);
     for(let k=0;k<3;k++){b.position[k]-=n[k]*(r-d+.0001);if(inward>0)b.velocity[k]-=inward*n[k];}
    }else{const vn=p.velocity.reduce((sum,v,k)=>sum+(v-b.velocity[k])*n[k],0);
     for(let k=0;k<3;k++){p.position[k]+=n[k]*(r-d+.0001);if(vn<0){const impulse=-vn*n[k];p.velocity[k]+=impulse;if(!b.held)b.velocity[k]-=impulse*Math.min(.25,p.mass/(bodyVolume(b)*b.ratio));}}
    }
   }
  }
 }
}
