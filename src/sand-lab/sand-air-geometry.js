import {shapeRadius,shapeBlend,shapeDistance,sandIsTracer} from './sand-shape.js';
import {bodyDistance} from './objects.js';
import {BoundsGrid} from './spatial-bounds.js';

// A wind evaluation makes many normal/shelter SDF probes without mutating
// geometry. Prepare radii once per evaluation, not once per probe. Refresh
// before the next evaluation: settling may move parcels in between calls.
export class SandAirGeometry {
 constructor(bed,bodies){this.bed=bed;this.bodies=bodies;this.items=[];this.solid=p=>this.distance(p);}
 refresh(spatial=false){let n=0;this.maxExpansion=1;for(const p of this.bed.parcels){if(p.held||p.mass<=0||sandIsTracer(p))continue;
  const q=this.items[n]||(this.items[n]={});q.parcel=p;q.x=p.position[0];q.y=p.position[1];q.z=p.position[2];q.r=shapeRadius(p);q.a=p.aspect||1;q.s=Math.min(1,q.a);q.k=shapeBlend(p);n++;
  q.expansion=Math.max(1,q.a)/q.s;this.maxExpansion=Math.max(this.maxExpansion,q.expansion);q.position=p.position;
 }this.count=n;this.index=spatial?(this.index||new BoundsGrid(.3)):null;if(this.index){this.index.clear();for(let i=0;i<n;i++){const q=this.items[i];this.index.insert(i,q.position,q.r*Math.max(1,q.a)+q.k*q.expansion);}}}
 distance(p){let d=(p[1]-this.bed.height(p[0],p[2]))*.65;
  const candidates=this.index?.query(p,Math.max(0,d)*this.maxExpansion);
  for(let j=0;j<(candidates?candidates.length:this.count);j++){const q=this.items[candidates?candidates[j]:j],x=p[0]-q.x,y=(p[1]-q.y)/q.a,z=p[2]-q.z,limit=q.r+(d+q.k)/q.s;
   if(limit>=0&&x*x+y*y+z*z>=limit*limit)continue;
   const sd=q.parcel.cuts?.length?shapeDistance(q.parcel,p):(Math.hypot(x,y,z)-q.r)*q.s,h=Math.max(q.k-Math.abs(d-sd),0)/Math.max(q.k,.00001);d=Math.min(d,sd)-h*h*q.k*.25;
  }
  for(const b of this.bodies){const x=p[0]-b.position[0],y=p[1]-b.position[1],z=p[2]-b.position[2];
   if(b.shape!=='cup')d=Math.min(d,Math.hypot(x,y,z)-b.radius);
   else d=Math.min(d,bodyDistance(p,b));
  }return d;
 }
}
