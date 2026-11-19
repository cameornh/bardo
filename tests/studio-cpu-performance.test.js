import test from 'node:test';
import assert from 'node:assert/strict';
import {seedLibrary,stamp} from '../src/asset-studio/model.js';
import {gridSpec,sampleGridCPU,extractSurface,bakeCPU} from '../src/asset-studio/sculpt.js';
import {sampleGridFast,extractSurfaceFast,bakeFast} from '../src/asset-studio/sculpt-fast.js';
test('allocation-light sculpt samples and complete surfaces match reference exactly',()=>{
 const l=seedLibrary(),fixtures=l.assets.flatMap(a=>a.parts.map(p=>p.stamps));
 for(let i=0;i<8;i++){const stamps=[];for(let j=0;j<16;j++)stamps.push(stamp(j%3===0?'box':j%3===1?'capsule':'sphere',j%5===4?'paint':j%4===3?'subtract':'add',[Math.sin(j*3.1+i)*.8,Math.cos(j*.7)*.6,Math.cos(j*1.1)*.7],[.18+j%3*.1,.25,.2],l.materials[j%l.materials.length].id,.09));fixtures.push(stamps);}
 fixtures.push([]);
 for(const stamps of fixtures){const g=gridSpec(stamps,.13);if(g){const a=sampleGridCPU(stamps,g),b=sampleGridFast(stamps,g);assert.deepEqual(b,a,'grid');assert.deepEqual(extractSurfaceFast(b,g,stamps),extractSurface(a,g,stamps),'surface');}else assert.deepEqual(bakeFast(stamps,.1),bakeCPU(stamps,.1));}
});
test('material ties, boundary zeroes and truncated grids keep reference ordering',()=>{
 const s=seedLibrary().assets[0].parts[0].stamps,g={dims:[33,33,33],origin:[0,0,0],h:.1,count:33**3},data=new Float32Array(g.count*2);for(let i=0;i<g.count;i++)data[i*2]=i%2?-1:1;
 assert.deepEqual(extractSurfaceFast(data,g,s),extractSurface(data,g,s));
});

test('conservative picking keeps exact hits through rotation, nonuniform scale, misses and inside rays',async()=>{
 const THREE=await import('three'),{StudioView}=await import('../src/asset-studio/view.js'),l=seedLibrary(),view=Object.create(StudioView.prototype);view.cache=new Map();view.surfaces=new Map();view.groups=new Map();
 for(let i=0;i<3;i++){const a=l.assets[i],group=new THREE.Group();group.userData={assetId:a.id,instanceId:'copy-'+i};group.position.set(i*3-3,.15,i-1);group.scale.set(.8+i*.1,1.3,.7);group.rotation.set(.1*i,.4*i,-.15*i);view.groups.set('copy-'+i,group);
  for(const p of a.parts){const s=bakeCPU(p.stamps,.14),key=a.id+':'+p.id,obj=new THREE.Group();obj.userData={partId:p.id};group.add(obj);view.surfaces.set(key,s);view.cache.set(key,view.geometry(s,l.materials));}group.updateMatrixWorld(true);
 }
 const ray=new THREE.Ray();view.ray=()=>ray;
 for(let i=0;i<500;i++){ray.origin.set(Math.sin(i*.3)*8,Math.sin(i*.12)*3+2,Math.cos(i*.23)*8);ray.direction.set(Math.sin(i*.91),-.2+Math.cos(i*.37),Math.cos(i*.41)).normalize();assert.deepEqual(view.pick(null,{optimized:true}),view.pick(null,{optimized:false}),'ray '+i);}
 for(const g of view.cache.values())g.dispose();
});

test('worker accepts exact fast extraction from GPU-shaped buffers and retains CPU reference',async()=>{
 const previous=globalThis.self,answers=[];globalThis.self={postMessage:r=>answers.push(r)};
 try{await import('../src/asset-studio/bake-worker.js');const stamps=seedLibrary().assets[1].parts[0].stamps,grid=gridSpec(stamps,.1),values=sampleGridCPU(stamps,grid);
  for(const optimized of [false,true])for(const sampled of [false,true])self.onmessage({data:{id:answers.length,stamps,spacing:.1,optimized,...(sampled?{grid,values}:{})}});
  for(const answer of answers){assert.equal(answer.error,undefined);assert.deepEqual(answer.surface,answers[0].surface);}
 }finally{globalThis.self=previous;}
});
