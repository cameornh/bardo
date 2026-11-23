// Procedural coastal dune, swale, marsh and back-barrier scrub flora calibrated
// to St. Andrews State Park / Shell Island, Florida (FNAI / UF-IFAS SGEB-75).
// Every species builds editable capsule stems, biomechanically scaled flexure joints,
// and surface-anchored Gaussian ribbon/dab attachments obeying all studio limits.
import {Euler, Quaternion, Vector3} from 'three';
import {material, part, stamp, LIMITS} from './model.js';
import {randomSequence} from './family.js';
import {brushFrame} from './gaussian-marks.js';
import {jointDefaults} from './physics-data.js';

const TAU = 2 * Math.PI;
const GOLDEN = 2.399963229728653;
const UP = new Vector3(0, 1, 0);
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const smooth = x => { const t = clamp(x); return t * t * (3 - 2 * t); };
const centered = rng => rng() + rng() - 1;
const gauss = (x, center, width) => Math.exp(-0.5 * ((x - center) / Math.max(1e-4, width)) ** 2);
const band = (x, lo, hi, soft = 0.25) => smooth((x - lo) / soft + 0.5) * smooth((hi - x) / soft + 0.5);

export function installCoastalMaterials(library) {
 // Update Wind Garden sand to bright Panhandle Appalachian quartz sugar-sand,
 // and ocean/swale water to clear Gulf emerald-turquoise.
 const sand = library.materials.find(m => m.id === 'sand');
 if (sand) {
  Object.assign(sand, {
   color: '#e8dec8', roughness: 0.94, grainDepth: 1.4, grainLength: 0.04, grainScale: 1.5,
   porosity: 0.40, permeability: 2e-10
  });
 }
 const water = library.materials.find(m => m.id === 'water');
 if (water) {
  Object.assign(water, {
   color: '#1da19c', absorption: 0.34, scattering: 0.13, opacity: 0.46, organicLoad: 0.24, roughness: 0.05
  });
 }

 const existing = new Set(library.materials.map(m => m.id));
 const fibre = library.materials.find(m => m.id === 'reed');
 const baseHerb = {
  porosity: 0.42, fuelEnergy: 1.5e7, burnRate: 0.02, smokeYield: 0.06,
  grainLength: 0.92, grainDepth: 1.0, roughness: 0.74, youngModulus: 8.4e7,
  tensileStrength: 4.5e6, yieldStress: 2.7e6, adhesion: 2.4e5, cohesion: 12000,
  density: 360, moisture: 0.14, waterAffinity: 0.48
 };
 if (fibre) Object.assign(fibre, {color: '#6a7e45', roughness: 0.72});

 const defs = [
  ['reed-blade', 'Reed blade', '#527839', {...baseHerb, roughness: 0.66, moisture: 0.28}],
  ['reed-husk', 'Reed husk', '#c4a86e', {...baseHerb, roughness: 0.90, moisture: 0.07, burnRate: 0.042, density: 270}],
  ['dune-culm', 'Sea-oat culm', '#7c8f52', {...baseHerb, density: 390, youngModulus: 1.4e8, roughness: 0.68, moisture: 0.14, grainLength: 0.95}],
  ['sea-oat-plume', 'Sea-oat spikelet', '#dcc27e', {...baseHerb, density: 260, roughness: 0.86, moisture: 0.06, burnRate: 0.048, fuelEnergy: 1.65e7}],
  ['glaucous-blade', 'Glaucous grass blade', '#5a867b', {...baseHerb, density: 370, roughness: 0.56, waterAffinity: 0.22, moisture: 0.24}],
  ['succulent-leaf', 'Coastal succulent', '#3f7840', {...baseHerb, density: 760, youngModulus: 4.8e7, tensileStrength: 2.2e6, roughness: 0.34, porosity: 0.62, moisture: 0.72, waterContent: 0.68, burnRate: 0.004, fuelEnergy: 4.5e6, waterAffinity: 0.68}],
  ['elder-leaf', 'Beach elder foliage', '#7c9b47', {...baseHerb, density: 620, youngModulus: 6.2e7, roughness: 0.52, moisture: 0.54, waterContent: 0.48, burnRate: 0.008, fuelEnergy: 8.0e6}],
  ['woolly-leaf', 'Pubescent goldenaster leaf', '#97a894', {...baseHerb, density: 350, roughness: 0.94, fiberLength: 0.008, moisture: 0.18, grainDepth: 1.8}],
  ['rush-stem', 'Black needlerush culm', '#42543a', {...baseHerb, density: 480, youngModulus: 2.6e8, tensileStrength: 9.0e6, roughness: 0.64, moisture: 0.34}],
  ['rush-tip', 'Needlerush bract', '#664e34', {...baseHerb, density: 340, roughness: 0.88, moisture: 0.12}],
  ['palmetto-frond', 'Saw palmetto frond', '#466f4f', {...baseHerb, density: 510, youngModulus: 2.8e8, tensileStrength: 1.1e7, roughness: 0.54, moisture: 0.22, fuelEnergy: 1.9e7, burnRate: 0.036}],
  ['rosemary-needle', 'Florida rosemary', '#4f6348', {...baseHerb, density: 460, youngModulus: 1.8e8, roughness: 0.78, moisture: 0.14, fuelEnergy: 2.1e7, burnRate: 0.055, smokeYield: 0.09}],
  ['scrub-bark', 'Coastal oak bark', '#74685c', {...baseHerb, density: 780, youngModulus: 7.5e9, tensileStrength: 1.8e7, yieldStress: 2.6e7, adhesion: 2.4e6, fractureGrain: 0.82, roughness: 0.92, grainDepth: 3.4, moisture: 0.15, fuelEnergy: 1.7e7, burnRate: 0.018}],
  ['oak-leaf', 'Sand live oak leaf', '#3d5a37', {...baseHerb, density: 580, youngModulus: 3.2e8, roughness: 0.50, moisture: 0.28, fuelEnergy: 1.65e7, burnRate: 0.025}],
  ['pine-bark', 'Coastal pine bark', '#6b4f3d', {...baseHerb, density: 740, youngModulus: 8.5e9, tensileStrength: 2.0e7, yieldStress: 2.8e7, adhesion: 2.6e6, fractureGrain: 0.85, roughness: 0.94, grainDepth: 3.8, moisture: 0.14, fuelEnergy: 1.85e7, burnRate: 0.022}],
  ['pine-needle', 'Pine needle fascicle', '#2c4e2c', {...baseHerb, density: 490, youngModulus: 3.0e8, roughness: 0.54, moisture: 0.24, fuelEnergy: 2.05e7, burnRate: 0.045, smokeYield: 0.08}],
  ['myrtle-leaf', 'Wax myrtle foliage', '#576e3e', {...baseHerb, density: 510, youngModulus: 2.4e8, roughness: 0.56, moisture: 0.26, fuelEnergy: 1.95e7, burnRate: 0.042}],
  ['vine-stem', 'Succulent stolon', '#7d5d46', {...baseHerb, density: 680, youngModulus: 5.2e7, roughness: 0.62, moisture: 0.60, waterContent: 0.54, burnRate: 0.006, fuelEnergy: 6.5e6}],
  ['dune-bloom-rose', 'Morning-glory petal', '#c9428f', {...baseHerb, density: 290, roughness: 0.48, moisture: 0.52, burnRate: 0.009, fuelEnergy: 6.0e6}],
  ['dune-bloom-gold', 'Dune ray blossom', '#eab924', {...baseHerb, density: 290, roughness: 0.60, moisture: 0.36, burnRate: 0.012, fuelEnergy: 7.0e6}],
  ['cactus-fruit', 'Prickly pear tuna', '#a53447', {...baseHerb, density: 790, roughness: 0.45, moisture: 0.74, waterContent: 0.72, burnRate: 0.003, fuelEnergy: 4.0e6}],
  ['driftwood', 'Bleached driftwood', '#b7b2a6', {...baseHerb, density: 480, youngModulus: 6.8e9, tensileStrength: 1.4e7, yieldStress: 2.0e7, fractureGrain: 0.92, grainLength: 0.96, grainDepth: 3.8, roughness: 0.92, moisture: 0.08, fuelEnergy: 1.65e7, burnRate: 0.024}],
  ['shell-calc', 'Shell calcite', '#ebe5d8', {porosity: 0.02, density: 2650, youngModulus: 6e10, tensileStrength: 4e6, yieldStress: 2.5e7, cohesion: 5e6, adhesion: 2e6, roughness: 0.42, grainDepth: 0.6, moisture: 0.02, fuelEnergy: 0, burnRate: 0}],
  ['coquina-rock', 'Coastal limestone', '#b5aa96', {porosity: 0.18, density: 2350, youngModulus: 3.5e10, tensileStrength: 2.5e6, yieldStress: 1.8e7, cohesion: 3e6, adhesion: 1.5e6, roughness: 0.88, grainDepth: 4.0, moisture: 0.06, fuelEnergy: 0, burnRate: 0}],
  ['pebble-quartz', 'Beach quartz pebble', '#9a9387', {porosity: 0.01, density: 2620, youngModulus: 7e10, tensileStrength: 6e6, yieldStress: 3.5e7, cohesion: 8e6, adhesion: 2e6, roughness: 0.58, grainDepth: 1.1, moisture: 0.01, fuelEnergy: 0, burnRate: 0}],
  ['pebble-dark', 'Dark mineral pebble', '#383532', {porosity: 0.01, density: 2950, youngModulus: 7.5e10, tensileStrength: 7e6, yieldStress: 4e7, cohesion: 9e6, adhesion: 2e6, roughness: 0.62, grainDepth: 1.3, moisture: 0.01, fuelEnergy: 0, burnRate: 0}],
  ['sargassum-wrack', 'Sargassum seaweed wrack', '#7a6228', {...baseHerb, density: 420, roughness: 0.68, moisture: 0.34, fuelEnergy: 1.2e7, burnRate: 0.018}],
  ['seagrass-wrack', 'Seagrass wrack', '#4d5232', {...baseHerb, density: 360, roughness: 0.78, moisture: 0.22, fuelEnergy: 1.35e7, burnRate: 0.025}],
  ['seagrass-bed', 'Submerged turtle grass', '#2d5431', {...baseHerb, density: 920, roughness: 0.42, moisture: 0.86, waterContent: 0.82, fuelEnergy: 4e6, burnRate: 0.002}],
  ['sand-dollar', 'Sand dollar test', '#eae6dc', {porosity: 0.14, density: 2300, youngModulus: 4e10, tensileStrength: 2e6, yieldStress: 1.2e7, cohesion: 3e6, adhesion: 1e6, roughness: 0.72, grainDepth: 0.8, moisture: 0.02, fuelEnergy: 0, burnRate: 0}],
  ['sea-star', 'Dried sea star', '#9f7856', {porosity: 0.22, density: 1450, youngModulus: 1.5e9, tensileStrength: 2e6, yieldStress: 6e6, cohesion: 1e6, adhesion: 5e5, roughness: 0.78, grainDepth: 1.6, moisture: 0.08, fuelEnergy: 8e6, burnRate: 0.01}],
  ['pine-cone', 'Fallen pine cone', '#5d432e', {...baseHerb, density: 620, youngModulus: 4.5e9, roughness: 0.88, moisture: 0.11, fuelEnergy: 1.95e7, burnRate: 0.032}],
  ['sea-rocket-bloom', 'Sea rocket petal', '#d9b8e3', {...baseHerb, density: 280, roughness: 0.50, moisture: 0.50, burnRate: 0.008, fuelEnergy: 5.5e6}],
  ['bluestem-copper', 'Gulf bluestem plume', '#a86544', {...baseHerb, density: 310, roughness: 0.82, moisture: 0.09, burnRate: 0.044, fuelEnergy: 1.6e7}],
  ['purslane-stem', 'Sea purslane stolon', '#9d4b4a', {...baseHerb, density: 740, youngModulus: 4.6e7, roughness: 0.48, moisture: 0.66, waterContent: 0.62, burnRate: 0.005, fuelEnergy: 5.0e6}],
  ['cordgrass-blade', 'Smooth cordgrass blade', '#63823d', {...baseHerb, density: 420, youngModulus: 1.8e8, roughness: 0.62, moisture: 0.36, waterAffinity: 0.64}],
  ['palm-trunk', 'Cabbage palm trunk', '#847768', {...baseHerb, density: 680, youngModulus: 6.5e9, tensileStrength: 1.6e7, yieldStress: 2.4e7, adhesion: 2.2e6, fractureGrain: 0.86, roughness: 0.94, grainDepth: 4.2, moisture: 0.18, fuelEnergy: 1.65e7, burnRate: 0.016}],
  ['sunflower-leaf', 'Dune sunflower leaf', '#476e36', {...baseHerb, density: 460, roughness: 0.66, moisture: 0.28, burnRate: 0.018, fuelEnergy: 1.2e7}],
  ['shoal-grass', 'Shoal grass (Halodule)', '#4c7b38', {...baseHerb, density: 910, roughness: 0.44, moisture: 0.86, waterContent: 0.82, fuelEnergy: 4e6, burnRate: 0.002}],
  ['manatee-grass', 'Manatee grass (Syringodium)', '#5c853a', {...baseHerb, density: 910, roughness: 0.40, moisture: 0.86, waterContent: 0.82, fuelEnergy: 4e6, burnRate: 0.002}],
  ['limestone-ledge', 'Karstic Gulf limestone', '#8b8473', {porosity: 0.22, density: 2380, youngModulus: 3.8e10, tensileStrength: 2.8e6, yieldStress: 2.0e7, cohesion: 3.5e6, adhesion: 1.6e6, roughness: 0.90, grainDepth: 4.4, moisture: 0.18, fuelEnergy: 0, burnRate: 0}],
  ['sea-sponge', 'Gulf loggerhead sponge', '#986434', {porosity: 0.72, density: 1080, youngModulus: 1.2e6, roughness: 0.82, moisture: 0.82, waterContent: 0.78, fuelEnergy: 3e6, burnRate: 0.002}],
  ['sea-whip', 'Sea-whip gorgonian', '#9d6c32', {porosity: 0.18, density: 1220, youngModulus: 8.0e7, roughness: 0.56, moisture: 0.68, fuelEnergy: 4e6, burnRate: 0.004}],
  ['benthic-algae', 'Benthic marine macroalgae', '#5a312c', {...baseHerb, density: 940, roughness: 0.46, moisture: 0.88, waterContent: 0.84, fuelEnergy: 4e6, burnRate: 0.002}],
  ['live-sand-dollar', 'Live keyhole sand dollar', '#3d3a2c', {porosity: 0.08, density: 2250, youngModulus: 3.2e10, tensileStrength: 2.5e6, roughness: 0.76, moisture: 0.35, fuelEnergy: 0, burnRate: 0}],
  ['pen-shell', 'Stiff pen shell (Atrina)', '#302824', {porosity: 0.03, density: 2620, youngModulus: 5.5e10, tensileStrength: 4.5e6, roughness: 0.38, moisture: 0.20, fuelEnergy: 0, burnRate: 0}],
  ['crab-chitin', 'Crustacean carapace', '#b8a991', {porosity: 0.06, density: 1420, youngModulus: 2.8e9, tensileStrength: 1.2e7, roughness: 0.36, moisture: 0.28, fuelEnergy: 6e6, burnRate: 0.008}],
  ['fish-scale', 'Pelagic fish scales', '#9fb4bd', {porosity: 0.04, density: 1060, youngModulus: 6.5e7, roughness: 0.20, moisture: 0.72, waterContent: 0.68, fuelEnergy: 5e6, burnRate: 0.004}],
  ['insect-chitin', 'Coastal insect chitin', '#383630', {porosity: 0.08, density: 1180, youngModulus: 3.5e9, tensileStrength: 1.5e7, roughness: 0.38, moisture: 0.18, fuelEnergy: 9e6, burnRate: 0.02}]
 ];

 for (const [id, name, color, opts] of defs) {
  const idx = library.materials.findIndex(m => m.id === id);
  if (idx >= 0) {
   Object.assign(library.materials[idx], {color, ...opts});
  } else if (library.materials.length < LIMITS.materials) {
   library.materials.push(material(id, name, color, opts));
   existing.add(id);
  }
 }
}

