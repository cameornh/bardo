import {field} from './sculpt.js';
import {retention} from './physics-data.js';

// Joint anchors may be outside the body. Sample the nearest sculpt surface
// there so both the editor and the simulation use the material at the mount.
export function anchorRetention(part,materials,point){
 if(!part.stamps.some(s=>s.mode==='add'))return 0;
 let p=point.slice(),[distance,index]=field(p,part.stamps);
 for(let i=0;distance>.0001&&i<4;i++){
  const gradient=p.map((x,k)=>{
   const q=p.slice();q[k]=x+.0001;const a=field(q,part.stamps)[0];
   q[k]=x-.0001;return (a-field(q,part.stamps)[0])/.0002;
  });
  const norm=gradient.reduce((sum,v)=>sum+v*v,0);if(norm<1e-6)break;
  p=p.map((x,k)=>x-gradient[k]*distance/norm);
  [distance,index]=field(p,part.stamps);
 }
 const m=materials.find(m=>m.id===part.stamps[index].materialId);
 return m?retention(m):0;
}
