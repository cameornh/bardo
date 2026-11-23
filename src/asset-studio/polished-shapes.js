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
function interval(s,origin,direction){
 const q=origin.clone().sub(s.center).divide(s.size),d=direction.clone().divide(s.size);
 if(!s.box){
  const a=d.lengthSq(),b=q.dot(d),disc=a-q.clone().cross(d).lengthSq();
  if(disc<=0)return [Infinity,-Infinity];
  const h=Math.sqrt(disc);return [(-b-h)/a,(-b+h)/a];
 }
 let lo=-Infinity,hi=Infinity;
 for(const k of axes){
  if(Math.abs(d[k])<1e-12){if(Math.abs(q[k])>=1)return [Infinity,-Infinity];continue;}
  const a=(-1-q[k])/d[k],b=(1-q[k])/d[k];lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));
 }
 return [lo,hi];
}
export function shapeHit(shape,origin,direction,minT=1e-6){
 const ranges=shape.primitives.map(s=>interval(s,origin,direction));
 const [entry,exit]=ranges[0];if(exit<=minT||exit<=entry)return null;
 let t=Infinity,owner=-1;
 for(const [i,[a,b]] of ranges.entries()){
  if(b<=a)continue;
  for(const root of [a,b]){
   if(root<minT||root>=t||root<entry||root>exit)continue;
   if(ranges.some(([lo,hi],j)=>j>0&&j!==i&&root>lo&&root<hi))continue;
   t=root;owner=i;
  }
 }
 if(owner<0)return null;
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
export function opticalHit(optic,origin,direction,minT){
 const hit=shapeHit(optic.shape,origin.clone().applyMatrix4(optic.inverse),direction.clone().applyMatrix3(optic.toLocal),minT);
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