function makeSegment(id, name, start, direction, length, radius, parentId, materialId, stiffness, damping, breakForce) {
 const r = Math.max(0.025, radius);
 const L = Math.max(0.052, length);
 const dir = direction.clone().normalize();
 const rot = new Quaternion().setFromUnitVectors(UP, dir);
 const rod = stamp('capsule', 'add', [0, L * 0.5, 0], [r, L * 0.5, r], materialId, 0);
 const section = part(name, [rod]);
 section.id = id;
 section.transform.position = start.toArray();
 section.transform.rotation = new Euler().setFromQuaternion(rot).toArray().slice(0, 3).map(x => x * 180 / Math.PI);
 section.joint = {
  ...jointDefaults(),
  parentId,
  anchor: start.toArray(),
  type: 'flexure',
  looseness: 0,
  stiffness: clamp(stiffness, 1.5, 95000),
  damping: clamp(damping, 0.15, 9000),
  breakForce: clamp(breakForce, 18, 1e8)
 };
 section.marks = [];
 return {section, tip: start.clone().addScaledVector(dir, L), dir, length: L, radius: r};
}

// Mount directly on the capsule cylinder (capPhi == null) or top hemisphere cap (0 <= capPhi <= PI/2)
// so SDF distance at mark.root is strictly zero (passes supportedMark cleanly).
function mountOnCapsule(section, y, azimuth, capPhi = null) {
 const s = section.stamps[0];
 const r = s.size[0], L = 2 * s.size[1];
 const cx = Math.cos(azimuth), sz = Math.sin(azimuth);
 if (capPhi === null) {
  return [r * cx, clamp(y, 0.002, L - 0.002), r * sz];
 }
 const phi = clamp(capPhi, 0.01, Math.PI * 0.49);
 return [r * Math.sin(phi) * cx, L + r * Math.cos(phi), r * Math.sin(phi) * sz];
}

function pushMark(section, mark) {
 if (section.marks.length >= 126) return;
 section.marks.push({
  ...mark,
  length: clamp(mark.length, 0.036, 3.8),
  width: clamp(mark.width, 0.042, 0.88),
  curl: clamp(mark.curl ?? 0, -0.98, 0.98),
  flex: clamp(mark.flex ?? 0.5, 0, 1),
  bias: clamp(mark.bias ?? 1, 0.26, 3.8),
  taper: clamp(mark.taper ?? 0.5, 0, 1)
 });
}

function addRibbon(section, id, root, direction, upHint, length, width, curl, flex, materialId, bias = 0.85, taper = 0.70, roll = 0) {
 pushMark(section, {
  id, kind: 'ribbon', materialId, root,
  ...brushFrame(direction, upHint, roll),
  length, width, curl, flex, bias, taper
 });
}

function addDab(section, id, root, direction, upHint, length, width, curl, flex, materialId, roll = 0) {
 pushMark(section, {
  id, kind: 'dab', materialId, root,
  ...brushFrame(direction, upHint, roll),
  length, width, curl, flex, bias: 1, taper: 0
 });
}

function axisVec(yaw, slope) {
 return new Vector3(slope * Math.cos(yaw), 1, slope * Math.sin(yaw)).normalize();
}

function worldDirToLocal(parentDir, worldDir) {
 const q = new Quaternion().setFromUnitVectors(UP, parentDir.clone().normalize()).invert();
 return worldDir.clone().normalize().applyQuaternion(q);
}

