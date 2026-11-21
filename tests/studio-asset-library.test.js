import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {asset, part, stamp, seedLibrary, clone, LIMITS, validateLibrary} from '../src/asset-studio/model.js';
import {jointDefaults} from '../src/asset-studio/physics-data.js';
import {exportAsset, importAsset} from '../src/asset-studio/asset-package.js';
import {studioGeometry, updateMaterialAttribute} from '../src/asset-studio/surface-attributes.js';
import {StudioView} from '../src/asset-studio/view.js';

test('a portable sculpt carries paint, carve materials, joints and both animation tracks', () => {
  const src = seedLibrary(), stem = src.assets[2], arm = stem.parts[1];
  arm.joint = {...jointDefaults(), parentId:stem.parts[0].id};
  arm.forceKeys = [{time:.5, force:[1,2,3], torque:[0,0,2]}];
  arm.stamps.push(stamp('sphere','paint',undefined,undefined,'rubber'),stamp('box','subtract',undefined,undefined,'clay'));
  const file = JSON.parse(JSON.stringify(exportAsset(src, stem.id)));
  assert.deepEqual(file.materials.map(m => m.id), ['clay','bronze','wood','rubber']);
  assert.equal(file.world, undefined);
  const dest = seedLibrary(), before = clone(dest);
  const result = importAsset(dest, file);
  assert.deepEqual(dest, before);
  assert.equal(result.library.world, dest.world);
  assert.equal(result.library.assets[0], dest.assets[0]);
  assert.notEqual(result.asset.id, stem.id);
  assert.equal(result.asset.name, 'Animated stem (2)');
  assert.deepEqual(result.asset.parts, stem.parts);
  assert.equal(result.library.materials.length, dest.materials.length);
  assert.doesNotThrow(() => validateLibrary(JSON.parse(JSON.stringify(result.library))));
  result.asset.parts[0].stamps.length = 0;
  assert.equal(file.asset.parts[0].stamps.length, 1);
});

test('material conflicts preserve the local material and reuse an identical imported variation on later imports', () => {
  const dest = seedLibrary(), packageA = exportAsset(dest, 'arch');
  packageA.materials[0].tensileStrength += 23;
  const first = importAsset(dest, packageA);
  const local = dest.materials.find(m => m.id === 'stone'), variant = first.library.materials.at(-1);
  assert.notEqual(variant.id, local.id);
  assert.notEqual(variant.name, local.name);
  assert.equal(variant.tensileStrength, local.tensileStrength + 23);
  assert.ok(first.asset.parts[0].stamps.every(s => s.materialId === variant.id));
  const file = exportAsset(first.library, first.asset.id);
  assert.deepEqual(file.materials, [variant]);
  packageA.materials[0] = Object.fromEntries(Object.entries(packageA.materials[0]).reverse());
  const second = importAsset(first.library, packageA);
  assert.equal(second.library.materials.length, first.library.materials.length);
  assert.equal(second.asset.parts[0].stamps[0].materialId, variant.id);
  assert.equal(second.asset.name, 'Stone arch (3)');
});

test('conflict IDs cannot capture another material in the same file', () => {
  const dest = seedLibrary(), file = exportAsset(dest, 'arch');
  file.materials[0].color = '#0000ff';
  const reserved = {...file.materials[0], id:'stone-import-2', name:'Inlay'};
  file.materials.push(reserved);
  file.asset.parts[0].stamps.push(stamp('box','paint',undefined,undefined,reserved.id));
  const result = importAsset(dest, file);
  const refs = result.asset.parts[0].stamps.map(s => s.materialId);
  assert.notEqual(refs[0], reserved.id);
  assert.equal(refs.at(-1), reserved.id);
  assert.deepEqual(result.library.materials.find(m => m.id === reserved.id), reserved);
});

