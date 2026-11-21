import {Vector3} from 'three';
import {field} from './sculpt.js';
import {retention} from './physics-data.js';

export const MAX_MARKS = 128;
export const markKinds = ['petal','leaf','blade','dab'];
const vector = a => new Vector3().fromArray(a);
const within = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi;
const triples = (v, limit) => Array.isArray(v) && v.length === 3 && v.every(x => within(x,-limit,limit));

export function validateMarks(part, materials) {
  if (part.marks === undefined) return;
  if (!Array.isArray(part.marks) || part.marks.length > MAX_MARKS) throw Error('Invalid Gaussian brush count.');
  const ids = new Set();
  for (const m of part.marks) {
    if (!m || typeof m.id !== 'string' || !/^[\w-]{1,100}$/.test(m.id) || ids.has(m.id)
      || !materials.has(m.materialId) || !markKinds.includes(m.kind) || !triples(m.root,500)
      || !triples(m.axis,1.001) || !triples(m.up,1.001) || !within(m.length,.035,4)
      || !within(m.width,.04,.9) || !within(m.curl,-1,1) || !within(m.flex,0,1))
      throw Error('Invalid Gaussian brush attachment.');
    const a=vector(m.axis), u=vector(m.up);
    if (Math.abs(a.lengthSq()-1)>.002 || Math.abs(u.lengthSq()-1)>.002 || Math.abs(a.dot(u))>.002)
      throw Error('Invalid Gaussian brush axes.');
    ids.add(m.id);
  }
}

// Picking returns sampled points on composite sculpts. Refine onto the authored
// zero set, including for symmetry copies, so that every root has an actual mount.
export function projectMount(part, point, reach) {
  const p=point.slice(), stamps=part.stamps;
  if (!stamps.length) return null;
  const h=.0003;
  for (let k=0;k<8;k++) {
    const [distance,index]=field(p,stamps);
    if (!Number.isFinite(distance) || Math.abs(distance)>reach || Math.abs(distance)>100) return null;
    const gradient=new Vector3(...p.map((x,i)=>{
      p[i]=x+h; const hi=field(p,stamps)[0]; p[i]=x-h; const lo=field(p,stamps)[0]; p[i]=x;
      return (hi-lo)/(2*h);
    }));
    const norm=gradient.lengthSq();
    if (norm<1e-8) return null;
    if (Math.abs(distance)<.001) return {root:p, normal:gradient.normalize(),materialId:stamps[index].materialId};
    const step=distance/norm;
    for (let i=0;i<3;i++) p[i]-=gradient.getComponent(i)*step;
    if (p.some(x=>Math.abs(x)>500) || Math.hypot(...p.map((x,i)=>x-point[i]))>reach) return null;
  }
  return null;
}

export function supportedMark(part, mark, materials) {
  const [d,index]=field(mark.root,part.stamps);
  const host=materials.get(part.stamps[index]?.materialId), paint=materials.get(mark.materialId);
  return Math.abs(d)<.012 && host && paint && retention(host)>1e-4 && retention(paint)>1e-4;
}

export function brushFrame(direction, upHint, roll=0) {
  const axis=direction.clone().normalize(),up=upHint.clone().addScaledVector(axis,-upHint.dot(axis));
  if(up.lengthSq()<1e-6){
    up.set(Math.abs(axis.y)>.8?1:0,Math.abs(axis.y)>.8?0:1,0);
    up.addScaledVector(axis,-up.dot(axis));
  }
  up.normalize().applyAxisAngle(axis,roll);
  return {axis:axis.toArray(),up:up.toArray()};
}

export function brushCopies(point, pattern, oriented=false) {
  const count=pattern==='mirror'?2:([4,6,8].includes(Number(pattern))?Number(pattern):1);
  const copies=[];
  for(let i=0;i<count;i++){
    const a=2*Math.PI*i/count,c=Math.cos(a),s=Math.sin(a);
    const transform=([x,y,z])=>pattern==='mirror'?[i?-x:x,y,z]:[c*x+s*z,y,c*z-s*x];
    const root=transform(point);
    if(oriented||!copies.some(p=>Math.hypot(...p.point.map((x,j)=>x-root[j]))<.0005))copies.push({point:root,transform});
  }
  return copies;
}

// Space stamps by arc length even when pointer events are coalesced. Do not
// bridge a miss or a large screen-space jump across disconnected geometry.
export function strokePoints(previous, point, radius, spacing) {
  if(!previous)return [point];
  const delta=point.map((x,i)=>x-previous[i]),distance=Math.hypot(...delta),step=Math.max(.015,radius*spacing);
  if(distance>radius*6)return [point];
  const points=[];
  for(let n=1;n<=Math.floor(distance/step);n++)points.push(previous.map((x,i)=>x+delta[i]*n*step/distance));
  return points;
}