// ---------------------------------------------------------------------------
// 0. Coastal Wetland Reed (Phragmites / Cladium — upgraded phytomer grass)
// ---------------------------------------------------------------------------
export function growCrown(id, name, seed, age = 0.96, vigour = 1) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.05, duration: 3, parts: []};
 const shoots = age > 0.79 ? 3 : 2;
 const rot = rng() * TAU;
 for (let t = 0; t < shoots; t++) {
  const heading = rot + t * TAU / shoots + 0.42 * centered(rng);
  const reach = (t === 0 ? 0.055 : 0.14) + 0.06 * rng();
  const base = new Vector3(reach * Math.cos(heading), 0.015, reach * Math.sin(heading));
  const shootAge = age - t * (0.19 + 0.08 * rng());
  const maturity = smooth((shootAge - 0.17) / 0.80);
  const height = (0.48 + 2.38 * maturity) * vigour * Math.exp(0.085 * centered(rng));
  const radius = Math.max(0.025, 0.030 + 0.016 * Math.pow(height / 2.5, 0.72));
  const spread = 0.035 + 0.30 * (1 - maturity) + 0.08 * rng();
  const lowerDir = axisVec(heading, spread);
  const upperDir = axisVec(heading + 0.45 * centered(rng), spread + 0.065 + 0.14 * rng());

  const leafCount = 5 + Math.floor(4.2 * maturity);
  const nodeAt = i => 0.055 + (0.63 + 0.11 * (1 - maturity)) * Math.pow((i + 0.45) / leafCount, 1.22);
  const jointRank = Math.round(leafCount * 0.66);
  const split = nodeAt(jointRank);
  const weightMoment = 360 * Math.PI * radius * radius * height * height * 9.81 * 0.5;
  const stiffness = weightMoment * 2.8 + 16 * Math.pow(radius / 0.04, 4) / height;

  const basal = makeSegment('base-' + t, 'Basal stem ' + (t + 1), base, lowerDir, height * split, radius,
   'ground', 'reed', stiffness, 2.4 * height, 1250 * Math.pow(radius / 0.04, 3) / Math.sqrt(height));
  const upper = makeSegment('tip-' + t, 'Upper stem ' + (t + 1), basal.tip, upperDir, height * (1 - split), radius * 0.84,
   basal.section.id, 'reed', stiffness * 0.29, 0.94 * height, 1250 * Math.pow(radius * 0.84 / 0.04, 3) / Math.sqrt(height));
  asset.parts.push(basal.section, upper.section);

  const basalCount = 2 + Math.round(1 - maturity);
  for (let i = 0; i < basalCount; i++) {
   const angle = heading + (i - 1) * 1.92 + 0.55 * centered(rng);
   const rPos = mountOnCapsule(basal.section, 0.035 + 0.045 * i, angle);
   addRibbon(basal.section, 'sheath-' + i, rPos,
    new Vector3(Math.cos(angle) * Math.cos(0.68), Math.sin(0.68), Math.sin(angle) * Math.cos(0.68)),
    UP, (0.30 + 0.24 * rng()) * Math.pow(height, 0.48), 0.046 + 0.012 * rng(), -0.88, 0.84,
    i === 0 && shootAge > 0.82 ? 'reed-husk' : 'reed-blade', 0.82, 0.72);
  }

  const twist = 0.22 * centered(rng);
  let az = heading + 0.75 * centered(rng);
  for (let i = 0; i < leafCount; i++) {
   const rank = (i + 0.45) / leafCount;
   const node = nodeAt(i) + (i === jointRank ? 0 : 0.014 * centered(rng));
   const inBasal = node < split && i !== jointRank;
   const host = inBasal ? basal : upper;
   const localY = (node - (inBasal ? 0 : split)) * height;
   const bladeLen = Math.pow(height, 0.65) * (0.24 + 0.34 * Math.sin(Math.PI * rank)) * (1 + 0.11 * centered(rng));
   const el = 0.24 + 0.92 * rank + 0.11 * centered(rng);
   const leafMat = (i === 0 && shootAge > 0.84) ? 'reed-husk' : (rank > 0.65 ? 'reed-blade' : 'reed');
   const rPos = mountOnCapsule(host.section, i === jointRank ? 0.002 : localY, az);
   if (i === jointRank) rPos[1] = 0;
   addRibbon(host.section, 'leaf-' + i, rPos,
    new Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)),
    UP, bladeLen, 0.045 + 0.018 * Math.sin(Math.PI * rank), -0.94 + 0.62 * rank, 0.76 + 0.12 * (1 - rank),
    leafMat, 0.82, 0.74);
   az += Math.PI + twist + 0.22 * centered(rng);
  }

  const bloom = smooth((shootAge - 0.73) / 0.22);
  const topLen = upper.length;
  if (bloom < 0.9) {
   addRibbon(upper.section, 'rolled-tip', mountOnCapsule(upper.section, Math.max(0.02, topLen - 0.05 * height), az),
    new Vector3(Math.cos(az) * Math.cos(1.24), Math.sin(1.24), Math.sin(az) * Math.cos(1.24)),
    UP, (0.14 + 0.08 * (1 - maturity)) * height, 0.046, -0.35, 0.74, 'reed', 0.82, 0.72);
  }
  if (bloom > 0.07) {
   const plumeLen = height * (0.08 + 0.15 * bloom);
   const branches = Math.ceil(12 + 18 * bloom);
   for (let i = 0; i < branches; i++) {
    const rank = (i + 0.3 * rng()) / branches;
    const phi = az + i * GOLDEN + 0.22 * centered(rng);
    const el = 0.72 + 0.56 * rank + 0.12 * centered(rng);
    const rPos = mountOnCapsule(upper.section, Math.max(0.02, topLen - plumeLen * (1 - rank)), phi);
    addRibbon(upper.section, 'spikelet-' + i, rPos,
     new Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el)),
     UP, Math.max(0.045, plumeLen * (0.22 + 0.64 * (1 - rank)) * (0.86 + 0.24 * rng())),
     0.054 + 0.014 * rng(), -0.40, 0.48, 'reed-husk', 0.75, 0.68);
   }
  }
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 1. Sea Oats (Uniola paniculata — iconic Gulf foredune grass with nodding panicles)
//    Wagner (1964), Lonard et al. (2011): 1.0–2.1 m tall, arching blades, heavy nodding
//    golden panicle of laterally compressed flat oat-like spikelets.
// ---------------------------------------------------------------------------
function growSeaOats(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.05, duration: 3, parts: []};
 const rot = rng() * TAU;
 for (let t = 0; t < 3; t++) {
  const heading = rot + t * TAU / 3 + 0.38 * centered(rng);
  const reach = (t === 0 ? 0.05 : 0.13) + 0.04 * rng();
  const base = new Vector3(reach * Math.cos(heading), 0.015, reach * Math.sin(heading));
  const maturity = t === 0 ? 0.96 : t === 1 ? 0.80 : 0.52;
  const height = (0.70 + 1.15 * maturity) * Math.exp(0.07 * centered(rng));
  const radius = Math.max(0.025, 0.026 + 0.008 * maturity);
  const spread = 0.14 + 0.22 * (1 - maturity);
  const lowerDir = axisVec(heading, spread);
  // Sea oats nod gracefully under the weight of their spikelet panicle.
  const archAngle = heading + 0.25 * centered(rng);
  const upperDir = axisVec(archAngle, spread + 0.34 * maturity + 0.08 * rng());
  const split = 0.56;
  const weightMoment = 390 * Math.PI * radius * radius * height * height * 9.81 * 0.5;
  const stiffness = weightMoment * 3.0 + 24 * Math.pow(radius / 0.035, 4) / height;

  const basal = makeSegment('base-' + t, 'Culm base ' + (t + 1), base, lowerDir, height * split, radius,
   'ground', 'dune-culm', stiffness * 1.45, 2.2 * height, 1250);
  const upper = makeSegment('tip-' + t, 'Panicle culm ' + (t + 1), basal.tip, upperDir, height * (1 - split), 0.025,
   basal.section.id, 'dune-culm', stiffness * 0.38, 0.95 * height, 920);
  asset.parts.push(basal.section, upper.section);

  const leaves = 6 + Math.floor(3 * maturity);
  let az = heading + 0.6 * centered(rng);
  for (let i = 0; i < leaves; i++) {
   const rank = (i + 0.3) / leaves;
   const node = 0.06 + 0.60 * Math.pow(rank, 1.15);
   const inBasal = node < split;
   const host = inBasal ? basal : upper;
   const localY = (node - (inBasal ? 0 : split)) * height;
   const el = 0.32 + 0.72 * rank + 0.12 * centered(rng);
   const bladeLen = (0.36 + 0.32 * Math.sin(Math.PI * rank)) * Math.pow(height / 1.5, 0.6);
   const mat = rank < 0.20 ? 'sea-oat-plume' : (i % 3 === 0 ? 'glaucous-blade' : 'dune-culm');
   addRibbon(host.section, 'leaf-' + i, mountOnCapsule(host.section, localY, az),
    new Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)),
    UP, bladeLen, 0.044 + 0.012 * (1 - rank), -0.92 + 0.35 * rank, 0.78, mat, 0.78, 0.80);
   az += Math.PI + 0.28 * centered(rng);
  }

  if (maturity > 0.62) {
   // Signature compressed golden-straw spikelets drooping from slender arching panicle branches
   const panicleStart = upper.length * 0.32;
   const branchCount = 7;
   for (let b = 0; b < branchCount; b++) {
    const u = b / (branchCount - 1);
    const phi = archAngle + b * GOLDEN;
    const brRoot = mountOnCapsule(upper.section, panicleStart + u * (upper.length - panicleStart) * 0.85, phi);
    const brDir = new Vector3(Math.cos(phi) * 0.65, 0.72 - 0.35 * u, Math.sin(phi) * 0.65).normalize();
    addRibbon(upper.section, 'panicle-' + b, brRoot, brDir, UP, 0.14 + 0.08 * (1 - u), 0.11, -0.58, 0.56, 'sea-oat-plume', 0.75, 0.70);
   }
   const spikeCount = Math.floor(14 + 8 * maturity);
   for (let i = 0; i < spikeCount; i++) {
    const u = i / (spikeCount - 1);
    const phi = archAngle + i * GOLDEN + 0.35 * centered(rng);
    const pedicel = new Vector3(Math.cos(phi) * 0.62, 0.32 - 0.68 * u, Math.sin(phi) * 0.62).normalize();
    const root = mountOnCapsule(upper.section, panicleStart + u * (upper.length - panicleStart), phi,
     u > 0.90 ? (1 - u) * 8 * Math.PI * 0.3 : null);
    addDab(upper.section, 'oat-' + i, root, pedicel, UP,
     0.075 + 0.042 * Math.sin(Math.PI * u), 0.36 + 0.10 * rng(), -0.42 - 0.32 * u, 0.65,
     'sea-oat-plume', 0.4 * centered(rng));
   }
  }
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 2. Bitter Panicgrass (Panicum amarum — stout glaucous sand-trapping grass)
//    Lonard & Judd (2011): 0.9–1.7 m stout blue-green culms, wide flat blades,
//    compact upright plume panicles.
// ---------------------------------------------------------------------------
function growBitterPanic(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.05, duration: 3, parts: []};
 const rot = rng() * TAU;
 for (let t = 0; t < 2; t++) {
  const heading = rot + t * Math.PI + 0.45 * centered(rng);
  const reach = 0.055 + 0.045 * rng();
  const base = new Vector3(reach * Math.cos(heading), 0.015, reach * Math.sin(heading));
  const maturity = t === 0 ? 0.94 : 0.72;
  const height = (0.78 + 0.78 * maturity) * Math.exp(0.08 * centered(rng));
  const radius = Math.max(0.025, 0.029 + 0.008 * maturity);
  const lowerDir = axisVec(heading, 0.10 + 0.10 * rng());
  const upperDir = axisVec(heading + 0.3 * centered(rng), 0.16 + 0.12 * rng());
  const split = 0.58;
  const weightMoment = 370 * Math.PI * radius * radius * height * height * 9.81 * 0.5;
  const stiffness = weightMoment * 3.0 + 24 * Math.pow(radius / 0.035, 4) / height;

  const basal = makeSegment('base-' + t, 'Glaucous stem ' + (t + 1), base, lowerDir, height * split, radius,
   'ground', 'glaucous-blade', stiffness * 1.4, 2.0 * height, 1300);
  const upper = makeSegment('tip-' + t, 'Panicle stem ' + (t + 1), basal.tip, upperDir, height * (1 - split), 0.025,
   basal.section.id, 'glaucous-blade', stiffness * 0.38, 0.92 * height, 950);
  asset.parts.push(basal.section, upper.section);

  const leaves = 7 + Math.floor(3 * maturity);
  let az = heading + 0.5 * centered(rng);
  for (let i = 0; i < leaves; i++) {
   const rank = (i + 0.4) / leaves;
   const node = 0.05 + 0.68 * rank;
   const inBasal = node < split;
   const host = inBasal ? basal : upper;
   const localY = (node - (inBasal ? 0 : split)) * height;
   const el = 0.36 + 0.68 * rank + 0.10 * centered(rng);
   addRibbon(host.section, 'blade-' + i, mountOnCapsule(host.section, localY, az),
    new Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)),
    UP, 0.34 + 0.24 * Math.sin(Math.PI * rank), 0.082 + 0.035 * Math.sin(Math.PI * rank),
    -0.68 + 0.38 * rank, 0.68, 'glaucous-blade', 0.72, 0.68);
   az += Math.PI + 0.32 * centered(rng);
  }
  const plumeCount = 10 + Math.floor(8 * maturity);
  for (let i = 0; i < plumeCount; i++) {
   const u = i / plumeCount;
   const phi = az + i * GOLDEN;
   const el = 0.88 + 0.42 * u;
   addRibbon(upper.section, 'panicle-' + i, mountOnCapsule(upper.section, upper.length * (0.55 + 0.43 * u), phi),
    new Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el)),
    UP, 0.14 + 0.12 * (1 - u), 0.068, -0.25, 0.42, 'reed-husk', 0.68, 0.74);
  }
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 3. Railroad Vine (Ipomoea pes-caprae — sinuous prostrate stolons, notched bilobed
//    "goat's-foot" leaves & fluted rose-magenta morning-glory funnels)
//    Devall (1992): creeping sand-binding runners up to 2+ m per stolon pair.
// ---------------------------------------------------------------------------
function growRailroadVine(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.05, duration: 3, parts: []};
 const baseDir = axisVec(rng() * TAU, 0.22);
 const crown = makeSegment('crown', 'Rootstock crown', new Vector3(0, 0.016, 0), baseDir, 0.06, 0.026,
  'ground', 'vine-stem', 180, 3.0, 1600);
 asset.parts.push(crown.section);

 function dressStolon(seg, rIdx, segTag, yaw, nodes, hasFlowers) {
  const localUp = worldDirToLocal(seg.dir, UP);
  const sideWorld = new Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
  const upAz = Math.atan2(localUp.z, localUp.x);
  for (let i = 0; i < nodes; i++) {
   const u = (i + 0.45) / nodes;
   const sideSign = (i + rIdx) % 2 ? 1 : -1;
   const rootAz = upAz + sideSign * 0.55;
   const root = mountOnCapsule(seg.section, u * seg.length, rootAz);
   const petWorld = UP.clone().multiplyScalar(0.84)
    .addScaledVector(sideWorld, sideSign * 0.46)
    .addScaledVector(seg.dir, 0.22 * centered(rng)).normalize();
   const localPet = worldDirToLocal(seg.dir, petWorld);
   addRibbon(seg.section, `petiole-${rIdx}-${segTag}-${i}`, root, localPet, localUp,
    0.065 + 0.022 * rng(), 0.14, -0.25, 0.22, 'vine-stem', 0.7, 0.55);

   // Signature deeply bilobed "goat's-foot" leaf blades splayed from upper stem face
   const bladeDirW = UP.clone().multiplyScalar(0.66)
    .addScaledVector(sideWorld, sideSign * 0.72)
    .addScaledVector(seg.dir, 0.16 * centered(rng)).normalize();
   const localBlade = worldDirToLocal(seg.dir, bladeDirW);
   const bladeLen = 0.115 + 0.032 * rng();
   for (const lobe of [-1, 1]) {
    const lobeDir = localBlade.clone().applyAxisAngle(localUp, lobe * 0.44).normalize();
    addRibbon(seg.section, `leaf-${rIdx}-${segTag}-${i}-${lobe > 0 ? 'a' : 'b'}`, root,
     lobeDir, localUp, bladeLen, 0.48, -0.36, 0.28, 'succulent-leaf', 1.42, 0.16, lobe * 0.26);
   }
   // Fluted 3-petal rose-magenta morning-glory trumpet blossoms
   if (hasFlowers && i % 2 === 1 && rng() > 0.22) {
    const flRoot = mountOnCapsule(seg.section, Math.min(seg.length - 0.01, (u + 0.03) * seg.length), upAz);
    const axisW = UP.clone().multiplyScalar(0.95).addScaledVector(sideWorld, sideSign * 0.24).normalize();
    const localAx = worldDirToLocal(seg.dir, axisW);
    for (let p = 0; p < 3; p++) {
     const pAz = p * TAU / 3 + rng() * 0.4;
     const petalW = axisW.clone().multiplyScalar(0.72)
      .addScaledVector(new Vector3(Math.cos(pAz), 0, Math.sin(pAz)), 0.68).normalize();
     const localPetal = worldDirToLocal(seg.dir, petalW);
     addRibbon(seg.section, `bloom-${rIdx}-${segTag}-${i}-${p}`, flRoot,
      localPetal, localAx, 0.072 + 0.018 * rng(), 0.46, 0.44, 0.24, 'dune-bloom-rose', 1.35, 0.24);
    }
   }
  }
 }

 const baseAz = rng() * TAU;
 for (let r = 0; r < 2; r++) {
  const yawA = baseAz + (r ? Math.PI * (0.72 + 0.46 * rng()) : 0);
  const lenA = 0.88 + 0.24 * rng();
  const dirA = new Vector3(Math.cos(yawA), 0.022 + 0.016 * rng(), Math.sin(yawA)).normalize();
  const segA = makeSegment(`stolon-${r}a`, `Trailing stolon ${r + 1}A`, crown.tip, dirA, lenA, 0.026,
   crown.section.id, 'vine-stem', 58, 3.6, 850);
  asset.parts.push(segA.section);
  dressStolon(segA, r, 'a', yawA, 5, true);

  const yawB = yawA + (r ? -1 : 1) * (0.38 + 0.34 * rng()) + 0.16 * centered(rng);
  const lenB = 0.82 + 0.28 * rng();
  const dirB = new Vector3(Math.cos(yawB), 0.016 + 0.014 * rng(), Math.sin(yawB)).normalize();
  const segB = makeSegment(`stolon-${r}b`, `Trailing stolon ${r + 1}B`, segA.tip, dirB, lenB, 0.025,
   segA.section.id, 'vine-stem', 44, 3.0, 720);
  asset.parts.push(segB.section);
  dressStolon(segB, r, 'b', yawB, 5, true);
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 4. Beach Elder (Iva imbricata — embryo-dune succulent cushioned subshrub)
//    Colosi & McCormick (1978): 0.35–0.80 m mounding branches, densely imbricate fleshy leaves.
// ---------------------------------------------------------------------------
function growBeachElder(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.05, duration: 3, parts: []};
 const rot = rng() * TAU;
 for (let b = 0; b < 3; b++) {
  const yaw = rot + b * TAU / 3 + 0.4 * centered(rng);
  const reach = 0.05 + 0.03 * rng();
  const base = new Vector3(reach * Math.cos(yaw), 0.015, reach * Math.sin(yaw));
  const len = (0.36 + 0.24 * rng());
  const dir = axisVec(yaw, 0.48 + 0.35 * rng());
  const stem = makeSegment('branch-' + b, 'Elder branch ' + (b + 1), base, dir, len, 0.027,
   'ground', 'elder-leaf', 85, 2.4, 920);
  asset.parts.push(stem.section);

  const count = 16;
  for (let i = 0; i < count; i++) {
   const u = (i + 0.6) / count;
   const phi = yaw + i * GOLDEN;
   const el = 0.22 + 0.62 * u + 0.14 * centered(rng);
   const leafDir = new Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el));
   const root = mountOnCapsule(stem.section, u * stem.length, phi, u > 0.88 ? (1 - u) * 5 : null);
   const isLeafDab = i % 2 === 0;
   if (isLeafDab) {
    addDab(stem.section, 'leaf-' + i, root, leafDir, UP, 0.075 + 0.025 * (1 - u * 0.3), 0.44, -0.18, 0.36, 'elder-leaf');
   } else {
    addRibbon(stem.section, 'leaf-' + i, root, leafDir, UP, 0.088 + 0.028 * (1 - u * 0.3), 0.34, -0.28, 0.42, 'elder-leaf', 1.25, 0.25);
   }
   if (u > 0.84) {
    addDab(stem.section, 'head-' + i, root, leafDir, UP, 0.044, 0.62, 0, 0.25, 'sea-oat-plume');
   }
  }
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 5. Godfrey's Goldenaster (Chrysopsis godfreyi — Panhandle endemic blowout wildflower)
//    Semple (1981): silvery-woolly basal rosette + ascending stems + golden daisy corymbs.
// ---------------------------------------------------------------------------
function growGoldenaster(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.05, duration: 3, parts: []};
 const rot = rng() * TAU;
 const rosette = makeSegment('rosette', 'Woolly basal rosette', new Vector3(0, 0.015, 0), UP, 0.12, 0.028,
  'ground', 'woolly-leaf', 110, 2.2, 850);
 asset.parts.push(rosette.section);

 // Silvery-white pubescent basal leaf rosette hugging the bright sand
 for (let i = 0; i < 12; i++) {
  const phi = rot + i * GOLDEN;
  const el = 0.08 + 0.26 * (i / 12);
  addRibbon(rosette.section, 'rosette-' + i, mountOnCapsule(rosette.section, 0.02 + 0.08 * (i / 12), phi),
   new Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el)),
   UP, 0.14 + 0.05 * rng(), 0.22, -0.32, 0.55, 'woolly-leaf', 1.15, 0.42);
 }

 for (let s = 0; s < 2; s++) {
  const yaw = rot + s * Math.PI * 0.85 + 0.5 * centered(rng);
  const len = (s === 0 ? 0.38 : 0.29) + 0.10 * rng();
  const dir = axisVec(yaw, 0.22 + 0.18 * rng());
  const stalk = makeSegment('stalk-' + s, 'Flowering stalk ' + (s + 1), rosette.tip, dir, len, 0.025,
   rosette.section.id, 'woolly-leaf', 48, 1.4, 520);
  asset.parts.push(stalk.section);

  for (let i = 0; i < 7; i++) {
   const u = (i + 0.4) / 7;
   const phi = yaw + i * GOLDEN;
   addRibbon(stalk.section, 'bract-' + i, mountOnCapsule(stalk.section, u * stalk.length, phi),
    new Vector3(Math.cos(phi) * 0.72, 0.68, Math.sin(phi) * 0.72), UP,
    0.085 - 0.03 * u, 0.26, -0.25, 0.45, 'woolly-leaf', 1.0, 0.55);
  }

  // Terminal corymb of 3–4 golden ray flower heads
  const heads = s === 0 ? 4 : 3;
  for (let h = 0; h < heads; h++) {
   const phi = yaw + h * TAU / heads + 0.3 * centered(rng);
   const r = mountOnCapsule(stalk.section, stalk.length * (0.86 + 0.12 * (h / heads)), phi, h === 0 ? 0.18 : 0.72);
   const headDir = new Vector3(Math.cos(phi) * 0.42, 0.90, Math.sin(phi) * 0.42);
   addDab(stalk.section, 'bloom-' + h, r, headDir, UP, 0.068 + 0.015 * rng(), 0.82, 0.12, 0.35, 'dune-bloom-gold');
   for (let p = 0; p < 3; p++) {
    const pa = phi + p * TAU / 3;
    addRibbon(stalk.section, `ray-${h}-${p}`, r,
     new Vector3(Math.cos(pa) * 0.92, 0.38, Math.sin(pa) * 0.92), UP,
     0.064, 0.42, -0.15, 0.52, 'dune-bloom-gold', 1.2, 0.25);
   }
  }
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 6. Coastal Prickly Pear (Opuntia humifusa — articulated sprawling mat of thick
//    obovate succulent cladode pads, pale needle areoles & golden/maroon flowers)
//    Abrahamson & Rubinstein (1976): branching prostrate pads anchoring xeric dunes.
// ---------------------------------------------------------------------------
function growPricklyPear(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.05, duration: 3, parts: []};
 const rot = rng() * TAU;

 function dressPad(seg, padIdx, padRot, bloomKind) {
  const padWidth = 0.14 + 0.04 * rng();
  const padW = clamp(padWidth / seg.length, 0.54, 0.72);
  // Crisp front/back obovate pad silhouette + orthogonal edge-thickness core ribbon
  for (const [tag, az] of [['a', padRot], ['b', padRot + Math.PI]]) {
   addRibbon(seg.section, `cladode-${tag}-${padIdx}`, mountOnCapsule(seg.section, 0.015, az),
    UP, new Vector3(Math.cos(az), 0, Math.sin(az)), seg.length * 1.03, padW,
    0.03, 0.04, 'succulent-leaf', 1.48, 0.10);
  }
  const coreAz = padRot + Math.PI * 0.5;
  addRibbon(seg.section, `cladode-core-${padIdx}`, mountOnCapsule(seg.section, 0.015, coreAz),
   UP, new Vector3(Math.cos(coreAz), 0, Math.sin(coreAz)), seg.length * 0.98, 0.24,
   0.02, 0.04, 'succulent-leaf', 1.35, 0.12);

  // Discrete golden-straw radiating spine tufts at spiral areole nodes
  const areoles = 8;
  for (let a = 0; a < areoles; a++) {
   const sideSign = a % 2 === 0 ? 1 : -1;
   const phi = padRot + (a % 2 === 0 ? 0 : Math.PI) + 0.35 * centered(rng);
   const yFrac = 0.22 + 0.66 * (a / (areoles - 1));
   const spineDir = new Vector3(Math.cos(phi) * 0.88, 0.46 + 0.22 * rng(), Math.sin(phi) * 0.88).normalize();
   addRibbon(seg.section, `areole-${padIdx}-${a}`,
    mountOnCapsule(seg.section, seg.length * yFrac, padRot + (sideSign > 0 ? 0 : Math.PI)),
    spineDir, UP, 0.038 + 0.010 * rng(), 0.055, 0, 0.04, 'sea-oat-plume', 0.4, 0.95);
  }
  if (bloomKind === 'flower') {
   const rimPhi = padRot + 0.3 * centered(rng);
   const rimRoot = mountOnCapsule(seg.section, seg.length, rimPhi, 0.42);
   for (let p = 0; p < 3; p++) {
    const pAz = rimPhi + p * TAU / 3;
    const petalDir = new Vector3(Math.cos(pAz) * 0.66, 0.75, Math.sin(pAz) * 0.66).normalize();
    addRibbon(seg.section, `bloom-${padIdx}-${p}`, rimRoot, petalDir, UP,
     0.056 + 0.014 * rng(), 0.48, 0.35, 0.14, 'dune-bloom-gold', 1.35, 0.22);
   }
  } else if (bloomKind === 'fruit') {
   const rimPhi = padRot + 0.35 * centered(rng);
   const rimRoot = mountOnCapsule(seg.section, seg.length, rimPhi, 0.38);
   addDab(seg.section, `fruit-${padIdx}`, rimRoot,
    new Vector3(Math.cos(rimPhi) * 0.28, 0.96, Math.sin(rimPhi) * 0.28), UP,
    0.055, 0.46, 0.08, 0.14, 'cactus-fruit');
  }
 }

 const rootPad = makeSegment('pad-0', 'Basal cladode', new Vector3(0, 0.016, 0), axisVec(rot, 0.65), 0.20, 0.030,
  'ground', 'succulent-leaf', 320, 6.0, 1800);
 asset.parts.push(rootPad.section);
 dressPad(rootPad, 0, rot, null);

 const pads = [rootPad];
 let hadReproductive = false;
 for (let c = 0; c < 4; c++) {
  const parentSeg = c < 3 ? rootPad : pads[1];
  const yaw = rot + (c - 1.2) * 1.15 + 0.35 * centered(rng);
  const padDir = axisVec(yaw, c === 3 ? 0.42 + 0.25 * rng() : 0.72 + 0.38 * rng());
  const padStart = parentSeg.tip.clone().addScaledVector(parentSeg.dir, -0.025);
  const pad = makeSegment('pad-' + (c + 1), 'Cladode pad ' + (c + 2), padStart, padDir, 0.17 + 0.05 * rng(), 0.028,
   parentSeg.section.id, 'succulent-leaf', 210, 4.5, 1300);
  asset.parts.push(pad.section);
  pads.push(pad);
  let kind = c >= 1 && rng() > 0.32 ? (rng() > 0.36 ? 'flower' : 'fruit') : null;
  if (c === 3 && !hadReproductive) kind = rng() > 0.4 ? 'flower' : 'fruit';
  if (kind) hadReproductive = true;
  dressPad(pad, c + 1, rot + c * 0.85, kind);
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 7. Black Needlerush (Juncus roemerianus — dense stiff cylindrical tussock with
//    dark bronze sub-apical bract clusters)
//    Eleuterius (1976): 0.8–1.5 m upright sharp dark olive-grey pith culms.
// ---------------------------------------------------------------------------
function growNeedlerush(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.05, duration: 3, parts: []};
 const rot = rng() * TAU;

 for (let b = 0; b < 3; b++) {
  const yaw = rot + b * TAU / 3 + 0.3 * centered(rng);
  const base = new Vector3(0.05 * Math.cos(yaw), 0.015, 0.05 * Math.sin(yaw));
  const coreLen = 0.38 + 0.10 * rng();
  const coreDir = axisVec(yaw, 0.14 + 0.10 * rng());
  const core = makeSegment('tussock-' + b, 'Rush bundle ' + (b + 1), base, coreDir, coreLen, 0.032,
   'ground', 'rush-stem', 260, 3.0, 2200);
  asset.parts.push(core.section);

  const culms = 14;
  for (let i = 0; i < culms; i++) {
   const phi = yaw + i * GOLDEN + 0.2 * centered(rng);
   const tilt = 0.08 + 0.38 * (i / culms) + 0.08 * rng();
   const needleDir = new Vector3(Math.sin(tilt) * Math.cos(phi), Math.cos(tilt), Math.sin(tilt) * Math.sin(phi));
   const needleLen = (0.72 + 0.48 * (1 - 0.35 * (i / culms))) * (0.88 + 0.24 * rng());
   const root = mountOnCapsule(core.section, 0.03 + 0.22 * (i / culms), phi);
   addRibbon(core.section, 'needle-' + i, root, needleDir, UP,
    needleLen, 0.044, -0.10 - 0.14 * tilt, 0.42, i % 4 === 0 ? 'rush-tip' : 'rush-stem', 0.45, 0.88);
   // Lateral sub-apical dark floral bract clusters near upper core cap
   if (i < 5) {
    addDab(core.section, 'bract-' + i, mountOnCapsule(core.section, core.length, phi, 0.35),
     needleDir, UP, 0.068, 0.36, 0, 0.3, 'rush-tip');
   }
  }
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 8. Saw Palmetto (Serenoa repens — radiating costapalmate pleated palm fans)
//    Abrahamson (1995): 0.7–1.4 m arched petioles tipped with 12–16 stiff pleated leaflets.
// ---------------------------------------------------------------------------
function growSawPalmetto(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.05, duration: 3, parts: []};
 const rot = rng() * TAU;
 const caudex = makeSegment('caudex', 'Palmetto caudex', new Vector3(0, 0.015, 0), axisVec(rot, 0.28), 0.24, 0.062,
  'ground', 'scrub-bark', 2200, 12, 8500);
 asset.parts.push(caudex.section);

 // Basal fibrous leaf sheath bracts overlapping the caudex-petiole collar cleanly
 for (let s = 0; s < 6; s++) {
  const phi = rot + s * TAU / 6;
  addRibbon(caudex.section, 'husk-' + s, mountOnCapsule(caudex.section, 0.12 + 0.018 * s, phi),
   new Vector3(Math.cos(phi) * 0.42, 0.90, Math.sin(phi) * 0.42), UP,
   0.16, 0.34, -0.25, 0.12, 'scrub-bark', 0.75, 0.65);
 }

 const fronds = 4;
 const petioleStart = caudex.tip.clone().addScaledVector(caudex.dir, -0.045);
 for (let f = 0; f < fronds; f++) {
  const yaw = rot + f * GOLDEN + 0.25 * centered(rng);
  const elev = 0.52 + 0.42 * (f / fronds) + 0.12 * centered(rng);
  const petioleLen = 0.46 + 0.22 * rng();
  const petioleDir = new Vector3(Math.cos(yaw) * Math.cos(elev), Math.sin(elev), Math.sin(yaw) * Math.cos(elev)).normalize();
  const petiole = makeSegment('petiole-' + f, 'Palmetto petiole ' + (f + 1), petioleStart, petioleDir, petioleLen, 0.032,
   caudex.section.id, 'palmetto-frond', 165, 3.6, 2600);
  asset.parts.push(petiole.section);

  // Costapalmate fan radiating from the hastula at the tip of the petiole
  const blades = 13;
  const fanSpan = 3.8; // ~218° fan
  const localForward = new Vector3(0, 1, 0);
  const localNormal = worldDirToLocal(petioleDir, UP.clone().addScaledVector(petioleDir, 0.35).normalize());
  const localSide = new Vector3().crossVectors(localForward, localNormal).normalize();
  const fanPlaneUp = new Vector3().crossVectors(localSide, localForward).normalize();
  const frondMat = f % 2 === 1 && rng() > 0.35 ? 'glaucous-blade' : 'palmetto-frond';

  for (let b = 0; b < blades; b++) {
   const u = b / (blades - 1) - 0.5;
   const sweep = u * fanSpan;
   const pleatTilt = (b % 2 === 0 ? 0.10 : -0.10) - 0.22 * Math.abs(u);
   const leafDir = localForward.clone().multiplyScalar(Math.cos(sweep * 0.82))
    .addScaledVector(localSide, Math.sin(sweep * 0.82))
    .addScaledVector(fanPlaneUp, pleatTilt).normalize();
   const len = (0.48 + 0.14 * (1 - Math.abs(u))) * (0.9 + 0.2 * rng());
   const rootAz = Math.atan2(localSide.z, localSide.x) + sweep * 0.5;
   const root = mountOnCapsule(petiole.section, petiole.length, rootAz, 0.18 + Math.abs(u) * 0.48);
   addRibbon(petiole.section, 'leaflet-' + b, root, leafDir, fanPlaneUp,
    len, 0.088, -0.44 - 0.24 * Math.abs(u), 0.36, frondMat, 0.72, 0.78, (b % 2 ? 0.25 : -0.25));
  }
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 9. Florida Rosemary (Ceratiola ericoides — dense globose needle-leaf allelopathic shrub)
//    Hunter & Menges (2002): 0.8–1.7 m rounded evergreen crown of clustered ericoid needles.
// ---------------------------------------------------------------------------
function growRosemary(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.055, duration: 3, parts: []};
 const rot = rng() * TAU;
 const trunk = makeSegment('trunk', 'Rosemary trunk', new Vector3(0, 0.015, 0), axisVec(rot, 0.16), 0.34 + 0.08 * rng(), 0.040,
  'ground', 'scrub-bark', 1250, 9.5, 5800);
 asset.parts.push(trunk.section);

 for (let b = 0; b < 3; b++) {
  const yaw = rot + b * TAU / 3 + 0.35 * centered(rng);
  const bLen = 0.52 + 0.18 * rng();
  const bDir = axisVec(yaw, 0.58 + 0.24 * rng());
  const branch = makeSegment('bough-' + b, 'Rosemary bough ' + (b + 1), trunk.tip, bDir, bLen, 0.028,
   trunk.section.id, 'scrub-bark', 340, 4.2, 3200);
  asset.parts.push(branch.section);

  const tufts = 22;
  for (let i = 0; i < tufts; i++) {
   const u = 0.24 + 0.76 * (i / (tufts - 1));
   const phi = yaw + i * GOLDEN;
   const el = 0.15 + 0.85 * u + 0.25 * centered(rng);
   const dir = new Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el));
   const root = mountOnCapsule(branch.section, u * branch.length, phi, u > 0.90 ? (1 - u) * 4 : null);
   if (i % 3 === 0) {
    addRibbon(branch.section, 'needle-spray-' + i, root, dir, UP, 0.16 + 0.06 * rng(), 0.24, -0.15, 0.30, 'rosemary-needle', 0.85, 0.42, (i % 2 ? 0.55 : -0.55));
   } else {
    addRibbon(branch.section, 'spray-' + i, root, dir, UP, 0.19 + 0.08 * rng(), 0.28, -0.18, 0.34, 'rosemary-needle', 0.88, 0.40);
   }
  }
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 10. Sand Live Oak (Quercus geminata — wind-sculpted wide-spreading coastal krummholz oak)
//     FNAI Coastal Strand / Scrub: 3.5–6 m gnarled trunk, broad horizontal leeward boughs.
// ---------------------------------------------------------------------------
function growSandLiveOak(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.09, duration: 3, parts: []};
 const leanAz = rng() * TAU;
 const lowerTrunk = makeSegment('trunk-base', 'Gnarled oak trunk', new Vector3(0, 0.02, 0), axisVec(leanAz, 0.28 + 0.12 * rng()),
  1.25 + 0.35 * rng(), 0.160, 'ground', 'scrub-bark', 28000, 110, 82000);
 const midStart = lowerTrunk.tip.clone().addScaledVector(lowerTrunk.dir, -0.20);
 const upperTrunk = makeSegment('trunk-mid', 'Upper oak trunk', midStart, axisVec(leanAz + 0.35 * centered(rng), 0.38 + 0.14 * rng()),
  1.15 + 0.35 * rng(), 0.130, lowerTrunk.section.id, 'scrub-bark', 16500, 68, 52000);
 asset.parts.push(lowerTrunk.section, upperTrunk.section);

 // Basal flared buttress ribs around trunk foot
 for (let k = 0; k < 5; k++) {
  const phi = leanAz + k * TAU / 5;
  addRibbon(lowerTrunk.section, 'buttress-' + k, mountOnCapsule(lowerTrunk.section, 0.14, phi),
   new Vector3(Math.cos(phi) * 0.42, 0.90, Math.sin(phi) * 0.42), UP, 0.34, 0.38, -0.15, 0.04, 'scrub-bark', 0.55, 0.8);
 }

 const boughStart = upperTrunk.tip.clone().addScaledVector(upperTrunk.dir, -0.16);
 for (let b = 0; b < 3; b++) {
  const yaw = leanAz + (b - 1) * 1.55 + 0.28 * centered(rng);
  const bLen = (1.65 + 0.55 * rng()) * (b === 1 ? 1.15 : 0.94);
  const bDir = axisVec(yaw, 1.15 + 0.55 * rng());
  const bough = makeSegment('bough-' + b, 'Oak canopy bough ' + (b + 1), boughStart, bDir, bLen, 0.078,
   upperTrunk.section.id, 'scrub-bark', 7200, 32, 26000);
  asset.parts.push(bough.section);

  const clusters = 30;
  for (let i = 0; i < clusters; i++) {
   const u = 0.24 + 0.76 * (i / (clusters - 1));
   const phi = yaw + i * GOLDEN;
   const el = -0.05 + 0.65 * u + 0.24 * centered(rng);
   const dir = new Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el));
   const root = mountOnCapsule(bough.section, u * bough.length, phi, u > 0.90 ? (1 - u) * 5 : null);
   if (i % 3 === 0) {
    addRibbon(bough.section, 'leaf-cluster-' + i, root, dir, UP, 0.44 + 0.16 * rng(), 0.42, -0.22, 0.22, 'oak-leaf', 0.90, 0.28, (i % 2 ? 0.48 : -0.48));
   } else {
    addRibbon(bough.section, 'twig-' + i, root, dir, UP, 0.46 + 0.16 * rng(), 0.46, -0.28, 0.26, 'oak-leaf', 0.85, 0.32);
   }
  }
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 11. Coastal Slash Pine (Pinus elliottii — 8–12 m straight trunk, open umbrella crown)
//     FNAI Maritime Hammock / Flatwoods: tall clear bole + distal tufted pine brooms.
// ---------------------------------------------------------------------------
function growSlashPine(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.12, duration: 3, parts: []};
 const leanAz = rng() * TAU;

 const t0 = makeSegment('trunk-0', 'Lower pine trunk', new Vector3(0, 0.02, 0),
  axisVec(leanAz, 0.06 + 0.04 * rng()), 3.15 + 0.55 * rng(), 0.185,
  'ground', 'pine-bark', 75000, 260, 150000);
 const t1Start = t0.tip.clone().addScaledVector(t0.dir, -0.24);
 const t1 = makeSegment('trunk-1', 'Mid pine trunk', t1Start,
  axisVec(leanAz + 0.4 * centered(rng), 0.08 + 0.04 * rng()), 2.75 + 0.55 * rng(), 0.155,
  t0.section.id, 'pine-bark', 48000, 175, 110000);
 const t2Start = t1.tip.clone().addScaledVector(t1.dir, -0.20);
 const t2 = makeSegment('trunk-2', 'Upper pine trunk', t2Start,
  axisVec(leanAz + 0.6 * centered(rng), 0.09 + 0.05 * rng()), 2.15 + 0.45 * rng(), 0.125,
  t1.section.id, 'pine-bark', 26000, 95, 72000);
 asset.parts.push(t0.section, t1.section, t2.section);

 // Furrowed lower bark plates
 for (let k = 0; k < 4; k++) {
  const phi = leanAz + k * TAU / 4;
  addRibbon(t0.section, 'plate-' + k, mountOnCapsule(t0.section, 0.25, phi),
   new Vector3(Math.cos(phi) * 0.22, 0.97, Math.sin(phi) * 0.22), UP, 0.55, 0.26, -0.05, 0.02, 'pine-bark', 0.6, 0.7);
 }

 // Leader needle brooms across upper crown apex
 for (let a = 0; a < 18; a++) {
  const u = 0.35 + 0.65 * (a / 17);
  const phi = leanAz + a * GOLDEN;
  const el = 0.12 + 0.80 * u + 0.16 * centered(rng);
  const dir = new Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el));
  addRibbon(t2.section, 'apex-' + a, mountOnCapsule(t2.section, u * t2.length, phi, u > 0.92 ? (1 - u) * 5 : null),
   dir, UP, 0.52 + 0.20 * rng(), 0.42, -0.26, 0.22, 'pine-needle', 1.15, 0.48, (a % 2 ? 0.35 : -0.35));
 }

 const boughConfigs = [
  {id: 'bough-low', label: 'Mid pine bough', parent: t1, yaw: leanAz + Math.PI * 0.75 + 0.45 * centered(rng), slope: 1.15 + 0.35 * rng(), len: 1.90 + 0.50 * rng(), rad: 0.068, startBack: 0.20, uMin: 0.30}
 ];
 for (let b = 0; b < 3; b++) {
  boughConfigs.push({
   id: 'bough-' + b,
   label: 'Pine umbrella bough ' + (b + 1),
   parent: t2,
   yaw: leanAz + b * TAU / 3 + 0.35 * centered(rng),
   slope: 1.15 + 0.45 * rng(),
   len: 2.0 + 0.65 * rng(),
   rad: 0.072,
   startBack: 0.18,
   uMin: 0.25
  });
 }
 for (const cfg of boughConfigs) {
  const boughStart = cfg.parent.tip.clone().addScaledVector(cfg.parent.dir, -cfg.startBack);
  const bough = makeSegment(cfg.id, cfg.label, boughStart,
   axisVec(cfg.yaw, cfg.slope), cfg.len, cfg.rad, cfg.parent.section.id, 'pine-bark', 8500, 36, 28000);
  asset.parts.push(bough.section);

  const tufts = 26;
  for (let i = 0; i < tufts; i++) {
   const u = cfg.uMin + (1 - cfg.uMin) * (i / (tufts - 1));
   const phi = cfg.yaw + i * GOLDEN;
   const el = 0.06 + 0.85 * (u - 0.2) + 0.22 * centered(rng);
   const dir = new Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el));
   const root = mountOnCapsule(bough.section, u * bough.length, phi, u > 0.90 ? (1 - u) * 5 : null);
   if (i % 3 === 0) {
    addRibbon(bough.section, 'fascicle-fan-' + i, root, dir, UP, 0.50 + 0.22 * rng(), 0.40, -0.24, 0.22, 'pine-needle', 1.25, 0.48, (i % 2 ? 0.58 : -0.58));
   } else {
    addRibbon(bough.section, 'needle-tuft-' + i, root, dir, UP, 0.52 + 0.22 * rng(), 0.46, -0.28, 0.24, 'pine-needle', 1.25, 0.50, (i % 2 ? 0.28 : -0.28));
   }
  }
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 12. Coastal Sand Pine (Pinus clausa — 5.5–9 m crooked wind-sheared trunk with
//     persistent low lateral limbs hugging xeric scrub ridges)
// ---------------------------------------------------------------------------
function growSandPine(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.10, duration: 3, parts: []};
 const leanAz = rng() * TAU;

 const t0 = makeSegment('trunk-0', 'Crooked sand-pine trunk', new Vector3(0, 0.02, 0),
  axisVec(leanAz, 0.22 + 0.08 * rng()), 2.55 + 0.65 * rng(), 0.155,
  'ground', 'pine-bark', 48000, 170, 105000);
 const t1Start = t0.tip.clone().addScaledVector(t0.dir, -0.20);
 const t1 = makeSegment('trunk-1', 'Upper crooked trunk', t1Start,
  axisVec(leanAz + 0.65 * centered(rng), 0.28 + 0.12 * rng()), 2.45 + 0.65 * rng(), 0.125,
  t0.section.id, 'pine-bark', 26000, 95, 68000);
 asset.parts.push(t0.section, t1.section);

 // Persistent low lateral branch from lower trunk junction + two upper crown limbs
 const limbSpecs = [
  {parent: t0, yaw: leanAz + 2.1 + 0.5 * centered(rng), slope: 1.15, len: 1.65 + 0.50 * rng(), rad: 0.068},
  {parent: t1, yaw: leanAz - 0.7 + 0.4 * centered(rng), slope: 0.85, len: 1.55 + 0.48 * rng(), rad: 0.062},
  {parent: t1, yaw: leanAz + 1.3 + 0.4 * centered(rng), slope: 0.95, len: 1.50 + 0.45 * rng(), rad: 0.058}
 ];
 // Pine needle sprays directly along upper trunk-1
 for (let i = 0; i < 16; i++) {
  const u = 0.25 + 0.75 * (i / 15);
  const phi = leanAz + i * GOLDEN;
  const dir = new Vector3(Math.cos(phi) * 0.75, 0.66, Math.sin(phi) * 0.75).normalize();
  addRibbon(t1.section, 'crown-spray-' + i, mountOnCapsule(t1.section, u * t1.length, phi),
   dir, UP, 0.44 + 0.16 * rng(), 0.40, -0.24, 0.22, 'pine-needle', 1.1, 0.5, (i % 2 ? 0.35 : -0.35));
 }

 for (const [lIdx, spec] of limbSpecs.entries()) {
  const limbStart = spec.parent.tip.clone().addScaledVector(spec.parent.dir, -0.16);
  const limb = makeSegment('limb-' + lIdx, 'Sand-pine limb ' + (lIdx + 1), limbStart,
   axisVec(spec.yaw, spec.slope), spec.len, spec.rad, spec.parent.section.id, 'pine-bark', 7200, 30, 24000);
  asset.parts.push(limb.section);
  const sprays = 26;
  for (let i = 0; i < sprays; i++) {
   const u = 0.24 + 0.76 * (i / (sprays - 1));
   const phi = spec.yaw + i * GOLDEN;
   const el = 0.05 + 0.72 * u + 0.25 * centered(rng);
   const dir = new Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el));
   const root = mountOnCapsule(limb.section, u * limb.length, phi, u > 0.90 ? (1 - u) * 5 : null);
   if (i % 3 === 0) {
    addRibbon(limb.section, 'fascicle-fan-' + i, root, dir, UP, 0.42 + 0.16 * rng(), 0.40, -0.20, 0.22, 'pine-needle', 1.15, 0.48, (i % 2 ? 0.56 : -0.56));
   } else {
    addRibbon(limb.section, 'fascicle-' + i, root, dir, UP, 0.44 + 0.18 * rng(), 0.46, -0.22, 0.22, 'pine-needle', 1.15, 0.48, (i % 2 ? 0.26 : -0.26));
   }
  }
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 13. Southern Wax Myrtle (Morella cerifera — 2.2–4 m multi-stemmed aromatic shrub/tree)
//     FNAI Coastal Swale / Strand: olive-green foliage ringing freshwater slack margins.
// ---------------------------------------------------------------------------
function growWaxMyrtle(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.075, duration: 3, parts: []};
 const rot = rng() * TAU;

 for (let s = 0; s < 4; s++) {
  const yaw = rot + s * TAU / 4 + 0.35 * centered(rng);
  const reach = 0.06 + 0.05 * rng();
  const base = new Vector3(reach * Math.cos(yaw), 0.015, reach * Math.sin(yaw));
  const len = 1.85 + 0.75 * rng();
  const stem = makeSegment('stem-' + s, 'Myrtle stem ' + (s + 1), base,
   axisVec(yaw, 0.26 + 0.18 * rng()), len, 0.048, 'ground', 'scrub-bark', 2600, 26, 6500);
  asset.parts.push(stem.section);

  const sprays = 24;
  for (let i = 0; i < sprays; i++) {
   const u = 0.32 + 0.68 * (i / (sprays - 1));
   const phi = yaw + i * GOLDEN;
   const el = 0.12 + 0.76 * u + 0.22 * centered(rng);
   const dir = new Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el));
   const root = mountOnCapsule(stem.section, u * stem.length, phi, u > 0.90 ? (1 - u) * 5 : null);
   if (i % 3 === 0) {
    addRibbon(stem.section, 'leaf-spray-' + i, root, dir, UP, 0.24 + 0.10 * rng(), 0.28, -0.20, 0.35, 'myrtle-leaf', 0.95, 0.55, (i % 2 ? 0.45 : -0.45));
   } else {
    addRibbon(stem.section, 'leaf-' + i, root, dir, UP, 0.26 + 0.10 * rng(), 0.34, -0.22, 0.38, 'myrtle-leaf', 0.95, 0.68);
   }
  }
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 14. Sea Rocket (Cakile constricta — succulent upper-berm Gulf pioneer brassica)
// ---------------------------------------------------------------------------
function growSeaRocket(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.05, duration: 3, parts: []};
 const rot = rng() * TAU;

 for (let b = 0; b < 4; b++) {
  const yaw = rot + b * TAU / 4 + 0.42 * centered(rng);
  const reach = 0.04 + 0.03 * rng();
  const base = new Vector3(reach * Math.cos(yaw), 0.015, reach * Math.sin(yaw));
  const len = 0.28 + 0.16 * rng();
  const stem = makeSegment('branch-' + b, 'Sea-rocket stem ' + (b + 1), base,
   axisVec(yaw, 0.55 + 0.32 * rng()), len, 0.026, 'ground', 'succulent-leaf', 72, 2.0, 760);
  asset.parts.push(stem.section);

  const leaves = 10;
  for (let i = 0; i < leaves; i++) {
   const u = 0.18 + 0.78 * (i / (leaves - 1));
   const phi = yaw + i * GOLDEN;
   const el = 0.24 + 0.60 * u + 0.14 * centered(rng);
   const dir = new Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el));
   const root = mountOnCapsule(stem.section, u * stem.length, phi, u > 0.90 ? (1 - u) * 5 : null);
   addRibbon(stem.section, 'leaf-' + i, root, dir, UP, 0.068 + 0.026 * (1 - 0.3 * u), 0.36, -0.32, 0.30, 'succulent-leaf', 1.20, 0.26);
   if (i >= 7) {
    addDab(stem.section, 'bloom-' + i, root, dir, UP, 0.038, 0.44, 0.08, 0.22, 'sea-rocket-bloom');
   }
  }
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 15. Gulf Bluestem (Schizachyrium maritimum — copper-plumed foredune/blowout bunchgrass)
// ---------------------------------------------------------------------------
function growGulfBluestem(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.05, duration: 3, parts: []};
 const rot = rng() * TAU;

 for (let t = 0; t < 3; t++) {
  const heading = rot + t * TAU / 3 + 0.38 * centered(rng);
  const reach = 0.04 + 0.05 * rng();
  const basePos = new Vector3(reach * Math.cos(heading), 0.015, reach * Math.sin(heading));
  const height = 0.52 + 0.32 * rng();
  const radius = 0.025;
  const baseDir = axisVec(heading, 0.24 + 0.18 * rng());
  const tipDir = axisVec(heading + 0.28 * centered(rng), 0.36 + 0.22 * rng());

  const basal = makeSegment('base-' + t, 'Bluestem culm ' + (t + 1), basePos, baseDir, height * 0.54, radius,
   'ground', 'glaucous-blade', 78, 1.4, 620);
  const upper = makeSegment('tip-' + t, 'Bluestem plume ' + (t + 1), basal.tip, tipDir, height * 0.46, radius,
   basal.section.id, 'bluestem-copper', 34, 0.8, 380);
  asset.parts.push(basal.section, upper.section);

  for (let i = 0; i < 6; i++) {
   const u = 0.14 + 0.80 * (i / 5);
   const phi = heading + i * GOLDEN;
   const el = 0.25 + 0.48 * u;
   addRibbon(basal.section, 'leaf-' + i, mountOnCapsule(basal.section, u * basal.length, phi),
    new Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el)),
    UP, 0.22 + 0.14 * rng(), 0.072, -0.58, 0.72, 'glaucous-blade', 0.68, 0.82);
  }
  for (let b = 0; b < 5; b++) {
   const u = 0.25 + 0.75 * (b / 4);
   const phi = heading + b * GOLDEN;
   const brDir = new Vector3(Math.cos(phi) * 0.48, 0.88, Math.sin(phi) * 0.48).normalize();
   addRibbon(upper.section, 'panicle-' + b, mountOnCapsule(upper.section, u * upper.length, phi, b === 4 ? 0.22 : null),
    brDir, UP, 0.14 + 0.08 * rng(), 0.14, -0.30, 0.56, 'bluestem-copper', 0.76, 0.74);
  }
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 16. Beach Dune Sunflower (Helianthus debilis — spreading coastal back-berm aster)
// ---------------------------------------------------------------------------
function growDuneSunflower(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.05, duration: 3, parts: []};
 const rot = rng() * TAU;

 for (let s = 0; s < 4; s++) {
  const yaw = rot + s * TAU / 4 + 0.36 * centered(rng);
  const reach = 0.04 + 0.03 * rng();
  const base = new Vector3(reach * Math.cos(yaw), 0.015, reach * Math.sin(yaw));
  const len = 0.32 + 0.16 * rng();
  const stem = makeSegment('stem-' + s, 'Sunflower stem ' + (s + 1), base,
   axisVec(yaw, 0.62 + 0.28 * rng()), len, 0.025, 'ground', 'sunflower-leaf', 64, 1.8, 540);
  asset.parts.push(stem.section);

  for (let i = 0; i < 8; i++) {
   const u = 0.16 + 0.74 * (i / 7);
   const phi = yaw + i * GOLDEN;
   const el = 0.22 + 0.42 * u + 0.14 * centered(rng);
   const leafDir = new Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el));
   addRibbon(stem.section, 'leaf-' + i, mountOnCapsule(stem.section, u * stem.length, phi),
    leafDir, UP, 0.095 + 0.035 * rng(), 0.54, -0.26, 0.42, 'sunflower-leaf', 1.15, 0.48);
  }
  const headRoot = mountOnCapsule(stem.section, stem.length * 0.96, yaw, 0.22);
  addDab(stem.section, 'head-disc-' + s, headRoot,
   new Vector3(Math.cos(yaw) * 0.35, 0.94, Math.sin(yaw) * 0.35), UP, 0.044, 0.65, 0.06, 0.25, 'pine-bark');
  for (let p = 0; p < 4; p++) {
   const pa = yaw + p * TAU / 4;
   addRibbon(stem.section, `bloom-${s}-${p}`, headRoot,
    new Vector3(Math.cos(pa) * 0.88, 0.48, Math.sin(pa) * 0.88), UP,
    0.068 + 0.012 * rng(), 0.48, -0.14, 0.48, 'dune-bloom-gold', 1.25, 0.26);
  }
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 17. Sea Purslane (Sesuvium portulacastrum — prostrate lower-berm / saline swale mat)
// ---------------------------------------------------------------------------
function growSeaPurslane(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.05, duration: 3, parts: []};
 const rot = rng() * TAU;

 for (let r = 0; r < 4; r++) {
  const yaw = rot + r * TAU / 4 + 0.35 * centered(rng);
  const base = new Vector3(0.03 * Math.cos(yaw), 0.015, 0.03 * Math.sin(yaw));
  const len = 0.44 + 0.24 * rng();
  const dir = new Vector3(Math.cos(yaw), 0.04 + 0.04 * rng(), Math.sin(yaw)).normalize();
  const stolon = makeSegment('stolon-' + r, 'Purslane runner ' + (r + 1), base, dir, len, 0.025,
   'ground', 'purslane-stem', 42, 2.6, 620);
  asset.parts.push(stolon.section);

  const localUp = worldDirToLocal(stolon.dir, UP);
  const localSide = worldDirToLocal(stolon.dir, new Vector3(-Math.sin(yaw), 0, Math.cos(yaw)));
  const pairs = 6;
  for (let i = 0; i < pairs; i++) {
   const u = 0.14 + 0.82 * (i / (pairs - 1));
   const yPos = u * stolon.length;
   const sideAz = yaw + (i % 2 ? Math.PI * 0.5 : -Math.PI * 0.5);
   for (const sideSign of [-1, 1]) {
    const root = mountOnCapsule(stolon.section, yPos, sideAz + (sideSign > 0 ? 0 : Math.PI));
    const bladeDir = localSide.clone().multiplyScalar(sideSign * 0.84).addScaledVector(localUp, 0.54).normalize();
    addRibbon(stolon.section, `leaf-${r}-${i}-${sideSign > 0 ? 'a' : 'b'}`, root,
     bladeDir, localUp, 0.066 + 0.022 * rng(), 0.44, -0.18, 0.24, 'succulent-leaf', 1.25, 0.22);
   }
   if (i === 3) {
    addDab(stolon.section, `bloom-${r}-${i}`, mountOnCapsule(stolon.section, yPos, yaw),
     localUp, localSide, 0.038, 0.36, 0.06, 0.18, 'sea-rocket-bloom');
   }
  }
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 18. Smooth Cordgrass (Spartina alterniflora — tall intertidal lagoon/swale marsh grass)
// ---------------------------------------------------------------------------
function growSmoothCordgrass(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.055, duration: 3, parts: []};
 const rot = rng() * TAU;

 for (let t = 0; t < 3; t++) {
  const heading = rot + t * TAU / 3 + 0.34 * centered(rng);
  const reach = (t === 0 ? 0.04 : 0.12) + 0.05 * rng();
  const basePos = new Vector3(reach * Math.cos(heading), 0.015, reach * Math.sin(heading));
  const height = (0.88 + 0.52 * (0.65 + 0.35 * rng()));
  const radius = 0.028;
  const basal = makeSegment('base-' + t, 'Cordgrass culm ' + (t + 1), basePos, axisVec(heading, 0.08 + 0.12 * rng()),
   height * 0.58, radius, 'ground', 'cordgrass-blade', 180, 2.2, 1100);
  const upper = makeSegment('tip-' + t, 'Cordgrass spike ' + (t + 1), basal.tip, axisVec(heading + 0.3 * centered(rng), 0.18 + 0.12 * rng()),
   height * 0.42, radius * 0.90, basal.section.id, 'cordgrass-blade', 64, 1.1, 680);
  asset.parts.push(basal.section, upper.section);

  for (let i = 0; i < 5; i++) {
   const u = 0.16 + 0.78 * (i / 4);
   const phi = heading + i * GOLDEN;
   const el = 0.35 + 0.42 * u;
   addRibbon(basal.section, 'leaf-' + i, mountOnCapsule(basal.section, u * basal.length, phi),
    new Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el)),
    UP, 0.38 + 0.24 * rng(), 0.068, -0.68, 0.76, 'cordgrass-blade', 0.72, 0.78);
  }
  for (let i = 0; i < 2; i++) {
   const u = 0.22 + 0.60 * i;
   const phi = heading + i * GOLDEN;
   addRibbon(upper.section, 'leaf-u-' + i, mountOnCapsule(upper.section, u * upper.length, phi),
    new Vector3(Math.cos(phi) * 0.62, 0.78, Math.sin(phi) * 0.62), UP,
    0.26 + 0.12 * rng(), 0.060, -0.52, 0.74, 'cordgrass-blade', 0.70, 0.80);
  }
  addRibbon(upper.section, 'spikelet-' + t, mountOnCapsule(upper.section, upper.length, heading, 0.12),
   new Vector3(0.18 * Math.cos(heading), 0.98, 0.18 * Math.sin(heading)).normalize(), UP,
   0.18 + 0.06 * rng(), 0.062, -0.14, 0.60, 'reed-husk', 0.64, 0.84);
 }
 return asset;
}

