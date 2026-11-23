import test from 'node:test';
import assert from 'node:assert/strict';
import {Color,Matrix4,Mesh,MeshBasicMaterial,Raycaster,Vector3} from 'three';
import {lightPathBench,opticsBench} from '../src/asset-studio/studio-equipment.js';
import {partMatrix} from '../src/asset-studio/view.js';
import {polishedShape,traceOptic,transformedOptic,shapeHit,opticalDistance,opticalHit} from '../src/asset-studio/polished-shapes.js';
import {revolvedOptic} from '../src/asset-studio/revolved-optic.js';
import {polishedShell} from '../src/asset-studio/polished-shell.js';
import {groundFocus,beamGain} from '../src/asset-studio/ground-caustics.js';
import {capillaryStrength} from '../src/asset-studio/capillary-sand.js';
import {sandMaterial} from '../src/sand-lab/sand-material.js';

const V=(...v)=>new Vector3(...v);
const lib=opticsBench(),glass=lib.materials.find(m=>m.id==='optical-glass');
function optic(form,mat='optical-glass',matrix=new Matrix4()){
 const a=lib.assets.find(a=>a.id==='equipment-'+mat+'-'+form);
 return transformedOptic(polishedShape(a.parts[0].stamps),matrix);
}
test('parallel rays converge through both convex interfaces and diverge through the carved negative lens',()=>{
 for(const offset of [.04,.12,.22]){
  const start=V(offset,.54,3),d=V(0,0,-1);
  const convex=traceOptic(optic('convex'),start,d,glass),concave=traceOptic(optic('concave'),start,d,glass);
  assert.ok(convex.origin.z<0&&convex.direction.x<0);
  assert.ok(concave.origin.z<0&&concave.direction.x>0);
  assert.ok(Math.abs(convex.origin.x+convex.direction.x*1.5)<offset*.35);
  const unchanged=traceOptic(optic('convex'),start,d,{...glass,ior:1});
  assert.ok(unchanged.direction.distanceTo(d)<1e-9);
 }
 const cup=optic('cup');
 const hit=shapeHit(cup.shape,V(0,2,0),V(0,-1,0));
 assert.ok(hit.point.y<.2&&hit.normal.y>.99);
});
test('rasterized cup and carved lens agree with their analytic front surfaces',()=>{
 for(const [form,start,dir] of [['cup',V(.015,2,.02),V(0,-1,0)],['concave',V(.04,.57,2),V(0,0,-1)]]){
  const {shape}=optic(form),expected=shapeHit(shape,start,dir);
  const mesh=new Mesh(polishedShell(shape),new MeshBasicMaterial());
  const [hit]=new Raycaster(start,dir).intersectObject(mesh);
  assert.ok(hit&&Math.abs(hit.distance-expected.t)<.012);
  assert.ok(hit.face.normal.dot(expected.normal)>.97);
  mesh.geometry.dispose();mesh.material.dispose();
 }
});
test('the compact shell follows the carved profile and the blocker path respects through-holes',()=>{
 for(const form of ['cup','concave']){
  const {shape}=optic(form),g=revolvedOptic(shape,false);
  assert.ok(g&&g.index.count/3<3000);g.dispose();
  // An eccentric cavity has no shared revolution axis.
  const cut=shape.primitives[1];cut.center.x+=.065;cut.center.z+=.07;cut.center.y+=.085;
  assert.equal(revolvedOptic(shape,false),null);
 }
 const ring=polishedShape([{mode:'add',shape:'box',position:[0,0,0],size:[1,1,.12]},
  {mode:'subtract',shape:'sphere',position:[0,0,0],size:[.65,.65,2]}]);
 const matrix=new Matrix4().makeScale(1.5,.8,.7).setPosition(.2,1,3),o=transformedOptic(ring,matrix),dir=V(0,0,-1);
 for(const x of [0,.25,.8,.99,1.1]){
  const start=V(x,0,0).applyMatrix4(matrix);start.z+=4;
  const d=opticalDistance(o,start,dir);
  assert.equal(d,opticalHit(o,start,dir)?.t??Infinity);
  assert.equal(Number.isFinite(d),x>.65&&x<1);
 }
});
test('mirror steers the central ray onto the floor and sunlight produces a focused spot',()=>{
 const l=lightPathBench();
 const placed=id=>{const inst=l.world.instances.find(i=>i.assetId===id);const p=l.assets.find(a=>a.id===id).parts[0];
  return transformedOptic(polishedShape(p.stamps),partMatrix(inst.transform,[0,0,0]));};
 const mirror=placed('bench-plane-mirror'),mirrorMaterial=l.materials.find(m=>m.id==='silver-mirror');
 const reflected=traceOptic(mirror,V(1.35,1.55,-2.35),V(0,0,1),mirrorMaterial);
 assert.ok(reflected.direction.y<-.8&&reflected.direction.z>.49);
 const red={position:V(1.35,1.55,-2.35),direction:V(0,0,1),limit:Math.cos(Math.PI/18),range2:.1,color:new Color(4,0,0)};
 const patch=groundFocus(mirror,mirrorMaterial,red);
 assert.ok(patch.length);assert.ok(patch.every(s=>Math.abs(s.shape.x-1.35)<.01&&s.shape.y>.7&&s.light.x>0&&s.light.y===0));
 assert.equal(groundFocus(mirror,mirrorMaterial,{...red,direction:V(0,0,-1)}).length,0);
 const lens=placed('equipment-optical-glass-convex'),sun={direction:V(0,-1,0),color:new Color(1,1,1)};
 const a=groundFocus(lens,glass,sun),flat=groundFocus(lens,{...glass,ior:1},sun);
 assert.ok(a[0].light.x>flat[0].light.x*2);
 const dark=groundFocus(lens,glass,sun,null,[{...transformedOptic(polishedShape([{mode:'add',shape:'box',position:[-1.35,1,0],size:[10,.1,10]}]),new Matrix4()),center:V(-1.35,1,0),radius:15}]);
 assert.equal(dark.length,0);
 assert.equal(beamGain(-1,-1),1);
});
test('damp grains retain more structure across the moisture range and dried grains retain their original memory',()=>{
 let prior=0;
 for(const wet of [.1,.25,.5,.75,1]){
  const strength=capillaryStrength(wet,wet),old=sandMaterial(wet,wet);
  assert.ok(strength.adhesion>old.adhesion&&strength.yield>old.shapeYield&&strength.yield>prior);prior=strength.yield;
 }
 assert.deepEqual(capillaryStrength(0,0),{adhesion:0,yield:0});
 assert.equal(capillaryStrength(0,1).yield,sandMaterial(0,1).shapeYield);
});
