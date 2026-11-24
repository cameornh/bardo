import * as T from 'three';
import {INLAND_DIR_X, INLAND_DIR_Z, ALONG_DIR_X, ALONG_DIR_Z} from './coastal-climate.js';
import {wrackCenter, bedPatch} from './coastal-props.js';
import {waveHeight, reflectedSurfaceClip} from './wave-surface.js';
import {groundSupportHeight, createCrabRig, createBipedRig, createRayRig, createFishSpine, solveFishSpine, solveLizardSpine, computePlacedMarkSwings} from './coastal-kinematics.js';
import {StimulusField, initAgentDrives, updateAgentAI} from './coastal-ai.js';

export const FAUNA_SECTOR_M = 48;
export const ACTIVE_SECTOR_RADIUS = 2;
export const MAX_FAUNA_ELLIPSOIDS = 16384;
export const MAX_SOFT_FAUNA_ELLIPSOIDS = 2048;

export function resolveEffectiveLand(land, physics) {
 const st = physics?.sandTerrain;
 if (!land || !st) return land;
 if (land._sandTerrainRef === st) return land;
 const base = land._baseLandForSand ?? land;
 const proxy = Object.create(base);
 proxy._baseLandForSand = base;
 proxy._sandTerrainRef = st;
 proxy.height = (x, z) => base.height(x, z) + st.offset(x, z);
 return proxy;
}

export const FAUNA_SPECIES = Object.freeze([
 {id: 'mole-crab', guild: 'moleCrabs', commonName: 'Atlantic Mole Crab', scientific: 'Emerita talpoida', group: 'Sand Flea / Anomura', perSector: 18, baseCount: 90, scaleRangeCm: [1.1, 3.2], medium: 'swash'},
 {id: 'beach-hopper', guild: 'beachHoppers', commonName: 'Atlantic Beach Hopper', scientific: 'Americorchestia megalophthalma', group: 'Sand Flea / Amphipod', perSector: 18, baseCount: 90, scaleRangeCm: [1.3, 2.2], medium: 'wrack'},
 {id: 'ghost-crab', guild: 'ghostCrabs', commonName: 'Atlantic Ghost Crab', scientific: 'Ocypode quadrata', group: 'Terrestrial Crab', perSector: 6, baseCount: 30, scaleRangeCm: [3.2, 5.0], medium: 'beach'},
 {id: 'fiddler-crab', guild: 'fiddlerCrabs', commonName: 'Sand Fiddler Crab', scientific: 'Leptuca pugilator', group: 'Intertidal Swale Crab', perSector: 16, baseCount: 80, scaleRangeCm: [1.6, 2.6], medium: 'swale'},
 {id: 'blue-crab', guild: 'swimmingCrabs', commonName: 'Atlantic Blue Crab', scientific: 'Callinectes sapidus', group: 'Swimming Crab', perSector: 3, baseCount: 15, scaleRangeCm: [9.5, 14.5], medium: 'submerged'},
 {id: 'speckled-crab', guild: 'swimmingCrabs', commonName: 'Speckled Swimming Crab', scientific: 'Arenaeus cribrarius', group: 'Surf Swimming Crab', perSector: 2, baseCount: 10, scaleRangeCm: [7.5, 11.5], medium: 'submerged'},
 {id: 'bay-scallop', guild: 'benthicMollusks', commonName: 'Bay Scallop', scientific: 'Argopecten irradians', group: 'Benthic Bivalve', perSector: 6, baseCount: 30, scaleRangeCm: [5.5, 8.2], medium: 'submerged'},
 {id: 'sand-gnat', guild: 'sandGnats', commonName: 'Saltmarsh Sand Gnat', scientific: 'Culicoides furens', group: 'Biting Midge / Gnat', perSector: 22, baseCount: 110, scaleRangeCm: [0.4, 0.7], medium: 'air'},
 {id: 'kelp-fly', guild: 'kelpFlies', commonName: 'Wrack Kelp Fly', scientific: 'Coelopa / Ephydridae', group: 'Wrack Shore Fly', perSector: 12, baseCount: 60, scaleRangeCm: [0.6, 1.0], medium: 'air'},
 {id: 'dragonlet', guild: 'dragonlets', commonName: 'Seaside Dragonlet', scientific: 'Erythrodiplax berenice', group: 'Aerial Insect Predator', perSector: 4, baseCount: 20, scaleRangeCm: [3.1, 3.8], medium: 'air'},
 {id: 'sanderling', guild: 'shorebirds', commonName: 'Sanderling', scientific: 'Calidris alba', group: 'Swash Shorebird', perSector: 2.2, baseCount: 11, scaleRangeCm: [18.0, 21.0], medium: 'beach'},
 {id: 'laughing-gull', guild: 'seabirds', commonName: 'Laughing Gull', scientific: 'Leucophaeus atricilla', group: 'Coastal Larid Gull', perSector: 2.0, baseCount: 10, scaleRangeCm: [37.0, 42.0], medium: 'beach'},
 {id: 'royal-tern', guild: 'seabirds', commonName: 'Royal Tern', scientific: 'Thalasseus maximus', group: 'Plunge-Diving Tern', perSector: 1.0, baseCount: 5, scaleRangeCm: [45.0, 51.0], medium: 'air'},
 {id: 'baitfish', guild: 'baitfish', commonName: 'Bay Anchovy & Silverside', scientific: 'Anchoa mitchilli', group: 'Schooling Baitfish', perSector: 24, baseCount: 120, scaleRangeCm: [4.8, 7.8], medium: 'submerged'},
 {id: 'pompano', guild: 'surfFish', commonName: 'Juvenile Florida Pompano', scientific: 'Trachinotus carolinus', group: 'Surf-Zone Predator', perSector: 4, baseCount: 20, scaleRangeCm: [10.5, 15.8], medium: 'submerged'},
 {id: 'pinfish', guild: 'reefSwaleFish', commonName: 'Gulf Pinfish', scientific: 'Lagodon rhomboides', group: 'Seagrass & Reef Bream', perSector: 9, baseCount: 45, scaleRangeCm: [8.0, 12.6], medium: 'submerged'},
 {id: 'killifish', guild: 'reefSwaleFish', commonName: 'Sheepshead Minnow', scientific: 'Cyprinodon variegatus', group: 'Swale Pond Minnow', perSector: 10, baseCount: 50, scaleRangeCm: [4.0, 6.4], medium: 'swale-water'},
 {id: 'atlantic-stingray', guild: 'rays', commonName: 'Atlantic Stingray', scientific: 'Hypanus sabinus', group: 'Rajiform Batoid', perSector: 0.8, baseCount: 4, scaleRangeCm: [26.0, 38.0], medium: 'submerged'},
 {id: 'bonnethead-shark', guild: 'coastalSharks', commonName: 'Juvenile Bonnethead Shark', scientific: 'Sphyrna tiburo', group: 'Coastal Hammerhead', perSector: 0.4, baseCount: 2, scaleRangeCm: [48.0, 68.0], medium: 'submerged'},
 {id: 'coquina-clam', guild: 'benthicMollusks', commonName: 'Variable Coquina Clam', scientific: 'Donax variabilis', group: 'Swash Bivalve', perSector: 14, baseCount: 70, scaleRangeCm: [1.2, 2.2], medium: 'swash'},
 {id: 'hermit-crab', guild: 'hermitCrabs', commonName: 'Thin-Striped Hermit Crab', scientific: 'Clibanarius vittatus', group: 'Shell-Carrying Crab', perSector: 7, baseCount: 35, scaleRangeCm: [2.0, 3.6], medium: 'beach'},
 {id: 'tiger-beetle', guild: 'dunePredators', commonName: 'Eastern Beach Tiger Beetle', scientific: 'Habroscelimorpha dorsalis', group: 'Cursorial Beach Beetle', perSector: 5, baseCount: 25, scaleRangeCm: [1.2, 1.6], medium: 'beach'},
 {id: 'racerunner', guild: 'dunePredators', commonName: 'Six-Lined Racerunner', scientific: 'Aspidoscelis sexlineata', group: 'Foredune Whiptail Lizard', perSector: 2, baseCount: 10, scaleRangeCm: [14.0, 20.0], medium: 'beach'},
 {id: 'grass-shrimp', guild: 'seagrassShrimp', commonName: 'Daggerblade Grass Shrimp', scientific: 'Palaemonetes pugio', group: 'Seagrass Caridean Shrimp', perSector: 14, baseCount: 70, scaleRangeCm: [2.2, 3.8], medium: 'submerged'},
 {id: 'marsh-periwinkle', guild: 'benthicMollusks', commonName: 'Saltmarsh Periwinkle', scientific: 'Littoraria irrorata', group: 'Intertidal Marsh Snail', perSector: 8, baseCount: 40, scaleRangeCm: [1.5, 2.4], medium: 'swale'},
]);