// ---------------------------------------------------------------------------
// 19. Coastal Cabbage Palm (Sabal palmetto — Florida coastal hammock palm 5.5–8.5 m)
// ---------------------------------------------------------------------------
function growCabbagePalm(id, name, seed) {
 const rng = randomSequence(seed);
 const asset = {id, name, spacing: 0.11, duration: 3, parts: []};
 const leanAz = rng() * TAU;

 const t0 = makeSegment('trunk-low', 'Lower palm trunk', new Vector3(0, 0.02, 0),
  axisVec(leanAz, 0.16 + 0.10 * rng()), 1.55 + 0.45 * rng(), 0.150, 'ground', 'palm-trunk', 72000, 240, 140000);
 const t1 = makeSegment('trunk-mid', 'Middle palm trunk', t0.tip,
  axisVec(leanAz + 0.22 * centered(rng), 0.10 + 0.08 * rng()), 1.65 + 0.50 * rng(), 0.135, t0.section.id, 'palm-trunk', 48000, 165, 95000);
 const t2 = makeSegment('trunk-top', 'Upper palm crownshaft', t1.tip,
  axisVec(leanAz - 0.15 * centered(rng), 0.08 + 0.06 * rng()), 1.55 + 0.45 * rng(), 0.120, t1.section.id, 'palm-trunk', 28000, 95, 65000);
 asset.parts.push(t0.section, t1.section, t2.section);

 // Fibrous criss-crossed persistent leaf-boot husks on upper trunk
 for (let s = 0; s < 6; s++) {
  const phi = leanAz + s * GOLDEN;
  const u = 0.25 + 0.65 * (s / 5);
  addRibbon(t2.section, 'husk-' + s, mountOnCapsule(t2.section, u * t2.length, phi),
   new Vector3(Math.cos(phi) * 0.42, 0.90, Math.sin(phi) * 0.42), UP,
   0.28, 0.36, -0.22, 0.12, 'palm-trunk', 0.72, 0.68);
 }

 const fronds = 5;
 const crownBase = t2.tip.clone().addScaledVector(t2.dir, -0.08);
 for (let f = 0; f < fronds; f++) {
  const yaw = leanAz + f * GOLDEN + 0.24 * centered(rng);
  const elev = 0.22 + 0.58 * (f / (fronds - 1)) + 0.12 * centered(rng);
  const pLen = 0.68 + 0.24 * rng();
  const pDir = new Vector3(Math.cos(yaw) * Math.cos(elev), Math.sin(elev), Math.sin(yaw) * Math.cos(elev)).normalize();
  const petiole = makeSegment('petiole-' + f, 'Palm frond ' + (f + 1), crownBase, pDir, pLen, 0.042,
   t2.section.id, 'palmetto-frond', 380, 7.5, 4200);
  asset.parts.push(petiole.section);

  const blades = 13;
  const fanSpan = 3.9;
  const localForward = new Vector3(0, 1, 0);
  const localNormal = worldDirToLocal(pDir, UP.clone().addScaledVector(pDir, 0.32).normalize());
  const localSide = new Vector3().crossVectors(localForward, localNormal).normalize();
  const fanPlaneUp = new Vector3().crossVectors(localSide, localForward).normalize();
  const frondMat = f % 2 === 1 && rng() > 0.40 ? 'glaucous-blade' : 'palmetto-frond';

  for (let b = 0; b < blades; b++) {
   const u = b / (blades - 1) - 0.5;
   const sweep = u * fanSpan;
   const pleatTilt = (b % 2 === 0 ? 0.10 : -0.10) - 0.28 * Math.abs(u);
   const leafDir = localForward.clone().multiplyScalar(Math.cos(sweep * 0.82))
    .addScaledVector(localSide, Math.sin(sweep * 0.82))
    .addScaledVector(fanPlaneUp, pleatTilt).normalize();
   const len = (0.64 + 0.22 * (1 - Math.abs(u))) * (0.90 + 0.20 * rng());
   const rootAz = Math.atan2(localSide.z, localSide.x) + sweep * 0.5;
   const root = mountOnCapsule(petiole.section, petiole.length, rootAz, 0.18 + Math.abs(u) * 0.48);
   addRibbon(petiole.section, 'leaflet-' + b, root, leafDir, fanPlaneUp,
    len, 0.082, -0.58 - 0.22 * Math.abs(u), 0.38, frondMat, 0.72, 0.78, (b % 2 ? 0.25 : -0.25));
  }
 }
 return asset;
}

