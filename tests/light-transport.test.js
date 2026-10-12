import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLightScene, MEDIUM, SHAPE, RAY_EPS, mediumAt, nearestBoundary, interfaceEvent, pointAt, norm, dot, refractDirection, reflectDirection, materialIOR, floatingHeight, submergedVolume } from '../src/light-transport.js';
import { tracePhotons, emissionRay, integratedFlux } from '../src/photon-map.js';
import { lightSurfaceGaussians } from '../src/light-gaussians.js';
import { allocateBudget } from '../src/lod.js';
const close=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
function transmittedPath(scene,origin,direction,max=48){
 const hits=[];for(let i=0;i<max;i++){
  const hit=nearestBoundary(scene,origin,direction);if(!hit)return {hits,escaped:true};hits.push(hit);
  if(hit.receiver!==undefined)return {hits,point:hit.point,direction};
  if(hit.mirror||hit.before!==hit.after){const event=interfaceEvent(hit,direction,1);direction=event.transmitted||event.reflected;}
  origin=pointAt(hit.point,direction,RAY_EPS*3);
 }return {hits,truncated:true};
}
test('Snell law, reflection, and the critical angle use the two adjacent media',()=>{
 const theta=Math.PI/3,d=[Math.sin(theta),-Math.cos(theta),0],n=[0,1,0],g=materialIOR(MEDIUM.GLASS),w=materialIOR(MEDIUM.WATER);
 const t=refractDirection(d,n,1,g);close(g*t[0],d[0]);close(Math.hypot(...t),1);
 const r=reflectDirection(d,n);close(r[0],d[0]);close(r[1],-d[1]);
 assert.equal(refractDirection(d,n,g,1),null);assert.ok(refractDirection(d,n,g,w));
 const f=interfaceEvent({before:0,after:1,normal:n},[0,-1,0],1);close(f.reflectance,((g-1)/(g+1))**2);
});
test('tank rays encounter glass, water, shell, cavity, shell, and water in order',()=>{
 const scene=makeLightScene({experiment:'tank',wave:0});let o=[-4,1.4,-.35],d=[1,0,0],transitions=[];
 for(let i=0;i<20;i++){const h=nearestBoundary(scene,o,d,{receivers:false});if(!h)break;if(h.before!==h.after)transitions.push([h.before,h.after]);o=pointAt(h.point,d,RAY_EPS*3);}
 assert.deepEqual(transitions.slice(0,6),[[0,1],[1,2],[2,1],[1,0],[0,1],[1,2]]);
 assert.equal(mediumAt(scene,scene.floats[0].center),MEDIUM.AIR);assert.equal(mediumAt(scene,[0,.5,0]),MEDIUM.WATER);assert.equal(mediumAt(scene,[0,.05,0]),MEDIUM.GLASS);
});
test('coincident receiver and glass bottom do not generate a random air gap / TIR',()=>{
 const scene=makeLightScene({experiment:'tank'});let previous;
 for(let x=-.04;x<=.04;x+=.001){const origin=[5.6,4.2,6.4],ray=transmittedPath(scene,origin,norm([x-origin[0],1-origin[1],-origin[2]]));
  assert.ok(ray.point);assert.ok(ray.hits.length<=6);close(ray.point[1],0);
  if(previous)assert.ok(Math.hypot(...ray.point.map((v,i)=>v-previous[i]))<.002);previous=ray.point;
 }
});
test('parallel glass slab preserves the outgoing direction and displaces the ray',()=>{
 const scene={volumes:[{id:0,type:SHAPE.BOX,medium:1,center:[0,2,0],size:[2,.2,2],rotation:0,params:[0,0,0,0]}]},o=[0,4,0],d=norm([.4,-1,0]);const ray=transmittedPath(scene,o,d);
 assert.ok(ray.point);for(let k=0;k<3;k++)close(ray.direction[k],d[k],1e-7);assert.ok(ray.point[0]<1.6&&ray.point[0]>1.5);
});
function footprint(experiment){const s=makeLightScene({experiment,spread:0}),points=[];for(let x=-.7;x<=.701;x+=.1){const o=[...s.light.origin];o[0]+=x;const r=transmittedPath(s,o,s.light.direction);assert.ok(r.point);points.push(r.point);}
 const center=points.reduce((s,p)=>s.map((x,i)=>x+p[i]/points.length),[0,0,0]);return Math.sqrt(points.reduce((s,p)=>s+p.reduce((v,x,i)=>v+(x-center[i])**2,0),0)/points.length);
}
test('convex lens concentrates and concave lens spreads a parallel bundle',()=>{assert.ok(footprint('convex')<.08);assert.ok(footprint('concave')>.9);});
test('parabolic mirror focuses the reflected bundle; plane mirror preserves its width',()=>{close(footprint('flat-mirror'),Math.sqrt(2.8/15),1e-8);assert.ok(footprint('concave-mirror')<.003);});
test('photon energy is accounted for and receiver filtering conserves flux in every setup',()=>{
 for(const experiment of ['sphere','convex','concave','prism','water','flat-mirror','concave-mirror','tank']){
  const r=tracePhotons(makeLightScene({experiment,photons:1500}),{size:48,paths:0}),l=r.ledger;
  close(l.emitted,l.receiver+l.absorbed+l.escaped+l.truncated,1e-8);close(integratedFlux(r.direct,r.size),l.direct,1e-5);close(integratedFlux(r.caustic,r.size),l.caustic,1e-5);assert.ok(l.caustic>0);
  assert.ok(r.direct.every(Number.isFinite)&&r.caustic.every(Number.isFinite));
 }
});
test('wave curvature redistributes photon irradiance without a prescribed caustic texture',()=>{
 function contrast(wave){const r=tracePhotons(makeLightScene({experiment:'water',wave,spread:0}),{count:6000,size:64,gather:.09,paths:0}),v=[];
  for(let y=25;y<39;y++)for(let x=25;x<39;x++){const i=(x+y*64)*4;v.push(r.caustic[i]+r.caustic[i+1]+r.caustic[i+2]);}const mean=v.reduce((a,b)=>a+b)/v.length;return Math.sqrt(v.reduce((s,x)=>s+(x-mean)**2,0)/v.length)/mean;
 }assert.ok(contrast(.14)>contrast(0)*3);
});
test('photon count changes variance, not emitted energy; colored light stays in its channel',()=>{
 for(const color of ['white','red','green','blue']){
  const s=makeLightScene({experiment:'convex',source:'laser',color}),r=tracePhotons(s,{count:300,size:32,paths:0});close(r.ledger.emitted,s.light.power,1e-8);
  if(color!=='white'){const channel=['red','green','blue'].indexOf(color);for(const map of [r.direct,r.caustic])for(let i=0;i<map.length;i+=4)for(let c=0;c<3;c++)if(c!==channel)assert.equal(map[i+c],0);}
 }
 const s=makeLightScene({experiment:'convex'}),a=tracePhotons(s,{count:600,size:32,paths:0}),b=tracePhotons(s,{count:2400,size:32,paths:0});close(a.ledger.emitted,b.ledger.emitted,1e-8);assert.ok(Math.abs(a.ledger.receiver-b.ledger.receiver)/b.ledger.receiver<.04);
});
test('dispersion separates refracted wavelengths; RGB lasers have distinct origins',()=>{
 const d=norm([.6,-1,0]),n=[0,1,0],red=refractDirection(d,n,1,materialIOR(1,0,true)),blue=refractDirection(d,n,1,materialIOR(1,2,true));assert.ok(red[0]>blue[0]);
 const scene=makeLightScene({source:'rgb'}),rays=[0,1,2].map(i=>emissionRay(scene,i,300));assert.deepEqual(rays.map(r=>r.channel),[0,1,2]);assert.ok(Math.hypot(...rays[0].origin.map((x,i)=>x-rays[2].origin[i]))>1);
});
test('sealed glass shells float according to displaced water and sink when too massive',()=>{
 const a=floatingHeight(.43,.024,1.45),b=floatingHeight(.43,.04,1.45);assert.ok(a.floating&&b.floating);assert.ok(b.y<a.y);close(1000*submergedVolume(.43,1.45+.43-a.y),a.mass,1e-8);
 assert.equal(floatingHeight(.43,.15,1.45).floating,false);
});
test('optical Gaussian hierarchy preserves moments and stays within the visual budget',()=>{
 const groups=lightSurfaceGaussians(makeLightScene({experiment:'tank'}));
 for(const group of groups){const mass=group.levels[0].nodes.reduce((s,g)=>s+g.mass,0);for(const level of group.levels){close(level.nodes.reduce((s,g)=>s+g.mass,0),mass,1e-7);assert.ok(level.nodes.every(g=>g.cov.every(Number.isFinite)&&g.tau>0));}}
 for(const speed of [1,4,20]){const allocation=allocateBudget(groups.map(g=>({...g,scale:90})),2*speed,16000);assert.ok(allocation.cost<=16000);}
});

