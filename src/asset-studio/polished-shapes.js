// An ellipsoid or box with up to three carved voids. Entry and exit are roots of
// the authored zero surface, so even a thin rim costs a fixed number of tests.
import {Box3,Matrix3,Vector3} from 'three';
export function polishedShape(stamps){
 if(!stamps.length||stamps.length>4||stamps.some((s,i)=>!['sphere','box'].includes(s.shape)||
  (i===0?s.mode!=='add':s.mode!=='subtract'||s.blend>0)))return null;
 const primitives=stamps.map(s=>({box:s.shape==='box',center:new Vector3(...s.position),size:new Vector3(...s.size)}));
 const {center,size}=primitives[0];
 return {primitives,center,size,bounds:new Box3(center.clone().sub(size),center.clone().add(size))};
}
const axes=['x','y','z'];
// Scratch for one synchronous query. A primitive contributes at most two
// endpoints and the authored shape contains at most four primitives.
const roots=new Float64Array(8),localOrigin=new Vector3(),localDirection=new Vector3();
function storeInterval(s,p,d,i){
 const x=(p.x-s.center.x)/s.size.x,y=(p.y-s.center.y)/s.size.y,z=(p.z-s.center.z)/s.size.z;
 const dx=d.x/s.size.x,dy=d.y/s.size.y,dz=d.z/s.size.z;
 let lo=-Infinity,hi=Infinity;
 if(!s.box){
  const a=dx*dx+dy*dy+dz*dz,b=x*dx+y*dy+z*dz;
  const cx=y*dz-z*dy,cy=z*dx-x*dz,cz=x*dy-y*dx,disc=a-(cx*cx+cy*cy+cz*cz);
  if(disc<=0)return false;
  const h=Math.sqrt(disc);lo=(-b-h)/a;hi=(-b+h)/a;
 }else{
  for(let k=0;k<3;k++){
   const v=k===0?dx:k===1?dy:dz,q=k===0?x:k===1?y:z;
   if(Math.abs(v)<1e-12){if(Math.abs(q)>=1)return false;continue;}
   const a=(-1-q)/v,b=(1-q)/v;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));
  }
  if(hi<=lo)return false;
 }
 roots[i]=lo;roots[i+1]=hi;return true;
}
function firstBoundary(shape,p,d,minT){
 const prim=shape.primitives,n=2*prim.length;
 if(!storeInterval(prim[0],p,d,0)||roots[1]<=minT)return -1;
 for(let i=2;i<n;i+=2)if(!storeInterval(prim[i/2],p,d,i)){roots[i]=Infinity;roots[i+1]=-Infinity;}
 let best=-1,t=Infinity;
 for(let i=0;i<n;i++){
  const root=roots[i];
  if(root<minT||root>=t||root<roots[0]||root>roots[1])continue;
  let carved=false;
  for(let j=2;j<n;j+=2){if((i&~1)!==j&&root>roots[j]&&root<roots[j+1]){carved=true;break;}}
  if(!carved){best=i;t=root;}
 }
 return best;
}
export function shapeHit(shape,origin,direction,minT=1e-6){
 const i=firstBoundary(shape,origin,direction,minT);if(i<0)return null;
 const t=roots[i],owner=i>>1;
 const s=shape.primitives[owner],point=origin.clone().addScaledVector(direction,t);
 const normal=point.clone().sub(s.center).divide(s.size);
 if(s.box){
  const k=axes.reduce((best,k)=>Math.abs(normal[k])>Math.abs(normal[best])?k:best,'x');
  const side=Math.sign(normal[k]);normal.set(0,0,0);normal[k]=side;
 }
 normal.divide(s.size).normalize();if(owner)normal.negate();
 return {point,normal,t};
}
export function bendRay(direction,n,eta){
 const c=-direction.dot(n),disc=1-eta*eta*(1-c*c);
 return disc<0?null:direction.clone().multiplyScalar(eta).addScaledVector(n,eta*c-Math.sqrt(disc)).normalize();
}
export function transformedOptic(shape,matrix){
 const inverse=matrix.clone().invert();
 return {shape,matrix,inverse,toLocal:new Matrix3().setFromMatrix4(inverse),toWorldNormal:new Matrix3().getNormalMatrix(matrix)};
}
export function opticalDistance(optic,origin,direction,minT=1e-6){
 const i=firstBoundary(optic.shape,localOrigin.copy(origin).applyMatrix4(optic.inverse),localDirection.copy(direction).applyMatrix3(optic.toLocal),minT);
 return i<0?Infinity:roots[i];
}
export function opticalHit(optic,origin,direction,minT){
 const hit=shapeHit(optic.shape,localOrigin.copy(origin).applyMatrix4(optic.inverse),localDirection.copy(direction).applyMatrix3(optic.toLocal),minT);
 if(!hit)return null;
 hit.point.applyMatrix4(optic.matrix);hit.normal.applyNormalMatrix(optic.toWorldNormal);return hit;
}
export function traceOptic(optic,origin,direction,material,front=opticalHit(optic,origin,direction)){
 if(!front||direction.dot(front.normal)>=0)return null;
 if(material.metallic>=.985)return {origin:front.point,direction:direction.clone().reflect(front.normal),distance:0};
 let ray=bendRay(direction,front.normal,1/material.ior),point=front.point,distance=0;
 for(let i=0;ray&&i<3;i++){
  const back=opticalHit(optic,point,ray,1e-5);
  if(!back)return null;
  distance+=back.t;const outgoing=bendRay(ray,back.normal.clone().negate(),material.ior);
  if(outgoing)return {origin:back.point,direction:outgoing,distance};
  point=back.point;ray.reflect(back.normal);
 }
 return null;
}