// ---------------------------------------------------------------------------
// Canonical Species Registry (indices 0..19) & Continuous Physiological Niche Functions
// Calibrated to St. Andrews / Shell Island / Perdido Key FNAI transect zones.
// ---------------------------------------------------------------------------
export const COASTAL_SPECIES = [
 {
  id: 'coastal-reed',
  name: 'Coastal wetland reed',
  scientificName: 'Phragmites / Cladium',
  guild: 'wetland',
  heightRange: [1.1, 2.7],
  spreadRadius: 1.75,
  ramets: [2, 5],
  minClearance: 0.70,
  allelopathic: false,
  conform: 0.0,
  maxRenderDist: 340,
  windSculpt: 0.12,
  canopyTint: [0.16, 0.22, 0.08],
  grow: (id, name, seed) => growCrown(id, name, seed, 0.96, 1),
  suitability(e) {
   const shore = smooth((e.shoreDistance - 24) / 4);
   const water = band(e.elevation, -0.56, 0.52, 0.22);
   const moist = smooth((e.moisture - 0.52) / 0.26);
   const salt = 1 - smooth((e.salinity - 0.42) / 0.30);
   const spray = 1 - smooth((e.saltSpray - 0.52) / 0.30);
   const burial = 1 - smooth((e.sandMobility - 0.35) / 0.25);
   return shore * water * moist * salt * spray * burial * (1 - 0.85 * e.rosemaryInhibition);
  }
 },
 {
  id: 'sea-oats',
  name: 'Sea oats',
  scientificName: 'Uniola paniculata',
  guild: 'foredune',
  heightRange: [0.95, 1.9],
  spreadRadius: 1.9,
  ramets: [2, 5],
  minClearance: 0.68,
  allelopathic: false,
  conform: 0.0,
  maxRenderDist: 340,
  windSculpt: 0.15,
  canopyTint: [0.42, 0.40, 0.18],
  grow: growSeaOats,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 17.5) / 3.5);
   const dry = band(e.elevation, 0.72, 6.0, 0.34) * (1 - smooth((e.moisture - 0.45) / 0.22));
   // Sea oats thrive on blowing quartz sand (sand burial stimulates tillering, Wagner 1964)
   const burial = 0.28 + 0.72 * smooth((e.sandMobility - 0.08) / 0.34);
   const spray = 0.25 + 0.75 * band(e.saltSpray, 0.18, 1.35, 0.22);
   const salt = 1 - smooth((e.salinity - 0.58) / 0.28);
   return shore * dry * burial * spray * salt * (1 - 0.88 * e.rosemaryInhibition);
  }
 },
 {
  id: 'bitter-panic',
  name: 'Bitter panicgrass',
  scientificName: 'Panicum amarum',
  guild: 'foredune',
  heightRange: [0.85, 1.65],
  spreadRadius: 1.55,
  ramets: [2, 4],
  minClearance: 0.65,
  allelopathic: false,
  conform: 0.0,
  maxRenderDist: 330,
  windSculpt: 0.12,
  canopyTint: [0.22, 0.34, 0.26],
  grow: growBitterPanic,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 16.5) / 3.5);
   const elev = band(e.elevation, 0.65, 5.2, 0.32);
   const moist = band(e.moisture, 0.02, 0.56, 0.18);
   const spray = 0.3 + 0.7 * band(e.saltSpray, 0.22, 1.35, 0.22);
   const mob = 0.32 + 0.68 * smooth((e.sandMobility - 0.06) / 0.30);
   return shore * elev * moist * spray * mob * (1 - 0.86 * e.rosemaryInhibition);
  }
 },
 {
  id: 'railroad-vine',
  name: 'Railroad vine',
  scientificName: 'Ipomoea pes-caprae',
  guild: 'pioneer',
  heightRange: [0.16, 0.28],
  spreadRadius: 2.3,
  ramets: [1, 2],
  minClearance: 1.25,
  allelopathic: false,
  conform: 1.0,
  maxRenderDist: 185,
  windSculpt: 0.0,
  canopyTint: [0.16, 0.34, 0.16],
  grow: growRailroadVine,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 14.5) / 3.0);
   const berm = band(e.elevation, 0.56, 3.2, 0.28);
   const dry = 1 - smooth((e.moisture - 0.38) / 0.20);
   const spray = smooth((e.saltSpray - 0.28) / 0.28);
   const mob = 0.35 + 0.65 * smooth((e.sandMobility - 0.10) / 0.28);
   const flat = 1 - smooth((e.slope - 0.36) / 0.18);
   return shore * berm * dry * spray * mob * flat * (1 - 0.90 * e.rosemaryInhibition);
  }
 },
 {
  id: 'beach-elder',
  name: 'Beach elder',
  scientificName: 'Iva imbricata',
  guild: 'pioneer',
  heightRange: [0.35, 0.72],
  spreadRadius: 1.35,
  ramets: [1, 3],
  minClearance: 0.64,
  allelopathic: false,
  conform: 0.25,
  maxRenderDist: 270,
  windSculpt: 0.10,
  canopyTint: [0.32, 0.42, 0.18],
  grow: growBeachElder,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 15.5) / 3.0);
   const elev = band(e.elevation, 0.62, 3.6, 0.30);
   const dry = 1 - smooth((e.moisture - 0.46) / 0.20);
   const spray = smooth((e.saltSpray - 0.26) / 0.26);
   const mob = 0.3 + 0.7 * smooth((e.sandMobility - 0.08) / 0.30);
   return shore * elev * dry * spray * mob * (1 - 0.88 * e.rosemaryInhibition);
  }
 },
 {
  id: 'goldenaster',
  name: "Godfrey's goldenaster",
  scientificName: 'Chrysopsis godfreyi',
  guild: 'foredune',
  heightRange: [0.32, 0.58],
  spreadRadius: 1.15,
  ramets: [1, 3],
  minClearance: 0.52,
  allelopathic: false,
  conform: 0.25,
  maxRenderDist: 190,
  windSculpt: 0.08,
  canopyTint: [0.42, 0.44, 0.24],
  grow: growGoldenaster,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 20) / 4.0);
   const elev = band(e.elevation, 0.75, 5.5, 0.36);
   const dry = 1 - smooth((e.moisture - 0.34) / 0.18);
   const spray = band(e.saltSpray, 0.12, 0.90, 0.18);
   const mob = band(e.sandMobility, 0.04, 0.78, 0.18);
   return shore * elev * dry * spray * mob * (1 - 0.92 * e.rosemaryInhibition);
  }
 },
 {
  id: 'prickly-pear',
  name: 'Coastal prickly pear',
  scientificName: 'Opuntia humifusa',
  guild: 'scrub',
  heightRange: [0.24, 0.48],
  spreadRadius: 1.15,
  ramets: [1, 2],
  minClearance: 0.72,
  allelopathic: false,
  conform: 0.85,
  maxRenderDist: 185,
  windSculpt: 0.04,
  canopyTint: [0.16, 0.30, 0.14],
  grow: growPricklyPear,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 26) / 5.0);
   const elev = band(e.elevation, 0.95, 6.2, 0.40);
   const xeric = 1 - smooth((e.moisture - 0.28) / 0.18);
   const spray = 1 - smooth((e.saltSpray - 0.76) / 0.25);
   const stable = 1 - smooth((e.sandMobility - 0.48) / 0.25);
   return shore * elev * xeric * spray * stable * (1 - 0.72 * e.rosemaryInhibition);
  }
 },
 {
  id: 'needlerush',
  name: 'Black needlerush',
  scientificName: 'Juncus roemerianus',
  guild: 'wetland',
  heightRange: [0.78, 1.45],
  spreadRadius: 1.65,
  ramets: [2, 5],
  minClearance: 0.65,
  allelopathic: false,
  conform: 0.0,
  maxRenderDist: 320,
  windSculpt: 0.06,
  canopyTint: [0.14, 0.18, 0.09],
  grow: growNeedlerush,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 28) / 5.0);
   const elev = band(e.elevation, -0.36, 0.42, 0.22);
   const moist = smooth((e.moisture - 0.54) / 0.24);
   const brackish = 0.45 + 0.55 * smooth((e.salinity - 0.12) / 0.24);
   const spray = 1 - smooth((e.saltSpray - 0.70) / 0.28);
   const burial = 1 - smooth((e.sandMobility - 0.26) / 0.20);
   return shore * elev * moist * brackish * spray * burial * (1 - 0.85 * e.rosemaryInhibition);
  }
 },
 {
  id: 'saw-palmetto',
  name: 'Saw palmetto',
  scientificName: 'Serenoa repens',
  guild: 'scrub',
  heightRange: [0.75, 1.45],
  spreadRadius: 1.75,
  ramets: [1, 3],
  minClearance: 1.10,
  allelopathic: false,
  conform: 0.0,
  maxRenderDist: 350,
  windSculpt: 0.08,
  canopyTint: [0.14, 0.26, 0.14],
  grow: growSawPalmetto,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 48) / 8.0);
   const elev = band(e.elevation, 0.42, 5.4, 0.35);
   const moist = band(e.moisture, 0.08, 0.72, 0.20);
   const spray = 1 - smooth((e.saltSpray - 0.56) / 0.24);
   const stable = 1 - smooth((e.sandMobility - 0.36) / 0.22);
   const salt = 1 - smooth((e.salinity - 0.40) / 0.22);
   return shore * elev * moist * spray * stable * salt * (1 - 0.48 * e.rosemaryInhibition);
  }
 },
 {
  id: 'rosemary',
  name: 'Florida rosemary',
  scientificName: 'Ceratiola ericoides',
  guild: 'scrub',
  heightRange: [0.85, 1.65],
  spreadRadius: 1.40,
  ramets: [1, 2],
  minClearance: 1.15,
  allelopathic: true,
  conform: 0.0,
  maxRenderDist: 350,
  windSculpt: 0.10,
  canopyTint: [0.18, 0.23, 0.14],
  grow: growRosemary,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 58) / 8.0);
   const high = smooth((e.elevation - 1.35) / 0.65);
   const xeric = 1 - smooth((e.moisture - 0.26) / 0.16);
   const spray = 1 - smooth((e.saltSpray - 0.46) / 0.22);
   const stable = 1 - smooth((e.sandMobility - 0.34) / 0.20);
   const salt = 1 - smooth((e.salinity - 0.28) / 0.18);
   return shore * high * xeric * spray * stable * salt;
  }
 },
 {
  id: 'sand-live-oak',
  name: 'Sand live oak',
  scientificName: 'Quercus geminata',
  guild: 'scrub',
  heightRange: [3.2, 5.8],
  spreadRadius: 2.8,
  ramets: [1, 2],
  minClearance: 2.4,
  allelopathic: false,
  conform: 0.0,
  maxRenderDist: 375,
  windSculpt: 0.18,
  canopyTint: [0.12, 0.19, 0.10],
  grow: growSandLiveOak,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 64) / 10.0);
   const elev = smooth((e.elevation - 0.90) / 0.55);
   const moist = band(e.moisture, 0.06, 0.56, 0.20);
   const spray = 1 - smooth((e.saltSpray - 0.42) / 0.20);
   const shelter = 1 - smooth((e.windExposure - 1.08) / 0.35);
   const stable = 1 - smooth((e.sandMobility - 0.24) / 0.16);
   const salt = 1 - smooth((e.salinity - 0.26) / 0.18);
   return shore * elev * moist * spray * shelter * stable * salt * (1 - 0.45 * e.rosemaryInhibition);
  }
 },
 {
  id: 'slash-pine',
  name: 'Coastal slash pine',
  scientificName: 'Pinus elliottii',
  guild: 'woodland',
  heightRange: [8.0, 12.5],
  spreadRadius: 3.6,
  ramets: [1, 2],
  minClearance: 3.2,
  allelopathic: false,
  conform: 0.0,
  maxRenderDist: 385,
  windSculpt: 0.06,
  canopyTint: [0.10, 0.18, 0.10],
  grow: growSlashPine,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 60) / 12.0);
   const elev = band(e.elevation, 0.48, 7.5, 0.35);
   const moist = band(e.moisture, 0.08, 0.72, 0.22);
   const spray = 1 - smooth((e.saltSpray - 0.36) / 0.20);
   const stable = 1 - smooth((e.sandMobility - 0.22) / 0.16);
   const salt = 1 - smooth((e.salinity - 0.24) / 0.16);
   return shore * elev * moist * spray * stable * salt * (1 - 0.55 * e.rosemaryInhibition);
  }
 },
 {
  id: 'sand-pine',
  name: 'Coastal sand pine',
  scientificName: 'Pinus clausa',
  guild: 'scrub',
  heightRange: [5.5, 9.2],
  spreadRadius: 2.9,
  ramets: [1, 2],
  minClearance: 2.6,
  allelopathic: false,
  conform: 0.0,
  maxRenderDist: 380,
  windSculpt: 0.12,
  canopyTint: [0.12, 0.20, 0.11],
  grow: growSandPine,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 72) / 12.0);
   const high = smooth((e.elevation - 1.35) / 0.65);
   const xeric = 1 - smooth((e.moisture - 0.32) / 0.18);
   const spray = 1 - smooth((e.saltSpray - 0.42) / 0.20);
   const stable = 1 - smooth((e.sandMobility - 0.30) / 0.18);
   const salt = 1 - smooth((e.salinity - 0.24) / 0.16);
   return shore * high * xeric * spray * stable * salt * (1 - 0.35 * e.rosemaryInhibition);
  }
 },
 {
  id: 'wax-myrtle',
  name: 'Southern wax myrtle',
  scientificName: 'Morella cerifera',
  guild: 'wetland',
  heightRange: [2.2, 4.0],
  spreadRadius: 2.0,
  ramets: [1, 3],
  minClearance: 1.55,
  allelopathic: false,
  conform: 0.0,
  maxRenderDist: 360,
  windSculpt: 0.12,
  canopyTint: [0.18, 0.25, 0.12],
  grow: growWaxMyrtle,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 38) / 8.0);
   const elev = band(e.elevation, -0.06, 1.85, 0.28);
   const moist = smooth((e.moisture - 0.34) / 0.22);
   const spray = 1 - smooth((e.saltSpray - 0.56) / 0.24);
   const salt = 1 - smooth((e.salinity - 0.42) / 0.24);
   const burial = 1 - smooth((e.sandMobility - 0.28) / 0.18);
   return shore * elev * moist * spray * salt * burial * (1 - 0.65 * e.rosemaryInhibition);
  }
 },
 {
  id: 'sea-rocket',
  name: 'Sea rocket',
  scientificName: 'Cakile constricta',
  guild: 'pioneer',
  heightRange: [0.28, 0.52],
  spreadRadius: 1.05,
  ramets: [1, 3],
  minClearance: 0.52,
  allelopathic: false,
  conform: 0.45,
  maxRenderDist: 195,
  windSculpt: 0.06,
  canopyTint: [0.24, 0.38, 0.20],
  grow: growSeaRocket,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 12.5) / 2.2);
   const elev = band(e.elevation, 0.42, 2.8, 0.25);
   const dry = 1 - smooth((e.moisture - 0.48) / 0.22);
   const spray = smooth((e.saltSpray - 0.26) / 0.26);
   const mob = 0.35 + 0.65 * smooth((e.sandMobility - 0.08) / 0.28);
   return shore * elev * dry * spray * mob * (1 - 0.90 * e.rosemaryInhibition);
  }
 },
 {
  id: 'gulf-bluestem',
  name: 'Gulf bluestem',
  scientificName: 'Schizachyrium maritimum',
  guild: 'foredune',
  heightRange: [0.48, 0.88],
  spreadRadius: 1.30,
  ramets: [2, 4],
  minClearance: 0.55,
  allelopathic: false,
  conform: 0.0,
  maxRenderDist: 280,
  windSculpt: 0.12,
  canopyTint: [0.32, 0.34, 0.22],
  grow: growGulfBluestem,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 16.0) / 3.5);
   const elev = band(e.elevation, 0.65, 5.2, 0.32);
   const dry = 1 - smooth((e.moisture - 0.42) / 0.20);
   const spray = band(e.saltSpray, 0.14, 1.15, 0.20);
   const mob = 0.30 + 0.70 * smooth((e.sandMobility - 0.06) / 0.32);
   return shore * elev * dry * spray * mob * (1 - 0.88 * e.rosemaryInhibition);
  }
 },
 {
  id: 'dune-sunflower',
  name: 'Beach dune sunflower',
  scientificName: 'Helianthus debilis',
  guild: 'foredune',
  heightRange: [0.30, 0.58],
  spreadRadius: 1.35,
  ramets: [1, 3],
  minClearance: 0.65,
  allelopathic: false,
  conform: 0.40,
  maxRenderDist: 205,
  windSculpt: 0.08,
  canopyTint: [0.28, 0.36, 0.16],
  grow: growDuneSunflower,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 18.0) / 3.5);
   const elev = band(e.elevation, 0.68, 4.8, 0.34);
   const moist = band(e.moisture, 0.04, 0.48, 0.18);
   const spray = band(e.saltSpray, 0.10, 0.92, 0.20);
   const mob = 0.25 + 0.75 * band(e.sandMobility, 0.02, 0.65, 0.18);
   return shore * elev * moist * spray * mob * (1 - 0.88 * e.rosemaryInhibition);
  }
 },
 {
  id: 'sea-purslane',
  name: 'Sea purslane',
  scientificName: 'Sesuvium portulacastrum',
  guild: 'pioneer',
  heightRange: [0.10, 0.24],
  spreadRadius: 1.45,
  ramets: [1, 2],
  minClearance: 0.75,
  allelopathic: false,
  conform: 0.90,
  maxRenderDist: 175,
  windSculpt: 0.0,
  canopyTint: [0.24, 0.32, 0.18],
  grow: growSeaPurslane,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 12.5) / 2.2);
   const elev = band(e.elevation, 0.04, 1.45, 0.22);
   const moist = smooth((e.moisture - 0.12) / 0.24);
   const salTol = 0.35 + 0.65 * smooth((e.salinity - 0.08) / 0.26);
   const flat = 1 - smooth((e.slope - 0.34) / 0.16);
   return shore * elev * moist * salTol * flat * (1 - 0.90 * e.rosemaryInhibition);
  }
 },
 {
  id: 'smooth-cordgrass',
  name: 'Smooth cordgrass',
  scientificName: 'Spartina alterniflora',
  guild: 'wetland',
  heightRange: [0.85, 1.55],
  spreadRadius: 1.60,
  ramets: [2, 5],
  minClearance: 0.62,
  allelopathic: false,
  conform: 0.0,
  maxRenderDist: 330,
  windSculpt: 0.08,
  canopyTint: [0.24, 0.34, 0.14],
  grow: growSmoothCordgrass,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 30.0) / 5.0);
   const elev = band(e.elevation, -0.34, 0.46, 0.22);
   const moist = smooth((e.moisture - 0.52) / 0.22);
   const brackish = 0.35 + 0.65 * smooth((e.salinity - 0.08) / 0.24);
   const burial = 1 - smooth((e.sandMobility - 0.26) / 0.20);
   return shore * elev * moist * brackish * burial * (1 - 0.85 * e.rosemaryInhibition);
  }
 },
 {
  id: 'cabbage-palm',
  name: 'Coastal cabbage palm',
  scientificName: 'Sabal palmetto',
  guild: 'woodland',
  heightRange: [5.4, 8.6],
  spreadRadius: 2.80,
  ramets: [1, 2],
  minClearance: 2.50,
  allelopathic: false,
  conform: 0.0,
  maxRenderDist: 380,
  windSculpt: 0.10,
  canopyTint: [0.14, 0.26, 0.14],
  grow: growCabbagePalm,
  suitability(e) {
   const shore = smooth((e.shoreDistance - 56.0) / 10.0);
   const elev = band(e.elevation, 0.45, 5.2, 0.32);
   const moist = band(e.moisture, 0.14, 0.78, 0.20);
   const spray = 1 - smooth((e.saltSpray - 0.44) / 0.20);
   const stable = 1 - smooth((e.sandMobility - 0.26) / 0.16);
   const salt = 1 - smooth((e.salinity - 0.30) / 0.18);
   return shore * elev * moist * spray * stable * salt * (1 - 0.60 * e.rosemaryInhibition);
  }
 }
];

