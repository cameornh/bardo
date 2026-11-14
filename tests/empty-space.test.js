import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {terrainCeilings,firstTerrainEntry,BOUND_MARGIN} from '../src/rtx-sand-lab/empty-space/bounds.js';
import {boundTraceShader,installEmptySpace} from '../src/rtx-sand-lab/empty-space/experiment.js';
import {SAND_TRACE_GLSL,SAND_BOUNDS_GLSL} from '../src/sand-lab/surface-trace.js';
import {EDGE_TRACE_GLSL} from '../src/rtx-sand-lab/edge-mirage.js';
let seed=71;function random(){seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;}
function field(n){const a=new Float32Array(n*n*4);for(let i=0;i<n*n;i++)a[i*4]=Math.sin(i*.31)+random()*4;return a;}
function height(a,n,x,z){const q=[Math.max(0,Math.min(n-1,(x+5.5)/11*(n-1))),Math.max(0,Math.min(n-1,(z+4.9)/9.8*(n-1)))],base=q.map(Math.floor),f=q.map((v,i)=>v-base[i]);const w=f.map(t=>[(1-t)**3/6,(3*t**3-6*t*t+4)/6,(-3*t**3+3*t*t+3*t+1)/6,t**3/6]);let h=0;for(let j=0;j<4;j++)for(let i=0;i<4;i++)h+=a[(Math.max(0,Math.min(n-1,base[1]+j-1))*n+Math.max(0,Math.min(n-1,base[0]+i-1)))*4]*w[0][i]*w[1][j];return h;}
test('positive cubic support stays below each tile, including clamped outer terrain',()=>{
 for(const n of [2,17,31,42,256]){const a=field(n),b=terrainCeilings(a,n);for(let i=0;i<4000;i++){const x=random()*25-12.5,z=random()*25-12.5,cx=Math.max(0,Math.min(7,Math.floor((x+5.5)/11*8))),cz=Math.max(0,Math.min(7,Math.floor((z+4.9)/9.8*8)));assert.ok(height(a,n,x,z)<b[cz*8+cx]);}}
});
test('empty ray prefix never crosses terrain: downward, horizontal, upward, outside and inside origins',()=>{
 const n=31,a=field(n),b=terrainCeilings(a,n);
 for(let i=0;i<5000;i++){const o=[random()*40-20,random()*12-3,random()*40-20],d=[random()*2-1,random()*2-1,random()*2-1];if(i%4===0)d[i%3]=0;const l=Math.hypot(...d);d.forEach((v,k)=>d[k]=v/l);const entry=firstTerrainEntry(o,d,b);assert.ok(entry>=0&&entry<=75);for(let j=0;j<24;j++){const t=entry*(j+.5)/24,p=o.map((v,k)=>v+d[k]*t);if(entry>1e-6)assert.ok(p[1]>height(a,n,p[0],p[2]),JSON.stringify({o,d,entry,t}));}}
});
test('parallel boundary rays and exact corners terminate conservatively',()=>{
 const b=new Float32Array(64).fill(1+BOUND_MARGIN);
 assert.equal(firstTerrainEntry([0,2,0],[0,0,0],b),75);
 assert.equal(firstTerrainEntry([0,0,0],[0,1,0],b),0);
 for(const x of [-50,-5.5,-4.125,0,5.5,50])for(const z of [-50,-4.9,0,4.9,50])for(const d of [[0,-1,0],[1,0,0],[-1,0,-1],[0,1,0]]){const e=firstTerrainEntry([x,5,z],d,b);assert.ok(Number.isFinite(e)&&e>=0&&e<=75);}
});
test('new edits and resolution resets immediately change ceiling values',()=>{
 const a=new Float32Array(31*31*4),before=terrainCeilings(a,31);a[(15*31+15)*4]=7;const after=terrainCeilings(a,31);assert.ok(after.some((v,i)=>v>before[i]));assert.ok(after.every(v=>v<7.01));a.fill(0);assert.deepEqual(terrainCeilings(a,31),before);assert.equal(terrainCeilings(new Float32Array(42*42*4),42).length,64);
});
test('bounds reject unsupported or nonfinite inputs',()=>{for(const n of [0,1,257])assert.throws(()=>terrainCeilings(new Float32Array(16),n));const a=new Float32Array(16);a[0]=NaN;assert.throws(()=>terrainCeilings(a,2),/Nonfinite/);});
test('near-hit logic and intentional mirage stepping remain original',()=>{
 const source=SAND_BOUNDS_GLSL+SAND_TRACE_GLSL+EDGE_TRACE_GLSL,next=boundTraceShader(source),edge=next.slice(next.indexOf('float traceEdgeOpaque'));
 assert.match(next,/firstSandEntry\(o,d,min\(hit,75\.\)\)/);assert.match(next,/start-\.01/);assert.ok(edge.endsWith(EDGE_TRACE_GLSL.slice(EDGE_TRACE_GLSL.indexOf('float t=.00001,last=t;'))));assert.ok(next.includes('for(int j=0;j<12;j++){float m=(lo+hi)*.5;if(labOpaque(o+d*m)>0.)lo=m;else hi=m;}'));
 assert.equal(boundTraceShader('void main(){}'),'void main(){}');
});
test('secondary-only variant leaves primary march untouched and rejects above the shared global ceiling',()=>{
 const source=SAND_BOUNDS_GLSL+SAND_TRACE_GLSL+EDGE_TRACE_GLSL,next=boundTraceShader(source,{primary:false,quick:true});
 assert.ok(next.endsWith(EDGE_TRACE_GLSL));
 assert.match(next,/min\(o.y,o.y\+d.y\*limit\)>uSandSkyCeiling/);
});
test('CPU fallback rebuilds only for changed geometry, restores reference and guards queued disposal',async()=>{
 let syncs=0;const sand={n:2,data:new Float32Array(16),bedGeometryRevision:1},material=new THREE.ShaderMaterial({fragmentShader:SAND_BOUNDS_GLSL+SAND_TRACE_GLSL+EDGE_TRACE_GLSL}),scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));
 const draw={lab:{sand,syncSandUniforms(){syncs++;}},renderer:{commands:[]},splitSurfaces:new Map([[0,{jobs:()=>[{scene}]}]]),render(){}};
 const e=await installEmptySpace(draw,{cpu:true});draw.render();assert.equal(e.updates,1);assert.equal(syncs,1);assert.notEqual(scene.children[0].material,material);
 for(let i=0;i<12;i++){sand.data[1]=i/12;draw.render();}assert.equal(e.updates,1);assert.equal(syncs,1);
 sand.data[0]=3;sand.bedGeometryRevision++;draw.render();assert.equal(e.updates,2);assert.ok(e.texture.image.data[0]>3);
 draw.lab.sand={...sand,data:new Float32Array(16)};draw.render();assert.equal(e.updates,3);
 e.enabled=false;draw.render();assert.equal(scene.children[0].material,material);assert.equal(e.updates,3);
 e.enabled=true;draw.lab.sand.n=257;draw.render();assert.equal(scene.children[0].material.uniforms.uEmptySpaceBounds.value,false);assert.equal(e.updates,3);
 draw.renderer.commands.push({});assert.throws(()=>e.dispose(),/Flush/);draw.renderer.commands.length=0;e.dispose();assert.equal(scene.children[0].material,material);scene.children[0].geometry.dispose();material.dispose();
});