test('empty sculpts transfer without a material, while malformed or over-budget imports leave the destination untouched', () => {
  const dest = seedLibrary(), blank = asset('Blank');
  const emptyFile = exportAsset({...dest, assets:[blank]}, blank.id);
  assert.deepEqual(emptyFile.materials, []);
  assert.equal(importAsset(dest, emptyFile).asset.id, blank.id);
  const file = exportAsset(dest, 'arch');
  for (const modify of [
    f => f.version++, f => f.materials.length=0, f => f.materials[0].density=-1,
    f => f.asset.parts[0].joint={...jointDefaults(),parentId:'missing'},
    f => f.asset.parts[0].stamps[1].materialId='absent'
  ]) {
    const bad = clone(file), before = clone(dest);
    modify(bad);
    assert.throws(() => importAsset(dest, bad));
    assert.deepEqual(dest, before);
  }
  // Each file fits on its own, but their combined UTF-8 data must still be savable.
  const large = {...dest, note:'界'.repeat(2_790_000)};
  const extra = clone(file);extra.asset.note='界'.repeat(10_000);
  assert.throws(() => importAsset(large, extra), /save limit/);
  while(dest.materials.length < LIMITS.materials)dest.materials.push({...dest.materials[0], id:'m'+dest.materials.length});
  assert.equal(importAsset(dest, file).library.materials.length, LIMITS.materials);
  file.materials[0].roughness = .012;
  assert.throws(() => importAsset(dest, file), /material limit/);
});

test('editing Gaussian materials matches rebuilding all attributes, including fibre bounds and phase changes', () => {
  const lib = seedLibrary(), m = lib.materials[0], other = lib.materials[1];
  const surface = {spacing:.08, positions:[0,0,0,1,2,0,3,0,2], normals:[0,1,0,0,1,0,1,0,0], materials:[m.id,other.id,m.id]};
  other.fiberLength = .3;
  const optimized = studioGeometry(surface, lib.materials);
  const reference = () => StudioView.prototype.referenceGeometry.call({liveStudio:true}, surface, lib.materials);
  const compare = () => {
    const ref = reference();
    for (const [name, attr] of Object.entries(ref.attributes)) assert.deepEqual(optimized.getAttribute(name).array, attr.array, name);
    assert.ok(optimized.boundingBox.equals(ref.boundingBox));assert.ok(optimized.boundingSphere.equals(ref.boundingSphere));
    ref.dispose();
  };
  compare();
  const fixedBuffers = ['center','surfaceNormal','radius'].map(key => optimized.getAttribute(key));
  for(const [key,value] of Object.entries({color:'#00ccff',opacity:.7,roughness:.14,emission:.8,grainDepth:2.3,grainScale:3.7,phase:'granular',liquidity:1,fiberLength:.5})){
    m[key]=value;updateMaterialAttribute(optimized,surface,lib.materials,m,key);compare();
  }
  m.fiberLength=0;updateMaterialAttribute(optimized,surface,lib.materials,m,'fiberLength');compare();
  const versions = Object.values(optimized.attributes).map(a => a.version);
  updateMaterialAttribute(optimized,surface,lib.materials,m,'density');
  updateMaterialAttribute(optimized,surface,lib.materials,lib.materials[3],'color');
  assert.deepEqual(Object.values(optimized.attributes).map(a => a.version), versions);
  assert.deepEqual(fixedBuffers.map(a => a.version), [0,0,0]);
  optimized.dispose();
});

test('framing an imported multi-part sculpt fits far-offset, rotated shapes in a portrait viewport', () => {
  const a = asset('Remote');
  a.parts = [part('Stem',[stamp('capsule','add',[20,1,0],[.2,1,.2])]), part('Cap',[stamp('box','add',[20,3,0],[1.2,.2,.6])])];
  a.parts[1].pivot=[20,3,0];a.parts[1].transform.rotation=[0,45,0];a.parts[1].transform.scale=[2,1,1];
  const camera=new THREE.PerspectiveCamera(48,.6,.03,10000);
  camera.position.set(4,3,5);
  const controls={minDistance:.25,maxDistance:4000,target:new THREE.Vector3(),update(){camera.lookAt(this.target);camera.updateMatrixWorld();}};
  StudioView.prototype.frameAuthoredAsset.call({camera,controls},a);
  assert.ok(Math.abs(controls.target.x-20)<.1);
  for(const p of [[20,-.2,0],[20,2.2,0],[21.7,3,-1.7],[18.3,3,1.7]]){
    const projected=new THREE.Vector3(...p).project(camera);
    assert.ok(Math.max(Math.abs(projected.x),Math.abs(projected.y),Math.abs(projected.z))<=1);
  }
});