function makeRng(seed) {
 let s = (seed >>> 0) || 1;
 return () => {
  s = (s + 0x6D2B79F5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
 };
}

function clamp(v, lo, hi) {
 return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
 return a + (b - a) * t;
}

function mixRGB(a, b, t) {
 return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function rotate2(vx, vz, cosA, sinA) {
 return [vx * cosA - vz * sinA, vx * sinA + vz * cosA];
}

export function worldAtShore(land, dTarget, alongTarget) {
 let x = dTarget * INLAND_DIR_X + alongTarget * ALONG_DIR_X;
 let z = dTarget * INLAND_DIR_Z + alongTarget * ALONG_DIR_Z;
 for (let k = 0; k < 3; k++) {
  const err = dTarget - land.shoreDistance(x, z);
  x += err * INLAND_DIR_X;
  z += err * INLAND_DIR_Z;
 }
 return [x, z];
}

function alongFromWorld(x, z) {
 return x * ALONG_DIR_X + z * ALONG_DIR_Z;
}

function alongWorld(land, x, z) {
 return (x + (land?.x || 0)) * ALONG_DIR_X + (z + (land?.z || 0)) * ALONG_DIR_Z;
}

function wrackDAt(land, alongLocal, seaLevel) {
 const alongW = alongLocal + ((land?.x || 0) * ALONG_DIR_X + (land?.z || 0) * ALONG_DIR_Z);
 return wrackCenter(alongW, seaLevel);
}

function sectorHash(simSeed, landSeed, sIdx, salt) {
 let h = (Math.imul(simSeed | 0, 1597334677) ^ Math.imul(landSeed | 0, 3812015801) ^ Math.imul(sIdx | 0, 2246822519) ^ (salt | 0)) >>> 0;
 h = Math.imul(h ^ (h >>> 15), 2246822519);
 h = Math.imul(h ^ (h >>> 13), 3266489917);
 return (h ^ (h >>> 16)) >>> 0;
}

function stratifiedCount(sectorIdx, rate, phaseOffset = 0) {
 const s0 = sectorIdx + 2 + phaseOffset;
 return Math.max(0, Math.floor((s0 + 1) * rate + 1e-6) - Math.floor(s0 * rate + 1e-6));
}

function findSectorSwaleBasins(land, aStart, aEnd) {
 const seaLevel = land.climate?.seaLevelOffset ?? 0;
 const flooded = [];
 const fallback = [];
 for (let d = 38; d <= 74; d += 3.5) {
  for (let a = aStart + 2; a <= aEnd - 2; a += 4.0) {
   const [x, z] = worldAtShore(land, d, a);
   const h = land.height(x, z);
   const env = land.environment ? land.environment(x, z, h) : {moisture: 0.7};
   const rec = {d, a, x, z, h, moisture: env.moisture ?? 0.65};
   if (h < seaLevel - 0.11) flooded.push(rec);
   else fallback.push(rec);
  }
 }
 const samples = flooded.length ? flooded : fallback;
 samples.sort((p, q) => p.h - q.h);
 const chosen = [];
 for (const c of samples) {
  if (chosen.every(o => Math.hypot(o.x - c.x, o.z - c.z) > 6.0)) {
   chosen.push(c);
   if (chosen.length >= 4) break;
  }
 }
 if (!chosen.length) {
  const [x, z] = worldAtShore(land, 50, (aStart + aEnd) * 0.5);
  chosen.push({d: 50, a: (aStart + aEnd) * 0.5, x, z, h: land.height(x, z), moisture: 0.85});
 }
 return chosen;
}

function findSectorSeagrass(land, aStart, aEnd, dMin, dMax, seaLevel) {
 const ox = land.x || 0, oz = land.z || 0;
 const hits = [];
 const fallback = [];
 for (let d = dMin; d <= dMax; d += 2.2) {
  for (let a = aStart + 2; a <= aEnd - 2; a += 3.2) {
   const [x, z] = worldAtShore(land, d, a);
   const bed = land.height(x, z);
   if (seaLevel - bed < 0.22) continue;
   const patch = bedPatch(x + ox, z + oz);
   const rec = {x, z, d, a, bed, patch};
   if (patch >= 0.36) hits.push(rec);
   else fallback.push(rec);
  }
 }
 return hits.length ? hits : fallback;
}

function findSectorBermRoost(land, aMid, dMin, dMax, seaLevel) {
 let best = null;
 let bestScore = 1e9;
 for (let d = dMin; d <= dMax; d += 1.8) {
  const [x, z] = worldAtShore(land, d, aMid);
  const h = land.height(x, z);
  const sl = terrainSlope(land, x, z);
  if (h < seaLevel + 0.14) continue;
  const sc = Math.hypot(sl.hx, sl.hz) + Math.abs(d - (dMin + dMax) * 0.5) * 0.05;
  if (sc < bestScore) { bestScore = sc; best = {x, z, h}; }
 }
 if (!best) {
  const [x, z] = worldAtShore(land, (dMin + dMax) * 0.5, aMid);
  best = {x, z, h: land.height(x, z)};
 }
 return best;
}

function findSwaleBasins(land) {
 return findSectorSwaleBasins(land, -FAUNA_SECTOR_M, FAUNA_SECTOR_M);
}

function waterHeightAt(sea, land, x, z) {
 if (sea && typeof sea.height === 'function') return sea.height(x, z);
 return land?.climate?.seaLevelOffset ?? 0;
}

function terrainSlope(land, x, z) {
 const e = 0.25;
 const h0 = land.height(x, z);
 const hx = (land.height(x + e, z) - h0) / e;
 const hz = (land.height(x, z + e) - h0) / e;
 return {h: h0, hx, hz};
}

export class CoastalFaunaSim {
 constructor(seed = 2187) {
  this.seed = seed;
  this.agents = [];
  this.time = 0;
  this.nextId = 1;
  this.loadedSectors = new Set();
  this.sectorRecords = new Map();
  this.baitPodsMap = new Map();
  this.swaleBasins = [];
  this.gnatClouds = [];
  this.baitPods = [];
  this.land = null;
  this.placedLinks = [];
  this.carcasses = [];
  this._recruitClock = 0;
  this.stimuli = new StimulusField();
  this._lastStreamKey = '';
  this.materialByGuild = {
   moleCrabs: 'crab-chitin',
   beachHoppers: 'crab-chitin',
   ghostCrabs: 'crab-chitin',
   fiddlerCrabs: 'crab-chitin',
   swimmingCrabs: 'crab-chitin',
   hermitCrabs: 'crab-chitin',
   seagrassShrimp: 'fish-scale',
   dunePredators: 'insect-chitin',
   benthicMollusks: 'scallop-shell',
   sandGnats: 'insect-chitin',
   kelpFlies: 'insect-chitin',
   dragonlets: 'insect-chitin',
   shorebirds: 'bird-plumage',
   seabirds: 'bird-plumage',
   baitfish: 'fish-scale',
   surfFish: 'fish-scale',
   reefSwaleFish: 'fish-scale',
   rays: 'stingray-skin',
   coastalSharks: 'shark-skin',
  };
 }

 _initAgentRig(agent, land) {
  const sp = agent.speciesId;
  if (sp === 'ghost-crab' || sp === 'fiddler-crab' || sp === 'blue-crab' || sp === 'speckled-crab' || sp === 'hermit-crab') {
   createCrabRig(agent, land);
  } else if (sp === 'baitfish' || sp === 'pompano' || sp === 'pinfish' || sp === 'killifish' || sp === 'bonnethead-shark') {
   agent.fishSpine = createFishSpine();
   solveFishSpine(agent, 0, sp === 'bonnethead-shark' ? 0.72 : 0.35, 0, 0, 1, 0);
  } else if (sp === 'racerunner') {
   solveLizardSpine(agent, 0, 0.2, 0, land);
  } else if (sp === 'sanderling' || sp === 'laughing-gull' || sp === 'royal-tern') {
   createBipedRig(agent, land);
  } else if (sp === 'atlantic-stingray') {
   agent.rayRig = createRayRig();
  }
 }

 emitStimulus(x, y, z, kind = 'vibration', intensity = 1, radius = 4.5, vx = 0, vy = 0, vz = 0, ttl = 0.9, sourceId = null) {
  return this.stimuli.emit(x, y, z, kind, intensity, radius, vx, vy, vz, ttl, sourceId);
 }

 get activeAgentCount() {
  let n = 0;
  for (const a of this.agents) if (a.emerged && a.visibility > 0.15) n++;
  return n + this.placedLinks.length;
 }

 syncPlaced(library, land = this.land) {
  const prev = new Map(this.placedLinks.map(l => [l.id, l]));
  this.placedLinks.length = 0;
  if (!library?.world?.instances?.length) return;
  const assetMap = new Map(library.assets.map(a => [a.id, a]));
  for (const inst of library.world.instances) {
   const asset = assetMap.get(inst.assetId);
   if (!asset?.fauna) continue;
   const [x, y, z] = inst.transform.position;
   const sc = (inst.transform.scale?.[0] || asset.fauna.defaultScale || 0.24) * (asset.fauna.sculptScale || 1);
   const sp = asset.fauna.speciesId;
   const isCrab = sp === 'ghost-crab' || sp === 'fiddler-crab' || sp === 'blue-crab' || sp === 'speckled-crab' || sp === 'hermit-crab';
   const isFish = sp === 'baitfish' || sp === 'pompano' || sp === 'pinfish' || sp === 'killifish' || sp === 'bonnethead-shark';
   const isBird = sp === 'sanderling' || sp === 'laughing-gull' || sp === 'royal-tern';
   const isRay = sp === 'atlantic-stingray';
   const isScallop = sp === 'bay-scallop';
   const existing = prev.get(inst.id);
   if (existing && existing.speciesId === sp) {
    // Update anchor if user repositioned with gizmo/reset
    if (Math.hypot(x - existing.x, z - existing.z) > 0.65 || existing.gizmoDragged) {
     existing.x = x; existing.y = y; existing.z = z;
     existing.anchorX = x; existing.anchorZ = z; existing.baseY = y;
    }
    existing.yaw = existing.gizmoDragged ? ((inst.transform.rotation?.[1] ?? 0) * (Math.PI / 180)) : existing.yaw;
    existing.landed = !!land;
    this.placedLinks.push(existing);
    continue;
   }
   const baseWidth = sp === 'blue-crab' || sp === 'speckled-crab' ? 0.33 * sc
    : sp === 'hermit-crab' ? 0.11 * sc
    : isCrab ? 0.25 * sc
    : isRay ? 0.85 * sc
    : isScallop ? 0.28 * sc
    : isBird ? (sp === 'sanderling' ? 0.14 : 0.20) * sc
    : sp === 'bonnethead-shark' ? 0.26 * sc
    : sp === 'racerunner' ? 0.074 * sc
    : sp === 'tiger-beetle' ? 0.042 * sc
    : sp === 'coquina-clam' ? 0.042 * sc
    : sp === 'marsh-periwinkle' ? 0.049 * sc
    : sp === 'grass-shrimp' ? 0.036 * sc
    : 0.07 * sc;
   const baseLen = isFish ? (sp === 'bonnethead-shark' ? 0.62 : sp === 'pompano' ? 0.33 : sp === 'pinfish' ? 0.31 : sp === 'killifish' ? 0.28 : 0.34) * sc
    : sp === 'hermit-crab' ? 0.14 * sc
    : sp === 'racerunner' ? 0.56 * sc
    : sp === 'tiger-beetle' ? 0.095 * sc
    : sp === 'coquina-clam' ? 0.06 * sc
    : sp === 'marsh-periwinkle' ? 0.072 * sc
    : sp === 'grass-shrimp' ? 0.14 * sc
    : (sp === 'blue-crab' || sp === 'speckled-crab' ? 0.19 * sc : isRay ? 0.82 * sc : isScallop ? 0.28 * sc : isBird ? 0.36 * sc : 0.21 * sc);
   const baseHt = sp === 'hermit-crab' ? 0.10 * sc
    : isCrab ? (sp === 'blue-crab' || sp === 'speckled-crab' ? 0.095 : 0.12) * sc
    : isRay ? 0.09 * sc
    : isScallop ? 0.10 * sc
    : sp === 'bonnethead-shark' ? 0.14 * sc
    : sp === 'racerunner' ? 0.056 * sc
    : sp === 'tiger-beetle' ? 0.036 * sc
    : sp === 'coquina-clam' ? 0.028 * sc
    : sp === 'marsh-periwinkle' ? 0.056 * sc
    : sp === 'grass-shrimp' ? 0.042 * sc
    : 0.14 * sc;
   const link = {
    id: inst.id,
    assetId: inst.assetId,
    speciesId: sp,
    guild: asset.fauna.guild,
    medium: asset.fauna.medium,
    hoverHeight: asset.fauna.hoverHeight ?? 0,
    isPlaced: true,
    x, y, z,
    baseY: y,
    anchorX: x,
    anchorZ: z,
    anchorId: inst.id,
    burrowX: x,
    burrowZ: z,
    homeX: x,
    homeZ: z,
    len: baseLen,
    width: baseWidth,
    height: baseHt,
    sex: sp === 'fiddler-crab' ? 'M' : 'F',
    clawRight: true,
    scale: sc,
    yaw: Math.PI * 0.5 - ((inst.transform.rotation?.[1] ?? 0) * (Math.PI / 180)),
    phase: (this.placedLinks.length + 1) * 1.618,
    stateTimer: 1.5,
    jumpCooldown: 1.5,
    waveTimer: 2.0,
    airY: 0,
    vx: 0, vy: 0, vz: 0,
    burrowDepth: 0,
    emerged: true,
    activity: 1,
    visibility: 1,
    gizmoDragged: false,
    landed: !!land,
   };
   initAgentDrives(link);
   link.lifeStage = 'adult';
   link.growth = 1.0;
   link.sizeScale = 1.0;
   this._initAgentRig(link, land);
   if (isBird) link.airborne = sp === 'royal-tern';
   this.placedLinks.push(link);
  }
 }

 spawn(land) {
  this.land = land;
  this.time = 0;
  this.nextId = 1;
  this.agents.length = 0;
  this.carcasses.length = 0;
  this._recruitClock = 0;
  this.loadedSectors.clear();
  this.sectorRecords.clear();
  this.baitPodsMap.clear();
  this.swaleBasins.length = 0;
  this.gnatClouds.length = 0;
  this.baitPods.length = 0;
  this.stimuli.clear();
  this._lastStreamKey = '';
  for (let s = -ACTIVE_SECTOR_RADIUS; s <= ACTIVE_SECTOR_RADIUS; s++) {
   this.spawnSector(s, land, 'gulf');
  }
 }

 ensureSectorsAround(x, z, land = this.land) {
  if (!land) return false;
  if (!this.loadedSectors.size) {
   this.spawn(land);
   return true;
  }
  const centerS = Math.floor(alongFromWorld(x, z) / FAUNA_SECTOR_M);
  const d = land.shoreDistance(x, z);
  const wantGulf = d < 175 ? 1 : 0;
  const wantBay = d > 140 ? 1 : 0;
  const streamKey = `${centerS}:${wantGulf}:${wantBay}:${land.seed || 7}`;
  if (this._lastStreamKey === streamKey) return false;
  this._lastStreamKey = streamKey;

  let changed = false;
  if (wantGulf) {
   for (let s = centerS - ACTIVE_SECTOR_RADIUS; s <= centerS + ACTIVE_SECTOR_RADIUS; s++) {
    if (this.spawnSector(s, land, 'gulf')) changed = true;
   }
  }
  if (wantBay) {
   for (let s = centerS - ACTIVE_SECTOR_RADIUS; s <= centerS + ACTIVE_SECTOR_RADIUS; s++) {
    if (this.spawnSector(s, land, 'bay')) changed = true;
   }
  }

  // Evict distant sectors cleanly while preserving all user-placed assets
  const keepEvictRad = ACTIVE_SECTOR_RADIUS + 1;
  let removedAny = false;
  for (const key of Array.from(this.loadedSectors)) {
   const rec = this.sectorRecords.get(key);
   if (!rec) continue;
   const outAlong = Math.abs(rec.sectorIdx - centerS) > keepEvictRad;
   const outBand = (rec.band === 'gulf' && !wantGulf && d > 195) || (rec.band === 'bay' && !wantBay && d < 120);
   if (outAlong || outBand) {
    this.loadedSectors.delete(key);
    this.sectorRecords.delete(key);
    for (const p of rec.baitPods || []) this.baitPodsMap.delete(p.key);
    removedAny = true;
   }
  }
  if (removedAny) {
   this.agents = this.agents.filter(a => this.loadedSectors.has(a.sectorKey));
   this._rebuildGlobalAux();
   changed = true;
  }
  return changed;
 }

 _rebuildGlobalAux() {
  this.swaleBasins.length = 0;
  this.gnatClouds.length = 0;
  this.baitPods.length = 0;
  for (const rec of this.sectorRecords.values()) {
   for (const b of rec.swales) this.swaleBasins.push(b);
   for (const c of rec.gnatClouds) this.gnatClouds.push(c);
   for (const p of rec.baitPods) this.baitPods.push(p);
  }
 }

 spawnSector(sectorIdx, land = this.land, band = 'gulf') {
  if (!land) return false;
  const secKey = `${band}:${sectorIdx}`;
  if (this.loadedSectors.has(secKey)) return false;
  this.loadedSectors.add(secKey);

  const seaLevel = land.climate?.seaLevelOffset ?? 0;
  const salt = band === 'bay' ? 911 : 101;
  const rng = makeRng(sectorHash(this.seed, land.seed || 7, sectorIdx, salt));
  const aStart = sectorIdx * FAUNA_SECTOR_M;
  const aEnd = aStart + FAUNA_SECTOR_M;
  const aMid = (aStart + aEnd) * 0.5;

  const spMetaMap = new Map(FAUNA_SPECIES.map(s => [s.id, s]));
  const rateFor = id => spMetaMap.get(id)?.perSector ?? 1;

  const pushAgent = spec => {
   const a = {
    id: this.nextId++,
    band,
    sectorIdx,
    sectorKey: secKey,
    emerged: true,
    visibility: 1,
    vy: 0,
    vx: 0,
    vz: 0,
    phase: rng() * Math.PI * 2,
    stateTimer: rng() * 6,
    state: spec.state || 'active',
    stateLabel: spec.stateLabel || 'foraging',
    airY: 0,
    burrowDepth: 0,
    yaw: rng() * Math.PI * 2,
    ...spec,
   };
   initAgentDrives(a, rng);
   const sp = a.speciesId;
   this._initAgentRig(a, land);
   if (sp === 'sanderling' || sp === 'laughing-gull' || sp === 'royal-tern') {
    const breeding = (land.climate?.dayOfYear ?? 155) >= 105 && (land.climate?.dayOfYear ?? 155) <= 225;
    if (a.cyber?.activeDrive === 'rest') {
     a.airborne = false;
     if (sp === 'laughing-gull') a.tucked = !!(breeding && a.hasNest);
     if (a.roostX !== undefined) {
      a.x = sp === 'laughing-gull' && breeding && a.hasNest && a.nestX !== undefined ? a.nestX : a.roostX;
      a.z = sp === 'laughing-gull' && breeding && a.hasNest && a.nestZ !== undefined ? a.nestZ : a.roostZ;
     }
     const supH = groundSupportHeight(land, a.x, a.z, sp === 'sanderling' ? 0.045 : 0.08);
     const legH = sp === 'sanderling' ? 0.046 : sp === 'laughing-gull' ? 0.088 : 0.068;
     a.bedY = supH;
     a.y = a.tucked ? supH + (a.height || 0.11) * 0.54 : supH + legH + (a.height || 0.09) * 0.48;
     a.state = a.tucked ? 'incubating' : (sp === 'laughing-gull' ? 'loafing' : 'roosting');
    } else if (sp === 'royal-tern') {
     a.airborne = true;
    }
   } else if (sp === 'atlantic-stingray') {
    if (a.cyber?.activeDrive === 'rest') {
     a.state = 'buried-resting';
     a.stateLabel = 'resting cryptically covered in sand beside seagrass';
     if (a.shelterX !== undefined) { a.x = a.shelterX; a.z = a.shelterZ; }
     const supBed = groundSupportHeight(land, a.x, a.z, Math.max(0.12, (a.width || 0.34) * 0.65));
     a.bedY = supBed;
     a.y = supBed + (a.height || 0.045) * 0.44 + 0.008;
    }
   } else if (sp === 'dragonlet' && a.cyber?.activeDrive === 'rest') {
    a.state = 'perched';
    a.stateLabel = 'perched motionless scanning airspace';
   } else if (sp === 'kelp-fly' && a.cyber?.activeDrive === 'rest') {
    a.state = 'alighted';
    a.stateLabel = 'alighted motionless on wrack';
    a.y = (a.bedY ?? groundSupportHeight(land, a.x, a.z, 0.03)) + 0.012;
   } else if (sp === 'ghost-crab' && a.cyber?.activeDrive === 'rest') {
    a.state = 'burrow-watching';
    a.stateLabel = 'resting sentinel beside burrow';
   } else if ((sp === 'blue-crab' || sp === 'speckled-crab') && a.cyber?.activeDrive === 'rest') {
    a.state = 'hiding';
    a.stateLabel = sp === 'blue-crab' ? 'ambush-hiding in seagrass' : 'hiding cryptically in surf sand';
   }
   this.agents.push(a);
   return a;
  };

  if (band === 'bay') {
   // Sheltered back-barrier St. Andrew Bay estuary & marsh hammock fauna
   const baySea = findSectorSeagrass(land, aStart, aEnd, 226, 286, seaLevel);
   const hamBasins = [];
   for (let d = 232; d <= 284; d += 6) {
    for (let al = aStart + 4; al <= aEnd - 4; al += 8) {
     const [hx, hz] = worldAtShore(land, d, al);
     const hh = land.height(hx, hz);
     if (hh >= seaLevel + 0.02 && hh <= seaLevel + 0.65) hamBasins.push({x: hx, z: hz, h: hh, d, a: al});
    }
   }
   const refBay = baySea[0] || (() => { const [x, z] = worldAtShore(land, 252, aMid); return {x, z, d: 252, a: aMid, bed: land.height(x, z)}; })();
   const pod = {key: `${secKey}:0`, id: 0, sectorKey: secKey, sectorIdx, band: 'bay', centerD: refBay.d, centerAlong: aMid, minD: 230, maxD: 280, aStart, aEnd, driftSign: 1};
   this.baitPodsMap.set(pod.key, pod);

   const rec = {band: 'bay', sectorIdx, swales: [refBay], gnatClouds: [], baitPods: [pod], seagrass: baySea};
   for (let c = 0; c < 2; c++) {
    const pt = hamBasins[c % Math.max(1, hamBasins.length)] || refBay;
    rec.gnatClouds.push({x: pt.x + lerp(-1.5, 1.5, rng()), z: pt.z + lerp(-1.5, 1.5, rng()), h: Math.max(pt.h ?? pt.bed ?? seaLevel, seaLevel), phase: rng() * Math.PI * 2});
   }
   this.sectorRecords.set(secKey, rec);
   this._rebuildGlobalAux();

   const addSub = (n, fn) => { for (let i = 0; i < n; i++) fn(i, n); };
   addSub(Math.round(rateFor('baitfish') * 0.55), (i, n) => {
    const pt = baySea[i % Math.max(1, baySea.length)] || refBay;
    const x = pt.x + lerp(-2.2, 2.2, rng()), z = pt.z + lerp(-2.2, 2.2, rng());
    const bed = land.height(x, z), w = Math.max(bed + 0.24, seaLevel);
    const len = lerp(0.050, 0.076, rng());
    pushAgent({speciesId: 'baitfish', guild: 'baitfish', commonName: 'Bay Anchovy & Silverside', scientific: 'Anchoa mitchilli', rank: (i + 0.3) / n, podId: 0, podObj: pod, len, width: len * 0.17, height: len * 0.24, color: [0.05, 0.12, 0.08], accent: [0.68, 0.74, 0.78], x, y: clamp(lerp(bed + 0.09, w - 0.12, rng()), bed + 0.07, w - 0.10), z, bedY: bed, homeX: pt.x, homeZ: pt.z, state: 'schooling', stateLabel: 'schooling over bay grass flats'});
   });
   addSub(Math.round(rateFor('bay-scallop') * 1.1), (i, n) => {
    const pt = baySea[i % Math.max(1, baySea.length)] || refBay;
    const x = pt.x + lerp(-1.6, 1.6, rng()), z = pt.z + lerp(-1.6, 1.6, rng());
    const sup = groundSupportHeight(land, x, z, 0.05);
    const sz = lerp(0.056, 0.082, rng());
    pushAgent({speciesId: 'bay-scallop', guild: 'benthicMollusks', commonName: 'Bay Scallop', scientific: 'Argopecten irradians', rank: (i + 0.3) / n, len: sz, width: sz * 1.04, height: sz * 0.38, color: [0.18, 0.14, 0.10], accent: [0.74, 0.68, 0.56], x, y: sup + sz * 0.24, z, bedY: sup, homeX: pt.x, homeZ: pt.z, valveGape: 0.18, state: 'filter-feeding', stateLabel: 'filter-feeding on bay seagrass'});
   });
   addSub(Math.round(rateFor('grass-shrimp') * 0.8), (i, n) => {
    const pt = baySea[i % Math.max(1, baySea.length)] || refBay;
    const x = pt.x + lerp(-1.8, 1.8, rng()), z = pt.z + lerp(-1.8, 1.8, rng());
    const bed = groundSupportHeight(land, x, z, 0.03), w = Math.max(bed + 0.22, seaLevel);
    const len = lerp(0.022, 0.038, rng());
    pushAgent({speciesId: 'grass-shrimp', guild: 'seagrassShrimp', commonName: 'Daggerblade Grass Shrimp', scientific: 'Palaemonetes pugio', rank: (i + 0.25) / n, len, width: len * 0.24, height: len * 0.28, color: [0.48, 0.44, 0.30], accent: [0.72, 0.68, 0.50], x, y: clamp(bed + lerp(0.03, 0.12, rng()), bed + 0.015, w - 0.075), z, bedY: bed, homeX: pt.x, homeZ: pt.z, homeAlong: pt.a, state: 'grazing', stateLabel: 'grazing inside bay seagrass canopy'});
   });
   addSub(Math.round(rateFor('blue-crab')), (i, n) => {
    const pt = baySea[i % Math.max(1, baySea.length)] || refBay;
    const x = pt.x + lerp(-2.2, 2.2, rng()), z = pt.z + lerp(-2.2, 2.2, rng());
    const sup = groundSupportHeight(land, x, z, 0.10);
    const cw = lerp(0.10, 0.145, rng());
    pushAgent({speciesId: 'blue-crab', guild: 'swimmingCrabs', commonName: 'Atlantic Blue Crab', scientific: 'Callinectes sapidus', rank: (i + 0.2) / n, len: cw * 0.54, width: cw, height: cw * 0.28, color: [0.06, 0.12, 0.08], accent: [0.05, 0.24, 0.56], clawTip: [0.46, 0.08, 0.07], x, y: sup + 0.035, z, bedY: sup, homeX: pt.x, homeZ: pt.z, homeAlong: pt.a, homeD: pt.d, state: 'prowling', stateLabel: 'prowling bay grass'});
   });
   addSub(stratifiedCount(sectorIdx, rateFor('atlantic-stingray'), 0.4), (i, n) => {
    const pt = baySea[i % Math.max(1, baySea.length)] || refBay;
    const x = pt.x + lerp(-1.5, 1.5, rng()), z = pt.z + lerp(-1.5, 1.5, rng());
    const sup = groundSupportHeight(land, x, z, 0.22);
    const disc = lerp(0.26, 0.36, rng());
    pushAgent({speciesId: 'atlantic-stingray', guild: 'rays', commonName: 'Atlantic Stingray', scientific: 'Hypanus sabinus', rank: (i + 0.3) / Math.max(1, n), len: disc * 1.15, width: disc, height: disc * 0.13, color: [0.42, 0.34, 0.20], accent: [0.76, 0.72, 0.60], x, y: sup + disc * 0.07, z, bedY: sup, homeX: pt.x, homeZ: pt.z, shelterX: pt.x, shelterZ: pt.z, homeAlong: aMid, state: 'buried-resting', stateLabel: 'resting on bay sand pocket'});
   });
   if (hamBasins.length) {
    addSub(Math.round(rateFor('fiddler-crab') * 0.6), (i, n) => {
     const hb = hamBasins[i % hamBasins.length];
     const bx = hb.x + lerp(-1.2, 1.2, rng()), bz = hb.z + lerp(-1.2, 1.2, rng());
     const cw = lerp(0.017, 0.025, rng());
     const sup = groundSupportHeight(land, bx, bz, cw * 1.25);
     pushAgent({speciesId: 'fiddler-crab', guild: 'fiddlerCrabs', commonName: 'Sand Fiddler Crab', scientific: 'Leptuca pugilator', rank: (i + 0.3) / n, sex: rng() < 0.55 ? 'M' : 'F', clawRight: rng() < 0.5, len: cw * 0.80, width: cw, height: cw * 0.52, color: [0.14, 0.11, 0.09], accent: [0.58, 0.35, 0.18], x: bx, y: sup + cw * 0.48, z: bz, bedY: sup, burrowX: bx, burrowZ: bz, burrowY: land.height(bx, bz), burrowRadius: cw * 0.85, state: 'feeding', stateLabel: 'deposit-feeding marsh edge'});
    });
    addSub(Math.round(rateFor('hermit-crab') * 0.6), (i, n) => {
     const hb = hamBasins[i % hamBasins.length];
     const hx = hb.x + lerp(-1.0, 1.0, rng()), hz = hb.z + lerp(-1.0, 1.0, rng());
     const len = lerp(0.020, 0.036, rng());
     const sup = groundSupportHeight(land, hx, hz, len * 1.1);
     pushAgent({speciesId: 'hermit-crab', guild: 'hermitCrabs', commonName: 'Thin-Striped Hermit Crab', scientific: 'Clibanarius vittatus', rank: (i + 0.3) / n, len, width: len * 0.78, height: len * 0.72, color: [0.36, 0.30, 0.22], accent: [0.58, 0.50, 0.36], x: hx, y: sup + Math.max(0.008, len * 0.42), z: hz, bedY: sup, homeAlong: hb.a, homeD: hb.d, state: 'foraging', stateLabel: 'crawling bay marsh edge'});
    });
    addSub(Math.round(rateFor('marsh-periwinkle') * 0.7), (i, n) => {
     const hb = hamBasins[i % hamBasins.length];
     const px = hb.x + lerp(-1.1, 1.1, rng()), pz = hb.z + lerp(-1.1, 1.1, rng());
     const len = lerp(0.015, 0.024, rng());
     const sup = groundSupportHeight(land, px, pz, Math.max(0.03, len * 1.4));
     pushAgent({speciesId: 'marsh-periwinkle', guild: 'benthicMollusks', commonName: 'Saltmarsh Periwinkle', scientific: 'Littoraria irrorata', rank: (i + 0.3) / n, len, width: len * 0.68, height: len * 0.78, color: [0.52, 0.48, 0.42], accent: [0.70, 0.64, 0.56], x: px, y: sup + Math.max(0.007, len * 0.48), z: pz, bedY: sup, state: 'grazing', stateLabel: 'grazing bay cordgrass edge'});
    });
    addSub(stratifiedCount(sectorIdx, rateFor('laughing-gull') * 0.6, 0.2), (i, n) => {
     const hb = hamBasins[i % hamBasins.length];
     const sup = groundSupportHeight(land, hb.x, hb.z, 0.08);
     const len = lerp(0.32, 0.38, rng());
     pushAgent({speciesId: 'laughing-gull', guild: 'seabirds', commonName: 'Laughing Gull', scientific: 'Leucophaeus atricilla', rank: (i + 0.3) / Math.max(1, n), len, width: len * 0.32, height: len * 0.34, wingSpan: len * 2.75, color: [0.36, 0.40, 0.45], accent: [0.94, 0.94, 0.92], x: hb.x, y: sup + 3.0, z: hb.z, bedY: sup, homeAlong: hb.a, roostX: hb.x, roostZ: hb.z, airborne: true, state: 'soaring', stateLabel: 'soaring over coastal bay'});
    });
   }
   addSub(Math.round(rateFor('sand-gnat') * 0.55), (i, n) => {
    const cloud = rec.gnatClouds[i % rec.gnatClouds.length];
    const len = lerp(0.0046, 0.0074, rng());
    pushAgent({speciesId: 'sand-gnat', guild: 'sandGnats', commonName: 'Saltmarsh Sand Gnat', scientific: 'Culicoides furens', rank: (i + 0.3) / n, sex: rng() < 0.7 ? 'M' : 'F', len, width: len * 0.48, height: len * 0.48, wingSpan: len * 2.3, color: [0.025, 0.022, 0.018], accent: [0.62, 0.56, 0.42], x: cloud.x, y: cloud.h + 0.5, z: cloud.z, bedY: cloud.h, cloudX: cloud.x, cloudZ: cloud.z, orbitR: lerp(0.28, 1.05, rng()), orbitH: lerp(0.24, 0.88, rng()), orbitFreq: lerp(2.4, 4.8, rng()), state: 'zipping', stateLabel: 'zipping marsh swarm'});
   });
   return true;
  }

  // ---------------- GULF SHORELINE & NEARSHORE SECTOR ----------------
  const swales = findSectorSwaleBasins(land, aStart, aEnd);
  const seagrass = findSectorSeagrass(land, aStart, aEnd, -22, -7, seaLevel);
  const bermRoost = findSectorBermRoost(land, aMid, 4.5, 10.5, seaLevel);
  const nestRoost = findSectorBermRoost(land, aMid + lerp(-6, 6, rng()), 11.5, 19.5, seaLevel);
  const ternRoost = findSectorBermRoost(land, aMid + lerp(-8, 8, rng()), 2.2, 6.2, seaLevel);

  const gnatClouds = [];
  for (let c = 0; c < 3; c++) {
   const basin = swales[c % swales.length];
   const [fx, fz] = worldAtShore(land, 46, lerp(aStart + 4, aEnd - 4, (c + 0.5) / 3));
   const cx = c === 2 ? fx : basin.x + lerp(-2.2, 2.2, rng());
   const cz = c === 2 ? fz : basin.z + lerp(-2.2, 2.2, rng());
   gnatClouds.push({x: cx, z: cz, h: Math.max(land.height(cx, cz), seaLevel), phase: rng() * Math.PI * 2});
  }

  const baitPods = [0, 1].map(p => ({
   key: `${secKey}:${p}`,
   id: p,
   sectorKey: secKey,
   sectorIdx,
   band: 'gulf',
   centerD: p === 0 ? -10.5 : -15.5,
   centerAlong: lerp(aStart + 6, aEnd - 6, (p + 0.5) / 2),
   aStart,
   aEnd,
   driftSign: p % 2 ? -1 : 1,
  }));
  for (const pod of baitPods) this.baitPodsMap.set(pod.key, pod);

  this.sectorRecords.set(secKey, {band: 'gulf', sectorIdx, swales, gnatClouds, baitPods, seagrass});
  this._rebuildGlobalAux();

  const nOf = (id, phaseOff = 0) => stratifiedCount(sectorIdx, rateFor(id), phaseOff);

  // 1. Atlantic Mole Crabs (Emerita talpoida)
  const nMole = nOf('mole-crab', 0.1);
  for (let i = 0; i < nMole; i++) {
   const isFemale = rng() < 0.65;
   const len = isFemale ? lerp(0.022, 0.032, rng()) : lerp(0.011, 0.015, rng());
   const along = lerp(aStart + 1, aEnd - 1, (i + rng() * 0.85) / Math.max(1, nMole));
   const d = lerp(-1.4, 2.2, rng());
   const [x, z] = worldAtShore(land, d, along);
   const y = land.height(x, z);
   const warmTone = rng();
   pushAgent({
    speciesId: 'mole-crab', guild: 'moleCrabs', commonName: 'Atlantic Mole Crab', scientific: 'Emerita talpoida',
    rank: (i + 0.3) / Math.max(1, nMole), sex: isFemale ? 'F' : 'M',
    len, width: len * lerp(0.68, 0.78, rng()), height: len * lerp(0.46, 0.56, rng()),
    color: mixRGB([0.17, 0.145, 0.095], [0.24, 0.20, 0.13], warmTone),
    accent: mixRGB([0.09, 0.08, 0.055], [0.30, 0.26, 0.18], warmTone),
    x, y, z, bedY: y, homeAlong: along, dOffset: d,
    state: 'filter-feeding', stateLabel: 'filter-feeding in swash',
   });
  }

  // 2. Atlantic Beach Hoppers (Americorchestia megalophthalma)
  const nHop = nOf('beach-hopper', 0.2);
  for (let i = 0; i < nHop; i++) {
   const along = lerp(aStart + 1, aEnd - 1, (i + rng() * 0.85) / Math.max(1, nHop));
   const wrackD = wrackDAt(land, along, seaLevel);
   const d = wrackD + lerp(-1.1, 1.9, rng());
   const [x, z] = worldAtShore(land, d, along);
   const len = lerp(0.013, 0.021, rng());
   const ht = len * 0.48;
   const sup = groundSupportHeight(land, x, z, Math.max(0.03, len * 1.4));
   pushAgent({
    speciesId: 'beach-hopper', guild: 'beachHoppers', commonName: 'Atlantic Beach Hopper', scientific: 'Americorchestia megalophthalma',
    rank: (i + 0.3) / Math.max(1, nHop), sex: rng() < 0.5 ? 'F' : 'M',
    len, width: len * 0.36, height: ht,
    color: mixRGB([0.23, 0.15, 0.075], [0.16, 0.105, 0.05], rng()), accent: [0.06, 0.04, 0.02],
    x, y: sup + ht * 0.72, z, bedY: sup, homeAlong: along, homeD: d,
    jumpCooldown: lerp(0.35, 2.4, rng()), state: 'scuttling', stateLabel: 'scuttling wrack',
   });
  }

  // 3. Atlantic Ghost Crabs (Ocypode quadrata)
  const nGhost = nOf('ghost-crab', 0.15);
  for (let i = 0; i < nGhost; i++) {
   const along = lerp(aStart + 1.5, aEnd - 1.5, (i + 0.15 + rng() * 0.7) / Math.max(1, nGhost));
   const burrowD = wrackDAt(land, along, seaLevel) + lerp(-0.8, 7.5, rng());
   const [bx, bz] = worldAtShore(land, burrowD, along);
   const by = land.height(bx, bz);
   const cw = lerp(0.034, 0.050, rng());
   const ht = cw * 0.50;
   const sup = groundSupportHeight(land, bx, bz, cw * 1.25);
   const morph = rng();
   pushAgent({
    speciesId: 'ghost-crab', guild: 'ghostCrabs', commonName: 'Atlantic Ghost Crab', scientific: 'Ocypode quadrata',
    rank: (i + 0.3) / Math.max(1, nGhost), sex: rng() < 0.5 ? 'M' : 'F', clawRight: rng() < 0.55,
    len: cw * 0.84, width: cw, height: ht,
    color: mixRGB([0.33, 0.24, 0.135], [0.22, 0.16, 0.09], morph),
    accent: mixRGB([0.36, 0.30, 0.20], [0.15, 0.11, 0.07], morph),
    x: bx, y: sup + ht * 0.92, z: bz, bedY: sup,
    burrowX: bx, burrowZ: bz, burrowY: by, burrowRadius: cw * 0.92, targetX: bx, targetZ: bz,
    state: 'foraging', stateLabel: 'stalking upper berm',
   });
  }

  // 4. Sand Fiddler Crabs (Leptuca pugilator)
  const nFid = nOf('fiddler-crab', 0.25);
  for (let i = 0; i < nFid; i++) {
   const basin = swales[i % swales.length];
   const ang0 = rng() * Math.PI * 2;
   let bx = basin.x + Math.cos(ang0) * 2.4;
   let bz = basin.z + Math.sin(ang0) * 2.4;
   let by = land.height(bx, bz);
   for (let rot = 0; rot < 6 && by < seaLevel + 0.015; rot++) {
    const ang = ang0 + (rot * Math.PI) / 3;
    for (let s = 0; s < 28; s++) {
     const rad = 1.2 + s * 0.7;
     const tx = basin.x + Math.cos(ang) * rad, tz = basin.z + Math.sin(ang) * rad;
     const th = land.height(tx, tz);
     if (th >= seaLevel + 0.02 && th <= seaLevel + 0.42) { bx = tx; bz = tz; by = th; break; }
     if (th >= seaLevel + 0.015 && (by < seaLevel + 0.015 || th < by)) { bx = tx; bz = tz; by = th; }
    }
   }
   if (by < seaLevel + 0.015) {
    const [fx, fz] = worldAtShore(land, 38 + (i % 5), basin.a);
    bx = fx; bz = fz; by = land.height(fx, fz);
   }
   const isMale = rng() < 0.56;
   const cw = lerp(0.017, 0.026, rng());
   const ht = cw * 0.52;
   const sup = groundSupportHeight(land, bx, bz, cw * 1.25);
   const morph = rng();
   pushAgent({
    speciesId: 'fiddler-crab', guild: 'fiddlerCrabs', commonName: 'Sand Fiddler Crab', scientific: 'Leptuca pugilator',
    rank: (i + 0.3) / Math.max(1, nFid), sex: isMale ? 'M' : 'F', clawRight: rng() < 0.52,
    len: cw * 0.80, width: cw, height: ht,
    color: mixRGB([0.105, 0.082, 0.092], [0.165, 0.125, 0.095], morph),
    accent: isMale ? mixRGB([0.56, 0.33, 0.17], [0.64, 0.43, 0.24], rng()) : [0.16, 0.12, 0.09],
    x: bx, y: sup + ht * 0.92, z: bz, bedY: sup,
    burrowX: bx, burrowZ: bz, burrowY: by, burrowRadius: cw * 0.85, waveTimer: rng() * 5,
    state: isMale ? 'waving' : 'feeding', stateLabel: isMale ? 'waving major claw' : 'deposit-feeding',
   });
  }

  // 5 & 6. Blue Crabs + Speckled Crabs (habitat anchored to seagrass/surf trough inside sector)
  const nBlue = nOf('blue-crab', 0.1);
  for (let i = 0; i < nBlue; i++) {
   const pt = seagrass[i % seagrass.length];
   const x = pt ? pt.x + lerp(-1.5, 1.5, rng()) : worldAtShore(land, lerp(-16, -8, rng()), lerp(aStart, aEnd, rng()))[0];
   const z = pt ? pt.z + lerp(-1.5, 1.5, rng()) : worldAtShore(land, lerp(-16, -8, rng()), lerp(aStart, aEnd, rng()))[1];
   const bed = groundSupportHeight(land, x, z, 0.10);
   const isFemale = rng() < 0.5;
   const cw = lerp(0.10, 0.145, rng());
   pushAgent({
    speciesId: 'blue-crab', guild: 'swimmingCrabs', commonName: 'Atlantic Blue Crab', scientific: 'Callinectes sapidus',
    rank: (i + 0.2) / Math.max(1, nBlue), sex: isFemale ? 'F' : 'M',
    len: cw * 0.54, width: cw, height: cw * 0.28,
    color: mixRGB([0.055, 0.115, 0.075], [0.085, 0.14, 0.09], rng()),
    accent: isFemale ? [0.05, 0.22, 0.54] : [0.04, 0.26, 0.58],
    clawTip: isFemale ? [0.52, 0.07, 0.06] : [0.06, 0.30, 0.62],
    x, y: bed + 0.035, z, bedY: bed, homeAlong: pt?.a ?? aMid, homeD: pt?.d ?? -12, podObj: baitPods[i % baitPods.length],
    state: 'prowling', stateLabel: 'prowling seagrass bed',
   });
  }
  const nSpec = nOf('speckled-crab', 0.4);
  for (let i = 0; i < nSpec; i++) {
   const along = lerp(aStart + 2, aEnd - 2, (i + 0.25 + rng() * 0.5) / Math.max(1, nSpec));
   const d = lerp(-13.5, -5.5, rng());
   const [x, z] = worldAtShore(land, d, along);
   const bed = groundSupportHeight(land, x, z, 0.08);
   const cw = lerp(0.075, 0.115, rng());
   pushAgent({
    speciesId: 'speckled-crab', guild: 'swimmingCrabs', commonName: 'Speckled Swimming Crab', scientific: 'Arenaeus cribrarius',
    rank: (i + 0.5) / Math.max(1, nSpec), sex: rng() < 0.5 ? 'F' : 'M',
    len: cw * 0.58, width: cw, height: cw * 0.27,
    color: mixRGB([0.18, 0.135, 0.08], [0.23, 0.175, 0.105], rng()), accent: [0.42, 0.36, 0.26], clawTip: [0.34, 0.28, 0.19],
    x, y: bed + 0.03, z, bedY: bed, homeAlong: along, homeD: d, podObj: baitPods[i % baitPods.length],
    state: 'foraging', stateLabel: 'foraging surf trough',
   });
  }

  // 7. Saltmarsh Sand Gnats (Culicoides furens) - sector local clouds
  const nGnat = nOf('sand-gnat', 0.1);
  for (let i = 0; i < nGnat; i++) {
   const cloud = gnatClouds[i % gnatClouds.length];
   const len = lerp(0.0046, 0.0074, rng());
   pushAgent({
    speciesId: 'sand-gnat', guild: 'sandGnats', commonName: 'Saltmarsh Sand Gnat', scientific: 'Culicoides furens',
    rank: (i + 0.25) / Math.max(1, nGnat), sex: rng() < 0.7 ? 'M' : 'F',
    len, width: len * 0.48, height: len * 0.48, wingSpan: len * 2.3,
    color: [0.025, 0.022, 0.018], accent: [0.62, 0.56, 0.42],
    x: cloud.x + lerp(-0.4, 0.4, rng()), y: cloud.h + lerp(0.35, 0.85, rng()), z: cloud.z + lerp(-0.4, 0.4, rng()), bedY: cloud.h,
    cloudX: cloud.x, cloudZ: cloud.z, orbitR: lerp(0.28, 1.05, rng()), orbitH: lerp(0.24, 0.88, rng()), orbitFreq: lerp(2.4, 4.8, rng()),
    state: 'zipping', stateLabel: 'zipping mating swarm',
   });
  }

  // 8. Kelp / Wrack Flies (Coelopa / Ephydridae)
  const nFly = nOf('kelp-fly', 0.2);
  for (let i = 0; i < nFly; i++) {
   const along = lerp(aStart + 1.5, aEnd - 1.5, (i + rng() * 0.85) / Math.max(1, nFly));
   const wrackD = wrackDAt(land, along, seaLevel) + lerp(-0.8, 0.9, rng());
   const [x, z] = worldAtShore(land, wrackD, along);
   const ground = groundSupportHeight(land, x, z, 0.03);
   const len = lerp(0.0065, 0.010, rng());
   pushAgent({
    speciesId: 'kelp-fly', guild: 'kelpFlies', commonName: 'Wrack Kelp Fly', scientific: 'Coelopa / Ephydridae',
    rank: (i + 0.3) / Math.max(1, nFly), len, width: len * 0.46, height: len * 0.44, wingSpan: len * 2.0,
    color: [0.032, 0.028, 0.020], accent: [0.56, 0.48, 0.30],
    x, y: ground + 0.12, z, bedY: ground, homeAlong: along, homeD: wrackD, hoverAlt: lerp(0.03, 0.28, rng()),
    state: 'hovering', stateLabel: 'feeding on wrack',
   });
  }

  // 9. Seaside Dragonlets (Erythrodiplax berenice)
  const nDrag = nOf('dragonlet', 0.3);
  for (let i = 0; i < nDrag; i++) {
   const basin = swales[i % swales.length];
   const cloud = gnatClouds[i % gnatClouds.length];
   const isMale = rng() < 0.55;
   const len = lerp(0.031, 0.038, rng());
   const px = basin.x + lerp(-4, 4, rng()), pz = basin.z + lerp(-4, 4, rng());
   const gh = groundSupportHeight(land, px, pz, 0.03);
   const py = gh + lerp(0.45, 1.05, rng());
   pushAgent({
    speciesId: 'dragonlet', guild: 'dragonlets', commonName: 'Seaside Dragonlet', scientific: 'Erythrodiplax berenice',
    rank: (i + 0.3) / Math.max(1, nDrag), sex: isMale ? 'M' : 'F',
    len, width: len * 0.15, height: len * 0.15, wingSpan: len * 1.56,
    color: isMale ? [0.09, 0.22, 0.40] : [0.42, 0.22, 0.04], accent: isMale ? [0.22, 0.38, 0.54] : [0.05, 0.045, 0.04],
    x: px, y: py, z: pz, bedY: gh, perchX: px, perchZ: pz, perchY: py, cloudX: cloud.x, cloudZ: cloud.z,
    state: 'perched', stateLabel: 'perched lookout',
   });
  }

  // 10. Schooling Baitfish (Anchoa mitchilli)
  const nBait = nOf('baitfish', 0.1);
  for (let i = 0; i < nBait; i++) {
   const pod = baitPods[i % baitPods.length];
   const d = pod.centerD + lerp(-2.4, 2.4, rng());
   const along = pod.centerAlong + lerp(-4.5, 4.5, rng());
   const [x, z] = worldAtShore(land, d, along);
   const bed = land.height(x, z), water = Math.max(bed + 0.24, seaLevel);
   const len = lerp(0.050, 0.078, rng());
   const ang = (pod.driftSign > 0 ? 0.1 : Math.PI - 0.1) + lerp(-0.4, 0.4, rng());
   pushAgent({
    speciesId: 'baitfish', guild: 'baitfish', commonName: 'Bay Anchovy & Silverside', scientific: 'Anchoa mitchilli',
    rank: (i + 0.25) / Math.max(1, nBait), podId: pod.id, podObj: pod,
    len, width: len * 0.17, height: len * 0.24, color: [0.05, 0.12, 0.08], accent: [0.68, 0.74, 0.78],
    x, y: clamp(lerp(bed + 0.09, water - 0.13, rng()), bed + 0.07, water - 0.10), z, bedY: bed,
    vx: Math.cos(ang) * 0.35, vz: Math.sin(ang) * 0.35, yaw: ang, panicTimer: 0,
    state: 'schooling', stateLabel: 'schooling in surf trough',
   });
  }

  // 11. Juvenile Florida Pompano (Trachinotus carolinus)
  const nPomp = nOf('pompano', 0.3);
  for (let i = 0; i < nPomp; i++) {
   const along = lerp(aStart + 2, aEnd - 2, (i + 0.2 + rng() * 0.6) / Math.max(1, nPomp));
   const d = lerp(-12.5, -5.5, rng());
   const [x, z] = worldAtShore(land, d, along);
   const bed = land.height(x, z), water = Math.max(bed + 0.25, seaLevel);
   const len = lerp(0.105, 0.155, rng());
   pushAgent({
    speciesId: 'pompano', guild: 'surfFish', commonName: 'Juvenile Florida Pompano', scientific: 'Trachinotus carolinus',
    rank: (i + 0.3) / Math.max(1, nPomp), len, width: len * 0.19, height: len * 0.46,
    color: [0.13, 0.19, 0.23], accent: [0.66, 0.48, 0.10],
    x, y: clamp(bed + 0.14, bed + 0.07, water - 0.10), z, bedY: bed,
    vx: (i % 2 ? 1 : -1) * 0.45, vz: 0.1, patrolSign: i % 2 ? 1 : -1, homeD: d, homeAlong: along, podObj: baitPods[i % baitPods.length],
    state: 'hunting', stateLabel: 'cruising breaking surf',
   });
  }

  // 12. Gulf Pinfish (Lagodon rhomboides) anchored to real sector seagrass patches
  const nPin = nOf('pinfish', 0.2);
  for (let i = 0; i < nPin; i++) {
   const pt = seagrass[i % seagrass.length];
   const along = pt ? pt.a + lerp(-2, 2, rng()) : lerp(aStart + 2, aEnd - 2, rng());
   const d = pt ? pt.d + lerp(-1.5, 1.5, rng()) : lerp(-18, -8, rng());
   const [x, z] = pt ? [pt.x + lerp(-1.4, 1.4, rng()), pt.z + lerp(-1.4, 1.4, rng())] : worldAtShore(land, d, along);
   const bed = land.height(x, z), water = Math.max(bed + 0.28, seaLevel);
   const len = lerp(0.082, 0.125, rng());
   pushAgent({
    speciesId: 'pinfish', guild: 'reefSwaleFish', commonName: 'Gulf Pinfish', scientific: 'Lagodon rhomboides',
    rank: (i + 0.25) / Math.max(1, nPin), len, width: len * 0.21, height: len * 0.40,
    color: [0.09, 0.14, 0.07], accent: [0.40, 0.35, 0.13],
    x, y: clamp(bed + lerp(0.10, 0.34, rng()), bed + 0.07, water - 0.11), z, bedY: bed, homeX: x, homeZ: z,
    state: 'browsing', stateLabel: 'browsing seagrass & reef',
   });
  }

  // 13. Sheepshead Minnow / Killifish (Cyprinodon variegatus)
  const nKilli = nOf('killifish', 0.3);
  for (let i = 0; i < nKilli; i++) {
   const basin = swales[i % swales.length];
   const isMale = rng() < 0.48;
   const len = lerp(0.042, 0.062, rng());
   const ang = rng() * Math.PI * 2;
   let r = lerp(0.15, 2.2, rng());
   let x = basin.x + Math.cos(ang) * r, z = basin.z + Math.sin(ang) * r, bed = land.height(x, z);
   for (let s = 0; s < 8 && bed >= seaLevel - 0.12; s++) { r *= 0.65; x = basin.x + Math.cos(ang) * r; z = basin.z + Math.sin(ang) * r; bed = land.height(x, z); }
   if (bed >= seaLevel - 0.10) { x = basin.x; z = basin.z; bed = land.height(x, z); }
   pushAgent({
    speciesId: 'killifish', guild: 'reefSwaleFish', commonName: 'Sheepshead Minnow', scientific: 'Cyprinodon variegatus',
    rank: (i + 0.45) / Math.max(1, nKilli), sex: isMale ? 'M' : 'F', len, width: len * 0.24, height: len * 0.32,
    color: isMale ? [0.06, 0.13, 0.21] : [0.12, 0.11, 0.065], accent: isMale ? [0.48, 0.20, 0.05] : [0.28, 0.25, 0.14],
    x, y: clamp(bed + 0.04, bed + 0.025, Math.max(bed + 0.028, seaLevel - 0.07)), z, bedY: bed,
    basinX: basin.x, basinZ: basin.z, homeX: basin.x, homeZ: basin.z,
    visibility: bed < seaLevel - 0.08 ? 1 : 0, state: 'foraging', stateLabel: 'foraging swale pool',
   });
  }

  // 14. Bay Scallop (Argopecten irradians) tightly associated with real seagrass beds
  const nScal = nOf('bay-scallop', 0.1);
  for (let i = 0; i < nScal; i++) {
   const pt = seagrass[i % seagrass.length];
   const [x, z] = pt ? [pt.x + lerp(-0.85, 0.85, rng()), pt.z + lerp(-0.85, 0.85, rng())] : worldAtShore(land, lerp(-18.5, -8.5, rng()), lerp(aStart + 2, aEnd - 2, rng()));
   const sup = groundSupportHeight(land, x, z, 0.05);
   const sz = lerp(0.056, 0.082, rng());
   pushAgent({
    speciesId: 'bay-scallop', guild: 'benthicMollusks', commonName: 'Bay Scallop', scientific: 'Argopecten irradians',
    rank: (i + 0.25) / Math.max(1, nScal), len: sz, width: sz * 1.04, height: sz * 0.38,
    color: [0.18, 0.14, 0.10], accent: [0.74, 0.68, 0.56],
    x, y: sup + sz * 0.24, z, bedY: sup, valveGape: 0.18,
    state: 'filter-feeding', stateLabel: 'filter-feeding on seagrass bed',
   });
  }

  // 15. Sanderling (Calidris alba) - swash-chasing shorebird flock
  const nSand = nOf('sanderling', 0.2);
  for (let i = 0; i < nSand; i++) {
   const along = lerp(aStart + 3, aEnd - 3, (i + 0.2 + rng() * 0.6) / Math.max(1, nSand));
   const d = lerp(-0.2, 2.4, rng());
   const [x, z] = worldAtShore(land, d, along);
   const supH = groundSupportHeight(land, x, z, 0.045);
   const len = lerp(0.165, 0.195, rng());
   pushAgent({
    speciesId: 'sanderling', guild: 'shorebirds', commonName: 'Sanderling', scientific: 'Calidris alba',
    rank: (i + 0.3) / Math.max(1, nSand), len, width: len * 0.34, height: len * 0.36, wingSpan: len * 1.95,
    color: [0.56, 0.50, 0.42], accent: [0.92, 0.92, 0.90],
    x, y: supH + 0.046 + len * 0.18, z, bedY: supH, homeAlong: along, anchorAlong: along,
    roostX: bermRoost.x + lerp(-1.2, 1.2, rng()), roostZ: bermRoost.z + lerp(-1.2, 1.2, rng()),
    airborne: false, state: 'chasing-swash', stateLabel: 'chasing receding swash wave',
   });
  }

  // 16. Laughing Gull (Leucophaeus atricilla) - loafing windward, incubating shell-scrapes & soaring
  const nGull = nOf('laughing-gull', 0.3);
  for (let i = 0; i < nGull; i++) {
   const along = lerp(aStart + 4, aEnd - 4, (i + 0.2 + rng() * 0.6) / Math.max(1, nGull));
   const startAir = i % 2 === 1;
   const d = startAir ? lerp(-8.0, 6.0, rng()) : lerp(3.2, 8.5, rng());
   const [x, z] = worldAtShore(land, d, along);
   const supH = groundSupportHeight(land, x, z, 0.08);
   const len = lerp(0.32, 0.38, rng());
   const hasNest = rng() < 0.42;
   const nx = nestRoost.x + lerp(-2.2, 2.2, rng()), nz = nestRoost.z + lerp(-2.2, 2.2, rng());
   pushAgent({
    speciesId: 'laughing-gull', guild: 'seabirds', commonName: 'Laughing Gull', scientific: 'Leucophaeus atricilla',
    rank: (i + 0.15) / Math.max(1, nGull), len, width: len * 0.32, height: len * 0.34, wingSpan: len * 2.75,
    color: [0.36, 0.40, 0.45], accent: [0.94, 0.94, 0.92],
    x, y: startAir ? Math.max(supH, seaLevel) + lerp(2.8, 4.6, rng()) : supH + 0.088 + len * 0.16, z, bedY: supH,
    homeAlong: along, hasNest, nestX: nx, nestZ: nz, nestY: groundSupportHeight(land, nx, nz, 0.12),
    roostX: bermRoost.x + lerp(-1.8, 1.8, rng()), roostZ: bermRoost.z + lerp(-1.8, 1.8, rng()),
    airborne: startAir, tucked: false, state: startAir ? 'soaring' : 'loafing', stateLabel: startAir ? 'soaring coastal updrafts' : 'loafing windward on berm',
   });
  }

  // 17. Royal Tern (Thalasseus maximus) - windward roosting & nearshore plunge-diving
  const nTern = nOf('royal-tern', 0.4);
  for (let i = 0; i < nTern; i++) {
   const along = lerp(aStart + 4, aEnd - 4, (i + 0.25 + rng() * 0.5) / Math.max(1, nTern));
   const d = lerp(-17.5, -8.5, rng());
   const [x, z] = worldAtShore(land, d, along);
   const supH = groundSupportHeight(land, x, z, 0.08);
   const len = lerp(0.45, 0.51, rng());
   pushAgent({
    speciesId: 'royal-tern', guild: 'seabirds', commonName: 'Royal Tern', scientific: 'Thalasseus maximus',
    rank: (i + 0.45) / Math.max(1, nTern), len, width: len * 0.26, height: len * 0.28, wingSpan: len * 2.85,
    color: [0.68, 0.72, 0.76], accent: [0.96, 0.96, 0.94],
    x, y: Math.max(supH, seaLevel) + lerp(3.6, 5.2, rng()), z, bedY: supH,
    homeAlong: along, podObj: baitPods[i % baitPods.length],
    roostX: ternRoost.x + lerp(-1.1, 1.1, rng()), roostZ: ternRoost.z + lerp(-1.1, 1.1, rng()),
    airborne: true, divePhase: 'patrol', diveCooldown: i * 2.2,
    state: 'patrolling', stateLabel: 'scanning nearshore for baitfish',
   });
  }

  // 18. Atlantic Stingray (Hypanus sabinus) - mostly cryptic stationary resting beside seagrass/reef pockets
  const nRay = nOf('atlantic-stingray', 0.35);
  for (let i = 0; i < nRay; i++) {
   const pt = seagrass[i % seagrass.length];
   const along = pt ? pt.a : lerp(aStart + 6, aEnd - 6, rng());
   const d = pt ? clamp(pt.d + 1.2, -17.5, -7.2) : lerp(-16.5, -7.8, rng());
   const [x, z] = pt ? [pt.x + lerp(-1.4, 1.4, rng()), pt.z + lerp(-1.4, 1.4, rng())] : worldAtShore(land, d, along);
   const supBed = groundSupportHeight(land, x, z, 0.24);
   const water = Math.max(supBed + 0.30, seaLevel);
   const disc = lerp(0.26, 0.36, rng());
   pushAgent({
    speciesId: 'atlantic-stingray', guild: 'rays', commonName: 'Atlantic Stingray', scientific: 'Hypanus sabinus',
    rank: (i + 0.3) / Math.max(1, nRay), len: disc * 1.15, width: disc, height: disc * 0.13,
    color: [0.42, 0.34, 0.20], accent: [0.76, 0.72, 0.60],
    x, y: clamp(supBed + 0.09, supBed + 0.05, water - 0.12), z, bedY: supBed,
    homeAlong: along, shelterX: x, shelterZ: z,
    state: 'foraging', stateLabel: 'gliding over seabed hunting invertebrates',
   });
  }

   // 19. Juvenile Bonnethead Shark (Sphyrna tiburo) - wide-ranging coastal hammerhead
   const nShark = nOf('bonnethead-shark', 0.45);
   for (let i = 0; i < nShark; i++) {
    const along = lerp(aStart + 8, aEnd - 8, (i + 0.35 + rng() * 0.3) / Math.max(1, nShark));
    const d = lerp(-19.5, -10.5, rng());
    const [x, z] = worldAtShore(land, d, along);
    const supBed = groundSupportHeight(land, x, z, 0.20);
    const water = Math.max(supBed + 0.45, seaLevel);
    const len = lerp(0.48, 0.62, rng());
    pushAgent({
     speciesId: 'bonnethead-shark', guild: 'coastalSharks', commonName: 'Juvenile Bonnethead Shark', scientific: 'Sphyrna tiburo',
     rank: (i + 0.3) / Math.max(1, nShark), len, width: len * 0.24, height: len * 0.20,
     color: [0.32, 0.31, 0.27], accent: [0.78, 0.78, 0.74],
     x, y: clamp(lerp(supBed + 0.22, water - 0.18, 0.5), supBed + 0.14, water - 0.16), z, bedY: supBed,
     homeAlong: along, speed: 0.74, state: 'cruising', stateLabel: 'ram-ventilating coastal cruise',
    });
   }

   // 20. Variable Coquina Clam (Donax variabilis) - polymorphic swash filter-feeder
   const coqPal = [[0.78, 0.58, 0.72], [0.84, 0.66, 0.52], [0.88, 0.84, 0.62], [0.68, 0.72, 0.82]];
   const nCoq = nOf('coquina-clam', 0.15);
   for (let i = 0; i < nCoq; i++) {
    const along = lerp(aStart + 1.5, aEnd - 1.5, (i + rng() * 0.85) / Math.max(1, nCoq));
    const d = lerp(-1.2, 1.8, rng());
    const [x, z] = worldAtShore(land, d, along);
    const len = lerp(0.012, 0.022, rng());
    const y = land.height(x, z);
    const col = coqPal[Math.floor(rng() * coqPal.length)];
    pushAgent({
     speciesId: 'coquina-clam', guild: 'benthicMollusks', commonName: 'Variable Coquina Clam', scientific: 'Donax variabilis',
     rank: (i + 0.25) / Math.max(1, nCoq), len, width: len * 0.68, height: len * 0.44,
     color: col, accent: [0.92, 0.88, 0.80],
     x, y: y + Math.max(0.0055, len * 0.36), z, bedY: y, homeAlong: along, dOffset: d,
     state: 'swash-emerging', stateLabel: 'migrating tidally in swash',
    });
   }

   // 21. Thin-Striped Hermit Crab (Clibanarius vittatus)
   const nHerm = nOf('hermit-crab', 0.2);
   for (let i = 0; i < nHerm; i++) {
    const along = lerp(aStart + 2, aEnd - 2, (i + rng() * 0.8) / Math.max(1, nHerm));
    const d = lerp(-0.4, 2.8, rng());
    const [x, z] = worldAtShore(land, d, along);
    const len = lerp(0.020, 0.036, rng());
    const sup = groundSupportHeight(land, x, z, len * 1.1);
    pushAgent({
     speciesId: 'hermit-crab', guild: 'hermitCrabs', commonName: 'Thin-Striped Hermit Crab', scientific: 'Clibanarius vittatus',
     rank: (i + 0.25) / Math.max(1, nHerm), len, width: len * 0.78, height: len * 0.72,
     color: [0.36, 0.30, 0.22], accent: [0.58, 0.50, 0.36],
     x, y: sup + Math.max(0.008, len * 0.42), z, bedY: sup, homeAlong: along, homeD: d,
     state: 'foraging', stateLabel: 'crawling slowly carrying striped shell',
    });
   }

   // 22. Eastern Beach Tiger Beetle (Habroscelimorpha dorsalis)
   const nTiger = nOf('tiger-beetle', 0.35);
   for (let i = 0; i < nTiger; i++) {
    const along = lerp(aStart + 2, aEnd - 2, (i + rng() * 0.8) / Math.max(1, nTiger));
    const d = lerp(2.5, 11.5, rng());
    const [x, z] = worldAtShore(land, d, along);
    const len = lerp(0.012, 0.016, rng());
    const sup = groundSupportHeight(land, x, z, Math.max(0.035, len * 1.4));
    pushAgent({
     speciesId: 'tiger-beetle', guild: 'dunePredators', commonName: 'Eastern Beach Tiger Beetle', scientific: 'Habroscelimorpha dorsalis',
     rank: (i + 0.3) / Math.max(1, nTiger), len, width: len * 0.44, height: len * 0.36,
     color: [0.84, 0.80, 0.70], accent: [0.24, 0.20, 0.12],
     x, y: sup + Math.max(0.006, len * 0.26), z, bedY: sup, homeAlong: along,
     state: 'hunting', stateLabel: 'cursorial stop-and-go patrolling',
    });
   }

   // 23. Six-Lined Racerunner (Aspidoscelis sexlineata)
   const nLizard = nOf('racerunner', 0.4);
   for (let i = 0; i < nLizard; i++) {
    const along = lerp(aStart + 4, aEnd - 4, (i + 0.3 + rng() * 0.4) / Math.max(1, nLizard));
    const d = lerp(12.0, 34.0, rng());
    const [x, z] = worldAtShore(land, d, along);
    const len = lerp(0.14, 0.20, rng());
    const sup = groundSupportHeight(land, x, z, len * 0.45);
    pushAgent({
     speciesId: 'racerunner', guild: 'dunePredators', commonName: 'Six-Lined Racerunner', scientific: 'Aspidoscelis sexlineata',
     rank: (i + 0.3) / Math.max(1, nLizard), len, width: len * 0.13, height: len * 0.10,
     color: [0.22, 0.17, 0.12], accent: [0.84, 0.78, 0.56],
     x, y: sup + Math.max(0.010, len * 0.068), z, bedY: sup, homeAlong: along,
     state: 'foraging', stateLabel: 'wide-foraging sunlit foredune sand',
    });
   }

   // 24. Daggerblade Grass Shrimp (Palaemonetes pugio)
   const nShrimp = nOf('grass-shrimp', 0.15);
   for (let i = 0; i < nShrimp; i++) {
    const pt = seagrass[i % seagrass.length];
    const [x, z] = pt ? [pt.x + lerp(-1.5, 1.5, rng()), pt.z + lerp(-1.5, 1.5, rng())] : worldAtShore(land, lerp(-18.0, -8.0, rng()), lerp(aStart + 2, aEnd - 2, rng()));
    const bed = groundSupportHeight(land, x, z, 0.03);
    const water = Math.max(bed + 0.22, seaLevel);
    const len = lerp(0.022, 0.038, rng());
    pushAgent({
     speciesId: 'grass-shrimp', guild: 'seagrassShrimp', commonName: 'Daggerblade Grass Shrimp', scientific: 'Palaemonetes pugio',
     rank: (i + 0.25) / Math.max(1, nShrimp), len, width: len * 0.24, height: len * 0.28,
     color: [0.48, 0.44, 0.30], accent: [0.72, 0.68, 0.50],
     x, y: clamp(bed + lerp(0.03, 0.12, rng()), bed + 0.015, water - 0.075), z, bedY: bed,
     homeX: pt?.x ?? x, homeZ: pt?.z ?? z, homeAlong: pt?.a ?? aMid,
     state: 'grazing', stateLabel: 'grazing epiphytes inside seagrass canopy',
    });
   }

   // 25. Saltmarsh Periwinkle (Littoraria irrorata)
   const nPeri = nOf('marsh-periwinkle', 0.25);
   for (let i = 0; i < nPeri; i++) {
    const basin = swales[i % swales.length];
    const ang0 = rng() * Math.PI * 2;
    let bx = basin.x + Math.cos(ang0) * 2.8, bz = basin.z + Math.sin(ang0) * 2.8, by = land.height(bx, bz);
    for (let rot = 0; rot < 6 && by < seaLevel + 0.025; rot++) {
     const ang = ang0 + (rot * Math.PI) / 3;
     for (let s = 0; s < 24; s++) {
      const rad = 1.4 + s * 0.7;
      const tx = basin.x + Math.cos(ang) * rad, tz = basin.z + Math.sin(ang) * rad;
      const th = land.height(tx, tz);
      if (th >= seaLevel + 0.025 && th <= seaLevel + 0.55) { bx = tx; bz = tz; by = th; break; }
     }
    }
    if (by < seaLevel + 0.025) {
     const [fx, fz] = worldAtShore(land, 39 + (i % 4), basin.a);
     bx = fx; bz = fz; by = land.height(fx, fz);
    }
    const len = lerp(0.015, 0.024, rng());
    const sup = groundSupportHeight(land, bx, bz, Math.max(0.03, len * 1.4));
    pushAgent({
     speciesId: 'marsh-periwinkle', guild: 'benthicMollusks', commonName: 'Saltmarsh Periwinkle', scientific: 'Littoraria irrorata',
     rank: (i + 0.3) / Math.max(1, nPeri), len, width: len * 0.68, height: len * 0.78,
     color: [0.52, 0.48, 0.42], accent: [0.70, 0.64, 0.56],
     x: bx, y: sup + Math.max(0.007, len * 0.48), z: bz, bedY: sup,
     state: 'grazing', stateLabel: 'grazing microfungi along swale rim',
    });
   }
   return true;
  }

  step(dtSec, land = this.land, wind = null, sea = null, ecology = null, physics = null) {
   if (!land) return;
   const sandTerrain = physics?.sandTerrain || null;
   let activeLand = land;
   if (sandTerrain) {
    if (this._proxyBase !== land || this._proxySand !== sandTerrain) {
     this._proxyBase = land;
     this._proxySand = sandTerrain;
     this._proxyLand = resolveEffectiveLand(land, physics);
    }
    activeLand = this._proxyLand;
   }
   this.land = activeLand;
   if (!this.agents.length) this.spawn(activeLand);
   const dt = clamp(dtSec || 0, 0, 0.08);
   this.time += dt;
   const t = this.time;
   const climate = activeLand.climate;
   const seaLevel = sea?.seaLevel ?? climate?.seaLevelOffset ?? 0;
   const windSpd = wind?.speed ?? climate?.prevailingWindSpeed ?? 4.2;
   const windX = wind?.x ?? (-INLAND_DIR_X * windSpd * 0.7);
   const windZ = wind?.z ?? (-INLAND_DIR_Z * windSpd * 0.7);

   this.stimuli.step(dt);
   this.stimuli.harvestWorld(activeLand, sea, physics, this.placedLinks, dt);

   const guildFraction = new Map();
   const guildActivity = new Map();
   if (ecology) {
    for (const sp of FAUNA_SPECIES) {
     if (!guildFraction.has(sp.guild)) {
      const tgt = ecology.targetCount(sp.guild, 100, climate, wind);
      guildFraction.set(sp.guild, clamp(tgt / 100, 0.05, 1.0));
      guildActivity.set(sp.guild, ecology.activity(sp.guild, climate, wind));
     }
    }
   }

   // Zero-allocation sector-bucketed spatial lists for O(1) per-agent neighbor lookups across 240+ m coastlines
   const kinds = ['hoppers', 'moleCrabs', 'ghostCrabs', 'fiddlers', 'swimmingCrabs', 'scallops', 'birds', 'raysAndSharks', 'predatorsSea', 'fishSurface', 'shrimp', 'snails', 'dunePrey', 'dunePredators'];
   if (!this._buckets) {
    this._buckets = {};
    this._scratch = {};
    this._flat = {};
    for (const k of kinds) {
     this._buckets[k] = new Map();
     this._scratch[k] = [];
     this._flat[k] = [];
    }
    this._baitPodLists = new Map();
   }
   for (const k of kinds) {
    if (!this._buckets[k]) {
     this._buckets[k] = new Map();
     this._scratch[k] = [];
     this._flat[k] = [];
    }
    for (const arr of this._buckets[k].values()) arr.length = 0;
    this._flat[k].length = 0;
   }
   for (const arr of this._baitPodLists.values()) arr.length = 0;

   const pushBucket = (kind, secKey, agent) => {
    const m = this._buckets[kind];
    let list = m.get(secKey);
    if (!list) { list = []; m.set(secKey, list); }
    list.push(agent);
    this._flat[kind].push(agent);
   };

   for (const pl of this.placedLinks) {
    if (pl.alive === false) continue;
    const pKey = 'placed';
    if (pl.sectorIdx === undefined) {
     pl.sectorIdx = Math.floor(alongFromWorld(pl.x, pl.z) / FAUNA_SECTOR_M);
     pl.band = activeLand.shoreDistance(pl.x, pl.z) > 170 ? 'bay' : 'gulf';
    }
    const sp = pl.speciesId;
    if (sp === 'ghost-crab') pushBucket('ghostCrabs', pKey, pl);
    else if (sp === 'fiddler-crab') pushBucket('fiddlers', pKey, pl);
    else if (sp === 'blue-crab' || sp === 'speckled-crab') { pushBucket('swimmingCrabs', pKey, pl); pushBucket('predatorsSea', pKey, pl); }
    else if (sp === 'bay-scallop') pushBucket('scallops', pKey, pl);
    else if (sp === 'sanderling' || sp === 'laughing-gull' || sp === 'royal-tern') pushBucket('birds', pKey, pl);
    else if (sp === 'atlantic-stingray' || sp === 'bonnethead-shark') { pushBucket('raysAndSharks', pKey, pl); pushBucket('predatorsSea', pKey, pl); }
    else if (sp === 'pompano' || sp === 'pinfish') pushBucket('predatorsSea', pKey, pl);
    else if (sp === 'beach-hopper') { pushBucket('hoppers', pKey, pl); pushBucket('dunePrey', pKey, pl); }
    else if (sp === 'mole-crab') pushBucket('moleCrabs', pKey, pl);
    else if (sp === 'kelp-fly' || sp === 'sand-gnat' || sp === 'tiger-beetle') pushBucket('dunePrey', pKey, pl);
    else if (sp === 'racerunner') pushBucket('dunePredators', pKey, pl);
    else if (sp === 'hermit-crab' || sp === 'marsh-periwinkle' || sp === 'coquina-clam') pushBucket('snails', pKey, pl);
    else if (sp === 'grass-shrimp') pushBucket('shrimp', pKey, pl);
   }

   const secSpeciesCounts = new Map();
   const spPerSectorMap = new Map(FAUNA_SPECIES.map(s => [s.id, s.perSector]));
   for (const a of this.agents) {
    if (a.alive === false) continue;
    const sk = a.sectorKey || `${a.band || 'gulf'}:${a.sectorIdx || 0}`;
    const cKey = `${sk}:${a.speciesId}`;
    secSpeciesCounts.set(cKey, (secSpeciesCounts.get(cKey) || 0) + 1);

    const frac = guildFraction.get(a.guild) ?? 1.0;
    a.emerged = a.rank <= frac;
    a.activity = guildActivity.get(a.guild) ?? 1.0;
    if (!a.emerged) continue;
    const sp = a.speciesId;
    if (sp === 'beach-hopper') { pushBucket('hoppers', sk, a); pushBucket('dunePrey', sk, a); }
    else if (sp === 'mole-crab') pushBucket('moleCrabs', sk, a);
    else if (sp === 'ghost-crab') pushBucket('ghostCrabs', sk, a);
    else if (sp === 'fiddler-crab') pushBucket('fiddlers', sk, a);
    else if (sp === 'blue-crab' || sp === 'speckled-crab') { pushBucket('swimmingCrabs', sk, a); pushBucket('predatorsSea', sk, a); }
    else if (sp === 'bay-scallop') pushBucket('scallops', sk, a);
    else if (sp === 'sanderling' || sp === 'laughing-gull' || sp === 'royal-tern') pushBucket('birds', sk, a);
    else if (sp === 'atlantic-stingray' || sp === 'bonnethead-shark') { pushBucket('raysAndSharks', sk, a); pushBucket('predatorsSea', sk, a); }
    else if (sp === 'baitfish' || sp === 'pompano' || sp === 'pinfish' || sp === 'killifish') {
     if (sp === 'baitfish') {
      const pk = a.podObj?.key ?? a.podId ?? 0;
      let pl = this._baitPodLists.get(pk);
      if (!pl) { pl = []; this._baitPodLists.set(pk, pl); }
      pl.push(a);
     }
     if (sp === 'pompano' || sp === 'pinfish') pushBucket('predatorsSea', sk, a);
     if (waterHeightAt(sea, activeLand, a.x, a.z) - a.y < 0.75) pushBucket('fishSurface', sk, a);
    } else if (sp === 'grass-shrimp') {
     pushBucket('shrimp', sk, a);
     if (waterHeightAt(sea, activeLand, a.x, a.z) - a.y < 0.75) pushBucket('fishSurface', sk, a);
    } else if (sp === 'coquina-clam') {
     if ((a.burrowDepth || 0) < 0.014) pushBucket('snails', sk, a);
    } else if (sp === 'hermit-crab' || sp === 'marsh-periwinkle') {
     pushBucket('snails', sk, a);
    } else if (sp === 'kelp-fly' || sp === 'sand-gnat' || sp === 'tiger-beetle') {
     pushBucket('dunePrey', sk, a);
    } else if (sp === 'racerunner') {
     pushBucket('dunePredators', sk, a);
    }
   }

   for (const pod of this.baitPodsMap.values()) {
    pod.centerAlong += pod.driftSign * 0.24 * dt;
    if (pod.centerAlong > pod.aEnd - 2) pod.driftSign = -1;
    if (pod.centerAlong < pod.aStart + 2) pod.driftSign = 1;
    pod.centerD = pod.band === 'bay'
     ? lerp(pod.minD ?? 232, pod.maxD ?? 276, 0.5 + 0.5 * Math.sin(t * 0.08 + pod.id * 2.1))
     : lerp(-17, -8.0, 0.5 + 0.5 * Math.sin(t * 0.09 + pod.id * 2.1));
   }

   const nearList = (kind, agent) => {
    const out = this._scratch[kind];
    if (!out) return null;
    out.length = 0;
    const bMap = this._buckets[kind];
    const b = agent.band || 'gulf';
    const s = agent.sectorIdx ?? Math.floor(alongFromWorld(agent.x, agent.z) / FAUNA_SECTOR_M);
    for (let ds = -1; ds <= 1; ds++) {
     const list = bMap.get(`${b}:${s + ds}`);
     if (list) for (let i = 0; i < list.length; i++) out.push(list[i]);
    }
    const pList = bMap.get('placed');
    if (pList) for (let i = 0; i < pList.length; i++) out.push(pList[i]);
    return out;
   };

   const newBirths = [];
   const spawnJuvenileClone = (parent, growInit = 0.22) => {
    const sk = parent.sectorKey || `${parent.band || 'gulf'}:${parent.sectorIdx || 0}`;
    const cKey = `${sk}:${parent.speciesId}`;
    const curN = secSpeciesCounts.get(cKey) || 0;
    const rate = spPerSectorMap.get(parent.speciesId) ?? 2;
    if (curN >= Math.max(2, Math.ceil(rate * 1.45)) || (this.agents.length + newBirths.length) >= 1800) return null;
    secSpeciesCounts.set(cKey, curN + 1);
    const id = this.nextId++;
    const ang = ((id * 2.39996) % (Math.PI * 2));
    const rad = Math.min(0.45, Math.max(0.08, (parent.len || 0.06) * 2.2));
    const child = {
     ...parent,
     id,
     isPlaced: false,
     alive: true,
     visibility: 1,
     emerged: true,
     vx: 0, vy: 0, vz: 0, speed: 0,
     yaw: ang,
     phase: (parent.phase || 0) + 1.1,
     x: parent.x + Math.cos(ang) * rad,
     z: parent.z + Math.sin(ang) * rad,
     crabRig: null, bipedRig: null, fishSpine: null, lizardSpine: null, rayRig: null, cyber: null,
     preyTarget: null,
     rank: clamp((parent.rank ?? 0.4) * 0.85, 0.04, 0.95),
     lifeStage: 'juvenile',
     growth: growInit,
     sizeScale: 0.60 + 0.40 * growInit,
     energy: 0.58,
     satiation: 0.35,
     stamina: 0.85,
     fatigue: 0.15,
     age: 0,
     reproEnergy: 0,
     fear: 0,
     captures: 0,
    };
    initAgentDrives(child);
    child.lifeStage = 'juvenile';
    child.growth = growInit;
    child.sizeScale = 0.60 + 0.40 * growInit;
    child.energy = 0.58;
    child.satiation = 0.35;
    child.age = 0;
    child.reproEnergy = 0;
    this._initAgentRig(child, activeLand);
    newBirths.push(child);
    return child;
   };

   const ctx = {
    time: t, land: activeLand, sea, wind, ecology,
    stimuli: this.stimuli,
    seaLevel, windSpd, windX, windZ,
    nearList,
    hoppers: this._flat.hoppers, moleCrabs: this._flat.moleCrabs, ghostCrabs: this._flat.ghostCrabs,
    fiddlers: this._flat.fiddlers, swimmingCrabs: this._flat.swimmingCrabs, scallops: this._flat.scallops,
    birds: this._flat.birds, raysAndSharks: this._flat.raysAndSharks, predatorsSea: this._flat.predatorsSea,
    fishSurface: this._flat.fishSurface, shrimp: this._flat.shrimp, snails: this._flat.snails,
    dunePrey: this._flat.dunePrey, dunePredators: this._flat.dunePredators, carcasses: this.carcasses,
    baitPodLists: this._baitPodLists,
    baitPods: this.baitPods, gnatClouds: this.gnatClouds, swaleBasins: this.swaleBasins,
    wrackDAt, wrackCenterFn: wrackCenter, alongWorldFn: (_land, x, z) => alongFromWorld(x, z),
    worldAtShoreFn: worldAtShore, waterHeightAtFn: waterHeightAt,
    consumePrey: (predator, prey, energyGain = 0.28) => {
     if (!prey || prey.isPlaced || prey.alive === false || (prey.visibility ?? 1) <= 0.05) return false;
     prey.alive = false;
     prey.visibility = 0;
     prey.deathCause = 'predation';
     predator.satiation = Math.min(1, (predator.satiation ?? 0.3) + energyGain);
     predator.energy = Math.min(1, predator.energy + energyGain * 0.35);
     predator.feedTimer = 1.05;
     predator.captures = (predator.captures || 0) + 1;
     ecology?.recordPredation?.(predator.guild, prey.guild, energyGain);
     return true;
    },
    scavengeCarcass: (scavenger, car, dtStep) => {
     if (!car || car.nutrition <= 0.01) return 0;
     const bite = Math.min(car.nutrition, dtStep * 0.22);
     car.nutrition = Math.max(0, car.nutrition - bite);
     scavenger.satiation = Math.min(1, (scavenger.satiation ?? 0.3) + bite);
     scavenger.energy = Math.min(1, scavenger.energy + bite * 0.35);
     scavenger.feedTimer = 0.5;
     ecology?.recordCarcassScavenge?.(bite);
     return bite;
    },
    onBirth: (parent) => {
     const ch = spawnJuvenileClone(parent, 0.22);
     if (ch) ecology?.recordBirth?.(parent.guild);
    },
    onDeath: (dead, cause) => {
     const bedAtDead = activeLand.height(dead.x, dead.z);
     const terrestrial = bedAtDead >= seaLevel - 0.02;
     ecology?.recordDeath?.(dead.guild, cause, terrestrial);
     if (terrestrial && cause !== 'predation' && this.carcasses.length < 24) {
      const supY = groundSupportHeight(activeLand, dead.x, dead.z, 0.04);
      this.carcasses.push({
       x: dead.x,
       y: supY + 0.008,
       z: dead.z,
       radius: clamp((dead.len || 0.08) * 0.55, 0.015, 0.18),
       nutrition: clamp((dead.len || 0.08) * 3.5, 0.25, 1.0),
       ttl: 120,
       color: dead.color ? [...dead.color] : [0.48, 0.42, 0.34],
      });
     }
    },
   };

   for (const a of this.agents) {
    if (a.alive === false) continue;
    if (!a.emerged) {
     a.visibility = Math.max(0, a.visibility - dt * 2.5);
     continue;
    }
    a.visibility = Math.min(1, a.visibility + dt * 2.5);
    a.phase += dt * (2.5 + 4.0 * (a.activity ?? 1));
    if(!a.carried)updateAgentAI(a, dt, ctx, false);
   }

   // Drive user-placed animal assets with the exact same AI, stimuli & IK locomotion
   for (const pl of this.placedLinks) {
    if (pl.gizmoDragged || physics) continue;
    pl.phase += dt * 3.0;
    pl.activity = guildActivity.get(pl.guild) ?? 1.0;
    pl.sectorIdx = Math.floor(alongFromWorld(pl.x, pl.z) / FAUNA_SECTOR_M);
    pl.band = activeLand.shoreDistance(pl.x, pl.z) > 170 ? 'bay' : 'gulf';
    updateAgentAI(pl, dt, ctx, true);
    const drift = Math.hypot(pl.x - pl.anchorX, pl.z - pl.anchorZ);
    if (drift > 4.2 && pl.alertStage !== 2) {
     pl.forageX = pl.anchorX;
     pl.forageZ = pl.anchorZ;
    }
   }

   // Prune dead agents, append births, decay carcasses, and run open-coast larval recruitment
   let hadDead = false;
   for (let i = 0; i < this.agents.length; i++) {
    if (this.agents[i].alive === false) { hadDead = true; break; }
   }
   if (hadDead) this.agents = this.agents.filter(a => a.alive !== false);
   if (newBirths.length) {
    for (let i = 0; i < newBirths.length; i++) this.agents.push(newBirths[i]);
   }
   for (let i = this.carcasses.length - 1; i >= 0; i--) {
    const car = this.carcasses[i];
    car.ttl -= dt;
    car.nutrition -= dt * 0.004;
    if (car.nutrition <= 0.01 || car.ttl <= 0) this.carcasses.splice(i, 1);
   }
   this._recruitClock += dt;
   if (this._recruitClock >= 6.0 && this.agents.length < 1800) {
    this._recruitClock -= 6.0;
    for (const secKey of this.loadedSectors) {
     if (!secKey.startsWith('gulf:')) continue;
     const templateMap = new Map();
     for (const a of this.agents) {
      if (a.sectorKey === secKey && !templateMap.has(a.speciesId)) templateMap.set(a.speciesId, a);
     }
     for (const [spId, rate] of spPerSectorMap) {
      const cKey = `${secKey}:${spId}`;
      const curN = secSpeciesCounts.get(cKey) || 0;
      const minFloor = Math.max(1, Math.floor(rate * 0.4));
      if (curN > 0 && curN < minFloor && templateMap.has(spId)) {
       const ch = spawnJuvenileClone(templateMap.get(spId), 0.35);
       if (ch) ecology?.recordBirth?.(ch.guild);
      }
     }
    }
    for (let i = 0; i < newBirths.length; i++) {
     if (!this.agents.includes(newBirths[i])) this.agents.push(newBirths[i]);
    }
   }
  }
 }

function pushSegment(out, x0, y0, z0, x1, y1, z1, radius, r, g, b, density, soft, uw, flatRatio = 1.0, rough = 0.42, metal = 0.0, trans = 0.0, bedClear = 0.05) {
 const ax = (x1 - x0) * 0.5, ay = (y1 - y0) * 0.5, az = (z1 - z0) * 0.5;
 const len = Math.hypot(ax, ay, az);
 if (len < 1e-5) return;
 // Orthonormal radial vector for cylindrical / paddle-flattened limb segment
 const ux = ax / len, uy = ay / len, uz = az / len;
 let sx = -uz, sy = 0, sz = ux;
 let sl = Math.hypot(sx, sz);
 if (sl < 1e-4) {
  sx = 0; sy = -uz; sz = uy;
  sl = Math.hypot(sy, sz) || 1;
 }
 sx = (sx / sl) * radius;
 sy = (sy / sl) * radius;
 sz = (sz / sl) * radius;
 pushEllipsoid(
  out,
  (x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5,
  ax, ay, az,
  sx, sy, sz,
  flatRatio,
  r, g, b,
  density, soft, uw,
  rough, metal, trans, bedClear
 );
}

function pushEllipsoid(out, cx, cy, cz, ax, ay, az, sx, sy, sz, thirdRatio, r, g, b, density, soft, underwater, rough = 0.42, metal = 0.0, trans = 0.0, bedClear = 0.05) {
 if (out.length >= MAX_FAUNA_ELLIPSOIDS) return;
 out.push({
  cx, cy, cz,
  ax, ay, az,
  sx, sy, sz,
  thirdRatio,
  r, g, b,
  density,
  soft,
  underwater,
  rough,
  metal,
  trans,
  bedClear,
 });
}

function pushSpanEllipsoid(out, ax, ay, az, bx, by, bz, sideX, sideY, sideZ, thirdRatio, r, g, b, density, soft, uw, rough = 0.42, metal = 0.0, trans = 0.0, bedClear = 0.05) {
 pushEllipsoid(
  out,
  (ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5,
  (bx - ax) * 0.5, (by - ay) * 0.5, (bz - az) * 0.5,
  sideX, sideY, sideZ,
  thirdRatio, r, g, b, density, soft, uw, rough, metal, trans, bedClear
 );
}

export function collectFaunaEllipsoids(sim, cameraPos = null, maxDist = 68, out = []) {
 out.length = 0;
 if (!sim?.agents?.length && !sim?.carcasses?.length) return out;
 const maxD2 = maxDist * maxDist;

 // Terrestrial scavenged carcasses returned to detritus/wrack cycle
 if (sim.carcasses?.length) {
  for (const car of sim.carcasses) {
   if (out.length >= MAX_FAUNA_ELLIPSOIDS) break;
   const dx = cameraPos ? car.x - cameraPos.x : 0;
   const dy = cameraPos ? car.y - cameraPos.y : 0;
   const dz = cameraPos ? car.z - cameraPos.z : 0;
   const dist2 = dx * dx + dy * dy + dz * dz;
   if (cameraPos && dist2 > maxD2) continue;
   const dist = Math.sqrt(dist2);
   const fade = dist > maxDist * 0.72 ? clamp(1 - (dist - maxDist * 0.72) / (maxDist * 0.28), 0, 1) : 1;
   if (fade <= 0.03) continue;
   const nut = clamp(car.nutrition ?? 0.5, 0.08, 1.0);
   const hl = Math.max(0.018, (car.len || 0.10) * 0.42 * (0.55 + 0.45 * nut));
   const hw = Math.max(0.014, (car.width || 0.07) * 0.42 * (0.55 + 0.45 * nut));
   const ht = Math.max(0.008, (car.height || 0.04) * 0.34 * (0.5 + 0.5 * nut));
   const col = car.color || [0.56, 0.52, 0.48];
   const yaw = car.yaw || 0;
   const cY = Math.cos(yaw), sY = Math.sin(yaw);
   pushEllipsoid(out, car.x, car.y + ht * 0.45, car.z, cY * hl, 0, sY * hl, -sY * hw, 0, cY * hw, ht / Math.max(1e-4, hw), col[0] * 0.82, col[1] * 0.78, col[2] * 0.74, (0.72 + 0.20 * nut) * fade, 0.22, 0.0, 0.78, 0.0, 0.0, 0.04);
   if (dist < 14) {
    pushEllipsoid(out, car.x - cY * hl * 0.25, car.y + ht * 0.65, car.z - sY * hl * 0.25, cY * hl * 0.45, 0, sY * hl * 0.45, -sY * hw * 0.55, 0, cY * hw * 0.55, 0.65, col[0] * 0.65, col[1] * 0.58, col[2] * 0.54, 0.68 * fade, 0.22, 0.0, 0.82, 0.0, 0.0, 0.02);
   }
  }
 }

 if (!sim?.agents?.length) return out;

 for (const rawA of sim.agents) {
  if (out.length >= MAX_FAUNA_ELLIPSOIDS) break;
  const vis = rawA.visibility ?? 1;
  // Still emit burrows for burrowed crabs within range!
  const dx = cameraPos ? rawA.x - cameraPos.x : 0;
  const dy = cameraPos ? rawA.y - cameraPos.y : 0;
  const dz = cameraPos ? rawA.z - cameraPos.z : 0;
  const dist2 = dx * dx + dy * dy + dz * dz;
  if (cameraPos && dist2 > maxD2) continue;
  const dist = Math.sqrt(dist2);
  const fade = dist > maxDist * 0.72 ? clamp(1 - (dist - maxDist * 0.72) / (maxDist * 0.28), 0, 1) : 1;

  // Excavated damp burrow rim for Ghost Crabs & Fiddler Crabs
  if ((rawA.speciesId === 'ghost-crab' || rawA.speciesId === 'fiddler-crab') && rawA.burrowX !== undefined) {
   const bdx = cameraPos ? rawA.burrowX - cameraPos.x : 0;
   const bdz = cameraPos ? rawA.burrowZ - cameraPos.z : 0;
   if (!cameraPos || (bdx * bdx + bdz * bdz) < (maxDist * 0.85) ** 2) {
    const br = rawA.burrowRadius || 0.03;
    const by = (rawA.burrowY ?? rawA.y) + 0.004;
    pushEllipsoid(out, rawA.burrowX, by, rawA.burrowZ, br * 1.32, 0, 0, 0, 0, br * 1.24, 0.14, 0.56, 0.49, 0.37, 0.72 * fade, 0.48, 0, 0.80, 0.0, 0.0, 0.02);
    pushEllipsoid(out, rawA.burrowX, by + 0.002, rawA.burrowZ, br * 0.72, 0, 0, 0, 0, br * 0.68, 0.18, 0.05, 0.04, 0.03, 0.92 * fade, 0.28, 0, 0.85, 0.0, 0.0, 0.01);
   }
  }

  if (vis <= 0.03 || fade <= 0.03) continue;
  const sc = rawA.sizeScale ?? 1;
  const a = (sc !== 1 && rawA.speciesId !== 'sand-gnat')
   ? {
      ...rawA,
      len: rawA.len * sc,
      width: rawA.width * sc,
      height: rawA.height * sc,
      wingSpan: (rawA.wingSpan || 0) * sc,
     }
   : rawA;
  const cosY = Math.cos(a.yaw), sinY = Math.sin(a.yaw);
  const fx = cosY, fz = sinY;
  const lx = -sinY, lz = cosY;
  const dens = vis * fade;
  const uw = (a.speciesId === 'blue-crab' || a.speciesId === 'speckled-crab' || a.speciesId === 'bay-scallop' || a.speciesId === 'atlantic-stingray' || a.speciesId === 'bonnethead-shark' || a.speciesId === 'baitfish' || a.speciesId === 'pompano' || a.speciesId === 'pinfish' || a.speciesId === 'grass-shrimp')
   ? 1.0
   : (a.speciesId === 'killifish' ? 0.35 : 0.0);
  const detailFull = !cameraPos || dist < 11;
  const detailMid = !cameraPos || dist < 24;

  if (a.speciesId === 'mole-crab') {
   const hl = a.len * 0.5, hw = a.width * 0.5, ht = a.height * 0.5;
   const mp = a.pitch || 0;
   const cp = Math.cos(mp), sp = Math.sin(mp);
   const pfx = fx * cp, pfy = sp, pfz = fz * cp;
   const ux = -fx * sp, uy = cp, uz = -fz * sp;
   // Domed egg-shaped sand carapace + cephalic anterior brow + tucked telson shield
   pushEllipsoid(out, a.x + pfx * hl * 0.06 + ux * ht * 0.08, a.y + pfy * hl * 0.06 + uy * ht * 0.08, a.z + pfz * hl * 0.06 + uz * ht * 0.08, pfx * hl * 0.94, pfy * hl * 0.94, pfz * hl * 0.94, lx * hw, 0, lz * hw, (ht * 0.95) / hw, a.color[0], a.color[1], a.color[2], 0.96 * dens, 0.08, 0, 0.24, 0.0, 0.10, 0.03);
   pushEllipsoid(out, a.x - pfx * hl * 0.54 - ux * ht * 0.08, a.y - pfy * hl * 0.54 - uy * ht * 0.08, a.z - pfz * hl * 0.54 - uz * ht * 0.08, pfx * hl * 0.44, pfy * hl * 0.44, pfz * hl * 0.44, lx * hw * 0.64, 0, lz * hw * 0.64, 0.58, a.accent[0], a.accent[1], a.accent[2], 0.93 * dens, 0.10, 0, 0.28, 0.0, 0.06, 0.02);
   if (detailFull) {
    pushEllipsoid(out, a.x + pfx * hl * 0.44 + ux * ht * 0.20, a.y + pfy * hl * 0.44 + uy * ht * 0.20, a.z + pfz * hl * 0.44 + uz * ht * 0.20, pfx * hl * 0.30, pfy * hl * 0.30, pfz * hl * 0.30, lx * hw * 0.76, 0, lz * hw * 0.76, 0.54, a.color[0] * 0.88, a.color[1] * 0.86, a.color[2] * 0.80, 0.92 * dens, 0.10, 0, 0.26, 0.0, 0.08, 0.04);
   }
   if (a.state === 'filter-feeding' && detailFull) {
    const antLen = a.len * 0.46;
    for (const s of [-1, 1]) {
     pushSegment(out, a.x + pfx * hl * 0.82 + lx * s * hw * 0.22, a.y + pfy * hl * 0.82 + uy * ht * 0.25, a.z + pfz * hl * 0.82 + lz * s * hw * 0.22, a.x + pfx * (hl + antLen * 0.85) + lx * s * hw * 0.76, a.y + pfy * (hl + antLen) + uy * antLen * 0.62, a.z + pfz * (hl + antLen * 0.85) + lz * s * hw * 0.76, hw * 0.16, 0.82, 0.78, 0.66, 0.82 * dens, 0.24, 0, 0.55, 0.40, 0.0, 0.30, 0.06);
    }
   }
   continue;
  }

  if (a.speciesId === 'beach-hopper') {
   const hl = a.len * 0.5, hw = a.width * 0.5, ht = a.height * 0.5;
   const bp = a.airY > 0.01 ? clamp(a.airPitch ?? a.pitch ?? 0.28, -0.9, 0.9) : 0;
   const arch = a.airY > 0.01 ? 0.38 : 0.22;
   // Cohesive curved amphipod pereon + dorsal mid-tergite + flexed pleon/telson
   pushEllipsoid(out, a.x + fx * hl * 0.34, a.y + ht * 0.26 + bp * hl * 0.18, a.z + fz * hl * 0.34, fx * hl * 0.48, hl * (arch * 0.8 + bp * 0.42), fz * hl * 0.48, lx * hw * 0.92, 0, lz * hw * 0.92, (ht * 0.88) / (hw * 0.92), a.color[0], a.color[1], a.color[2], 0.94 * dens, 0.09, 0, 0.26, 0.0, 0.20, 0.04);
   pushEllipsoid(out, a.x - fx * hl * 0.06, a.y + ht * 0.24, a.z - fz * hl * 0.06, fx * hl * 0.46, 0, fz * hl * 0.46, lx * hw * 0.96, 0, lz * hw * 0.96, (ht * 0.86) / (hw * 0.96), mixRGB(a.color, a.accent, 0.45)[0], mixRGB(a.color, a.accent, 0.45)[1], mixRGB(a.color, a.accent, 0.45)[2], 0.93 * dens, 0.10, 0, 0.26, 0.0, 0.18, 0.04);
   pushEllipsoid(out, a.x - fx * hl * 0.46, a.y - ht * 0.04 - bp * hl * 0.10, a.z - fz * hl * 0.46, fx * hl * 0.44, -hl * (arch * 0.85 - bp * 0.25), fz * hl * 0.44, lx * hw * 0.78, 0, lz * hw * 0.78, (ht * 0.72) / (hw * 0.78), a.accent[0], a.accent[1], a.accent[2], 0.91 * dens, 0.10, 0, 0.28, 0.0, 0.16, 0.03);
   if (detailFull) {
    for (const s of [-1, 1]) {
     pushEllipsoid(out, a.x + fx * hl * 0.68 + lx * s * hw * 0.58, a.y + ht * 0.42 + bp * hl * 0.3, a.z + fz * hl * 0.68 + lz * s * hw * 0.58, fx * hw * 0.26, 0, fz * hw * 0.26, lx * hw * 0.24, 0, lz * hw * 0.24, 0.9, 0.04, 0.04, 0.045, 0.97 * dens, 0.08, 0, 0.14, 0.0, 0.0, 0.04);
     pushSegment(out, a.x + fx * hl * 0.72 + lx * s * hw * 0.30, a.y + ht * 0.30, a.z + fz * hl * 0.72 + lz * s * hw * 0.30, a.x + fx * hl * 1.46 + lx * s * hw * 0.92, a.y + ht * 0.88 + bp * hl * 0.42, a.z + fz * hl * 1.46 + lz * s * hw * 0.92, hw * 0.15, 0.68, 0.36, 0.24, 0.86 * dens, 0.18, 0, 0.7, 0.30, 0.0, 0.08, 0.05);
    }
   }
   continue;
  }

  if (a.speciesId === 'ghost-crab' || a.speciesId === 'fiddler-crab') {
   const isFiddler = a.speciesId === 'fiddler-crab';
   const hl = a.len * 0.5, hw = a.width * 0.5, ht = a.height * 0.5;
   const tiltP = a.pitch || 0, tiltR = a.roll || 0;
   const shellTrans = isFiddler ? 0.06 : 0.14;
   // Sculpted quadrate carapace: main thoracic shield + paired anterior brow angles + branchial shoulders
   pushEllipsoid(out, a.x, a.y, a.z, lx * hw, tiltR * hw, lz * hw, fx * hl, tiltP * hl, fz * hl, ht / hl, a.color[0], a.color[1], a.color[2], 0.98 * dens, 0.07, 0, 0.26, 0.0, shellTrans, 0.05);
   if (detailFull) {
    pushEllipsoid(out, a.x + fx * hl * 0.38, a.y + tiltP * hl * 0.38 + ht * 0.14, a.z + fz * hl * 0.38, lx * hw * 0.96, tiltR * hw * 0.94, lz * hw * 0.96, fx * hl * 0.48, tiltP * hl * 0.48, fz * hl * 0.48, (ht * 0.68) / (hl * 0.48), a.color[0] * 0.96, a.color[1] * 0.94, a.color[2] * 0.90, 0.96 * dens, 0.08, 0, 0.28, 0.0, shellTrans, 0.05);
    pushEllipsoid(out, a.x - fx * hl * 0.10, a.y + ht * 0.56, a.z - fz * hl * 0.10, lx * hw * 0.68, tiltR * hw * 0.68, lz * hw * 0.68, fx * hl * 0.56, tiltP * hl * 0.56, fz * hl * 0.56, 0.32, a.color[0] * 0.80, a.color[1] * 0.77, a.color[2] * 0.72, 0.93 * dens, 0.10, 0, 0.32, 0.0, shellTrans, 0.06);
   }

   if (detailFull && a.crabRig) {
    const legs = a.crabRig.legs;
    const legR = Math.max(0.0018, hw * 0.14);
    for (let i = 0; i < legs.length; i++) {
     const leg = legs[i];
     pushSegment(out, leg.hipX, leg.hipY, leg.hipZ, leg.kneeX, leg.kneeY, leg.kneeZ, legR * 1.18, a.color[0] * 0.90, a.color[1] * 0.86, a.color[2] * 0.80, 0.96 * dens, 0.08, 0, 0.88, 0.32, 0.0, shellTrans, 0.04);
     pushSegment(out, leg.kneeX, leg.kneeY, leg.kneeZ, leg.footX, leg.footY, leg.footZ, legR * 0.80, a.color[0] * 0.72, a.color[1] * 0.68, a.color[2] * 0.62, 0.95 * dens, 0.09, 0, 0.88, 0.36, 0.0, shellTrans, 0.02);
    }
    const claws = a.crabRig.claws;
    for (let c = 0; c < claws.length; c++) {
     const cl = claws[c];
     const isMaj = isFiddler && a.sex === 'M' && ((a.clawRight ? 1 : -1) === cl.side);
     const cr = isMaj ? a.width * 0.20 : hw * 0.22;
     const col = isMaj ? a.accent : a.color;
     pushSegment(out, cl.shX, cl.shY, cl.shZ, cl.elX, cl.elY, cl.elZ, cr * 0.78, col[0], col[1], col[2], 0.97 * dens, 0.08, 0, 0.85, 0.28, 0.0, 0.04, 0.04);
     const dx = cl.tipX - cl.elX, dy = cl.tipY - cl.elY, dz = cl.tipZ - cl.elZ;
     const openLift = (cl.open || 0.14) * cr * 2.1;
     pushSegment(out, cl.elX, cl.elY, cl.elZ, cl.tipX, cl.tipY - openLift * 0.25, cl.tipZ, isMaj ? cr * 1.18 : cr * 0.90, a.accent[0], a.accent[1], a.accent[2], 0.98 * dens, 0.07, 0, 0.68, 0.24, 0.0, 0.02, 0.05);
     pushSegment(out, cl.elX + dx * 0.35, cl.elY + dy * 0.35 + cr * 0.32, cl.elZ + dz * 0.35, cl.tipX + dx * 0.08, cl.tipY + openLift, cl.tipZ + dz * 0.08, isMaj ? cr * 0.56 : cr * 0.44, 0.94, 0.91, 0.84, 0.97 * dens, 0.08, 0, 0.75, 0.22, 0.0, 0.02, 0.06);
    }
    const eyeRaise = a.alertStage === 1 ? 1.55 : 1.22;
    for (const s of [-1, 1]) {
     const ex = a.x + fx * hl * 0.68 + lx * s * hw * 0.38;
     const ez = a.z + fz * hl * 0.68 + lz * s * hw * 0.38;
     pushEllipsoid(out, ex, a.y + ht * (eyeRaise * 0.78), ez, 0, ht * 0.50, 0, lx * hw * 0.10, 0, lz * hw * 0.10, 0.9, a.color[0] * 0.85, a.color[1] * 0.82, a.color[2] * 0.78, 0.96 * dens, 0.08, 0, 0.26, 0.0, 0.0, 0.07);
     pushEllipsoid(out, ex, a.y + ht * (eyeRaise * 1.12), ez, 0, ht * 0.24, 0, lx * hw * 0.15, 0, lz * hw * 0.15, 0.95, 0.03, 0.03, 0.04, 0.98 * dens, 0.07, 0, 0.10, 0.0, 0.0, 0.09);
    }
   } else if (detailMid) {
    for (const s of [-1, 1]) {
     const legSpan = a.width * 0.65;
     pushEllipsoid(out, a.x + lx * s * (hw + legSpan * 0.42), a.y - ht * 0.22, a.z + lz * s * (hw + legSpan * 0.42), lx * s * legSpan * 0.5, -ht * 0.45, lz * s * legSpan * 0.5, fx * hl * 0.68, 0, fz * hl * 0.68, 0.25, a.color[0] * 0.85, a.color[1] * 0.82, a.color[2] * 0.78, 0.92 * dens, 0.10, 0, 0.32, 0.0, shellTrans, 0.03);
    }
   }
   continue;
  }

  if (a.speciesId === 'blue-crab' || a.speciesId === 'speckled-crab') {
   const isBlue = a.speciesId === 'blue-crab';
   const hl = a.len * 0.5, hw = a.width * 0.5, ht = a.height * 0.5;
   const tiltP = a.pitch || 0, tiltR = a.roll || 0;
   // Sculpted fusiform kite carapace: central dome + swept antero-lateral carapace wings into white spines + tapered posterior apron (zero underwater soft edges)
   pushEllipsoid(out, a.x + fx * hl * 0.06, a.y, a.z + fz * hl * 0.06, lx * hw * (isBlue ? 0.84 : 0.92), tiltR * hw * 0.84, lz * hw * (isBlue ? 0.84 : 0.92), fx * hl * 0.92, tiltP * hl * 0.92, fz * hl * 0.92, ht / (hl * 0.92), a.color[0], a.color[1], a.color[2], 0.97 * dens, 0.06, uw, 0.20, 0.0, 0.0, 0.05);
   pushEllipsoid(out, a.x - fx * hl * 0.42, a.y - ht * 0.06, a.z - fz * hl * 0.42, lx * hw * 0.58, tiltR * hw * 0.58, lz * hw * 0.58, fx * hl * 0.48, tiltP * hl * 0.48, fz * hl * 0.48, (ht * 0.72) / (hl * 0.48), a.color[0] * 0.92, a.color[1] * 0.92, a.color[2] * 0.90, 0.96 * dens, 0.07, uw, 0.22, 0.0, 0.0, 0.04);
   if (detailFull) {
    for (const s of [-1, 1]) {
     // Continuous serrated antero-lateral carapace wing bridging into Callinectes lateral spine
     pushSpanEllipsoid(out, a.x + fx * hl * 0.36 + lx * s * hw * 0.22, a.y + tiltR * s * hw * 0.22, a.z + fz * hl * 0.36 + lz * s * hw * 0.22, a.x - fx * hl * 0.02 + lx * s * hw * (isBlue ? 1.24 : 1.06), a.y + tiltR * s * hw * 0.96 - ht * 0.05, a.z - fz * hl * 0.02 + lz * s * hw * (isBlue ? 1.24 : 1.06), fx * hl * (isBlue ? 0.26 : 0.34), tiltP * hl * 0.26, fz * hl * (isBlue ? 0.26 : 0.34), (ht * 0.44) / (hl * 0.26), isBlue ? 0.80 : a.color[0] * 0.94, isBlue ? 0.80 : a.color[1] * 0.94, isBlue ? 0.75 : a.color[2] * 0.92, 0.96 * dens, 0.06, uw, 0.22, 0.0, 0.0, 0.06);
     pushEllipsoid(out, a.x + fx * hl * 0.86 + lx * s * hw * 0.24, a.y + ht * 0.56, a.z + fz * hl * 0.86 + lz * s * hw * 0.24, fx * hw * 0.08, 0, fz * hw * 0.08, lx * hw * 0.08, 0, lz * hw * 0.08, 0.9, 0.04, 0.04, 0.04, 0.97 * dens, 0.06, uw, 0.12, 0.0, 0.0, 0.07);
    }
    if (!isBlue) {
     for (const [ox, oz] of [[-0.40, 0.14], [0.40, 0.14], [0, -0.18], [-0.24, -0.34], [0.24, -0.34]]) {
      pushEllipsoid(out, a.x + lx * ox * hw + fx * oz * hl, a.y + ht * 0.72, a.z + lz * ox * hw + fz * oz * hl, lx * hw * 0.15, 0, lz * hw * 0.15, fx * hl * 0.15, 0, fz * hl * 0.15, 0.35, 0.88, 0.84, 0.72, 0.94 * dens, 0.07, uw, 0.24, 0.0, 0.0, 0.06);
     }
    }
   }

   if (detailFull && a.crabRig) {
    const legs = a.crabRig.legs;
    const legR = hw * 0.095;
    for (let i = 0; i < legs.length; i++) {
     const leg = legs[i];
     pushSegment(out, leg.hipX, leg.hipY, leg.hipZ, leg.kneeX, leg.kneeY, leg.kneeZ, legR, a.accent[0], a.accent[1], a.accent[2], 0.95 * dens, 0.07, uw, 0.9, 0.24, 0.0, 0.0, 0.04);
     pushSegment(out, leg.kneeX, leg.kneeY, leg.kneeZ, leg.footX, leg.footY, leg.footZ, leg.isPaddle ? legR * 1.95 : legR * 0.76, a.accent[0], a.accent[1], a.accent[2], 0.95 * dens, 0.07, uw, leg.isPaddle ? 0.32 : 0.92, 0.22, 0.0, 0.0, 0.03);
    }
    const claws = a.crabRig.claws;
    for (let c = 0; c < claws.length; c++) {
     const cl = claws[c];
     pushSegment(out, cl.shX, cl.shY, cl.shZ, cl.elX, cl.elY, cl.elZ, hw * 0.13, a.accent[0], a.accent[1], a.accent[2], 0.96 * dens, 0.07, uw, 0.88, 0.22, 0.0, 0.0, 0.04);
     const dx = cl.tipX - cl.elX, dy = cl.tipY - cl.elY, dz = cl.tipZ - cl.elZ;
     const openLift = (cl.open || 0.14) * hw * 0.22;
     pushSegment(out, cl.elX, cl.elY, cl.elZ, cl.tipX, cl.tipY - openLift * 0.2, cl.tipZ, hw * 0.11, a.clawTip[0], a.clawTip[1], a.clawTip[2], 0.97 * dens, 0.06, uw, 0.78, 0.20, 0.0, 0.0, 0.05);
     pushSegment(out, cl.elX + dx * 0.38, cl.elY + dy * 0.38 + hw * 0.05, cl.elZ + dz * 0.38, cl.tipX + dx * 0.05, cl.tipY + openLift, cl.tipZ + dz * 0.05, hw * 0.065, a.clawTip[0] * 0.95, a.clawTip[1] * 0.95, a.clawTip[2] * 0.95, 0.96 * dens, 0.06, uw, 0.78, 0.20, 0.0, 0.0, 0.06);
    }
   } else {
    for (const s of [-1, 1]) {
     pushEllipsoid(out, a.x + lx * s * hw * 0.72 + fx * hl * 0.92, a.y, a.z + lz * s * hw * 0.72 + fz * hl * 0.92, fx * hl * 0.65 + lx * s * hl * 0.35, 0, fz * hl * 0.65 + lz * s * hl * 0.35, lx * hw * 0.14, 0, lz * hw * 0.14, 0.8, a.accent[0], a.accent[1], a.accent[2], 0.96 * dens, 0.07, uw, 0.24, 0.0, 0.0, 0.04);
    }
   }
   continue;
  }

  if (a.speciesId === 'sand-gnat') {
   const hl = a.len * 0.5, hw = a.width * 0.5, ht = a.height * 0.5;
   const ws = a.wingSpan * 0.5;
   pushEllipsoid(out, a.x, a.y, a.z, fx * hl, 0, fz * hl, lx * hw, 0, lz * hw, ht / hw, a.color[0], a.color[1], a.color[2], 0.96 * dens, 0.14, 0, 0.30, 0.0, 0.0, 0.08);
   if (!cameraPos || dist < 5.5) {
    const flutter = Math.sin(a.phase * 18.0 + a.id) * 0.42;
    pushEllipsoid(out, a.x, a.y + ht * 0.75, a.z, lx * ws, ws * flutter, lz * ws, fx * hl * 0.68, 0, fz * hl * 0.68, 0.22, a.accent[0], a.accent[1], a.accent[2], 0.58 * dens, 0.56, 0, 0.22, 0.08, 0.62, 0.10);
   }
   continue;
  }

  if (a.speciesId === 'kelp-fly') {
   const hl = a.len * 0.5, hw = a.width * 0.5, ht = a.height * 0.5;
   const ws = a.wingSpan * 0.5;
   pushEllipsoid(out, a.x - fx * hl * 0.32, a.y, a.z - fz * hl * 0.32, fx * hl * 0.68, 0, fz * hl * 0.68, lx * hw * 0.96, 0, lz * hw * 0.96, ht / hw, a.color[0] * 0.88, a.color[1] * 0.86, a.color[2] * 0.80, 0.96 * dens, 0.09, 0, 0.28, 0.12, 0.0, 0.06);
   pushEllipsoid(out, a.x + fx * hl * 0.45, a.y + ht * 0.14, a.z + fz * hl * 0.45, fx * hl * 0.42, 0, fz * hl * 0.42, lx * hw * 1.12, 0, lz * hw * 1.12, 0.92, a.color[0], a.color[1], a.color[2], 0.96 * dens, 0.08, 0, 0.24, 0.16, 0.0, 0.07);
   if (detailFull) {
    pushEllipsoid(out, a.x + fx * hl * 0.88, a.y + ht * 0.26, a.z + fz * hl * 0.88, fx * hw * 0.72, 0, fz * hw * 0.72, lx * hw * 0.98, 0, lz * hw * 0.98, 0.85, 0.48, 0.18, 0.08, 0.97 * dens, 0.08, 0, 0.14, 0.0, 0.0, 0.08);
   }
   const flutter = Math.sin(a.phase * 14.0) * 0.35;
   for (const s of [-1, 1]) {
    pushSpanEllipsoid(out, a.x + fx * hl * 0.10, a.y + ht * 0.65, a.z + fz * hl * 0.10, a.x - fx * hl * 0.42 + lx * s * ws, a.y + ht * 0.65 + ws * flutter, a.z - fz * hl * 0.42 + lz * s * ws, fx * hl * 0.64, 0, fz * hl * 0.64, 0.20, a.accent[0], a.accent[1], a.accent[2], 0.62 * dens, 0.56, 0, 0.20, 0.10, 0.58, 0.10);
   }
   continue;
  }

  if (a.speciesId === 'bay-scallop') {
   const hl = a.len * 0.5, hw = a.width * 0.5, ht = a.height * 0.5;
   const gape = a.valveGape ?? 0.18;
   const lift = Math.sin(clamp(gape, 0.03, 0.58) * 0.95) * hl * 0.72;
   // Posterior hinge ears + cupped lower cream valve + upper valve hinged strictly at -fx * hl * 0.68
   pushEllipsoid(out, a.x - fx * hl * 0.72, a.y - ht * 0.08, a.z - fz * hl * 0.72, fx * hl * 0.20, 0, fz * hl * 0.20, lx * hw * 0.68, 0, lz * hw * 0.68, 0.58, a.accent[0] * 0.92, a.accent[1] * 0.90, a.accent[2] * 0.85, 0.97 * dens, 0.06, uw, 0.34, 0.0, 0.0, 0.02);
   pushEllipsoid(out, a.x + fx * hl * 0.06, a.y - ht * 0.16, a.z + fz * hl * 0.06, fx * hl * 0.92, 0, fz * hl * 0.92, lx * hw, 0, lz * hw, (ht * 0.62) / hw, a.accent[0], a.accent[1], a.accent[2], 0.97 * dens, 0.06, uw, 0.34, 0.0, 0.0, 0.02);
   // Upper valve pivots smoothly from posterior hinge (-0.72*hl) so hinge stays seated even when swimming
   pushSpanEllipsoid(out, a.x - fx * hl * 0.76, a.y + ht * 0.06, a.z - fz * hl * 0.76, a.x + fx * hl * 0.94, a.y + ht * 0.18 + lift, a.z + fz * hl * 0.94, lx * hw, 0, lz * hw, (ht * 0.56) / hw, a.color[0], a.color[1], a.color[2], 0.98 * dens, 0.06, uw, 0.36, 0.0, 0.0, 0.04);
   if (detailFull) {
    pushEllipsoid(out, a.x - fx * hl * 0.30, a.y + ht * 0.44 + lift * 0.25, a.z - fz * hl * 0.30, fx * hl * 0.52, lift * 0.28, fz * hl * 0.52, lx * hw * 0.66, 0, lz * hw * 0.66, 0.42, a.color[0] * 0.86, a.color[1] * 0.84, a.color[2] * 0.82, 0.97 * dens, 0.06, uw, 0.34, 0.0, 0.0, 0.04);
    if (gape > 0.12) {
     pushEllipsoid(out, a.x + fx * hl * 0.58, a.y + lift * 0.34, a.z + fz * hl * 0.58, fx * hl * 0.22, 0, fz * hl * 0.22, lx * hw * 0.72, 0, lz * hw * 0.72, 0.36, 0.76, 0.44, 0.24, 0.94 * dens, 0.08, uw, 0.36, 0.0, 0.0, 0.05);
     for (const s of [-0.62, -0.31, 0, 0.31, 0.62]) {
      const ang = s * 0.72;
      const ex = a.x + fx * hl * (0.86 * Math.cos(ang)) + lx * (hw * 0.86 * Math.sin(ang));
      const ez = a.z + fz * hl * (0.86 * Math.cos(ang)) + lz * (hw * 0.86 * Math.sin(ang));
      pushEllipsoid(out, ex, a.y + lift * 0.52, ez, fx * hl * 0.09, 0, fz * hl * 0.09, lx * hw * 0.09, 0, lz * hw * 0.09, 0.9, 0.10, 0.54, 0.96, 0.97 * dens, 0.06, uw, 0.12, 0.28, 0.0, 0.06);
     }
    }
   }
   continue;
  }

  if (a.speciesId === 'sanderling') {
   const hl = a.len * 0.5, hw = a.width * 0.5, ht = a.height * 0.5;
   const ws = (a.wingSpan || a.len * 1.95) * 0.5;
   const pitch = a.pitch || 0;
   const np = a.bipedRig?.neckPitch || 0;
   const flap = a.bipedRig?.wingFlap || 0;
   const outerFlap = a.bipedRig?.wingOuterFlap ?? flap;
   // Teardrop breast + back + neck bridge + rump + tail + head + bill
   pushEllipsoid(out, a.x + fx * hl * 0.14, a.y - ht * 0.04 - pitch * hl * 0.12, a.z + fz * hl * 0.14, fx * hl * 0.72, -pitch * hl * 0.32, fz * hl * 0.72, lx * hw, 0, lz * hw, (ht * 0.88) / hw, a.accent[0], a.accent[1], a.accent[2], 0.97 * dens, 0.07, 0, 0.52, 0.0, 0.0, 0.05);
   pushEllipsoid(out, a.x - fx * hl * 0.08, a.y + ht * 0.26, a.z - fz * hl * 0.08, fx * hl * 0.72, -pitch * hl * 0.24, fz * hl * 0.72, lx * hw * 0.92, 0, lz * hw * 0.92, (ht * 0.68) / (hw * 0.92), a.color[0], a.color[1], a.color[2], 0.97 * dens, 0.07, 0, 0.50, 0.0, 0.0, 0.06);
   pushEllipsoid(out, a.x - fx * hl * 0.80, a.y + ht * 0.10 + pitch * hl * 0.22, a.z - fz * hl * 0.80, fx * hl * 0.36, 0, fz * hl * 0.36, lx * hw * 0.44, 0, lz * hw * 0.44, 0.38, a.accent[0], a.accent[1], a.accent[2], 0.95 * dens, 0.08, 0, 0.52, 0.0, 0.0, 0.05);
   const hx = a.x + fx * hl * 0.70, hy = a.y + ht * (0.48 - np * 0.52) - pitch * hl * 0.34, hz = a.z + fz * hl * 0.70;
   pushSpanEllipsoid(out, a.x + fx * hl * 0.42, a.y + ht * 0.18 - pitch * hl * 0.20, a.z + fz * hl * 0.42, hx, hy, hz, lx * hw * 0.58, 0, lz * hw * 0.58, 0.85, a.accent[0] * 0.95, a.accent[1] * 0.93, a.accent[2] * 0.90, 0.97 * dens, 0.07, 0, 0.52, 0.0, 0.0, 0.07);
   pushEllipsoid(out, hx, hy, hz, fx * hw * 0.72, -np * hw * 0.35, fz * hw * 0.72, lx * hw * 0.65, 0, lz * hw * 0.65, 0.92, a.accent[0] * 0.94, a.accent[1] * 0.92, a.accent[2] * 0.88, 0.97 * dens, 0.07, 0, 0.52, 0.0, 0.0, 0.07);
   if (detailFull) {
    pushEllipsoid(out, hx - fx * hw * 0.04, hy + hw * 0.36, hz - fz * hw * 0.04, fx * hw * 0.56, 0, fz * hw * 0.56, lx * hw * 0.44, 0, lz * hw * 0.44, 0.52, a.color[0] * 0.88, a.color[1] * 0.86, a.color[2] * 0.82, 0.95 * dens, 0.08, 0, 0.50, 0.0, 0.0, 0.08);
    for (const s of [-1, 1]) {
     pushEllipsoid(out, hx + fx * hw * 0.24 + lx * s * hw * 0.46, hy + hw * 0.14, hz + fz * hw * 0.24 + lz * s * hw * 0.46, fx * hw * 0.12, 0, fz * hw * 0.12, lx * hw * 0.12, 0, lz * hw * 0.12, 0.9, 0.03, 0.03, 0.03, 0.98 * dens, 0.06, 0, 0.12, 0.0, 0.0, 0.08);
    }
   }
   pushSegment(out, hx + fx * hw * 0.48, hy - 0.003, hz + fz * hw * 0.48, hx + fx * hw * 1.50, hy - np * hl * 0.40 - 0.005, hz + fz * hw * 1.50, 0.0030, 0.05, 0.05, 0.05, 0.97 * dens, 0.06, 0, 0.88, 0.28, 0.0, 0.0, 0.06);
   if (a.airborne) {
    const iw = ws * 0.50, ow = ws * 0.48;
    for (const s of [-1, 1]) {
     const shX = a.x + lx * s * hw * 0.55 + fx * hl * 0.06, shY = a.y + ht * 0.22, shZ = a.z + lz * s * hw * 0.55 + fz * hl * 0.06;
     const wrX = a.x + lx * s * iw + fx * hw * 0.28, wrY = shY + flap * ws * 0.42, wrZ = a.z + lz * s * iw + fz * hw * 0.28;
     const tipX = a.x + lx * s * (iw + ow) - fx * hw * 0.88, tipY = shY + outerFlap * ws * 0.72, tipZ = a.z + lz * s * (iw + ow) - fz * hw * 0.88;
     pushSpanEllipsoid(out, shX, shY, shZ, wrX, wrY, wrZ, fx * hw * 1.18, 0, fz * hw * 1.18, 0.17, a.color[0], a.color[1], a.color[2], 0.96 * dens, 0.07, 0, 0.48, 0.0, 0.0, 0.12);
     pushSpanEllipsoid(out, wrX, wrY, wrZ, tipX, tipY, tipZ, fx * hw * 0.72, 0, fz * hw * 0.72, 0.17, 0.18, 0.17, 0.16, 0.96 * dens, 0.07, 0, 0.50, 0.0, 0.0, 0.14);
    }
   } else if (detailMid && a.bipedRig?.legs) {
    for (const s of [-1, 1]) {
     pushEllipsoid(out, a.x - fx * hl * 0.22 + lx * s * hw * 0.70, a.y + ht * 0.12, a.z - fz * hl * 0.22 + lz * s * hw * 0.70, fx * hl * 0.62, -0.008, fz * hl * 0.62, lx * hw * 0.24, 0, lz * hw * 0.24, 0.55, a.color[0] * 0.76, a.color[1] * 0.74, a.color[2] * 0.72, 0.95 * dens, 0.07, 0, 0.50, 0.0, 0.0, 0.06);
    }
    for (const leg of a.bipedRig.legs) {
     pushSegment(out, leg.hipX, leg.hipY, leg.hipZ, leg.kneeX, leg.kneeY, leg.kneeZ, 0.0034, 0.055, 0.055, 0.055, 0.96 * dens, 0.07, 0, 0.9, 0.36, 0.0, 0.0, 0.03);
     pushSegment(out, leg.kneeX, leg.kneeY, leg.kneeZ, leg.footX, leg.footY, leg.footZ, 0.0026, 0.045, 0.045, 0.045, 0.96 * dens, 0.07, 0, 0.9, 0.38, 0.0, 0.0, 0.01);
    }
   }
   continue;
  }

  if (a.speciesId === 'laughing-gull' || a.speciesId === 'royal-tern') {
   const isTern = a.speciesId === 'royal-tern';
   const hl = a.len * 0.5, hw = a.width * 0.5, ht = a.height * 0.5;
   const ws = (a.wingSpan || a.len * 2.75) * 0.5;
   const flap = a.bipedRig?.wingFlap || 0;
   const outerFlap = a.bipedRig?.wingOuterFlap ?? flap;
   const np = a.bipedRig?.neckPitch || 0;
   const roll = a.roll || 0;
   const pitch = a.pitch || 0;
   if (!isTern && a.hasNest && (!cameraPos || dist < 34)) {
    const ny = a.nestY ?? (a.bedY ?? a.y);
    pushEllipsoid(out, a.nestX ?? a.x, ny + 0.004, a.nestZ ?? a.z, hl * 1.15, 0, 0, 0, 0, hl * 1.10, 0.14, 0.62, 0.56, 0.44, 0.85 * dens, 0.50, 0, 0.72, 0.0, 0.0, 0.01);
   }
   // Continuous streamlined coastal larid torso: deep chest keel -> mid fuselage -> grey dorsal mantle -> tapered undertail/tail
   pushEllipsoid(out, a.x + fx * hl * 0.26, a.y - ht * 0.04 - pitch * hl * 0.22, a.z + fz * hl * 0.26, fx * hl * 0.58, -pitch * hl * 0.44, fz * hl * 0.58, lx * hw * 0.96, roll * hw * 0.96, lz * hw * 0.96, (ht * 0.92) / (hw * 0.96), a.accent[0], a.accent[1], a.accent[2], 0.98 * dens, 0.06, 0, 0.48, 0.0, 0.0, 0.06);
   pushEllipsoid(out, a.x - fx * hl * 0.14, a.y - ht * 0.02 + pitch * hl * 0.08, a.z - fz * hl * 0.14, fx * hl * 0.70, -pitch * hl * 0.42, fz * hl * 0.70, lx * hw * 0.90, roll * hw * 0.90, lz * hw * 0.90, (ht * 0.80) / (hw * 0.90), a.accent[0], a.accent[1], a.accent[2], 0.97 * dens, 0.06, 0, 0.50, 0.0, 0.0, 0.06);
   pushEllipsoid(out, a.x - fx * hl * 0.04, a.y + ht * 0.28 - pitch * hl * 0.04, a.z - fz * hl * 0.04, fx * hl * 0.72, -pitch * hl * 0.36, fz * hl * 0.72, lx * hw * 0.90, roll * hw * 0.90, lz * hw * 0.90, (ht * 0.60) / (hw * 0.90), a.color[0], a.color[1], a.color[2], 0.97 * dens, 0.06, 0, 0.48, 0.0, 0.0, 0.08);
   if (isTern) {
    for (const s of [-1, 1]) {
     pushSpanEllipsoid(out, a.x - fx * hl * 0.68, a.y + ht * 0.06 + pitch * hl * 0.28, a.z - fz * hl * 0.68, a.x - fx * hl * 1.54 + lx * s * hw * 0.46, a.y + ht * 0.10 + pitch * hl * 0.42, a.z - fz * hl * 1.54 + lz * s * hw * 0.46, lx * hw * 0.18, 0, lz * hw * 0.18, 0.32, a.accent[0], a.accent[1], a.accent[2], 0.96 * dens, 0.07, 0, 0.50, 0.0, 0.0, 0.07);
    }
   } else {
    pushSpanEllipsoid(out, a.x - fx * hl * 0.58, a.y + ht * 0.05 + pitch * hl * 0.22, a.z - fz * hl * 0.58, a.x - fx * hl * 1.28, a.y + ht * 0.07 + pitch * hl * 0.36, a.z - fz * hl * 1.28, lx * hw * 0.66, roll * hw * 0.4, lz * hw * 0.66, 0.24, a.accent[0], a.accent[1], a.accent[2], 0.96 * dens, 0.07, 0, 0.50, 0.0, 0.0, 0.07);
   }
   // Continuous S-curved neck bridging chest/mantle smoothly to head + facial bridge + two-segment tapered bill
   const hYaw = a.headYaw || 0;
   const hfx = Math.cos(a.yaw + hYaw), hfz = Math.sin(a.yaw + hYaw);
   const hlx = -hfz, hlz = hfx;
   const shBaseX = a.x + fx * hl * 0.56, shBaseY = a.y + ht * 0.20 - pitch * hl * 0.30, shBaseZ = a.z + fz * hl * 0.56;
   const hx = a.x + fx * hl * 0.86, hy = a.y + ht * (0.56 - np * 0.44) - pitch * hl * 0.40, hz = a.z + fz * hl * 0.86;
   const headCol = isTern ? [0.96, 0.96, 0.95] : [0.06, 0.06, 0.07];
   pushSpanEllipsoid(out, shBaseX, shBaseY, shBaseZ, hx - hfx * hw * 0.16, hy - hw * 0.12, hz - hfz * hw * 0.16, lx * hw * 0.62, 0, lz * hw * 0.62, 0.86, a.accent[0], a.accent[1], a.accent[2], 0.97 * dens, 0.06, 0, 0.48, 0.0, 0.0, 0.07);
   pushEllipsoid(out, hx, hy, hz, hfx * hw * 0.72, -np * hw * 0.24, hfz * hw * 0.72, hlx * hw * 0.62, 0, hlz * hw * 0.62, 0.88, headCol[0], headCol[1], headCol[2], 0.98 * dens, 0.06, 0, 0.46, 0.0, 0.0, 0.09);
   if (detailFull) {
    pushEllipsoid(out, hx + hfx * hw * 0.48, hy - hw * 0.08, hz + hfz * hw * 0.48, hfx * hw * 0.38, -hw * 0.06, hfz * hw * 0.38, hlx * hw * 0.40, 0, hlz * hw * 0.40, 0.78, headCol[0], headCol[1], headCol[2], 0.97 * dens, 0.06, 0, 0.46, 0.0, 0.0, 0.09);
    for (const s of [-1, 1]) {
     if (!isTern) {
      pushEllipsoid(out, hx + hfx * hw * 0.12 + hlx * s * hw * 0.56, hy + hw * 0.12, hz + hfz * hw * 0.12 + hlz * s * hw * 0.56, hfx * hw * 0.22, 0, hfz * hw * 0.22, hlx * hw * 0.08, 0, hlz * hw * 0.08, 0.85, 0.95, 0.95, 0.94, 0.96 * dens, 0.07, 0, 0.45, 0.0, 0.0, 0.09);
     }
     pushEllipsoid(out, hx + hfx * hw * 0.24 + hlx * s * hw * 0.52, hy + hw * 0.14, hz + hfz * hw * 0.24 + hlz * s * hw * 0.52, hfx * hw * 0.12, 0, hfz * hw * 0.12, hlx * hw * 0.10, 0, hlz * hw * 0.10, 0.9, 0.03, 0.03, 0.035, 0.98 * dens, 0.06, 0, 0.12, 0.0, 0.0, 0.09);
    }
   }
   if (isTern) {
    pushSpanEllipsoid(out, hx + hfx * hw * 0.22, hy + hw * 0.36, hz + hfz * hw * 0.22, hx - hfx * hw * 0.92, hy + hw * 0.18, hz - hfz * hw * 0.92, hlx * hw * 0.44, 0, hlz * hw * 0.44, 0.52, 0.04, 0.04, 0.05, 0.98 * dens, 0.06, 0, 0.48, 0.0, 0.0, 0.09);
   }
   const billCol = isTern ? [0.94, 0.36, 0.07] : [0.68, 0.14, 0.10];
   const bx0 = hx + hfx * hw * 0.56, by0 = hy - 0.004, bz0 = hz + hfz * hw * 0.56;
   const bx1 = hx + hfx * hw * (isTern ? 1.18 : 0.96), by1 = hy - np * hl * 0.14 - 0.008, bz1 = hz + hfz * hw * (isTern ? 1.18 : 0.96);
   const bx2 = hx + hfx * hw * (isTern ? 1.72 : 1.32), by2 = hy - np * hl * 0.28 - 0.017, bz2 = hz + hfz * hw * (isTern ? 1.72 : 1.32);
   pushSegment(out, bx0, by0, bz0, bx1, by1, bz1, 0.0082, billCol[0], billCol[1], billCol[2], 0.98 * dens, 0.06, 0, 0.85, 0.24, 0.0, 0.0, 0.09);
   pushSegment(out, bx1, by1, bz1, bx2, by2, bz2, 0.0042, isTern ? billCol[0] * 0.94 : 0.32, isTern ? billCol[1] * 0.84 : 0.07, isTern ? billCol[2] * 0.80 : 0.06, 0.98 * dens, 0.06, 0, 0.88, 0.24, 0.0, 0.0, 0.09);

   if (a.airborne) {
    // Symmetric crooked W/M gull & tern wing kinematics: explicit shoulder -> carpal wrist -> swept wingtip
    const dive = a.divePhase === 'diving';
    const foldSweep = dive ? 0.44 : 1.0;
    const iw = ws * 0.46 * foldSweep;
    const ow = ws * 0.54 * foldSweep;
    for (const s of [-1, 1]) {
     const shX = a.x + fx * hl * 0.12 + lx * s * hw * 0.62;
     const shY = a.y + ht * 0.24 + roll * s * hw * 0.80;
     const shZ = a.z + fz * hl * 0.12 + lz * s * hw * 0.62;
     const wrX = shX + fx * hl * 0.16 * foldSweep + lx * s * iw;
     const wrY = shY + flap * ws * 0.42 + roll * s * iw * 0.38;
     const wrZ = shZ + fz * hl * 0.16 * foldSweep + lz * s * iw;
     const tipX = wrX - fx * hl * (dive ? 0.82 : 0.48) + lx * s * ow;
     const tipY = shY + outerFlap * ws * 0.72 + roll * s * (iw + ow) * 0.38;
     const tipZ = wrZ - fz * hl * (dive ? 0.82 : 0.48) + lz * s * ow;
     const cX = wrX + lx * s * ow * 0.22 - fx * hl * 0.10;
     const cY = wrY + (outerFlap - flap) * ws * 0.16;
     const cZ = wrZ + lz * s * ow * 0.22 - fz * hl * 0.10;
     // Inner wing (secondary/coverts) + white/grey trailing edge + carpal wrist bridge + black-tipped primary blade
     pushSpanEllipsoid(out, shX, shY, shZ, wrX, wrY, wrZ, fx * hw * 1.18, 0, fz * hw * 1.18, 0.14, a.color[0], a.color[1], a.color[2], 0.97 * dens, 0.06, 0, 0.46, 0.0, 0.0, 0.16);
     pushSpanEllipsoid(out, wrX - fx * hw * 0.12, wrY, wrZ - fz * hw * 0.12, cX, cY, cZ, fx * hw * 0.96, 0, fz * hw * 0.96, 0.14, a.color[0] * 0.94, a.color[1] * 0.94, a.color[2] * 0.94, 0.97 * dens, 0.06, 0, 0.46, 0.0, 0.0, 0.16);
     pushSpanEllipsoid(out, cX, cY, cZ, tipX, tipY, tipZ, fx * hw * 0.62, 0, fz * hw * 0.62, 0.15, isTern ? a.color[0] * 0.82 : 0.05, isTern ? a.color[1] * 0.82 : 0.05, isTern ? a.color[2] * 0.84 : 0.06, 0.97 * dens, 0.06, 0, 0.48, 0.0, 0.0, 0.18);
    }
   } else if (detailMid && a.bipedRig?.legs) {
    // Neat folded mantle wings flush against torso + crossed dark primaries resting above tail
    for (const s of [-1, 1]) {
     pushSpanEllipsoid(out, a.x + fx * hl * 0.20 + lx * s * hw * 0.70, a.y + ht * 0.16, a.z + fz * hl * 0.20 + lz * s * hw * 0.70, a.x - fx * hl * 0.72 + lx * s * hw * 0.56, a.y + ht * 0.08, a.z - fz * hl * 0.72 + lz * s * hw * 0.56, lx * hw * 0.26, 0, lz * hw * 0.26, 0.72, a.color[0] * 0.88, a.color[1] * 0.88, a.color[2] * 0.88, 0.97 * dens, 0.06, 0, 0.48, 0.0, 0.0, 0.06);
     pushSpanEllipsoid(out, a.x - fx * hl * 0.60 + lx * s * hw * 0.46, a.y + ht * 0.08, a.z - fz * hl * 0.60 + lz * s * hw * 0.46, a.x - fx * hl * 1.24 - lx * s * hw * 0.08, a.y + ht * 0.02, a.z - fz * hl * 1.24 - lz * s * hw * 0.08, lx * hw * 0.16, 0, lz * hw * 0.16, 0.56, isTern ? a.color[0] * 0.74 : 0.05, isTern ? a.color[1] * 0.74 : 0.05, isTern ? a.color[2] * 0.76 : 0.06, 0.96 * dens, 0.07, 0, 0.48, 0.0, 0.0, 0.06);
    }
    if (!a.tucked) {
     const legCol = isTern ? [0.06, 0.06, 0.06] : [0.22, 0.08, 0.07];
     for (const leg of a.bipedRig.legs) {
      pushSegment(out, leg.hipX, leg.hipY, leg.hipZ, leg.kneeX, leg.kneeY, leg.kneeZ, 0.0052, legCol[0], legCol[1], legCol[2], 0.96 * dens, 0.07, 0, 0.92, 0.32, 0.0, 0.0, 0.03);
      pushSegment(out, leg.kneeX, leg.kneeY, leg.kneeZ, leg.footX, leg.footY, leg.footZ, 0.0040, legCol[0], legCol[1], legCol[2], 0.96 * dens, 0.07, 0, 0.92, 0.34, 0.0, 0.0, 0.01);
     }
    }
   }
   continue;
  }

  if (a.speciesId === 'atlantic-stingray') {
   const hl = a.len * 0.5, hw = a.width * 0.5, ht = a.height * 0.5;
   const buried = a.state === 'buried-resting';
   const dc = buried ? mixRGB(a.color, [0.54, 0.49, 0.39], 0.40) : a.color;
   // Sculpted diamond batoid spine: tapered spade snout -> interorbital cranium ridge -> central keel + pale ventral underdisc
   pushEllipsoid(out, a.x + fx * hl * 0.56, a.y + ht * 0.14, a.z + fz * hl * 0.56, fx * hl * 0.48, -ht * 0.08, fz * hl * 0.48, lx * hw * 0.34, 0, lz * hw * 0.34, (ht * 0.72) / (hw * 0.34), dc[0], dc[1], dc[2], 0.97 * dens, 0.06, uw, 0.22, 0.0, 0.0, 0.03);
   pushEllipsoid(out, a.x + fx * hl * 0.02, a.y + ht * 0.22, a.z + fz * hl * 0.02, fx * hl * 0.86, 0, fz * hl * 0.86, lx * hw * 0.52, 0, lz * hw * 0.52, (ht * 0.88) / (hw * 0.52), dc[0], dc[1], dc[2], 0.97 * dens, 0.06, uw, 0.22, 0.0, 0.0, 0.03);
   pushEllipsoid(out, a.x + fx * hl * 0.06, a.y - ht * 0.22, a.z + fz * hl * 0.06, fx * hl * 0.78, 0, fz * hl * 0.78, lx * hw * 0.56, 0, lz * hw * 0.56, (ht * 0.52) / (hw * 0.56), a.accent[0], a.accent[1], a.accent[2], 0.95 * dens, 0.06, uw, 0.24, 0.0, 0.0, 0.02);
   if (detailFull) {
    for (const s of [-1, 1]) {
     pushEllipsoid(out, a.x + fx * hl * 0.44 + lx * s * hw * 0.15, a.y + ht * 0.78, a.z + fz * hl * 0.44 + lz * s * hw * 0.15, fx * hw * 0.06, 0, fz * hw * 0.06, lx * hw * 0.06, 0, lz * hw * 0.06, 0.85, 0.05, 0.045, 0.04, 0.97 * dens, 0.06, uw, 0.12, 0.0, 0.0, 0.05);
    }
   }
   if (a.rayRig && detailMid) {
    const finChord = hl * 0.34;
    const stationFwd = [0.46, 0.22, -0.02, -0.26, -0.48];
    const stations = a.rayRig.left.length;
    // Continuous pectoral radial sheets anchored from vertebral keel to left/right undulating fin tips
    for (let i = 0; i < stations; i++) {
     const nl = a.rayRig.left[i], nr = a.rayRig.right[i];
     const fwdS = hl * stationFwd[Math.min(i, stationFwd.length - 1)];
     const sx0 = a.x + fx * fwdS, sy0 = a.y + ht * 0.12, sz0 = a.z + fz * fwdS;
     const wCol = dc[0] * 1.03, wG = dc[1] * 1.01, wB = dc[2] * 0.94;
     pushSpanEllipsoid(out, sx0, sy0, sz0, nl.x, nl.y, nl.z, fx * finChord, 0, fz * finChord, clamp((ht * 0.42) / finChord, 0.08, 0.22), wCol, wG, wB, 0.96 * dens, 0.06, uw, 0.22, 0.0, 0.0, 0.03);
     pushSpanEllipsoid(out, sx0, sy0, sz0, nr.x, nr.y, nr.z, fx * finChord, 0, fz * finChord, clamp((ht * 0.42) / finChord, 0.08, 0.22), wCol, wG, wB, 0.96 * dens, 0.06, uw, 0.22, 0.0, 0.0, 0.03);
    }
    if (detailFull) {
     // Continuous outer pectoral wing margin ribbon eliminating scalloped oval separation
     for (let i = 0; i < stations - 1; i++) {
      const l0 = a.rayRig.left[i], l1 = a.rayRig.left[i + 1];
      const r0 = a.rayRig.right[i], r1 = a.rayRig.right[i + 1];
      pushSpanEllipsoid(out, l0.x, l0.y, l0.z, l1.x, l1.y, l1.z, lx * (-hw * 0.18), 0, lz * (-hw * 0.18), 0.24, dc[0] * 1.05, dc[1] * 1.03, dc[2] * 0.96, 0.95 * dens, 0.06, uw, 0.22, 0.0, 0.0, 0.03);
      pushSpanEllipsoid(out, r0.x, r0.y, r0.z, r1.x, r1.y, r1.z, lx * (hw * 0.18), 0, lz * (hw * 0.18), 0.24, dc[0] * 1.05, dc[1] * 1.03, dc[2] * 0.96, 0.95 * dens, 0.06, uw, 0.22, 0.0, 0.0, 0.03);
     }
     for (const s of [-1, 1]) {
      pushEllipsoid(out, a.x - fx * hl * 0.70 + lx * s * hw * 0.22, a.y - ht * 0.02, a.z - fz * hl * 0.70 + lz * s * hw * 0.22, fx * hl * 0.22, 0, fz * hl * 0.22, lx * hw * 0.16, 0, lz * hw * 0.16, 0.26, dc[0] * 0.94, dc[1] * 0.92, dc[2] * 0.88, 0.94 * dens, 0.06, uw, 0.24, 0.0, 0.0, 0.03);
     }
    }
    const tr = a.rayRig.tail;
    pushSegment(out, a.x - fx * hl * 0.64, a.y, a.z - fz * hl * 0.64, tr[0].x, tr[0].y, tr[0].z, ht * 0.50, dc[0] * 0.86, dc[1] * 0.82, dc[2] * 0.78, 0.95 * dens, 0.07, uw, 0.9, 0.24, 0.0, 0.0, 0.03);
    pushSegment(out, tr[0].x, tr[0].y + ht * 0.35, tr[0].z, tr[0].x - fx * hl * 0.28, tr[0].y + ht * 0.82, tr[0].z - fz * hl * 0.28, ht * 0.14, 0.88, 0.86, 0.78, 0.95 * dens, 0.07, uw, 0.8, 0.28, 0.0, 0.0, 0.05);
    pushSegment(out, tr[0].x, tr[0].y, tr[0].z, tr[1].x, tr[1].y, tr[1].z, ht * 0.32, dc[0] * 0.74, dc[1] * 0.70, dc[2] * 0.66, 0.93 * dens, 0.07, uw, 0.9, 0.26, 0.0, 0.0, 0.03);
    pushSegment(out, tr[1].x, tr[1].y, tr[1].z, tr[2].x, tr[2].y, tr[2].z, ht * 0.18, dc[0] * 0.62, dc[1] * 0.60, dc[2] * 0.56, 0.92 * dens, 0.08, uw, 0.9, 0.28, 0.0, 0.0, 0.03);
   } else {
    pushEllipsoid(out, a.x, a.y, a.z, fx * hl * 0.88, 0, fz * hl * 0.88, lx * hw, 0, lz * hw, ht / hw, dc[0], dc[1], dc[2], 0.95 * dens, 0.07, uw, 0.24, 0.0, 0.0, 0.03);
   }
   continue;
  }

  if (a.speciesId === 'bonnethead-shark') {
   const hl = a.len * 0.5, hw = a.width * 0.5, ht = a.height * 0.5;
   const bank = a.roll || 0;
   const nodes = a.fishSpine?.nodes;
   if (nodes && (!cameraPos || dist < 34)) {
    const n0 = nodes[0], n1 = nodes[1], n2 = nodes[2], n3 = nodes[3];
    // Shovel-rounded cephalofoil bridged cleanly into nape + lateral eyes
    const cx = n0.x + n0.fx * hl * 0.14, cy = a.y + ht * 0.06, cz = n0.z + n0.fz * hl * 0.14;
    pushEllipsoid(out, cx, cy, cz, n0.lx * hw * 1.54, bank * hw * 0.95, n0.lz * hw * 1.54, n0.fx * hl * 0.24, 0, n0.fz * hl * 0.24, 0.34, a.color[0], a.color[1], a.color[2], 0.98 * dens, 0.06, uw, 0.18, 0.0, 0.0, 0.08);
    pushSpanEllipsoid(out, cx - n0.fx * hl * 0.08, cy, cz - n0.fz * hl * 0.08, n1.x, a.y + ht * 0.10, n1.z, n0.lx * hw * 0.88, bank * hw * 0.55, n0.lz * hw * 0.88, (ht * 0.92) / (hw * 0.88), a.color[0], a.color[1], a.color[2], 0.98 * dens, 0.06, uw, 0.18, 0.0, 0.0, 0.07);
    pushSpanEllipsoid(out, cx - n0.fx * hl * 0.06, a.y - ht * 0.24, cz - n0.fz * hl * 0.06, n1.x, a.y - ht * 0.28, n1.z, n0.lx * hw * 0.78, bank * hw * 0.50, n0.lz * hw * 0.78, (ht * 0.58) / (hw * 0.78), a.accent[0], a.accent[1], a.accent[2], 0.96 * dens, 0.06, uw, 0.22, 0.0, 0.0, 0.05);
    if (detailFull) {
     for (const s of [-1, 1]) {
      pushEllipsoid(out, cx + n0.lx * s * hw * 1.48 + n0.fx * hl * 0.04, cy + bank * s * hw * 0.85, cz + n0.lz * s * hw * 1.48 + n0.fz * hl * 0.04, n0.fx * hw * 0.12, 0, n0.fz * hw * 0.12, n0.lx * hw * 0.10, 0, n0.lz * hw * 0.10, 0.9, 0.03, 0.03, 0.035, 0.98 * dens, 0.06, uw, 0.12, 0.0, 0.0, 0.09);
     }
    }
    // Seamless mid-trunk & caudal peduncle bridged n1 -> n2 -> n3
    pushSpanEllipsoid(out, n1.x + n1.fx * hl * 0.12, a.y + ht * 0.06, n1.z + n1.fz * hl * 0.12, n2.x - n2.fx * hl * 0.08, a.y + ht * 0.02, n2.z - n2.fz * hl * 0.08, n1.lx * hw * 0.74, bank * hw * 0.42, n1.lz * hw * 0.74, (ht * 0.84) / (hw * 0.74), a.color[0] * 0.96, a.color[1] * 0.96, a.color[2] * 0.96, 0.97 * dens, 0.06, uw, 0.18, 0.0, 0.0, 0.07);
    pushSpanEllipsoid(out, n1.x, a.y - ht * 0.24, n1.z, n2.x, a.y - ht * 0.20, n2.z, n1.lx * hw * 0.62, bank * hw * 0.35, n1.lz * hw * 0.62, (ht * 0.52) / (hw * 0.62), a.accent[0], a.accent[1], a.accent[2], 0.95 * dens, 0.06, uw, 0.22, 0.0, 0.0, 0.05);
    pushSpanEllipsoid(out, n2.x + n2.fx * hl * 0.08, a.y, n2.z + n2.fz * hl * 0.08, n3.x - n3.fx * hl * 0.08, a.y, n3.z - n3.fz * hl * 0.08, n2.lx * hw * 0.44, 0, n2.lz * hw * 0.44, (ht * 0.68) / (hw * 0.44), a.color[0] * 0.92, a.color[1] * 0.92, a.color[2] * 0.92, 0.96 * dens, 0.06, uw, 0.19, 0.0, 0.0, 0.06);
    // Fins strictly rooted inside dorsal/pectoral trunk sockets (zero detached ovals)
    const d1rx = n1.x + n1.fx * hl * 0.06, d1rz = n1.z + n1.fz * hl * 0.06;
    pushSpanEllipsoid(out, d1rx, a.y + ht * 0.52, d1rz, n1.x - n1.fx * hl * 0.34, a.y + ht * 2.08, n1.z - n1.fz * hl * 0.34, n1.fx * hl * 0.22, 0, n1.fz * hl * 0.22, 0.15, a.color[0] * 0.92, a.color[1] * 0.92, a.color[2] * 0.92, 0.97 * dens, 0.06, uw, 0.20, 0.0, 0.0, 0.12);
    pushSpanEllipsoid(out, n2.x - n2.fx * hl * 0.04, a.y + ht * 0.32, n2.z - n2.fz * hl * 0.04, n2.x - n2.fx * hl * 0.24, a.y + ht * 0.96, n2.z - n2.fz * hl * 0.24, n2.fx * hl * 0.12, 0, n2.fz * hl * 0.12, 0.16, a.color[0] * 0.90, a.color[1] * 0.90, a.color[2] * 0.90, 0.95 * dens, 0.06, uw, 0.22, 0.0, 0.0, 0.10);
    for (const s of [-1, 1]) {
     const px0 = n1.x + n1.fx * hl * 0.12 + n1.lx * s * hw * 0.42, py0 = a.y - ht * 0.24 + bank * s * hw * 0.25, pz0 = n1.z + n1.fz * hl * 0.12 + n1.lz * s * hw * 0.42;
     const px1 = n1.x - n1.fx * hl * 0.32 + n1.lx * s * hw * 1.96, py1 = a.y - ht * 0.46 + bank * s * hw * 0.72, pz1 = n1.z - n1.fz * hl * 0.32 + n1.lz * s * hw * 1.96;
     pushSpanEllipsoid(out, px0, py0, pz0, px1, py1, pz1, n1.fx * hl * 0.20, 0, n1.fz * hl * 0.20, 0.17, a.color[0], a.color[1], a.color[2], 0.96 * dens, 0.06, uw, 0.20, 0.0, 0.0, 0.06);
     if (detailFull) {
      const pvx0 = n2.x + n2.lx * s * hw * 0.28, pvz0 = n2.z + n2.lz * s * hw * 0.28;
      pushSpanEllipsoid(out, pvx0, a.y - ht * 0.24, pvz0, n2.x - n2.fx * hl * 0.22 + n2.lx * s * hw * 0.88, a.y - ht * 0.42, n2.z - n2.fz * hl * 0.22 + n2.lz * s * hw * 0.88, n2.fx * hl * 0.12, 0, n2.fz * hl * 0.12, 0.18, a.color[0] * 0.90, a.color[1] * 0.90, a.color[2] * 0.90, 0.94 * dens, 0.07, uw, 0.22, 0.0, 0.0, 0.05);
     }
    }
    // Rooted heterocercal shark tail blades emanating from caudal peduncle n3
    pushSpanEllipsoid(out, n3.x + n3.fx * hl * 0.04, a.y, n3.z + n3.fz * hl * 0.04, n3.x - n3.fx * hl * 0.62, a.y + ht * 1.24, n3.z - n3.fz * hl * 0.62, n3.fx * hl * 0.16, 0, n3.fz * hl * 0.16, 0.18, a.color[0] * 0.86, a.color[1] * 0.86, a.color[2] * 0.86, 0.96 * dens, 0.06, uw, 0.22, 0.0, 0.0, 0.08);
    pushSpanEllipsoid(out, n3.x + n3.fx * hl * 0.02, a.y - ht * 0.06, n3.z + n3.fz * hl * 0.02, n3.x - n3.fx * hl * 0.34, a.y - ht * 0.62, n3.z - n3.fz * hl * 0.34, n3.fx * hl * 0.14, 0, n3.fz * hl * 0.14, 0.18, a.accent[0] * 0.90, a.accent[1] * 0.90, a.accent[2] * 0.90, 0.94 * dens, 0.07, uw, 0.24, 0.0, 0.0, 0.05);
   } else {
    pushEllipsoid(out, a.x, a.y, a.z, fx * hl, 0, fz * hl, lx * hw, 0, lz * hw, ht / hw, a.color[0], a.color[1], a.color[2], 0.96 * dens, 0.06, uw, 0.18, 0.0, 0.0, 0.07);
   }
   continue;
  }

  if (a.speciesId === 'dragonlet') {
   const hl = a.len * 0.5, hw = a.width * 0.5, ht = a.height * 0.5;
   const ws = a.wingSpan * 0.5;
   const perched = a.state === 'perched';
   const dp = a.pitch || 0;
   // Metallic segmented dragonfly abdomen + bulbous thorax + wrap-around eyes
   pushSpanEllipsoid(out, a.x - fx * hl * 0.12, a.y - dp * hl * 0.05, a.z - fz * hl * 0.12, a.x - fx * hl * 1.12, a.y - dp * hl * 0.58, a.z - fz * hl * 1.12, lx * hw * 0.86, 0, lz * hw * 0.86, ht / (hw * 0.86), a.color[0], a.color[1], a.color[2], 0.97 * dens, 0.07, 0, 0.24, 0.26, 0.0, 0.08);
   pushEllipsoid(out, a.x + fx * hl * 0.42, a.y + ht * 0.18, a.z + fz * hl * 0.42, fx * hl * 0.28, 0, fz * hl * 0.28, lx * hw * 1.55, 0, lz * hw * 1.55, 0.95, a.accent[0], a.accent[1], a.accent[2], 0.97 * dens, 0.07, 0, 0.22, 0.32, 0.0, 0.09);
   pushEllipsoid(out, a.x + fx * hl * 0.80, a.y + ht * 0.22, a.z + fz * hl * 0.80, fx * hw * 1.05, 0, fz * hw * 1.05, lx * hw * 1.65, 0, lz * hw * 1.65, 0.85, 0.10, 0.28, 0.34, 0.98 * dens, 0.07, 0, 0.10, 0.18, 0.0, 0.10);
   // Symmetric 4 gossamer wings attached directly to dorsal thorax
   const fore = perched ? -0.18 : (a.wingFore ?? Math.sin(sim.time * 36 + a.id) * 0.30);
   const hind = perched ? -0.26 : (a.wingHind ?? -fore * 0.92);
   for (const s of [-1, 1]) {
    const rfx = a.x + fx * hl * 0.48 + lx * s * hw * 0.65, rfy = a.y + ht * 0.58, rfz = a.z + fz * hl * 0.48 + lz * s * hw * 0.65;
    const rhx = a.x + fx * hl * 0.26 + lx * s * hw * 0.65, rhy = a.y + ht * 0.50, rhz = a.z + fz * hl * 0.26 + lz * s * hw * 0.65;
    pushSpanEllipsoid(out, rfx, rfy, rfz, rfx + lx * s * ws * 1.04 + fx * hw * 0.25, rfy + fore * ws * 0.62, rfz + lz * s * ws * 1.04 + fz * hw * 0.25, fx * hw * 1.48, 0, fz * hw * 1.48, 0.14, 0.76, 0.82, 0.84, 0.60 * dens, 0.50, 0, 0.18, 0.10, 0.62, 0.12);
    pushSpanEllipsoid(out, rhx, rhy, rhz, rhx + lx * s * ws * 0.94 - fx * hw * 0.68, rhy + hind * ws * 0.58, rhz + lz * s * ws * 0.94 - fz * hw * 0.68, fx * hw * 1.68, 0, fz * hw * 1.68, 0.14, 0.74, 0.80, 0.82, 0.58 * dens, 0.52, 0, 0.18, 0.10, 0.62, 0.12);
   }
   continue;
  }

  // Size-scaled half-extents for juvenile -> adult growth & new small coastal fauna
  const hl = a.len * 0.5, hw = a.width * 0.5, ht = a.height * 0.5;
  const baseY = a.y;
  const cB = a.color, cA = a.accent;

  if (a.speciesId === 'coquina-clam') {
   const burrow = clamp((a.burrowDepth ?? 0) / 0.022, 0, 1);
   const cy = baseY;
   const tilt = burrow * 0.78;
   const cT = Math.cos(tilt), sT = Math.sin(tilt);
   // Wedge-shaped glossy pastel aragonite valve tilted into swash when digging
   pushEllipsoid(
    out, a.x, cy, a.z,
    fx * hl * cT, -hl * sT, fz * hl * cT,
    lx * hw, 0, lz * hw,
    ht / Math.max(1e-4, hw),
    cB[0], cB[1], cB[2], 0.97 * dens, 0.07, uw, 0.16, 0.02, 0.0, 0.01
   );
   pushEllipsoid(
    out, a.x - fx * hl * 0.16 * cT, cy + hl * 0.16 * sT + ht * 0.10, a.z - fz * hl * 0.16 * cT,
    fx * hl * 0.62 * cT, -hl * 0.62 * sT, fz * hl * 0.62 * cT,
    lx * hw * 0.86, 0, lz * hw * 0.86,
    0.72,
    cA[0], cA[1], cA[2], 0.94 * dens, 0.07, uw, 0.20, 0.02, 0.0, 0.01
   );
   if (detailFull && burrow < 0.72) {
    // Pale muscular wedge foot + twin short translucent siphons
    pushSegment(out, a.x + fx * hl * 0.45, cy - ht * 0.15, a.z + fz * hl * 0.45, a.x + fx * hl * 0.92, cy - ht * 0.68, a.z + fz * hl * 0.92, hw * 0.26, 0.86, 0.81, 0.72, 0.86 * dens, 0.10, uw, 0.85, 0.28, 0.0, 0.0, 0.0);
    pushSegment(out, a.x - fx * hl * 0.45, cy + ht * 0.12, a.z - fz * hl * 0.45, a.x - fx * hl * 0.78, cy + ht * 0.55, a.z - fz * hl * 0.78, hw * 0.14, 0.88, 0.84, 0.76, 0.82 * dens, 0.12, uw, 0.9, 0.25, 0.0, 0.0, 0.01);
   }
   continue;
  }

  if (a.speciesId === 'hermit-crab') {
   const ret = a.retracted ? 1 : 0;
   const shellY = baseY + ht * 0.16;
   // Heavy spiraled gastropod house angled back-right over thorax
   pushEllipsoid(
    out, a.x - fx * hl * 0.14, shellY, a.z - fz * hl * 0.14,
    fx * hl * 0.72, ht * 0.12, fz * hl * 0.72,
    lx * hw * 0.84, 0, lz * hw * 0.84,
    (ht * 0.82) / Math.max(1e-4, hw * 0.84),
    cB[0], cB[1], cB[2], 0.97 * dens, 0.07, uw, 0.46, 0.02, 0.0, 0.02
   );
   pushSegment(
    out,
    a.x - fx * hl * 0.28, shellY + ht * 0.14, a.z - fz * hl * 0.28,
    a.x - fx * hl * 0.92 + lx * hw * 0.36, shellY + ht * 0.54, a.z - fz * hl * 0.92 + lz * hw * 0.36,
    hw * 0.48, cA[0], cA[1], cA[2], 0.96 * dens, 0.07, uw, 0.92, 0.48, 0.02, 0.0, 0.02
   );
   if (ret < 0.78) {
    const ext = 1 - ret;
    const headX = a.x + fx * hl * (0.42 * ext);
    const headZ = a.z + fz * hl * (0.42 * ext);
    pushEllipsoid(out, headX, baseY - ht * 0.06, headZ, fx * hl * 0.24 * ext, 0, fz * hl * 0.24 * ext, lx * hw * 0.44, 0, lz * hw * 0.44, 0.65, 0.74, 0.38, 0.22, 0.94 * dens, 0.07, uw, 0.36, 0.04, 0.0, 0.01);
    if (detailFull) {
     const footY = baseY - ht * 0.84;
     for (const side of [-1, 1]) {
      // Major/minor striped chelipeds
      const cOff = side > 0 ? 0.88 : 0.74;
      pushSegment(out, headX + lx * side * hw * 0.28, baseY - ht * 0.12, headZ + lz * side * hw * 0.28, headX + fx * hl * 0.42 * cOff * ext + lx * side * hw * 0.48, footY + ht * 0.25, headZ + fz * hl * 0.42 * cOff * ext + lz * side * hw * 0.48, hw * 0.14 * cOff, 0.34, 0.36, 0.20, 0.92 * dens, 0.07, uw, 0.85, 0.34, 0.04, 0.0, 0.0);
      // 2 pairs of striped ambulatory legs seated flush at sand level
      for (let k = 0; k < 2; k++) {
       const sw = Math.sin((a.phase || 0) * 10 + k * 2.1 + side * 1.4) * hl * 0.22 * ext;
       const rx = headX - fx * hl * k * 0.18 + sw * fx;
       const rz = headZ - fz * hl * k * 0.18 + sw * fz;
       pushSegment(out, rx + lx * side * hw * 0.26, baseY - ht * 0.10, rz + lz * side * hw * 0.26, rx + lx * side * hw * (0.95 + k * 0.12) - fx * hl * 0.12, footY, rz + lz * side * hw * (0.95 + k * 0.12) - fz * hl * 0.12, hw * 0.085, 0.26, 0.30, 0.17, 0.90 * dens, 0.07, uw, 0.9, 0.38, 0.02, 0.0, 0.0);
      }
     }
    }
   }
   continue;
  }

  if (a.speciesId === 'tiger-beetle') {
   const by = baseY + ht * 0.14;
   // Ivory-white elytra abdomen & bronze-green iridescent thorax/head
   pushEllipsoid(out, a.x - fx * hl * 0.16, by, a.z - fz * hl * 0.16, fx * hl * 0.64, 0, fz * hl * 0.64, lx * hw * 0.88, 0, lz * hw * 0.88, (ht * 0.72) / Math.max(1e-4, hw * 0.88), cB[0], cB[1], cB[2], 0.97 * dens, 0.06, uw, 0.26, 0.05, 0.0, 0.02);
   pushSegment(out, a.x - fx * hl * 0.68, by + ht * 0.42, a.z - fz * hl * 0.68, a.x + fx * hl * 0.42, by + ht * 0.42, a.z + fz * hl * 0.42, hw * 0.12, cA[0], cA[1], cA[2], 0.88 * dens, 0.06, uw, 0.55, 0.24, 0.25, 0.0, 0.02);
   pushEllipsoid(out, a.x + fx * hl * 0.58, by + ht * 0.06, a.z + fz * hl * 0.58, fx * hl * 0.34, 0, fz * hl * 0.34, lx * hw * 0.68, 0, lz * hw * 0.68, 0.82, cA[0], cA[1], cA[2], 0.96 * dens, 0.06, uw, 0.22, 0.38, 0.0, 0.02);
   if (detailMid) {
    const footY = baseY - ht * 0.86;
    for (const side of [-1, 1]) {
     for (let k = 0; k < 3; k++) {
      const fOff = (1 - k) * hl * 0.28;
      const stride = Math.sin((a.phase || 0) * 18 + (k + (side > 0 ? 1 : 0)) * Math.PI) * hl * 0.24;
      const hx = a.x + fx * fOff + lx * side * hw * 0.32;
      const hz = a.z + fz * fOff + lz * side * hw * 0.32;
      const tx = hx + lx * side * hw * (1.25 - k * 0.12) + fx * (stride - k * hl * 0.18);
      const tz = hz + lz * side * hw * (1.25 - k * 0.12) + fz * (stride - k * hl * 0.18);
      pushSegment(out, hx, by - ht * 0.12, hz, tx, footY, tz, hw * 0.075, cA[0] * 0.9, cA[1] * 0.95, cA[2] * 0.9, 0.88 * dens, 0.06, uw, 0.9, 0.28, 0.28, 0.0, 0.0);
     }
    }
   }
   if (detailFull) {
    // Pale curved sickle mandibles
    for (const side of [-1, 1]) {
     pushSegment(out, a.x + fx * hl * 0.82 + lx * side * hw * 0.25, by - ht * 0.02, a.z + fz * hl * 0.82 + lz * side * hw * 0.25, a.x + fx * hl * 1.12 + lx * side * hw * 0.05, by - ht * 0.08, a.z + fz * hl * 1.12 + lz * side * hw * 0.05, hw * 0.08, 0.88, 0.85, 0.72, 0.90 * dens, 0.06, uw, 0.85, 0.26, 0.05, 0.0, 0.02);
    }
   }
   continue;
  }

  if (a.speciesId === 'racerunner') {
   // Smooth connected serpentine spine: snout -> striped trunk -> tapering whip tail
   const rawNodes = a.lizardSpine?.nodes;
   const hasValidSpine = Array.isArray(rawNodes) && rawNodes.length >= 4 && Number.isFinite(rawNodes[0]?.x) && Number.isFinite(rawNodes[rawNodes.length - 1]?.x);
   const nCount = hasValidSpine ? rawNodes.length : 6;
   const getN = (i) => {
    if (hasValidSpine) {
     const nd = rawNodes[i];
     return { x: nd.x, y: Math.max(nd.y ?? baseY, baseY - ht * 0.15), z: nd.z };
    }
    const u = i / (nCount - 1);
    const wave = Math.sin((a.phase || 0) * 11 - u * 4.4) * hw * (0.25 + u * 0.95);
    const back = (0.58 - u * 1.72) * hl;
    return { x: a.x + fx * back + lx * wave, y: baseY - ht * 0.08 * u, z: a.z + fz * back + lz * wave };
   };
   const n0 = getN(0), n1 = getN(1), n2 = getN(2);
   // Narrow pointed wedge snout
   pushSegment(out, n0.x + fx * hl * 0.22, n0.y + ht * 0.04, n0.z + fz * hl * 0.22, n0.x, n0.y + ht * 0.08, n0.z, hw * 0.62, cB[0], cB[1], cB[2], 0.96 * dens, 0.06, uw, 0.78, 0.34, 0.02, 0.0, 0.02);
   // Dark striped trunk segments
   pushSegment(out, n0.x, n0.y + ht * 0.06, n0.z, n1.x, n1.y + ht * 0.05, n1.z, hw * 0.88, 0.24, 0.24, 0.17, 0.97 * dens, 0.06, uw, 0.72, 0.38, 0.02, 0.0, 0.02);
   pushSegment(out, n1.x, n1.y + ht * 0.05, n1.z, n2.x, n2.y, n2.z, hw * 0.78, 0.24, 0.24, 0.17, 0.96 * dens, 0.06, uw, 0.74, 0.38, 0.02, 0.0, 0.02);
   // Crisp longitudinal yellow-cream dorsal stripes along trunk
   for (const side of [-1, 1]) {
    pushSegment(out, n0.x + lx * side * hw * 0.42, n0.y + ht * 0.36, n0.z + lz * side * hw * 0.42, n2.x + lx * side * hw * 0.36, n2.y + ht * 0.28, n2.z + lz * side * hw * 0.36, hw * 0.22, cA[0], cA[1], cA[2], 0.92 * dens, 0.06, uw, 0.65, 0.34, 0.0, 0.0, 0.02);
   }
   // Tapering whip tail
   for (let i = 2; i < nCount - 1; i++) {
    const p = getN(i), q = getN(i + 1);
    const tFrac = (i - 2) / Math.max(1, nCount - 3);
    const rad = hw * (0.52 * (1 - tFrac * 0.72));
    const tr = cB[0] * (1 - tFrac * 0.2) + 0.56 * tFrac * 0.25;
    const tg = cB[1] * (1 - tFrac * 0.1) + 0.60 * tFrac * 0.25;
    const tb = cB[2] + 0.22 * tFrac;
    pushSegment(out, p.x, p.y, p.z, q.x, q.y, q.z, Math.max(0.0025, rad), tr, tg, tb, 0.92 * dens, 0.07, uw, 0.92, 0.40, 0.0, 0.0, 0.02);
   }
   if (detailMid) {
    const footY = baseY - ht * 0.82;
    const gSwing = Math.sin((a.phase || 0) * 12) * hl * 0.14;
    for (const side of [-1, 1]) {
     // Forelimb & larger muscular hindlimb anchored flush to sand
     const fFoot = gSwing * side;
     pushSegment(out, n0.x - fx * hl * 0.06 + lx * side * hw * 0.55, n0.y - ht * 0.05, n0.z - fz * hl * 0.06 + lz * side * hw * 0.55, n0.x + fx * fFoot + lx * side * hw * 1.45, footY, n0.z + fz * fFoot + lz * side * hw * 1.45, hw * 0.22, cB[0] * 0.9, cB[1] * 0.9, cB[2] * 0.9, 0.92 * dens, 0.06, uw, 0.88, 0.36, 0.0, 0.0, 0.0);
     pushSegment(out, n2.x + fx * hl * 0.08 + lx * side * hw * 0.58, n2.y - ht * 0.06, n2.z + fz * hl * 0.08 + lz * side * hw * 0.58, n2.x - fx * fFoot - fx * hl * 0.12 + lx * side * hw * 1.72, footY, n2.z - fz * fFoot - fz * hl * 0.12 + lz * side * hw * 1.72, hw * 0.28, cB[0] * 0.88, cB[1] * 0.88, cB[2] * 0.88, 0.93 * dens, 0.06, uw, 0.88, 0.36, 0.0, 0.0, 0.0);
    }
   }
   continue;
  }

  if (a.speciesId === 'grass-shrimp') {
   // Strictly uw = 1.0 & soft <= 0.20 so zero underwater soft-edge halo artifacts
   const flip = clamp(a.tailFlex ?? 0, 0, 1);
   // Translucent glass cephalothorax & anterior carapace
   pushEllipsoid(out, a.x + fx * hl * 0.18, a.y + ht * 0.12, a.z + fz * hl * 0.18, fx * hl * 0.44, 0, fz * hl * 0.44, lx * hw * 0.85, 0, lz * hw * 0.85, 0.92, cB[0], cB[1], cB[2], 0.62 * dens, 0.12, uw, 0.14, 0.02, 0.25, 0.02);
   // Arched flexed abdomen tapering to uropod tail fan (curls sharply during caridoid escape)
   const midY = a.y + ht * (0.16 - 0.55 * flip);
   const tailY = a.y - ht * (0.28 + 0.95 * flip);
   const tailFwd = -hl * (0.85 - 0.68 * flip);
   pushSegment(out, a.x + fx * hl * 0.02, a.y + ht * 0.12, a.z + fz * hl * 0.02, a.x - fx * hl * 0.42, midY, a.z - fz * hl * 0.42, hw * 0.72, cB[0], cB[1], cB[2], 0.58 * dens, 0.12, uw, 0.88, 0.14, 0.02, 0.25, 0.02);
   pushSegment(out, a.x - fx * hl * 0.42, midY, a.z - fz * hl * 0.42, a.x + fx * tailFwd, tailY, a.z + fz * tailFwd, hw * 0.52, cA[0], cA[1], cA[2], 0.60 * dens, 0.14, uw, 0.45, 0.16, 0.02, 0.22, 0.02);
   if (detailFull) {
    // Dark stalked eyes (`soft: 0.06` crisp sphere) + delicate swept-back antennae
    for (const side of [-1, 1]) {
     pushEllipsoid(out, a.x + fx * hl * 0.56 + lx * side * hw * 0.42, a.y + ht * 0.26, a.z + fz * hl * 0.56 + lz * side * hw * 0.42, fx * hw * 0.26, 0, fz * hw * 0.26, lx * hw * 0.26, 0, lz * hw * 0.26, 1.0, 0.09, 0.09, 0.10, 0.94 * dens, 0.06, uw, 0.12, 0.10, 0.0, 0.02);
     pushSegment(out, a.x + fx * hl * 0.58, a.y + ht * 0.15, a.z + fz * hl * 0.58, a.x - fx * hl * 0.65 + lx * side * hw * 1.9, a.y + ht * 0.42, a.z - fz * hl * 0.65 + lz * side * hw * 1.9, hw * 0.10, cA[0], cA[1], cA[2], 0.45 * dens, 0.14, uw, 0.9, 0.18, 0.0, 0.20, 0.02);
    }
   }
   continue;
  }

  if (a.speciesId === 'marsh-periwinkle') {
   // Pale ribbed conical shell seated cleanly on substrate/stem
   const by = baseY;
   pushEllipsoid(out, a.x, by - ht * 0.10, a.z, fx * hw * 0.92, 0, fz * hw * 0.92, lx * hw * 0.92, 0, lz * hw * 0.92, 0.92, cB[0], cB[1], cB[2], 0.97 * dens, 0.07, uw, 0.56, 0.0, 0.0, 0.0);
   pushSegment(out, a.x, by + ht * 0.05, a.z, a.x - fx * hl * 0.35, by + ht * 0.88, a.z - fz * hl * 0.35, hw * 0.58, cA[0], cA[1], cA[2], 0.96 * dens, 0.07, uw, 0.95, 0.54, 0.0, 0.0, 0.0);
   if (detailFull) {
    // Moist pale muscular foot + twin cephalic tentacles
    pushEllipsoid(out, a.x + fx * hl * 0.14, by - ht * 0.72, a.z + fz * hl * 0.14, fx * hl * 0.62, 0, fz * hl * 0.62, lx * hw * 0.72, 0, lz * hw * 0.72, 0.25, 0.76, 0.72, 0.64, 0.88 * dens, 0.12, uw, 0.32, 0.0, 0.0, 0.0);
    for (const side of [-1, 1]) {
     pushSegment(out, a.x + fx * hl * 0.42 + lx * side * hw * 0.22, by - ht * 0.45, a.z + fz * hl * 0.42 + lz * side * hw * 0.22, a.x + fx * hl * 0.78 + lx * side * hw * 0.46, by - ht * 0.15, a.z + fz * hl * 0.78 + lz * side * hw * 0.46, hw * 0.09, 0.66, 0.62, 0.54, 0.86 * dens, 0.10, uw, 0.9, 0.34, 0.0, 0.0, 0.0);
    }
   }
   continue;
  }

  // Four distinct coastal fish morphotypes: baitfish, pompano, pinfish, killifish (100% opaque underwater hulls)
  const pitch = a.pitch || 0;
  const bank = a.roll || 0;
  const isAnchovy = a.speciesId === 'baitfish';
  const isPompano = a.speciesId === 'pompano';
  const isPinfish = a.speciesId === 'pinfish';
  const isKillifish = a.speciesId === 'killifish';
  const bodyRough = isAnchovy ? 0.16 : (isPompano ? 0.16 : (isPinfish ? 0.20 : 0.22));
  const bodyMetal = isAnchovy ? 0.30 : (isPompano ? 0.22 : (isPinfish ? 0.14 : 0.04));
  const nodes = a.fishSpine?.nodes;
  if (nodes && (!cameraPos || dist < 18)) {
   const n0 = nodes[0], n1 = nodes[1], n2 = nodes[2], n3 = nodes[3];
   // Continuous overlapping spine segments n0 -> n1 -> n2 -> n3
   pushSpanEllipsoid(out, n0.x + n0.fx * hl * 0.14, a.y + ht * 0.05 - pitch * hl * 0.16, n0.z + n0.fz * hl * 0.14, n1.x - n1.fx * hl * 0.10, a.y + ht * 0.06, n1.z - n1.fz * hl * 0.10, n0.lx * hw, bank * hw * 0.6, n0.lz * hw, ht / hw, a.color[0], a.color[1], a.color[2], 0.97 * dens, 0.06, uw, bodyRough, bodyMetal, 0.0, 0.06);
   pushSpanEllipsoid(out, n0.x + n0.fx * hl * 0.08, a.y - ht * 0.22 - pitch * hl * 0.12, n0.z + n0.fz * hl * 0.08, n1.x - n1.fx * hl * 0.08, a.y - ht * 0.20, n1.z - n1.fz * hl * 0.08, n0.lx * hw * 0.92, bank * hw * 0.5, n0.lz * hw * 0.92, (ht * 0.64) / (hw * 0.92), a.accent[0], a.accent[1], a.accent[2], 0.96 * dens, 0.06, uw, bodyRough, bodyMetal * 0.85, 0.0, 0.04);
   pushSpanEllipsoid(out, n1.x + n1.fx * hl * 0.12, a.y + ht * 0.02, n1.z + n1.fz * hl * 0.12, n2.x - n2.fx * hl * 0.10, a.y, n2.z - n2.fz * hl * 0.10, n2.lx * hw * 0.74, bank * hw * 0.4, n2.lz * hw * 0.74, (ht * 0.80) / (hw * 0.74), a.color[0] * 0.82 + a.accent[0] * 0.18, a.color[1] * 0.82 + a.accent[1] * 0.18, a.color[2] * 0.82 + a.accent[2] * 0.18, 0.96 * dens, 0.06, uw, bodyRough + 0.02, bodyMetal * 0.7, 0.0, 0.05);
   if (detailFull) {
    for (const s of [-1, 1]) {
     pushEllipsoid(out, n0.x - n0.fx * hl * 0.06 + n0.lx * s * hw * 0.86, a.y + ht * 0.16, n0.z - n0.fz * hl * 0.06 + n0.lz * s * hw * 0.86, n0.fx * hw * 0.24, 0, n0.fz * hw * 0.24, n0.lx * hw * 0.18, 0, n0.lz * hw * 0.18, 0.9, 0.03, 0.03, 0.035, 0.98 * dens, 0.06, uw, 0.10, 0.0, 0.0, 0.07);
    }
    if (isPompano) {
     pushSpanEllipsoid(out, n1.x + n1.fx * hl * 0.08, a.y + ht * 0.56, n1.z + n1.fz * hl * 0.08, n1.x - n1.fx * hl * 0.34, a.y + ht * 1.56, n1.z - n1.fz * hl * 0.34, n1.fx * hl * 0.20, 0, n1.fz * hl * 0.20, 0.16, a.color[0] * 0.80, a.color[1] * 0.84, a.color[2] * 0.88, 0.94 * dens, 0.07, uw, 0.22, 0.12, 0.0, 0.09);
     pushSpanEllipsoid(out, n1.x, a.y - ht * 0.42, n1.z, n2.x - n2.fx * hl * 0.22, a.y - ht * 1.18, n2.z - n2.fz * hl * 0.22, n1.fx * hl * 0.18, 0, n1.fz * hl * 0.18, 0.16, a.accent[0] * 0.88, a.accent[1] * 0.88, a.accent[2] * 0.82, 0.94 * dens, 0.07, uw, 0.24, 0.10, 0.0, 0.07);
    } else if (isPinfish) {
     const midX = (n0.x + n1.x) * 0.5, midZ = (n0.z + n1.z) * 0.5;
     pushEllipsoid(out, midX - n0.fx * hl * 0.04, a.y + ht * 0.22, midZ - n0.fz * hl * 0.04, n0.fx * hl * 0.14, 0, n0.fz * hl * 0.14, n0.lx * hw * 1.04, 0, n0.lz * hw * 1.04, 0.65, 0.08, 0.09, 0.07, 0.95 * dens, 0.07, uw, 0.24, 0.0, 0.0, 0.06);
     pushEllipsoid(out, n1.x, a.y + ht * 0.84, n1.z, n1.fx * hl * 0.36, 0, n1.fz * hl * 0.36, n1.lx * (-bank * hw * 0.5), ht * 0.38, n1.lz * (-bank * hw * 0.5), 0.18, 0.72, 0.76, 0.54, 0.94 * dens, 0.07, uw, 0.24, 0.0, 0.0, 0.08);
    }
   }
   // Tail fin rooted into peduncle n2 -> n3
   if (isKillifish) {
    pushSpanEllipsoid(out, n2.x, a.y, n2.z, n3.x - n3.fx * hl * 0.26, a.y, n3.z - n3.fz * hl * 0.26, n3.lx * hw * 0.28, 0, n3.lz * hw * 0.28, (ht * 1.18) / (hw * 0.28), a.accent[0] * 0.84, a.accent[1] * 0.84, a.accent[2] * 0.78, 0.94 * dens, 0.07, uw, 0.24, 0.0, 0.0, 0.05);
   } else {
    pushSpanEllipsoid(out, n2.x, a.y, n2.z, n3.x - n3.fx * hl * 0.30, a.y + ht * 0.52, n3.z - n3.fz * hl * 0.30, n3.lx * hw * 0.20, 0, n3.lz * hw * 0.20, (ht * 0.42) / (hw * 0.20), a.accent[0] * 0.90, a.accent[1] * 0.90, a.accent[2] * 0.86, 0.94 * dens, 0.07, uw, 0.22, bodyMetal * 0.6, 0.0, 0.06);
    pushSpanEllipsoid(out, n2.x, a.y, n2.z, n3.x - n3.fx * hl * 0.30, a.y - ht * 0.52, n3.z - n3.fz * hl * 0.30, n3.lx * hw * 0.20, 0, n3.lz * hw * 0.20, (ht * 0.42) / (hw * 0.20), a.accent[0] * 0.90, a.accent[1] * 0.90, a.accent[2] * 0.86, 0.94 * dens, 0.07, uw, 0.22, bodyMetal * 0.6, 0.0, 0.04);
   }
  } else {
   pushEllipsoid(out, a.x + fx * hl * 0.16, a.y, a.z + fz * hl * 0.16, fx * hl * 0.64, 0, fz * hl * 0.64, lx * hw, 0, lz * hw, ht / hw, a.color[0], a.color[1], a.color[2], 0.96 * dens, 0.06, uw, bodyRough, bodyMetal, 0.0, 0.06);
   pushEllipsoid(out, a.x + fx * hl * 0.10, a.y - ht * 0.24, a.z + fz * hl * 0.10, fx * hl * 0.52, 0, fz * hl * 0.52, lx * hw * 0.92, 0, lz * hw * 0.92, (ht * 0.62) / (hw * 0.92), a.accent[0], a.accent[1], a.accent[2], 0.95 * dens, 0.06, uw, bodyRough, bodyMetal * 0.8, 0.0, 0.04);
  }
 }
 return out;
}

function uploadEllipsoidInstance(dstCenter, dstAxis, dstSide, dstTint, dstProps, dstMat, idx, e) {
 const i3 = idx * 3, i4 = idx * 4;
 dstCenter[i3] = e.cx; dstCenter[i3 + 1] = e.cy; dstCenter[i3 + 2] = e.cz;
 dstAxis[i3] = e.ax; dstAxis[i3 + 1] = e.ay; dstAxis[i3 + 2] = e.az;
 dstSide[i3] = e.sx; dstSide[i3 + 1] = e.sy; dstSide[i3 + 2] = e.sz;
 dstTint[i3] = e.r; dstTint[i3 + 1] = e.g; dstTint[i3 + 2] = e.b;
 dstProps[i4] = e.thirdRatio; dstProps[i4 + 1] = e.density; dstProps[i4 + 2] = e.soft; dstProps[i4 + 3] = e.underwater;
 dstMat[i4] = e.rough ?? 0.42; dstMat[i4 + 1] = e.metal ?? 0.0; dstMat[i4 + 2] = e.trans ?? 0.0; dstMat[i4 + 3] = e.bedClear ?? 0.05;
}

function updateFaunaInstances(mesh, count) {
 mesh.visible = count > 0;
 mesh.geometry.instanceCount = count;
 if (!count) return;
 for (const attribute of Object.values(mesh.geometry.attributes)) {
  if (!attribute.isInstancedBufferAttribute) continue;
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, count * attribute.itemSize);
  attribute.needsUpdate = true;
 }
}

export class CoastalFaunaView {
 constructor(view, lighting) {
  this.view = view;
  this.sim = new CoastalFaunaSim(2187);
  this.ellipsoids = [];
  this.maxDist = 68;
  this._activeLand = null;

  const initInstanced = (capacity) => {
   const g = new T.InstancedBufferGeometry();
   g.setIndex([0, 1, 2, 0, 2, 3]);
   g.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
   const bufs = {
    center: new Float32Array(capacity * 3),
    axis: new Float32Array(capacity * 3),
    side: new Float32Array(capacity * 3),
    tint: new Float32Array(capacity * 3),
    props: new Float32Array(capacity * 4),
    mat: new Float32Array(capacity * 4),
   };
   g.setAttribute('instCenter', new T.InstancedBufferAttribute(bufs.center, 3).setUsage(T.DynamicDrawUsage));
   g.setAttribute('instAxis', new T.InstancedBufferAttribute(bufs.axis, 3).setUsage(T.DynamicDrawUsage));
   g.setAttribute('instSide', new T.InstancedBufferAttribute(bufs.side, 3).setUsage(T.DynamicDrawUsage));
   g.setAttribute('instTint', new T.InstancedBufferAttribute(bufs.tint, 3).setUsage(T.DynamicDrawUsage));
   g.setAttribute('instProps', new T.InstancedBufferAttribute(bufs.props, 4).setUsage(T.DynamicDrawUsage));
   g.setAttribute('instMat', new T.InstancedBufferAttribute(bufs.mat, 4).setUsage(T.DynamicDrawUsage));
   g.instanceCount = 0;
   return {g, bufs};
  };

  const opaque = initInstanced(MAX_FAUNA_ELLIPSOIDS);
  const soft = initInstanced(MAX_SOFT_FAUNA_ELLIPSOIDS);
  this.geometry = opaque.g;
  this.instCenter = opaque.bufs.center;
  this.instAxis = opaque.bufs.axis;
  this.instSide = opaque.bufs.side;
  this.instTint = opaque.bufs.tint;
  this.instProps = opaque.bufs.props;
  this.instMat = opaque.bufs.mat;

  this.softGeometry = soft.g;
  this.softCenter = soft.bufs.center;
  this.softAxis = soft.bufs.axis;
  this.softSide = soft.bufs.side;
  this.softTint = soft.bufs.tint;
  this.softProps = soft.bufs.props;
  this.softMat = soft.bufs.mat;

  const g = opaque.g;

  this.uniforms = {
   ...view.uniforms,
   sunDirection: view.uniforms.sunDirection ?? {value: new T.Vector3(-0.6, 1, 0.5).normalize()},
   sunColor: view.uniforms.sunColor ?? {value: new T.Color(1.1, 1.02, 0.88)},
   hazeColor: view.uniforms.hazeColor ?? {value: new T.Color(0.38, 0.45, 0.48)},
   fadeDistance: {value: this.maxDist},
  };

  const vertexShader = `
   attribute vec3 instCenter, instAxis, instSide, instTint;
   attribute vec4 instProps, instMat;
   uniform vec2 viewport;
   uniform float fadeDistance;
   varying vec2 vGaussian;
   varying vec3 vTint, vCenter, vRimWorld, vViewPos, vFlatN, vFrontW;
   varying vec4 vMat;
   varying float vThick, vDensity, vSoft, vUnderwater, vFlatBlend;
   void main() {
    float dist = length(cameraPosition - instCenter);
    if (instProps.y <= 0.002 || dist > fadeDistance + 4.0) {
     gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
     vDensity = 0.0;
     return;
    }
    vec3 crossAS = cross(instAxis, instSide);
    float cLen = length(crossAS);
    vec3 thirdDir = cLen > 1e-6 ? (crossAS / cLen) : vec3(0.0, 1.0, 0.0);
    float lA = length(instAxis), lB = length(instSide);
    float lC = max(1e-4, lB * max(0.05, instProps.x));
    vec3 third = thirdDir * lC;
    float reach = 2.6 * (lA + lB + lC);
    vec4 v = viewMatrix * vec4(instCenter, 1.0);
    float z = -v.z;
    if (z < 0.03 || any(greaterThan(abs(v.xy), (z + reach) / vec2(projectionMatrix[0][0], projectionMatrix[1][1]) + reach))) {
     gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
     vDensity = 0.0;
     return;
    }
    mat3 M = mat3(instAxis, instSide, third);
    mat3 basis = mat3(viewMatrix) * M;
    vec3 px = vec3(1.0, 0.0, v.x / z) * basis * (0.5 * projectionMatrix[0][0] * viewport.x / z);
    vec3 py = vec3(0.0, 1.0, v.y / z) * basis * (0.5 * projectionMatrix[1][1] * viewport.y / z);
    float xx = dot(px, px) + 0.28, yy = dot(py, py) + 0.28, xy = dot(px, py);
    float a = sqrt(xx), b = xy / a;
    float minor = sqrt(max(0.005, yy - b * b));
    float softC = clamp(instProps.z, 0.0, 1.0);
    float cutoff = mix(1.65, 2.25, softC);
    vGaussian = position.xy * cutoff;
    vec2 off = vec2(a * vGaussian.x, b * vGaussian.x + minor * vGaussian.y);
    vec4 clip = projectionMatrix * v;
    clip.xy += off * 2.0 / viewport * clip.w;
    gl_Position = clip;

    vec3 sNorm = px * (position.x / a) + (py - px * (b / a)) * (position.y / minor);
    vec3 sWorld = M * (sNorm * cutoff);
    vCenter = instCenter;
    vRimWorld = sWorld;
    vViewPos = v.xyz + (viewMatrix * vec4(sWorld, 0.0)).xyz;
    vFrontW = normalize(cameraPosition - instCenter);
    vec3 faceN = cLen > 1e-6 ? (-crossAS / cLen) : vFrontW;
    vFlatN = faceforward(faceN, -vFrontW, faceN);
    vFlatBlend = clamp(smoothstep(0.45, 0.14, instProps.x) * 0.55, 0.0, 0.65);
    vec3 invRay = vec3(
     dot(vFrontW, instAxis) / max(1e-10, dot(instAxis, instAxis)),
     dot(vFrontW, instSide) / max(1e-10, dot(instSide, instSide)),
     dot(vFrontW, third) / max(1e-10, dot(third, third))
    );
    vThick = min(1.0 / max(1e-4, length(invRay)), max(lA, max(lB, lC)));
    vTint = instTint;
    vMat = instMat;
    vDensity = instProps.y * smoothstep(fadeDistance + 2.0, fadeDistance - 5.0, dist);
    vSoft = softC;
    vUnderwater = instProps.w;
   }
  `;

  const makeFrag = (isOpaque) => lighting + reflectedSurfaceClip + `
   uniform vec3 hazeColor;
   uniform mat4 projectionMatrix;
   varying vec2 vGaussian;
   varying vec3 vTint, vCenter, vRimWorld, vViewPos, vFlatN, vFrontW;
   varying vec4 vMat;
   varying float vThick, vDensity, vSoft, vUnderwater, vFlatBlend;
   void main() {
    if (vDensity <= 0.005) discard;
    float softC = clamp(vSoft, 0.0, 1.0);
    float g2 = dot(vGaussian, vGaussian);
    float cut = mix(1.65, 2.25, softC);
    if (g2 > cut * cut) discard;
    float k = mix(0.84, 0.22, softC);
    float surf = exp(-0.5 * g2 - 0.5 * k * g2 * g2) * vDensity;
    ${isOpaque
     ? `float aa = clamp(fwidth(surf), 0.002, 0.025); if (surf < 0.24 - aa * 0.35) discard;`
     : `float alpha = clamp(surf, 0.0, 1.0); if (alpha < 0.03) discard;`}
    float dome = sqrt(max(0.0, 1.0 - g2 / mix(1.75, cut * cut, softC)));
    vec3 pSurf = vCenter + vRimWorld + vFrontW * (vThick * dome);
    if (clipWaves && belowReflector(pSurf)) discard;

    float vz = max(0.03, -vViewPos.z);
    float zSurf = max(0.03, vz - vThick * dome);
    vec3 pView = vec3(vViewPos.xy * (zSurf / vz), -zSurf);
    vec4 dclip = projectionMatrix * vec4(pView, 1.0);
    gl_FragDepth = clamp(0.5 + 0.5 * dclip.z / dclip.w, 0.0, 1.0);

    vec3 rawRad = vRimWorld + vFrontW * (max(0.015, vThick) * dome * 0.92);
    vec3 nRad = dot(rawRad, rawRad) > 1e-8 ? normalize(rawRad) : normalize(vFrontW);
    vec3 nSurf = normalize(mix(nRad, normalize(vFlatN), vFlatBlend));

    float sunVis = sampleSunShadow(pSurf, nSurf);
    vec3 lit = shadeLit(vTint, nSurf, pSurf, vec4(vMat.x, vMat.y, 1.0, 0.0), sunVis);

    if (vMat.z > 0.01) {
     vec3 sunD = normalize(sunDirection);
     vec3 viewDir = normalize(cameraPosition - pSurf);
     float back = pow(max(0.0, dot(viewDir, -sunD)), 2.2);
     float wrap = 0.5 + 0.5 * dot(nSurf, sunD);
     lit += vTint * sunColor * (back * 0.65 + wrap * 0.22) * vMat.z * (0.42 + 0.58 * sunVis);
    }

    float ao = clamp(0.66 + 0.34 * smoothstep(0.0, 0.045, vMat.w), 0.65, 1.0);
    lit = lit * ao + vTint * vec3(0.86, 0.80, 0.68) * max(0.0, -nSurf.y) * 0.14 * ao;

    if (vUnderwater > 0.005) {
     float subTone = clamp(vUnderwater * 0.16, 0.0, 0.16);
     lit *= mix(vec3(1.0), vec3(0.84, 0.96, 0.98), subTone);
    }

    float hazeV = 1.0 - exp(-length(cameraPosition - pSurf) * 0.00028);
    lit = mix(lit, hazeColor, hazeV);
    gl_FragColor = vec4(lit, ${isOpaque ? '1.0' : 'alpha'});
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }
  `;

  this.material = new T.ShaderMaterial({
   uniforms: this.uniforms,
   transparent: false,
   depthWrite: true,
   depthTest: true,
   side: T.DoubleSide,
   vertexShader,
   fragmentShader: makeFrag(true),
  });

  this.softMaterial = new T.ShaderMaterial({
   uniforms: this.uniforms,
   transparent: true,
   depthWrite: false,
   depthTest: true,
   side: T.DoubleSide,
   vertexShader,
   fragmentShader: makeFrag(false),
  });

  this.shadowMaterial = new T.ShaderMaterial({
   colorWrite: false,
   depthWrite: true,
   depthTest: true,
   side: T.DoubleSide,
   vertexShader: `
    attribute vec3 instCenter, instAxis, instSide;
    attribute vec4 instProps;
    varying vec2 vG;
    void main() {
     if (instProps.y <= 0.05 || instProps.z >= 0.42) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vG = vec2(9.0);
      return;
     }
     vec3 crossAS = cross(instAxis, instSide);
     float cLen = length(crossAS);
     vec3 thirdDir = cLen > 1e-6 ? (crossAS / cLen) : vec3(0.0, 1.0, 0.0);
     float lB = length(instSide);
     vec3 third = thirdDir * max(1e-4, lB * max(0.05, instProps.x));
     vec3 cV = (modelViewMatrix * vec4(instCenter, 1.0)).xyz;
     vec3 av = mat3(modelViewMatrix) * instAxis;
     vec3 bv = mat3(modelViewMatrix) * instSide;
     vec3 cv = mat3(modelViewMatrix) * third;
     float xx = av.x * av.x + bv.x * bv.x + cv.x * cv.x + 0.000025;
     float yy = av.y * av.y + bv.y * bv.y + cv.y * cv.y + 0.000025;
     float xy = av.x * av.y + bv.x * bv.y + cv.x * cv.y;
     float a = sqrt(xx), b = xy / a, minor = sqrt(max(0.000004, yy - b * b));
     vG = position.xy * 1.25;
     vec2 off = vec2(a * vG.x, b * vG.x + minor * vG.y);
     gl_Position = projectionMatrix * vec4(cV.xy + off, cV.z, 1.0);
    }
   `,
   fragmentShader: 'varying vec2 vG; void main(){ if(dot(vG, vG) > 1.45) discard; gl_FragColor = vec4(0.0); }',
  });

  this.geometry = g;
  this.mesh = new T.Mesh(g, this.material);
  this.mesh.frustumCulled = false;
  this.mesh.renderOrder = 2;
  view.scene.add(this.mesh);

  this.softMesh = new T.Mesh(this.softGeometry, this.softMaterial);
  this.softMesh.frustumCulled = false;
  this.softMesh.renderOrder = 3;
  view.scene.add(this.softMesh);
 }

 get activeAgentCount() {
  return this.sim.activeAgentCount;
 }

 get agents() {
  return this.sim.agents;
 }

 configure(land) {
  this.sim.spawn(land);
 }

 syncPlaced(library, land) {
  this.sim.syncPlaced(library, land);
 }

 animatePlaced(view, land, sea, wind) {
  land = this._activeLand ?? land;
  if (!view || view.mode !== 'world' || view.activePhysics || !this.sim.placedLinks.length || !land) return;
  const t = this.sim.time;
  const seaLevel = sea?.seaLevel ?? land.climate?.seaLevelOffset ?? 0;
  for (const link of this.sim.placedLinks) {
   const group = view.groups?.get(link.id);
   if (!group) continue;
   const inst = view.library?.world?.instances?.find(i => i.id === link.id);
   const isDragged = view.gizmo?.object === group;
   link.gizmoDragged = isDragged;
   if (isDragged) {
    if (inst) {
     const nx = inst.transform.position[0];
     const ny = inst.transform.position[1];
     const nz = inst.transform.position[2];
     link.vx = (nx - link.x) * 30;
     link.vz = (nz - link.z) * 30;
     link.speed = Math.hypot(link.vx, link.vz);
     link.x = nx;
     link.y = ny;
     link.baseY = ny;
     link.z = nz;
     link.anchorX = nx;
     link.anchorZ = nz;
     link.burrowX = nx;
     link.burrowZ = nz;
     link.yaw = Math.PI * 0.5 - ((inst.transform.rotation?.[1] ?? 0) * (Math.PI / 180));
    }
    group.position.set(link.x, link.baseY, link.z);
    group.rotation.order = 'YXZ';
    group.rotation.set(0, Math.atan2(Math.cos(link.yaw || 0), Math.sin(link.yaw || 0)), 0);
    group.updateMatrixWorld(true);
    continue;
   }
   // Ground/water seat compensation so canonical bottom aligns nicely on terrain/water
   let py = link.y;
   if (link.medium === 'air' || link.airborne) {
    const groundY = groundSupportHeight(land, link.x, link.z, 0.06);
    py = Math.max(groundY + 0.14, link.y);
   } else if (link.medium === 'submerged' || link.medium === 'swale-water') {
    const bed = groundSupportHeight(land, link.x, link.z, Math.max(0.05, (link.width || 0.08) * 0.65));
    const wy = waterHeightAt(sea, land, link.x, link.z);
    py = wy - bed > 0.12 ? clamp(link.y, bed + 0.015, wy - 0.08) : bed + 0.014;
   } else {
    const groundY = groundSupportHeight(land, link.x, link.z, Math.max(0.04, (link.width || 0.08) * 0.75));
    py = groundY - (link.burrowDepth || 0) + (link.crabRig?.comHeave || 0);
   }
   group.position.set(link.x, py, link.z);
   group.rotation.order = 'YXZ';
   group.rotation.set(
    clamp(link.pitch || 0, -0.35, 0.35),
    Math.atan2(Math.cos(link.yaw || 0), Math.sin(link.yaw || 0)),
    clamp(-(link.roll || 0), -0.35, 0.35)
   );
   group.updateMatrixWorld(true);
   const swings = computePlacedMarkSwings(link, link.speed || 0, t);
   view.paintView?.setMarkSwings(link.id, swings);
  }
 }

 update(land, camera, wind, sea, dt, ecology, physics = null) {
  if (!land) return;
  const st = physics?.sandTerrain || null;
  let activeLand = land;
  if (st) {
   if (this._viewProxyBase !== land || this._viewProxySand !== st) {
    this._viewProxyBase = land;
    this._viewProxySand = st;
    this._viewProxyLand = resolveEffectiveLand(land, physics);
   }
   activeLand = this._viewProxyLand;
  }
  this._activeLand = activeLand;
  const pos = camera?.position ?? camera;
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.z)) {
   this.sim.ensureSectorsAround(pos.x, pos.z, activeLand);
  }
  this.sim.step(dt, activeLand, wind, sea, ecology, physics);
  collectFaunaEllipsoids(this.sim, pos, this.maxDist, this.ellipsoids);

  let oCount = 0;
  let sCount = 0;
  for (let i = 0; i < this.ellipsoids.length; i++) {
   const e = this.ellipsoids[i];
   if (e.soft >= 0.42) {
    if (sCount < MAX_SOFT_FAUNA_ELLIPSOIDS) {
     uploadEllipsoidInstance(this.softCenter, this.softAxis, this.softSide, this.softTint, this.softProps, this.softMat, sCount++, e);
    }
   } else if (oCount < MAX_FAUNA_ELLIPSOIDS) {
    uploadEllipsoidInstance(this.instCenter, this.instAxis, this.instSide, this.instTint, this.instProps, this.instMat, oCount++, e);
   }
  }

  updateFaunaInstances(this.mesh, oCount);
  updateFaunaInstances(this.softMesh, sCount);
 }

 drawShadows(renderer, shadowCamera) {
  if (!this.mesh.visible || !this.geometry.instanceCount) return;
  this.mesh.material = this.shadowMaterial;
  renderer.render(this.mesh, shadowCamera);
  this.mesh.material = this.material;
 }

 beginGrab(point,radius){
  this.endGrab();this.hand=[];
  for(const animal of this.sim.agents){
   if(!animal.emerged||animal.visibility<.15||animal.alive===false)continue;
   const offset=new T.Vector3(animal.x,animal.y,animal.z).sub(point);
   if(offset.length()>radius+Math.max(.06,animal.len,animal.width))continue;
   animal.carried=true;this.hand.push({animal,offset});
  }
  return this.hand.length;
 }
 moveGrab(point){
  for(const {animal,offset} of this.hand??[]){
   animal.x=point.x+offset.x;animal.y=point.y+offset.y;animal.z=point.z+offset.z;
  }
 }
 endGrab(){
  for(const {animal} of this.hand??[]){animal.carried=false;animal.forageX=animal.x;animal.forageZ=animal.z;}
  this.hand=null;
 }
 pick(ray, nearest) {
  const p = new T.Vector3();
  const closest = new T.Vector3();
  for (const a of this.sim.agents) {
   if (!a.emerged || a.visibility < 0.15) continue;
   p.set(a.x, a.y, a.z);
   const r = Math.max(0.06, a.len * 1.4, a.width * 1.2);
   const d2 = ray.distanceSqToPoint(p);
   if (d2 > r * r) continue;
   ray.closestPointToPoint(p, closest);
   const distance = closest.distanceTo(ray.origin);
   if (nearest && nearest.distance <= distance) continue;
   nearest = {
    point: closest.clone(),
    normal: closest.clone().sub(p).normalize(),
    distance,
    materialId: this.sim.materialByGuild[a.guild] ?? 'crab-chitin',
    propLabel: `${a.commonName} (${a.scientific}) · ${a.stateLabel}${(a.fear || 0) > 0.25 ? ` · fear ${Math.round(a.fear * 100)}%` : ''}`,
   };
  }
  return nearest;
 }

 activeCountsByGuild() {
  const counts = {};
  for (const a of this.sim.agents) {
   counts[a.guild] = (counts[a.guild] || 0) + (a.emerged && a.visibility > 0.2 ? 1 : 0);
  }
  return counts;
 }

 dispose() {
  this.mesh.removeFromParent();
  this.geometry.dispose();
  this.material.dispose();
  this.softMesh.removeFromParent();
  this.softGeometry.dispose();
  this.softMaterial.dispose();
  this.shadowMaterial.dispose();
 }
}
