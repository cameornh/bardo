const sphereVolume=r=>4*Math.PI/3*r**3;
export const shapeRadius=p=>p.shapeRadius??Math.cbrt(p.mass/(p.packing*4*Math.PI/3*(p.aspect||1)));
// Reconstruction blends settled grains over their local support spacing.
// It is geometry (also used by collision queries), not a blur of the image.
// A cut keeps the narrower brush boundary; fresh airborne clumps use the original kernel.
export const shapeBlend=p=>p.cuts?.length?Math.min(.08,shapeRadius(p)*.5):(p.surfaceBlend??Math.min(.08,shapeRadius(p)*.5));
export const sandIsTracer=p=>!!p.windborne&&!p.held&&!p.anchored;
export const shapeHeight=p=>shapeRadius(p)*(p.aspect||1);
// Flattened deposits conserve occupied volume. This conservative ellipsoid
// distance is shared by the CPU collider and the GPU terrain query.
export function shapeDistance(p,point){
 const aspect=p.aspect||1,dx=point[0]-p.position[0],dy=(point[1]-p.position[1])/aspect,dz=point[2]-p.position[2];
 let d=(Math.hypot(dx,dy,dz)-shapeRadius(p))*Math.min(1,aspect);
 for(const op of p.cuts||[]){const a=op.aspect||1,q=(Math.hypot(point[0]-p.position[0]-op.offset[0],(point[1]-p.position[1]-op.offset[1])/a,point[2]-p.position[2]-op.offset[2])-Math.abs(op.radius))*Math.min(1,a);d=Math.max(d,op.radius>0?-q:q);}
 return d;
}
export function sphereIntersection(r,s,d){
 if(d>=r+s)return 0;if(d<=Math.abs(r-s))return sphereVolume(Math.min(r,s));
 return Math.PI*(r+s-d)**2*(d*d+2*d*(r+s)-3*(r-s)**2)/(12*d);
}
const radical=(i,base)=>{let x=0,f=1/base;while(i){x+=(i%base)*f;i=Math.floor(i/base);f/=base;}return x;};
// Intersect the brush with the existing CSG, not merely its bounding sphere.
// The first cut has an exact spherical-lens volume; subsequent overlapping
// cuts use bounded deterministic quadrature. The stock ledger stays exact.
export function cutShape(p,point,radius,samples=2048){
 const r=shapeRadius(p),d=Math.hypot(...point.map((v,k)=>v-p.position[k]));
 if(d>=r+radius||p.mass<=0)return null;
 if(d+r<=radius){const q={...p,position:p.position.slice(),cuts:p.cuts?.map(c=>({...c,offset:c.offset.slice()}))};p.mass=0;return q;}
 let volume=sphereIntersection(r,radius,d);
 if(p.cuts?.length||(p.aspect||1)!==1){const small=radius<r,center=small?point:p.position,extent=Math.min(radius,r),n=samples;let hits=0;
  for(let i=1;i<=n;i++){const rr=extent*Math.cbrt(radical(i,2)),y=radical(i,3)*2-1,a=radical(i,5)*Math.PI*2,s=Math.sqrt(1-y*y),q=[rr*s*Math.cos(a),rr*y,rr*s*Math.sin(a)].map((v,k)=>v+center[k]);if(Math.hypot(...q.map((v,k)=>v-point[k]))<=radius&&shapeDistance(p,q)<=0)hits++;}
  volume=sphereVolume(extent)*hits/n;
 }
 const amount=Math.min(p.mass,volume*p.packing);if(amount<=1e-14)return null;
 const cuts=(p.cuts||[]).map(c=>({...c,offset:c.offset.map((v,k)=>v+p.position[k]-point[k])}));
 cuts.push({offset:p.position.map((v,k)=>v-point[k]),radius:-r,aspect:p.aspect||1});
 const q={...p,position:point.slice(),shapeRadius:radius,aspect:1,cuts,mass:amount};
 p.shapeRadius=r;p.cuts=[...(p.cuts||[]),{offset:point.map((v,k)=>v-p.position[k]),radius}];p.mass-=amount;
 return q;
}

// Three-texel headers: position/radius, moisture/aspect/CSG range, blend width.
// Two-texel CSG operations follow the headers in the same texture.
export function packSandShapes(parcels){
 const headers=new Float32Array(parcels.length*12),cuts=[];
 parcels.forEach((p,i)=>{headers.set([...p.position,sandIsTracer(p)?-1:shapeRadius(p),p.wet,p.aspect||1,parcels.length*3+cuts.length/4,p.cuts?.length||0,shapeBlend(p),0,0,0],i*12);for(const c of p.cuts||[])cuts.push(...c.offset.map((v,k)=>v+p.position[k]),c.radius,c.aspect||1,0,0,0);});
 const data=new Float32Array(headers.length+cuts.length);data.set(headers);data.set(cuts,headers.length);return {headers,cuts:new Float32Array(cuts),data};
}
