import * as THREE from 'three';
import {looseKind} from './loose-matter.js';
import {grainParams} from './surface-grain.js';

const affected = {
  color:'tint', roughness:'properties', metallic:'properties', opacity:'properties', emission:'properties',
  grainDepth:'grainSettings', grainLength:'grainSettings', grainScale:'grainSettings',
  phase:'phaseId', liquidity:'phaseId', fiberLength:'fiberLength'
};

function appearance(m, index) {
  return {
    tint:new THREE.Color(m.color).toArray(), properties:[m.roughness, m.metallic, m.opacity, m.emission],
    grainSettings:grainParams(m), phaseId:[m.phase==='gas'?1:looseKind(m), index], fiberLength:[Math.fround(m.fiberLength || 0)]
  };
}

function setBounds(geometry, surface, maxFiber) {
  geometry.boundingBox = new THREE.Box3().setFromArray(surface.positions).expandByScalar(2 * (surface.spacing + maxFiber));
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
}

// The same sculpt may be placed many times. All placements share the attribute
// buffers and use the material indices of the owning library.
export function studioGeometry(surface, materials) {
  const count = surface.positions.length / 3;
  const geometry = new THREE.InstancedBufferGeometry();
  const attribute = (name, array, size) => geometry.setAttribute(name, new THREE.InstancedBufferAttribute(array, size));
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0], 3));
  geometry.setIndex([0,1,2,0,2,3]);
  attribute('center', new Float32Array(surface.positions), 3);
  const box=new THREE.Box3().setFromArray(surface.positions).expandByScalar(surface.spacing*.2);
  const lo=new Float32Array(count*3),hi=new Float32Array(count*3);
  const lower=box.min.toArray(),upper=box.max.toArray(),eps=Math.max(.000002,surface.spacing*.0005);
  for(let j=0;j<count*3;j++){
    lo[j]=(Number.isFinite(surface.supportMin?.[j])?surface.supportMin[j]:lower[j%3])-eps;
    hi[j]=(Number.isFinite(surface.supportMax?.[j])?surface.supportMax[j]:upper[j%3])+eps;
  }
  attribute('supportMin',lo,3);attribute('supportMax',hi,3);
  attribute('surfaceNormal', new Float32Array(surface.normals), 3);
  attribute('radius', new Float32Array(count).fill(surface.spacing * .61), 1);
  const colors = new Float32Array(count * 3), props = new Float32Array(count * 4);
  const grains = new Float32Array(count * 3), phases = new Float32Array(count * 2), fibers = new Float32Array(count);
  const palette = new Map();
  let maxFiber = 0;
  for (let i = 0; i < count; i++) {
    const id = surface.materials[i];
    let style = palette.get(id);
    if (!style) {
      const index = Math.max(0, materials.findIndex(m => m.id === id));
      style = appearance(materials[index], index);
      palette.set(id, style);
      maxFiber = Math.max(maxFiber, style.fiberLength[0]);
    }
    colors.set(style.tint, 3*i);
    props.set(style.properties, 4*i);
    grains.set(style.grainSettings, 3*i);
    phases.set(style.phaseId, 2*i);
    fibers[i] = style.fiberLength[0];
  }
  attribute('tint', colors, 3);
  attribute('properties', props, 4);
  attribute('grainSettings', grains, 3);
  attribute('phaseId', phases, 2);
  attribute('fiberLength', fibers, 1);
  geometry.userData.materialIds = new Set(palette.keys());
  geometry.instanceCount = count;
  setBounds(geometry, surface, maxFiber);
  return geometry;
}

export function updateMaterialAttribute(geometry, surface, materials, material, field) {
  const name = affected[field];
  if (!name || !geometry.userData.materialIds.has(material.id)) return;
  const attr = geometry.getAttribute(name);
  const value = appearance(material, materials.indexOf(material))[name];
  for (let i = 0; i < surface.materials.length; i++) {
    if (surface.materials[i] === material.id) attr.array.set(value, i * attr.itemSize);
  }
  attr.needsUpdate = true;
  if (name === 'fiberLength') {
    let maxFiber = 0;
    for (const m of materials) if (geometry.userData.materialIds.has(m.id)) maxFiber = Math.max(maxFiber, Math.fround(m.fiberLength || 0));
    setBounds(geometry, surface, maxFiber);
  }
}
