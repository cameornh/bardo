import {Euler,Quaternion,Vector3} from 'three';
import {clone,uid,validateLibrary,MAX_LIBRARY_BYTES} from './model.js';
import {anchorRetention} from './attachment-material.js';
import {jointDefaults} from './physics-data.js';
import {familySampler,pickFamilyMember} from './family.js';
import {projectMount,supportedMark} from './gaussian-marks.js';

const v=a=>new Vector3(...a);
const vertical=new Vector3(0,1,0);
const radians=Math.PI/180;
const pivotAt=(part,pose=part.transform)=>v(part.pivot).add(v(pose.position));
const orientation=(from,to,angle)=>new Quaternion().setFromAxisAngle(to,angle*radians)
  .multiply(new Quaternion().setFromUnitVectors(from,to));

export function reusableContents(source) {
  const entries=[{id:'whole',name:'Whole asset'}];
  if (source.parts.length>1) entries.push({id:'sample',name:'Sample one named part'});
  for (const p of source.parts) {
    entries.push({id:'part:'+p.id,name:'Part · '+p.name});
    for (const [i,m] of (p.marks||[]).entries()) entries.push({
      id:'detail:'+p.id+':'+m.id,name:p.name+' · '+(m.kind==='dab'?'ellipsoid':'ribbon')+' '+(i+1)
    });
  }
  return entries;
}

function copyParts(parts,source,destination,point,normal,sample,mount) {
  const ids=new Map(parts.map(p=>[p.id,uid()]));
  const rotation=orientation(vertical,normal,sample.twist);
  const root=parts.find(p=>!ids.has(p.joint?.parentId));
  const origin=pivotAt(root);
  const timeScale=destination.duration/source.duration;
  const mapPoint=p=>p.sub(origin).multiplyScalar(sample.size).applyQuaternion(rotation).add(point);
  const copies=parts.map(original=>{
    const p=clone(original);
    p.id=ids.get(original.id);
    for (const pose of [p.transform,...p.keys]) {
      pose.position=mapPoint(pivotAt(p,pose)).sub(v(p.pivot)).toArray();
      const old=new Quaternion().setFromEuler(new Euler(...pose.rotation.map(a=>a*radians)));
      pose.rotation=new Euler().setFromQuaternion(old.premultiply(rotation)).toArray().slice(0,3).map(a=>a/radians);
      pose.scale=pose.scale.map(s=>s*sample.size);
    }
    for (const key of [...p.keys,...(p.forceKeys||[])]) key.time=Math.min(destination.duration,key.time*timeScale);
    // Scene anchors belong to the original placement. Only internal joints travel with the assembly.
    if (p.physics) p.physics.fixed=false;
    if (p.joint && ids.has(p.joint.parentId)) {
      p.joint.parentId=ids.get(p.joint.parentId);
      p.joint.anchor=mapPoint(v(p.joint.anchor)).toArray();
      p.joint.axis=v(p.joint.axis).applyQuaternion(rotation).normalize().toArray();
    } else if (mount && original===root) {
      if (anchorRetention(original,mount.materials,original.pivot)<1e-4 ||
          anchorRetention(mount.host,mount.materials,mount.localPoint)<1e-4) throw Error('Choose a free placement for a material that cannot hold a joint.');
      p.joint={...jointDefaults(),parentId:mount.host.id,type:mount.type,anchor:point.toArray(),axis:normal.toArray()};
    } else if (p.joint) p.joint=null;
    for (const m of p.marks||[]) {m.id=uid();sample.varyMark(m);}
    return p;
  });
  destination.parts.push(...copies);
  return {partId:ids.get(root.id),count:copies.length};
}

function copyDetail(sourcePart,sourceMark,host,localPoint,library,sample,reach) {
  const site=projectMount(host,localPoint,reach);
  const oldSite=projectMount(sourcePart,sourceMark.root,.025);
  if (!oldSite || !site) throw Error('Place the detail on a sculpted surface that can hold it.');
  const mark=clone(sourceMark);
  const rotation=orientation(oldSite.normal,site.normal,sample.twist);
  mark.id=uid();mark.root=site.root;
  mark.axis=v(mark.axis).applyQuaternion(rotation).normalize().toArray();
  mark.up=v(mark.up).applyQuaternion(rotation).normalize().toArray();
  mark.length=Math.min(4,Math.max(.035,mark.length*sample.size));
  sample.varyMark(mark);
  if (!supportedMark(host,mark,new Map(library.materials.map(m=>[m.id,m])))) throw Error('These materials cannot retain a detail joint.');
  (host.marks??=[]).push(mark);
  return {partId:host.id,markId:mark.id,count:1};
}

// Work on an independent snapshot, including self-insertion. A failed validation leaves history and source untouched.
export function insertSelection(library,{sourceId,destinationId,hostId,content='whole',point,normal=[0,1,0],localPoint,seed,jointType}) {
  if(sourceId.startsWith('family:')){
    const family=library.families?.find(f=>'family:'+f.id===sourceId);
    if(!family)throw Error('Choose an existing family.');
    const members=content==='sampleDetail'?family.members.filter(m=>library.assets.find(a=>a.id===m.assetId)?.parts.some(p=>p.marks?.length)):family.members;
    sourceId=pickFamilyMember(members,seed);
  }
  const source=library.assets.find(a=>a.id===sourceId);
  const next=clone(library),destination=next.assets.find(a=>a.id===destinationId);
  if (!source||!destination) throw Error('Choose a source and a destination asset.');
  const sample=familySampler(source.variation,seed);
  if(content==='sampleDetail'){
    const details=reusableContents(source).filter(entry=>entry.id.startsWith('detail:'));
    if(!details.length)throw Error('This source has no painted details.');
    content=details[sample.member(details.length)].id;
  }
  const [kind,partId,markId]=content.split(':');
  const p=source.parts.find(p=>p.id===partId);
  let result;
  if (kind==='detail') {
    const host=destination.parts.find(p=>p.id===hostId), mark=p?.marks?.find(m=>m.id===markId);
    if (!host||!mark||!localPoint) throw Error('Click a sculpted surface to attach the selected detail.');
    result=copyDetail(p,mark,host,localPoint,next,sample,Math.max(.025,destination.spacing*1.5));
  } else {
    const parts=kind==='whole'?source.parts:kind==='sample'?[source.parts[sample.member(source.parts.length)]]:kind==='part'&&p?[p]:[];
    if (!parts.length||!point) throw Error('Choose a library part and an insertion point.');
    const mount=jointType&&jointType!=='free'?{type:jointType,localPoint,materials:next.materials,host:destination.parts.find(p=>p.id===hostId)}:null;
    if(mount&&(!mount.host||!localPoint)) throw Error('Choose a surface for the joint.');
    result=copyParts(parts,source,destination,v(point),v(normal).normalize(),sample,mount);
  }
  validateLibrary(next);
  if (new Blob([JSON.stringify(next)]).size>MAX_LIBRARY_BYTES) throw Error('Insertion would exceed the library save limit.');
  return {...result,library:next};
}