export const SPECIES_BY_ID = new Map(COASTAL_SPECIES.map(s => [s.id, s]));

export function growCoastalSpecies(speciesId, seed, overrides = {}) {
 const spec = SPECIES_BY_ID.get(speciesId);
 if (!spec) throw Error('Unknown coastal species: ' + speciesId);
 const asset = spec.grow('example-' + spec.id, overrides.name ?? spec.name, seed);
 asset.speciesId = spec.id;
 return asset;
}

export function speciesSuitability(spec, env) {
 return clamp(spec.suitability(env), 0, 1);
}

// Phenotypic plasticity emerging from local physical stressors:
// - Salt spray + wind exposure cause aerodynamic stunting and leeward anemomorphosis
// - Favorable water + low salt boost vigour
export function phenotypicPlasticity(spec, env, rng) {
 const suit = speciesSuitability(spec, env);
 const windStress = clamp((env.windExposure - 0.75) * 0.45 + env.saltSpray * 0.28, 0, 1);
 const sizeScale = clamp((0.68 + 0.42 * suit + 0.16 * centered(rng)) * (1 - 0.24 * spec.windSculpt * windStress * 3), 0.52, 1.32);
 const bend = spec.windSculpt * clamp(env.windExposure, 0.2, 1.6) * (0.65 + 0.35 * rng());
 const leanX = (env.windDirX ?? 0.422618) * bend;
 const leanZ = (env.windDirZ ?? 0.906308) * bend;
 const vitality = clamp(0.76 + 0.36 * suit - 0.18 * windStress * (spec.guild === 'scrub' ? 1.2 : 0.4), 0.65, 1.15);
 return {sizeScale, leanX, leanZ, vitality};
}
