import test from 'node:test';
import assert from 'node:assert/strict';
import {Euler,Quaternion,Vector3} from 'three';
import {clone,asset,newStudioLibrary,part,stamp,validateLibrary,LIMITS} from '../src/asset-studio/model.js';
import {familySampler,defaultVariation,pickFamilyMember} from '../src/asset-studio/family.js';
import {insertSelection,reusableContents} from '../src/asset-studio/assembly.js';
import {brushCopies,markProfile,ribbonWidth,supportedMark} from '../src/asset-studio/gaussian-marks.js';
import {jointDefaults} from '../src/asset-studio/physics-data.js';
import {exportAsset,importAsset,exportFamily,importFamily} from '../src/asset-studio/asset-package.js';
import {materialBench,studioTests,workbenchStore} from '../src/asset-studio/workbenches.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';

function libraryWithModule(){
  const library=newStudioLibrary(),dest=library.assets[0],source=asset('Linkage');
  const hub=part('Hub',[stamp('box','add',[0,0,0],[1,1,1],'wood')]);
  const arm=part('Arm',[stamp('sphere','add',[0,2,0],[.5,.5,.5],'wood')]);
  hub.physics={fixed:true};hub.transform.position=[4,0,0];
  arm.pivot=[0,2,0];arm.transform.position=[4,0,0];arm.transform.rotation=[0,0,32];
  arm.joint={...jointDefaults(),type:'hinge',parentId:hub.id,anchor:[4,1,0],axis:[0,1,0]};
  arm.keys=[{...clone(arm.transform),time:2}];arm.forceKeys=[{time:4,force:[2,0,0],torque:[0,4,0]}];
  hub.marks=[{id:'painted',kind:'ribbon',root:[0,1,0],axis:[0,1,0],up:[0,0,1],length:.5,width:.28,
    curl:.3,flex:.5,bias:1.37,taper:.13,materialId:'wood'}];
  source.duration=4;source.parts=[arm,hub];library.assets.push(source);
  const opts={destinationId:dest.id,sourceId:source.id,hostId:dest.parts[0].id,point:[0,1.2,0],localPoint:[0,1.2,0],seed:42};
  return {library,source,hub,arm,dest,opts};
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,a+' differs from '+b);
test('editable assembly preserves a rotated mechanism, internal joint frames, timeline phase and source',()=>{
  const {library,source,hub,opts}=libraryWithModule(),original=JSON.stringify(library);
  source.variation={...defaultVariation,size:.5,twist:45};
  const variant=familySampler(source.variation,opts.seed);
  const result=insertSelection(library,{...opts,normal:[1,0,0],jointType:'fixed'});
  const [host,arm,root]=result.library.assets[0].parts;
  assert.notEqual(root.id,hub.id);assert.equal(result.partId,root.id);
  assert.equal(root.physics.fixed,false);assert.equal(root.joint.parentId,host.id);
  assert.equal(arm.joint.parentId,root.id);assert.deepEqual(root.transform.position,opts.point);
  assert.equal(arm.forceKeys[0].time,3);assert.equal(arm.keys[0].time,1.5);
  const offset=new Vector3(...arm.transform.position).add(new Vector3(...arm.pivot)).sub(new Vector3(...opts.point));
  close(offset.x,2*variant.size);close(offset.length(),offset.x);
  close(arm.joint.anchor[0],opts.point[0]+variant.size);close(arm.joint.axis[0],1);
  const q=new Quaternion().setFromEuler(new Euler(...root.transform.rotation.map(d=>d*Math.PI/180)));
  close(new Vector3(0,1,0).applyQuaternion(q).x,1);
  assert.notEqual(root.marks[0].id,hub.marks[0].id);
  assert.equal(result.library.assets[0].duration,3);
  delete source.variation;assert.equal(JSON.stringify(library),original);
});
test('a reused Gaussian attaches to a new surface with its curl, frame, paint and hinge, without adding a body',()=>{
  const {library,dest,source,hub,opts}=libraryWithModule();
  const m=hub.marks[0];source.variation={...defaultVariation,size:.2,width:.6,curl:.1,twist:30};
  const content='detail:'+hub.id+':'+m.id;
  const config={...opts,content,point:[.6,.6,0],localPoint:[.6,.6,0]};
  const first=insertSelection(library,config),host=first.library.assets[0].parts[0],copy=host.marks[0];
  assert.equal(first.library.assets[0].parts.length,1);assert.equal(dest.parts[0].marks,undefined);
  assert.ok(supportedMark(host,copy,new Map(library.materials.map(m=>[m.id,m]))));
  close(copy.axis[0],1);assert.equal(copy.materialId,m.materialId);assert.equal(copy.flex,m.flex);
  const repeat=insertSelection(library,config).library.assets[0].parts[0].marks[0];
  assert.deepEqual({...copy,id:repeat.id},repeat);
  assert.notEqual(copy.width,insertSelection(library,{...config,seed:43}).library.assets[0].parts[0].marks[0].width);
  assert.throws(()=>insertSelection(library,{...config,localPoint:[14,0,0]}),/surface/);
  host.stamps[0].materialId='water';assert.throws(()=>insertSelection(first.library,config),/retain/);
  assert.ok(reusableContents(source).some(e=>e.id===content));
});
test('named-part families sample continuous seeded distributions and travel in single asset files',()=>{
  const {library,source,arm,hub,opts}=libraryWithModule();
  source.variation={...defaultVariation,distribution:'centered',size:.54,twist:37};
  const selection=new Set();
  for(let seed=0;seed<12;seed++){
    const {library:next}=insertSelection(library,{...opts,content:'sample',seed});
    const p=next.assets[0].parts.at(-1);selection.add(p.name);assert.ok(!p.joint);
  }
  assert.deepEqual(selection,new Set([arm.name,hub.name]));
  const one=insertSelection(library,{...opts,content:'part:'+arm.id});
  assert.equal(one.library.assets[0].parts.at(-1).name,arm.name);
  const exported=exportAsset(library,source.id), imported=importAsset(newStudioLibrary(),JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(imported.asset.variation,source.variation);assert.equal(imported.asset.parts[0].joint.parentId,imported.asset.parts[1].id);
  const draws=distribution=>Array.from({length:4000},(_,n)=>familySampler({...source.variation,distribution},n).size);
  const variance=arr=>arr.reduce((n,v)=>n+(v-1)**2,0)/arr.length;
  const centered=draws('centered'),uniform=draws('uniform');
  assert.ok(variance(centered)<variance(uniform)*.56);assert.ok(new Set(uniform).size>3900);
  assert.ok(centered.concat(uniform).every(x=>x>=.46&&x<=1.54));
  assert.deepEqual([familySampler().size,Math.abs(familySampler().twist)],[1,0]);
  source.variation.size=1.01;assert.throws(()=>validateLibrary(library),/variation/);
});
test('weighted families sample complete authored assets or supported details and merge portable dependencies atomically',()=>{
  const {library,dest,source,hub,opts}=libraryWithModule();
  const f={id:'collection',name:'Mechanical parts',members:[{assetId:source.id,weight:3},{assetId:dest.id,weight:1}]};
  library.families=[f];validateLibrary(library);
  const bundle=JSON.parse(JSON.stringify(exportFamily(library,f.id)));
  assert.deepEqual(new Set(bundle.materials.map(m=>m.id)),new Set(['wood','clay']));
  const before=JSON.stringify(library),merged=importFamily(library,bundle);
  assert.equal(JSON.stringify(library),before);
  assert.notEqual(merged.family.id,f.id);
  assert.deepEqual(merged.family.members.map(m=>m.weight),[3,1]);
  assert.ok(merged.family.members.every(m=>!f.members.some(old=>old.assetId===m.assetId)));
  assert.equal(merged.library.materials.length,library.materials.length);
  const file=exportFamily(merged.library,merged.family.id);
  assert.equal(file.assets[0].parts[0].joint.parentId,file.assets[0].parts[1].id);
  const config={...opts,sourceId:'family:'+f.id};
  for (let seed=0;seed<20;seed++){
    const id=pickFamilyMember(f.members,seed),sample=insertSelection(library,{...config,seed});
    assert.equal(sample.count,library.assets.find(a=>a.id===id).parts.length);
  }
  const picks=Array.from({length:2000},(_,i)=>pickFamilyMember(f.members,i)).filter(id=>id===source.id);
  assert.ok(picks.length>1400&&picks.length<1600);
  const detail=insertSelection(library,{...config,content:'sampleDetail'});
  assert.equal(detail.library.assets[0].parts.length,1);
  assert.equal(detail.library.assets[0].parts[0].marks[0].bias,hub.marks[0].bias);
  bundle.family.members[0].weight=-1;
  assert.throws(()=>importFamily(library,bundle),/family member/);assert.equal(JSON.stringify(library),before);
});
test('self-insertion and rejected operations never rewrite the original',()=>{
  const {library,source,dest,opts}=libraryWithModule(),length=source.parts.length;
  const nested=insertSelection(library,{...opts,destinationId:source.id});
  assert.equal(nested.library.assets[1].parts.length,length*2);assert.equal(source.parts.length,length);
  while(dest.parts.length<LIMITS.parts)dest.parts.push(part('Existing'));
  const before=JSON.stringify(library);
  assert.throws(()=>insertSelection(library,opts),/part count/);assert.equal(JSON.stringify(library),before);
});
test('legacy brush profiles migrate with the same silhouette, including arbitrary rotational symmetry',()=>{
  const {library,hub}=libraryWithModule(),saved=hub.marks[0];
  for(const [kind,curve] of [['leaf',t=>Math.sin(Math.PI*t)],['petal',t=>Math.sin(Math.PI*t**1.5)],['blade',t=>1-t]]){
    hub.marks=[{...saved,kind}];validateLibrary(library);const m=hub.marks[0];assert.equal(m.kind,'ribbon');
    for(let i=0;i<=100;i++)close(ribbonWidth(i/100,...markProfile(m)),curve(i/100));
  }
  assert.equal(brushCopies([1,2,0],11).length,11);
});
test('tests open fresh isolated worlds and a new personal library starts with one editable sculpt',async()=>{
  const fresh=newStudioLibrary();assert.equal(fresh.assets.length,1);assert.equal(fresh.world.instances.length,1);
  for(const test of studioTests.filter(t=>t.create)){
    const store=workbenchStore(test),a=(await store.load()).library;
    validateLibrary(a);a.world.instances=[];await store.save(a);
    assert.ok((await store.load()).library.world.instances.length);
  }
});
test('both electrical samples move under a nudge, fall under gravity, and open their real contact',async()=>{
  const library=materialBench(),sim=await StudioPhysics.create(library,'world','copper');
  try {
    const records=['copper','graphite'].map(id=>sim.get(id,'sample'));
    for(const r of records)assert.ok(r.body.isDynamic());
    const [a,b]=records,w=sim.materialWorld;
    const connected=()=>w.edges.some(e=>(e.a.record===a&&e.b.record===b)||(e.a.record===b&&e.b.record===a));
    w.apply(a.field.sites[0],'positive');w.apply(b.field.sites[1],'return');
    for(let i=0;i<60;i++)sim.step();
    assert.ok(connected());assert.ok(b.field.sites.some(s=>s.watts>.01));
    const start=records.map(r=>r.body.translation());
    records.forEach((r,i)=>sim.addPulse(r.key,new Vector3(),new Vector3((i?1:-1)*650,1800,0),.10));
    for(let i=0;i<20;i++)sim.step();
    for(const [i,r] of records.entries()){
      assert.ok(r.body.translation().y>start[i].y+.05);
      assert.ok(Math.abs(r.body.translation().x-start[i].x)>.04);
    }
    for(let i=0;i<480;i++)sim.step();
    assert.equal(connected(),false);assert.ok(b.field.sites.every(s=>s.watts<.01));
    for(const [i,r] of records.entries())assert.ok(r.body.translation().y<start[i].y+.6);
  } finally {sim.dispose();}
});