test('a prism separates white wavelengths on the receiver and changing its angle changes the path',()=>{
 function trace(channel,angle,dispersion){const scene=makeLightScene({experiment:'prism',prismAngle:angle,dispersion});let o=scene.light.origin,d=scene.light.direction,tir=0;
  for(let i=0;i<20;i++){const h=nearestBoundary(scene,o,d);assert.ok(h);if(h.receiver!==undefined)return {point:h.point,tir};const e=interfaceEvent(h,d,channel,dispersion);if(!e.transmitted)tir++;d=e.transmitted||e.reflected;o=pointAt(h.point,d,RAY_EPS*3);}assert.fail('prism path failed to reach a receiver');
 }
 const red=trace(0,60,true),green=trace(1,60,true),blue=trace(2,60,true);assert.ok(red.point[2]<green.point[2]&&green.point[2]<blue.point[2]);assert.ok(blue.point[2]-red.point[2]>.3);
 assert.deepEqual(trace(0,60,false).point,trace(2,60,false).point);assert.ok(trace(1,90,false).tir>0);
});

test('a wave surface ending on the floor cannot invent a refracting water-air gap',()=>{
 const scene=makeLightScene({experiment:'water',wave:.2});
 for(let ix=-12;ix<=12;ix++)for(let iz=-12;iz<=12;iz++){
  const ray=transmittedPath(scene,[ix*.14,4,iz*.14],norm([.02,-1,.06]));assert.ok(ray.point);assert.equal(ray.hits.length,2);assert.equal(ray.hits[0].after,MEDIUM.WATER);assert.equal(ray.hits[1].receiver,0);
 }
});
