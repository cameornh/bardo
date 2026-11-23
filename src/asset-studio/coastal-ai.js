// Emergent coastal behavioral ecology, sensory StimulusField, homeostatic drives,
// optimal foraging, and predator-escape AI for wild and user-placed Wind Garden fauna.
//
// Grounded in:
// - Ydenberg & Dill (1986): Optimal Escape Theory (FID vs hunger & refuge distance)
// - Hemmi (2005) / Zeil & Hemmi (2006): angular looming, freeze -> home-run -> burrow & colony waves
// - Charnov (1976): Marginal Value Theorem (MVT) patch depletion & departure
// - Weissburg & Zimmer-Faust (1993): Callinectes cross-flow casting & chemotaxis
// - Couzin et al. (2002): 3-zone collective schooling & flash-expansion predator evasion
// - Domenici & Blake (1997): Mauthner-cell C-start escape trigger

import {INLAND_DIR_X, INLAND_DIR_Z} from './coastal-climate.js';
import {groundSupportHeight, stepCrabIK, stepBipedIK, stepRayUndulation, stepScallopValves, solveFishSpine, solveLizardSpine} from './coastal-kinematics.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;

function detHash(n) {
 let x = (n | 0) ^ 0x9e3779b9;
 x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
 x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
 return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function wrapAngle(a) {
 while (a > Math.PI) a -= Math.PI * 2;
 while (a < -Math.PI) a += Math.PI * 2;
 return a;
}

function cachedGroundSupport(a, land, radius = 0.05, margin = 0.012) {
 if (!land) return a.bedY ?? 0;
 const dx = a.x - (a._gx ?? 1e9);
 const dz = a.z - (a._gz ?? 1e9);
 const hNow = land.height(a.x, a.z);
 if (
  a._gLand !== land ||
  Math.abs(hNow - (a._gRaw ?? 1e9)) > 1e-4 ||
  dx * dx + dz * dz >= 0.004 * 0.004 ||
  (a._gRad || 0) < radius * 0.99 ||
  (a._gMargin || 0) < margin * 0.99
 ) {
  a._gLand = land;
  a._gx = a.x;
  a._gz = a.z;
  a._gRad = radius;
  a._gMargin = margin;
  a._gRaw = hNow;
  a._gSup = groundSupportHeight(land, a.x, a.z, radius, margin);
 }
 return a._gSup;
}

function birdDuneSlope(a, land, footRadius = 0.24) {
 if (!land) return {supH: a.bedY ?? 0, slopeMag: 0, slopePitch: 0, slopeRoll: 0, downX: 0, downZ: 0};
 const supH = cachedGroundSupport(a, land, footRadius, 0.018);
 const fx = Math.cos(a.yaw || 0), fz = Math.sin(a.yaw || 0);
 const lx = -fz, lz = fx;
 const fSpan = Math.max(0.14, footRadius * 0.95);
 const sSpan = Math.max(0.08, (a.width || 0.14) * 0.72);
 const hF = land.height(a.x + fx * fSpan, a.z + fz * fSpan);
 const hB = land.height(a.x - fx * fSpan, a.z - fz * fSpan);
 const hL = land.height(a.x + lx * sSpan, a.z + lz * sSpan);
 const hR = land.height(a.x - lx * sSpan, a.z - lz * sSpan);
 const fwdSlope = (hF - hB) / (2 * fSpan);
 const latSlope = (hL - hR) / (2 * sSpan);
 const slopeMag = Math.hypot(fwdSlope, latSlope);
 // Positive pitch tilts bill DOWN, so uphill (+fwdSlope) requires negative pitch
 const slopePitch = clamp(-fwdSlope * 0.58, -0.34, 0.34);
 const slopeRoll = clamp(latSlope * 0.20, -0.18, 0.18);
 const downX = -(fx * fwdSlope + lx * latSlope);
 const downZ = -(fz * fwdSlope + lz * latSlope);
 const extraClear = slopeMag * fSpan * 0.42;
 const surfMax = Math.max(supH, hF + 0.016, hB + 0.016);
 return {supH: surfMax, slopeMag, slopePitch, slopeRoll, downX, downZ, extraClear};
}

const MAX_STIMULI = 48;

export class StimulusField {
 constructor() {
  this.slots = Array.from({length: MAX_STIMULI}, () => ({
   active: false,
   x: 0,
   y: 0,
   z: 0,
   vx: 0,
   vy: 0,
   vz: 0,
   radius: 3.5,
   intensity: 0,
   kind: 'vibration',
   ttl: 0,
   maxTtl: 1,
   sourceId: null,
  }));
  this._senseOut = {threat: 0, looming: 0, nearDist: Infinity, threatX: 0, threatZ: 0, kind: 'none'};
 }

 get activeCount() {
  let c = 0;
  for (let i = 0; i < this.slots.length; i++) if (this.slots[i].active) c++;
  return c;
 }

 clear() {
  for (let i = 0; i < this.slots.length; i++) this.slots[i].active = false;
 }

 emit(x, y, z, kind = 'vibration', intensity = 1, radius = 4.2, vx = 0, vy = 0, vz = 0, ttl = 0.9, sourceId = null) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  let chosen = null;
  let weakest = this.slots[0];
  let weakestScore = Infinity;

  for (let i = 0; i < this.slots.length; i++) {
   const s = this.slots[i];
   if (sourceId !== null && s.active && s.sourceId === sourceId && s.kind === kind) {
    chosen = s;
    break;
   }
   if (!s.active) {
    chosen = s;
    break;
   }
   const score = s.intensity * (s.ttl / Math.max(0.05, s.maxTtl));
   if (score < weakestScore) {
    weakestScore = score;
    weakest = s;
   }
  }
  const slot = chosen || weakest;
  slot.active = true;
  slot.x = x;
  slot.y = y || 0;
  slot.z = z;
  slot.vx = vx || 0;
  slot.vy = vy || 0;
  slot.vz = vz || 0;
  slot.kind = kind;
  slot.intensity = clamp(intensity, 0.05, 3.0);
  slot.radius = clamp(radius, 0.4, 18.0);
  slot.maxTtl = Math.max(0.12, ttl);
  slot.ttl = slot.maxTtl;
  slot.sourceId = sourceId;
  return slot;
 }

 emitAlarmWave(x, y, z, sourceId = null) {
  return this.emit(x, y, z, 'alarm', 0.85, 1.35, 0, 0, 0, 0.45, sourceId);
 }

 step(dt) {
  for (let i = 0; i < this.slots.length; i++) {
   const s = this.slots[i];
   if (!s.active) continue;
   s.ttl -= dt;
   if (s.ttl <= 0) {
    s.active = false;
    s.intensity = 0;
   }
  }
 }

 harvestWorld(land, sea, physics, placedLinks, dt) {
  if (!land) return;
  // 1. Ocean ripples (splashes / water scoops)
  if (sea?.ripples?.length) {
   for (let i = 0; i < sea.ripples.length; i++) {
    const r = sea.ripples[i];
    const age = (sea.time || 0) - r.t;
    if (age >= 0 && age < 0.75) {
     const inten = clamp((r.scoop ? 0.95 : Math.abs(r.a) * 6.5) * (1 - age / 0.75), 0.18, 1.5);
     this.emit(r.x, land.height(r.x, r.z), r.z, 'splash', inten, r.scoop ? 6.0 : 4.8, 0, 0, 0, 0.25, `ripple-${r.x.toFixed(1)}-${r.z.toFixed(1)}`);
    }
   }
  }
  // 2. Breaking wave crests along the swash line
  if (sea?.crests?.length) {
   for (let i = 0; i < sea.crests.length; i++) {
    const c = sea.crests[i];
    const age = (sea.time || 0) - c.t;
    if (age >= 0 && age < 0.55 && c.frame) {
     this.emit(c.frame.x, land.height(c.frame.x, c.frame.z), c.frame.z, 'splash', 0.75 * (1 - age / 0.55), Math.max(3.5, c.span || 3.5), c.dx || 0, 0, c.dz || 0, 0.28, `crest-${i}`);
    }
   }
  }
  // 3. Fast moving / fallen Rapier physics rigid bodies or sand chunks
  if (physics?.bodies?.size) {
   for (const [key, rec] of physics.bodies) {
    const body = rec?.body;
    if (!body || body.isFixed?.()) continue;
    const t = body.translation();
    const lv = body.linvel?.();
    if (!t || !lv) continue;
    const spd = Math.hypot(lv.x, lv.y, lv.z);
    if (spd > 0.45) {
     const bedY = land.height(t.x, t.z);
     if (Math.abs(t.y - bedY) < 2.2) {
      this.emit(t.x, t.y, t.z, 'vibration', clamp(spd * 0.48, 0.35, 1.8), 4.5, lv.x, lv.y, lv.z, 0.35, `phys-${key}`);
     }
    }
   }
  }
  // 4. User-dragged placed assets (moving gizmo creates looming & substrate vibration)
  if (placedLinks?.length && dt > 0) {
   for (let i = 0; i < placedLinks.length; i++) {
    const pl = placedLinks[i];
    if (pl.gizmoDragged && (pl.speed || 0) > 0.15) {
     this.emit(pl.x, pl.y, pl.z, 'looming', clamp(pl.speed * 0.85, 0.4, 1.8), 3.6, pl.vx || 0, 0, pl.vz || 0, 0.30, `drag-${pl.id}`);
    }
   }
  }
 }

 senseThreat(agent, predators, seaLevel) {
  const out = this._senseOut;
  out.threat = 0;
  out.looming = 0;
  out.nearDist = Infinity;
  out.threatX = agent.x;
  out.threatZ = agent.z;
  out.kind = 'none';

  const isAquatic = agent.speciesId === 'baitfish' || agent.speciesId === 'pompano' || agent.speciesId === 'pinfish' || agent.speciesId === 'killifish' || agent.speciesId === 'blue-crab' || agent.speciesId === 'speckled-crab' || agent.speciesId === 'bay-scallop' || agent.speciesId === 'atlantic-stingray' || agent.speciesId === 'bonnethead-shark' || agent.speciesId === 'grass-shrimp';
  const isAerial = agent.speciesId === 'sand-gnat' || agent.speciesId === 'kelp-fly' || agent.speciesId === 'dragonlet' || agent.speciesId === 'royal-tern' || ((agent.speciesId === 'sanderling' || agent.speciesId === 'laughing-gull' || agent.speciesId === 'tiger-beetle') && agent.airborne);
  const R = 0.22; // nominal threat visual half-radius for Hemmi (2005) retinal rate

  // Active StimulusField events
  for (let i = 0; i < this.slots.length; i++) {
   const s = this.slots[i];
   if (!s.active) continue;
   if (s.sourceId === agent.id || s.sourceId === agent.anchorId) continue;
   if (s.kind === 'alarm' && agent.speciesId !== 'fiddler-crab') continue;
   if (isAerial && s.kind === 'vibration') continue;

   const dx = s.x - agent.x;
   const dy = (s.y - agent.y) * 0.65;
   const dz = s.z - agent.z;
   const d2 = dx * dx + dy * dy + dz * dz;
   if (d2 > s.radius * s.radius) continue;
   const dist = Math.sqrt(d2);
   const decay = clamp(s.ttl / s.maxTtl, 0, 1);
   const spatial = Math.pow(clamp(1 - dist / s.radius, 0, 1), 1.6);
   const vApp = dist > 0.04 ? Math.max(0, -(dx * s.vx + dz * s.vz) / dist) : 0;
   const loom = (2 * R * vApp) / (d2 + R * R);
   const kindBoost = s.kind === 'splash' && isAquatic ? 1.45 : s.kind === 'alarm' ? 1.25 : 1.0;
   const score = s.intensity * decay * spatial * kindBoost + loom * 0.35;
   if (score > 0.05) {
    out.threat += score;
    out.looming = Math.max(out.looming, loom);
    if (dist < out.nearDist) {
     out.nearDist = dist;
     out.threatX = s.x;
     out.threatZ = s.z;
     out.kind = s.kind;
    }
   }
  }

  // Live predator threat + Hemmi angular looming rate
  if (predators?.length) {
   const horizon = isAquatic ? 2.6 : 2.3;
   const h2 = horizon * horizon;
   for (let i = 0; i < predators.length; i++) {
    const p = predators[i];
    if (p === agent || p.id === agent.id) continue;
    const dx = p.x - agent.x;
    const dz = p.z - agent.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > h2) continue;
    const dist = Math.sqrt(d2);
    const rvx = (p.vx || 0) - (agent.vx || 0);
    const rvz = (p.vz || 0) - (agent.vz || 0);
    const vApp = dist > 0.03 ? Math.max(0, -(dx * rvx + dz * rvz) / dist) : 0;
    const prR = Math.max(0.05, (p.width || p.len || 0.08) * 0.85);
    const loom = (2 * prR * vApp) / (d2 + prR * prR);
    const prox = Math.pow(clamp(1 - dist / horizon, 0, 1), 1.8);
    const score = prox * 0.95 + loom * 0.42;
    if (score > 0.08) {
     out.threat += score;
     out.looming = Math.max(out.looming, loom);
     if (dist < out.nearDist) {
      out.nearDist = dist;
      out.threatX = p.x;
      out.threatZ = p.z;
      out.kind = 'predator';
     }
    }
   }
  }
  return out;
 }
}

/**
 * Closed-loop cybernetic ethology controller synthesizing:
 * - Powers (1973) Perceptual Control Theory (reference r_i vs perception p_i -> error e_i),
 * - McFarland & Houston (1981) / McFarland & Sibly (1975) state-space Behavioural Final Common Path
 *   with switching hysteresis to prevent motivational chatter,
 * - Tinbergen (1951) / Lorenz (1950) post-consummatory refractory damping.
 */
export function stepCyberneticLoop(agent, dt, percepts = {}, profile = {}) {
 if (!agent.cyber) {
  agent.cyber = {
   activeDrive: 'forage',
   errSafe: 0,
   errSat: 0,
   errRest: 0,
   refracForage: 0,
   refracEscape: 0,
   refracRest: 0,
   commitTime: 0,
  };
 }
 const c = agent.cyber;
 const safeDt = Math.max(0, dt || 0);
 c.commitTime += safeDt;
 c.refracForage = Math.max(0, c.refracForage - safeDt * (profile.forageDecay ?? 0.28));
 c.refracEscape = Math.max(0, c.refracEscape - safeDt * (profile.escapeDecay ?? 0.45));
 c.refracRest = Math.max(0, c.refracRest - safeDt * (profile.restDecay ?? 0.25));

 const rSafe = profile.refSafety ?? 0.92;
 const rSat = profile.refSatiation ?? 0.84;
 const rRest = profile.refRest ?? 0.80;

 const pSafe = clamp(1 - (percepts.threat ?? agent.fear ?? 0), 0, 1);
 const pSat = clamp(percepts.satiation ?? agent.energy ?? 0.65, 0, 1);
 const pRest = clamp(1 - (percepts.fatigue ?? agent.fatigue ?? 0), 0, 1);

 const eSafe = Math.max(0, rSafe - pSafe);
 const eSat = Math.max(0, rSat - pSat);
 const eRest = Math.max(0, rRest - pRest);

 c.errSafe = eSafe;
 c.errSat = eSat;
 c.errRest = eRest;

 const wSafe = profile.wSafe ?? 2.45;
 const wForage = profile.wForage ?? 1.25;
 const wRest = profile.wRest ?? 1.05;
 const wExplore = profile.wExplore ?? 0.36;

 const foodAvail = percepts.foodAvail ?? (agent.patchRichness ?? 0.7);
 const windEase = percepts.windEase ?? 1.0;
 const satRest = clamp((pSat - 0.62) / 0.30, 0, 1) * (profile.satiatedRest ?? 0.55);
 const restDemand = Math.max(eRest, satRest);

 const scores = {
  escape: eSafe * wSafe * (1 - 0.35 * c.refracEscape),
  forage: eSat * wForage * (0.45 + 0.55 * foodAvail) * (1 - 0.65 * c.refracForage),
  rest: restDemand * wRest * (1.25 - 0.25 * windEase) * (1 - 0.6 * c.refracRest),
  explore: wExplore * clamp(1 - eSafe * 2.2, 0.1, 1.0) * (1 - eSat * 0.4),
 };

 const cur = c.activeDrive in scores ? c.activeDrive : 'forage';
 const hyst = profile.hysteresis ?? 0.14;
 const escapeOverride = eSafe > (profile.urgentSafeErr ?? 0.34);

 let bestDrive = cur;
 let bestScore = scores[cur] + (escapeOverride && cur !== 'escape' ? 0 : hyst);
 for (const key of ['escape', 'forage', 'rest', 'explore']) {
  if (key === cur) continue;
  if (scores[key] > bestScore) {
   bestScore = scores[key];
   bestDrive = key;
  }
 }

 if (bestDrive !== cur) {
  if (cur === 'forage' && pSat >= rSat - 0.06) c.refracForage = 0.85;
  if (cur === 'rest' && pRest >= rRest - 0.06) c.refracRest = 0.80;
  if (cur === 'escape' && eSafe < 0.10) c.refracEscape = 0.40;
  c.activeDrive = bestDrive;
  c.commitTime = 0;
 }
 return c;
}

/**
 * Initialize behavioral ecology, homeostatic drive, and escape state fields on an agent or placed link.
 */
export function initAgentDrives(agent, rng = null) {
 const r0 = rng ? rng() : detHash((agent.id || 1) * 13 + 7);
 const r1 = rng ? rng() : detHash((agent.id || 1) * 31 + 19);
 const rB = rng ? rng() : detHash((agent.id || 1) * 53 + 29);
 const rL = rng ? rng() : detHash((agent.id || 1) * 71 + 41);
 const sp = agent.speciesId;
 let initialDrive = 'forage';
 agent.energy = lerp(0.56, 0.88, r0);
 if (sp === 'atlantic-stingray') {
  const calm = rB < 0.72;
  agent.energy = calm ? lerp(0.72, 0.94, r0) : lerp(0.32, 0.62, r0);
  initialDrive = calm ? 'rest' : 'forage';
 } else if (sp === 'laughing-gull') {
  const calm = rB < 0.62;
  agent.energy = calm ? lerp(0.72, 0.95, r0) : lerp(0.34, 0.65, r0);
  initialDrive = calm ? 'rest' : 'forage';
 } else if (sp === 'royal-tern') {
  const calm = rB < 0.55;
  agent.energy = calm ? lerp(0.70, 0.92, r0) : lerp(0.34, 0.62, r0);
  initialDrive = calm ? 'rest' : 'forage';
 } else if (sp === 'sanderling') {
  const calm = rB < 0.35;
  agent.energy = calm ? lerp(0.72, 0.92, r0) : lerp(0.28, 0.62, r0);
  initialDrive = calm ? 'rest' : 'forage';
 } else if (sp === 'dragonlet') {
  const calm = rB < 0.80;
  agent.energy = calm ? lerp(0.72, 0.94, r0) : lerp(0.30, 0.58, r0);
  initialDrive = calm ? 'rest' : 'forage';
 } else if (sp === 'kelp-fly') {
  const calm = rB < 0.70;
  agent.energy = calm ? lerp(0.70, 0.94, r0) : lerp(0.35, 0.62, r0);
  initialDrive = calm ? 'rest' : 'forage';
 } else if (sp === 'ghost-crab' || sp === 'blue-crab' || sp === 'speckled-crab' || sp === 'hermit-crab' || sp === 'racerunner' || sp === 'tiger-beetle') {
  const calm = rB < 0.45;
  agent.energy = calm ? lerp(0.70, 0.92, r0) : lerp(0.34, 0.64, r0);
  initialDrive = calm ? 'rest' : 'forage';
 } else if (sp === 'bonnethead-shark') {
  initialDrive = 'forage';
 }
 agent.alive = agent.alive !== false;
 agent.satiation = clamp(agent.satiation ?? lerp(0.28, 0.72, r1), 0, 1);
 agent.stamina = clamp(agent.stamina ?? lerp(0.68, 1.0, r0), 0.1, 1);
 const isJuv = agent.lifeStage === 'juvenile' || (agent.lifeStage === undefined && rL < 0.22);
 agent.lifeStage = isJuv ? 'juvenile' : 'adult';
 agent.growth = clamp(agent.growth ?? (isJuv ? lerp(0.36, 0.78, rB) : 1.0), 0.20, 1.0);
 agent.sizeScale = 0.60 + 0.40 * agent.growth;
 const maxAgeMap = {
  'sand-gnat': 240, 'kelp-fly': 320, 'dragonlet': 520, 'beach-hopper': 420,
  'tiger-beetle': 480, 'coquina-clam': 680, 'mole-crab': 650, 'marsh-periwinkle': 800,
  'grass-shrimp': 520, 'fiddler-crab': 780, 'hermit-crab': 840, 'ghost-crab': 920,
  'blue-crab': 960, 'speckled-crab': 920, 'bay-scallop': 900, 'baitfish': 640,
  'killifish': 720, 'pinfish': 1020, 'pompano': 1080, 'racerunner': 950,
  'sanderling': 1250, 'laughing-gull': 1400, 'royal-tern': 1450,
  'atlantic-stingray': 1600, 'bonnethead-shark': 1800,
 };
 agent.maxAge = agent.maxAge ?? (maxAgeMap[sp] || 800);
 agent.age = agent.age ?? lerp(0, agent.maxAge * 0.45, r0);
 agent.reproEnergy = agent.reproEnergy ?? lerp(0.05, 0.42, r1);
 agent.hunger = clamp(1 - (0.65 * agent.energy + 0.35 * agent.satiation), 0, 1);
 agent._calcHunger = agent.hunger;
 agent.fear = 0;
 agent.fatigue = clamp(1 - agent.stamina, 0, 1);
 agent.alertStage = 0; // 0: normal, 1: freeze, 2: flee/home-run, 3: burrow refuge
 agent.alertTimer = 0;
 agent.threatX = agent.x || 0;
 agent.threatZ = agent.z || 0;
 agent.cStartTimer = 0;
 agent.cStartDir = 1;
 agent.patchRichness = lerp(0.65, 1.0, r1);
 agent.patchTime = 0;
 agent.forageX = agent.x || 0;
 agent.forageZ = agent.z || 0;
 agent.feedTimer = 0;
 agent.pelagicSwim = 0;
 agent.yawVel = 0;
 agent.smoothYawRate = 0;
 agent.yawRate = 0;
 agent.speed = agent.speed || 0;
 agent.pitch = 0;
 agent.roll = 0;
 agent.preyTarget = null;
 agent.homeX = agent.homeX ?? agent.burrowX ?? agent.x ?? 0;
 agent.homeZ = agent.homeZ ?? agent.burrowZ ?? agent.z ?? 0;
 agent.castBias = (r0 < 0.5 ? -1 : 1);
 agent.cyber = {
  activeDrive: initialDrive,
  errSafe: 0,
  errSat: 0,
  errRest: 0,
  refracForage: 0,
  refracEscape: 0,
  refracRest: 0,
  commitTime: 0,
 };
 return agent;
}

const smoothstep01 = (a, b, x) => {
 const u = clamp((x - a) / (b - a), 0, 1);
 return u * u * (3 - 2 * u);
};

function sampleLocalWind(land, x, z, bed, ctx) {
 const exp = land?.windExposure ? land.windExposure(x, z, bed) : 1.0;
 const spd = (ctx.windSpd || 0) * exp;
 const wx = (ctx.windX || 0) * exp;
 const wz = (ctx.windZ || 0) * exp;
 const surfChop = clamp(((ctx.windSpd || 0) - 4.5) / 10.5, 0, 1);
 const saltation = bed > (ctx.seaLevel || 0) + 0.22 ? clamp((spd - 6.8) / 8.0, 0, 1) : 0;
 return {exp, spd, wx, wz, surfChop, saltation};
}

function leewardShelterGradient(land, x, z, step = 4.0) {
 if (!land?.windExposure) return {gx: 0, gz: 0, exp: 1};
 const eC = land.windExposure(x, z);
 const gx = (land.windExposure(x - step, z) - land.windExposure(x + step, z)) / (2 * step);
 const gz = (land.windExposure(x, z - step) - land.windExposure(x, z + step)) / (2 * step);
 const m = Math.hypot(gx, gz);
 if (m < 1e-5) return {gx: 0, gz: 0, exp: eC};
 return {gx: gx / m, gz: gz / m, exp: eC};
}

function avoidShallowGradient(a, land, seaLevel, waterY, minDepth, lookDist, dt, isPlaced) {
 const curBed = land.height(a.x, a.z);
 const curDepth = waterY - curBed;
 const yaw = a.yaw || 0;
 let minAhead = curDepth;
 const probes = [0, 0.52, -0.52];
 for (let i = 0; i < probes.length; i++) {
  const ang = yaw + probes[i];
  const px = a.x + Math.cos(ang) * lookDist;
  const pz = a.z + Math.sin(ang) * lookDist;
  const dP = seaLevel - land.height(px, pz);
  if (dP < minAhead) minAhead = dP;
 }
 const eps = 0.65;
 // Gradient pointing toward LOWER bed height = DEEPER water
 const gx = -(land.height(a.x + eps, a.z) - land.height(a.x - eps, a.z)) / (2 * eps);
 const gz = -(land.height(a.x, a.z + eps) - land.height(a.x, a.z - eps)) / (2 * eps);
 let gm = Math.hypot(gx, gz);
 let ux = gm > 0.02 ? gx / gm : (a.band === 'bay' ? INLAND_DIR_X : -INLAND_DIR_X);
 let uz = gm > 0.02 ? gz / gm : (a.band === 'bay' ? INLAND_DIR_Z : -INLAND_DIR_Z);
 if (a.band === 'bay' && a.homeX !== undefined && curDepth < minDepth * 1.1) {
  const hx = a.homeX - a.x, hz = a.homeZ - a.z, hm = Math.hypot(hx, hz) || 1;
  ux = lerp(ux, hx / hm, 0.5);
  uz = lerp(uz, hz / hm, 0.5);
  const rm = Math.hypot(ux, uz) || 1;
  ux /= rm; uz /= rm;
 }
 const weight = smoothstep01(minDepth * 1.85, minDepth * 0.65, minAhead);
 if (!isPlaced && curDepth < minDepth * 0.45 && dt > 0) {
  // Soft depth cushion drift without touching yaw or teleporting backward
  const cushion = Math.min(0.28 * dt, Math.max(0, minDepth * 0.50 - curDepth) * 0.55);
  a.x += ux * cushion;
  a.z += uz * cushion;
 }
 return {avoidX: ux, avoidZ: uz, weight};
}

function smoothSteer(a, targetYaw, dt, {maxYawRate = 1.8, yawAccel = 4.2, targetSpeed = 0.6, speedRate = 3.0, rollGain = 0.22, maxRoll = 0.34, kp = 2.4, rateFilter = 6.0} = {}) {
 const err = wrapAngle(targetYaw - (a.yaw || 0));
 const desVel = clamp(err * kp, -maxYawRate, maxYawRate);
 const ay = 1 - Math.exp(-yawAccel * dt);
 a.yawVel = lerp(a.yawVel || 0, desVel, ay);
 a.yaw = wrapAngle((a.yaw || 0) + a.yawVel * dt);
 a.smoothYawRate = lerp(a.smoothYawRate || 0, a.yawVel, 1 - Math.exp(-rateFilter * dt));
 a.yawRate = a.smoothYawRate;
 a.speed = lerp(a.speed ?? targetSpeed, targetSpeed, 1 - Math.exp(-speedRate * dt));
 a.roll = lerp(a.roll || 0, clamp(-a.smoothYawRate * rollGain, -maxRoll, maxRoll), 1 - Math.exp(-5.0 * dt));
}

function consumePrey(predator, prey, energyGain, ctx, label = '') {
 if (!prey || prey.isPlaced || prey.alive === false || (prey.visibility ?? 1) <= 0.05) return false;
 if (ctx.consumePrey) return ctx.consumePrey(predator, prey, energyGain, label);
 prey.alive = false;
 prey.visibility = 0;
 prey.deathCause = 'predation';
 predator.satiation = Math.min(1, (predator.satiation ?? 0.4) + energyGain);
 predator.energy = Math.min(1, predator.energy + energyGain * 0.35);
 predator.feedTimer = 1.05;
 predator.captures = (predator.captures || 0) + 1;
 return true;
}

function stepPhysiology(a, dt, workFactor, windPowerMult, ctx, isPlaced) {
 if (!(dt > 0) || a.alive === false) return;
 // Sync with any external hunger override (e.g., scenario tests setting energy & hunger directly)
 if (a.hunger !== undefined && a._calcHunger !== undefined && Math.abs(a.hunger - a._calcHunger) > 0.02) {
  a.satiation = clamp(1 - a.hunger, 0, 1);
 }
 // Gut digestion transfers satiation smoothly into metabolic reserves
 const digest = Math.min(a.satiation ?? 0, dt * 0.055);
 if (digest > 0) {
  a.satiation = Math.max(0, (a.satiation ?? 0) - digest);
  a.energy = Math.min(1, (a.energy ?? 0.7) + digest * 0.88);
 }
 // Kleiber-scaled basal & locomotion metabolic rate (small ectotherms/insects turn over faster per unit time)
 const massProxy = clamp((a.len || 0.08) * (a.sizeScale ?? 1), 0.005, 0.65);
 const bmr = clamp(0.0022 * Math.pow(0.08 / massProxy, 0.22), 0.0014, 0.0048);
 const burn = bmr * (0.45 + 0.90 * workFactor * windPowerMult) * dt;
 a.energy = clamp((a.energy ?? 0.7) - burn, 0, 1);
 if (isPlaced) a.energy = Math.max(0.08, a.energy);

 // Stamina & anaerobic recovery (sync with any external fatigue override first)
 if (a.fatigue !== undefined && Math.abs(a.fatigue - (1 - (a.stamina ?? 0.8))) > 0.02) {
  a.stamina = clamp(1 - a.fatigue, 0, 1);
 }
 if (workFactor > 1.25) {
  a.stamina = Math.max(0, (a.stamina ?? 0.8) - dt * 0.14 * (workFactor - 1.0) * windPowerMult);
 } else {
  a.stamina = Math.min(1, (a.stamina ?? 0.8) + dt * (workFactor < 0.75 ? 0.22 : 0.07));
 }
 a.fatigue = clamp(1 - a.stamina, 0, 1);
 a.hunger = clamp(1 - (0.65 * a.energy + 0.35 * (a.satiation ?? 0)), 0, 1);
 a._calcHunger = a.hunger;

 // Ontogenetic growth (juvenile -> adult) & bounded energetic reproduction
 a.age = (a.age || 0) + dt;
 if (a.lifeStage === 'juvenile' && a.energy > 0.50) {
  a.growth = clamp((a.growth ?? 0.6) + dt * 0.022 * (a.energy - 0.35), 0.2, 1.0);
  a.sizeScale = 0.60 + 0.40 * a.growth;
  if (a.growth >= 0.995) {
   a.lifeStage = 'adult';
   a.growth = 1.0;
   a.sizeScale = 1.0;
  }
 }
 if (!isPlaced && a.lifeStage === 'adult' && a.energy > 0.80 && (a.satiation ?? 0) > 0.42 && a.stamina > 0.48) {
  a.reproEnergy = (a.reproEnergy || 0) + dt * 0.065;
  if (a.reproEnergy >= 1.0 && ctx.onBirth) {
   a.reproEnergy = 0;
   a.energy = Math.max(0.42, a.energy - 0.28);
   ctx.onBirth(a);
  }
 }
 if (!isPlaced && (a.energy <= 0.0005 || a.age >= (a.maxAge || 900))) {
  a.alive = false;
  a.visibility = 0;
  a.deathCause = a.energy <= 0.0005 ? 'starvation' : 'senescence';
  ctx.onDeath?.(a, a.deathCause);
 }
}

function advanceSidewaysYaw(currentYaw, vx, vz, dt = 0) {
 const mag = Math.hypot(vx, vz);
 if (mag < 1e-4) return currentYaw;
 const moveAng = Math.atan2(vz, vx);
 // Crabs run sideways with either left (+PI/2) or right (-PI/2) leading: choose closest side to avoid sudden 180 flip!
 const candA = moveAng - Math.PI * 0.5;
 const candB = moveAng + Math.PI * 0.5;
 const errA = Math.abs(wrapAngle(candA - currentYaw));
 const errB = Math.abs(wrapAngle(candB - currentYaw));
 const tgt = errA <= errB ? candA : candB;
 if (dt > 0) return wrapAngle(currentYaw + clamp(wrapAngle(tgt - currentYaw), -9.5 * dt, 9.5 * dt));
 return tgt;
}

/**
 * Update one animal's behavioral AI + IK/spine locomotion. Works identically for
 * wild ecosystem agents and placed Asset Studio animals (`isPlaced = true`).
 */
export function updateAgentAI(a, dt, ctx, isPlaced = false) {
 const {
  time, land, sea, wind, ecology, stimuli, seaLevel,
  windSpd, windX, windZ, nearList,
  hoppers, moleCrabs, ghostCrabs, fiddlers, swimmingCrabs, scallops, birds, raysAndSharks,
  predatorsSea, baitPodLists, baitPods, fishSurface, shrimp, snails, dunePrey, carcasses,
  gnatClouds, swaleBasins,
  wrackDAt, wrackCenterFn, alongWorldFn, worldAtShoreFn, waterHeightAtFn,
 } = ctx;

 if (a.energy === undefined) initAgentDrives(a);
 if (a.alive === false) return;

 const localHoppers = nearList ? nearList('hoppers', a) : hoppers;
 const localMoleCrabs = nearList ? nearList('moleCrabs', a) : moleCrabs;
 const localGhostCrabs = nearList ? nearList('ghostCrabs', a) : ghostCrabs;
 const localSwimmingCrabs = nearList ? nearList('swimmingCrabs', a) : swimmingCrabs;
 const localScallops = nearList ? nearList('scallops', a) : scallops;
 const localRaysSharks = nearList ? nearList('raysAndSharks', a) : raysAndSharks;
 const localPredatorsSea = nearList ? nearList('predatorsSea', a) : predatorsSea;
 const localFishSurface = nearList ? nearList('fishSurface', a) : fishSurface;
 const localShrimp = nearList ? nearList('shrimp', a) : shrimp;
 const localSnails = nearList ? nearList('snails', a) : snails;
 const localDunePrey = nearList ? nearList('dunePrey', a) : dunePrey;

 const idNum = typeof a.id === 'number' ? a.id : Math.floor((a.phase || 1) * 100);
 const prevYaw = a.yaw || 0;
 const prevSpd = a.speed || 0;
 const bedRaw = land ? land.height(a.x, a.z) : (a.bedY ?? 0);
 const localW = sampleLocalWind(land, a.x, a.z, bedRaw, ctx);
 const upwindYaw = localW.spd > 0.25 ? Math.atan2(-localW.wz, -localW.wx) : prevYaw;

 // 1. Dynamic Energy Budget, locomotion work, aerodynamic wind cost, ontogeny & mortality
 const isResting = a.state === 'burrowed' || a.state === 'buried-resting' || a.state === 'resting' ||
  a.state === 'incubating' || a.state === 'loafing' || a.state === 'roosting' ||
  a.state === 'perched' || a.state === 'alighted' || a.state === 'hiding' ||
  a.state === 'burrow-watching' || a.state === 'shell-retracted' || a.state === 'basking' || a.alertStage === 1;
 const isFlying = !!(a.airborne || a.speciesId === 'sand-gnat' || (a.speciesId === 'kelp-fly' && !isResting) || (a.speciesId === 'dragonlet' && !isResting));
 let windPowerMult = 1.0;
 if (isFlying && localW.spd > 0.5) {
  const cosAlign = (Math.cos(prevYaw) * localW.wx + Math.sin(prevYaw) * localW.wz) / Math.max(0.1, localW.spd);
  const headFrac = clamp(-cosAlign, 0, 1);
  windPowerMult = 1.0 + 0.45 * headFrac * clamp(localW.spd / 6.0, 0, 1.5) + 0.04 * localW.spd;
 }
 const refCruise = a.airborne ? 5.2 : (a.speciesId === 'ghost-crab' || a.speciesId === 'bonnethead-shark' || a.speciesId === 'pompano' ? 0.65 : 0.25);
 const workFactor = isResting ? 0.35 : clamp(0.65 + (prevSpd / refCruise) * 0.95 + (a.alertStage === 2 ? 0.65 : 0), 0.5, 2.4);
 if (a.feedTimer > 0) a.feedTimer = Math.max(0, a.feedTimer - dt);
 stepPhysiology(a, dt, workFactor, windPowerMult, ctx, isPlaced);
 if (a.alive === false) return;

 a.fear = Math.max(0, a.fear * Math.exp(-dt * (a.alertStage === 3 ? 0.45 : 0.72)) - dt * 0.02);

 // ---------------- MOLE CRAB (Emerita talpoida) ----------------
 if (a.speciesId === 'mole-crab') {
  const seaShift = -seaLevel * 7.2 - localW.surfChop * 1.4;
  const sense = stimuli ? stimuli.senseThreat(a, localGhostCrabs, seaLevel) : {threat: 0, nearDist: Infinity};
  let flowSurf = 0;
  if (sea?.flow) flowSurf = (sea.flow(a.x, a.z).x * INLAND_DIR_X + sea.flow(a.x, a.z).z * INLAND_DIR_Z) * 0.55;
  const waveSurge = Math.sin(time * 0.85 + (a.homeAlong || 0) * 0.16) * (1.35 + 0.35 * localW.surfChop) + flowSurf;
  const targetD = isPlaced ? land.shoreDistance(a.anchorX ?? a.x, a.anchorZ ?? a.z) + waveSurge * 0.35 : (seaShift + (a.dOffset || 0) * 0.55 + waveSurge);
  const homeAlong = a.homeAlong ?? alongWorldFn(land, a.x, a.z);
  const [tx, tz] = worldAtShoreFn(land, targetD, homeAlong + Math.sin(time * 0.22 + idNum) * 0.7);
  const nextX = lerp(a.x, tx, Math.min(1, dt * 1.8));
  const nextZ = lerp(a.z, tz, Math.min(1, dt * 1.8));
  a.vx = (nextX - a.x) / Math.max(1e-3, dt);
  a.vz = (nextZ - a.z) / Math.max(1e-3, dt);
  a.x = nextX;
  a.z = nextZ;
  a.speed = Math.hypot(a.vx, a.vz);

  const bed = land.height(a.x, a.z);
  a.bedY = bed;
  const waterY = waterHeightAtFn(sea, land, a.x, a.z);
  const inWash = waterY > bed - 0.04;
  if (sense.threat > 0.28) a.fear = Math.min(1, Math.max(a.fear, sense.threat * 0.95));

  if (a.fear > 0.32 || sense.nearDist < 1.3) {
   a.state = 'burrowing';
   a.stateLabel = 'burrowing into wet sand';
   a.burrowDepth = lerp(a.burrowDepth || 0, (a.height || 0.015) * 0.92, Math.min(1, dt * 5.2));
  } else if (Math.abs(waveSurge) > 1.05 && inWash) {
   a.state = 'swash-riding';
   a.stateLabel = 'surfing swash wave';
   a.burrowDepth = lerp(a.burrowDepth || 0, -0.004, Math.min(1, dt * 4.2));
  } else {
   a.state = 'filter-feeding';
   a.stateLabel = 'filter-feeding in backwash';
   a.burrowDepth = lerp(a.burrowDepth || 0, (a.height || 0.015) * 0.40, Math.min(1, dt * 3.0));
   const planktonRich = ecology ? clamp(ecology.resources.plankton ?? 1, 0.2, 1.5) : 1.0;
   if (inWash) a.satiation = Math.min(1, (a.satiation ?? 0.4) + dt * 0.045 * planktonRich);
  }
  const burFrac = clamp((a.burrowDepth || 0) / Math.max(0.004, a.height || 0.015), 0, 1);
  const supH = a.state === 'swash-riding' ? groundSupportHeight(land, a.x, a.z, Math.max(0.025, (a.width || 0.02) * 0.8)) : bed;
  a.bedY = supH;
  a.y = (a.state === 'swash-riding' ? Math.max(bed, supH) : bed) + (a.height || 0.015) * (0.48 - 0.42 * burFrac);
  const tgtPitch = a.state === 'burrowing' ? 0.58 : a.state === 'filter-feeding' ? 0.28 : -0.06;
  a.pitch = lerp(a.pitch || 0, tgtPitch, Math.min(1, dt * 6));
  a.yaw = Math.atan2(-INLAND_DIR_Z, -INLAND_DIR_X) + Math.sin(a.phase * 0.2) * 0.2;
  a.yawRate = wrapAngle(a.yaw - prevYaw) / Math.max(1e-3, dt);
  return;
 }

 // ---------------- BEACH HOPPER (Americorchestia megalophthalma) ----------------
 if (a.speciesId === 'beach-hopper') {
  if (a.airY > 0 || a.vy > 0) {
   a.vx += localW.wx * 0.28 * dt;
   a.vz += localW.wz * 0.28 * dt;
   a.x += a.vx * dt;
   a.z += a.vz * dt;
   a.airY += a.vy * dt;
   a.vy -= 9.81 * dt;
   a.speed = Math.hypot(a.vx, a.vz);
   a.airPitch = clamp(Math.atan2(a.vy, Math.max(0.25, a.speed)) * 0.72, -0.78, 0.78);
   a.pitch = a.airPitch;
   if (a.airY <= 0) {
    a.airY = 0; a.vy = 0; a.vx = 0; a.vz = 0; a.speed = 0; a.airPitch = 0; a.pitch = 0;
    a.state = a.fear > 0.3 ? 'cryptic-freeze' : 'scuttling';
    a.stateLabel = a.fear > 0.3 ? 'cryptic motionless landing' : 'scuttling wrack';
    a.alertTimer = a.fear > 0.3 ? 0.55 : 0;
    a.jumpCooldown = lerp(0.9, 3.4, detHash(idNum * 17 + Math.floor(time * 2)));
   }
  } else if (a.alertTimer > 0) {
   a.airPitch = 0; a.pitch = 0;
   a.alertTimer = Math.max(0, a.alertTimer - dt);
   a.vx = 0; a.vz = 0; a.speed = 0;
  } else {
   a.airPitch = 0; a.pitch = 0;
   a.jumpCooldown -= dt * (0.6 + (a.activity ?? 1) + a.hunger * 0.35);
   const sense = stimuli ? stimuli.senseThreat(a, localGhostCrabs, seaLevel) : {threat: 0, nearDist: Infinity};
   let spooked = sense.threat > 0.32 || sense.nearDist < 1.25;
   if (!spooked && ghostCrabs?.length) {
    for (let i = 0; i < ghostCrabs.length; i++) {
     const gc = ghostCrabs[i];
     if (gc.alive === false) continue;
     const dx = a.x - gc.x, dz = a.z - gc.z;
     if (dx * dx + dz * dz < 1.25 * 1.25) { spooked = true; sense.threatX = gc.x; sense.threatZ = gc.z; break; }
    }
   }
   if (spooked || (a.jumpCooldown <= 0 && localW.saltation < 0.65)) {
    if (spooked) {
     a.fear = Math.min(1, Math.max(a.fear, 0.85));
     const dx = a.x - sense.threatX, dz = a.z - sense.threatZ;
     const dist = Math.hypot(dx, dz);
     const ang = dist > 1e-4 ? Math.atan2(dz, dx) : a.yaw;
     a.vx = Math.cos(ang) * 1.05;
     a.vz = Math.sin(ang) * 1.05;
    } else {
     const ang = a.yaw + Math.sin(time * 2.1 + idNum) * 1.35;
     const hSpd = 0.45 + 0.4 * detHash(idNum * 29 + Math.floor(time));
     a.vx = Math.cos(ang) * hSpd;
     a.vz = Math.sin(ang) * hSpd;
    }
    a.vy = spooked ? 1.85 : lerp(1.15, 1.65, detHash(idNum * 19 + 3));
    a.yaw = Math.atan2(a.vz, a.vx);
    a.speed = Math.hypot(a.vx, a.vz);
    a.state = 'leaping';
    a.stateLabel = spooked ? 'evasive amphipod leap' : 'hopping across wrack';
   } else {
    a.patchTime += dt;
    if (a.patchRichness < 0.25 || a.patchTime > 5.5) {
     a.patchRichness = 0.85; a.patchTime = 0; a.yaw += 1.4;
    }
    const wrackTgt = isPlaced ? land.shoreDistance(a.anchorX ?? a.x, a.anchorZ ?? a.z) : wrackDAt(land, alongWorldFn(land, a.x, a.z), seaLevel);
    const dErr = clamp(wrackTgt + ((a.homeD ?? wrackTgt) - wrackTgt) * 0.5 - land.shoreDistance(a.x, a.z), -2, 2);
    const scuttle = (localW.saltation > 0.55 ? 0.04 : 0.085) * (a.activity ?? 1) * (0.7 + 0.6 * a.hunger);
    const lee = localW.saltation > 0.35 ? leewardShelterGradient(land, a.x, a.z, 3.0) : {gx: 0, gz: 0};
    a.yaw += Math.sin(a.phase * 0.7 + idNum) * 1.5 * dt;
    a.vx = Math.cos(a.yaw) * scuttle + INLAND_DIR_X * dErr * 0.14 + lee.gx * localW.saltation * 0.08;
    a.vz = Math.sin(a.yaw) * scuttle + INLAND_DIR_Z * dErr * 0.14 + lee.gz * localW.saltation * 0.08;
    a.x += a.vx * dt; a.z += a.vz * dt;
    a.speed = Math.hypot(a.vx, a.vz);
    a.state = 'feeding';
    a.stateLabel = localW.saltation > 0.55 ? 'sheltering under sand wrack' : 'grazing wrack biofilm';
    const wrackRich = ecology ? clamp(ecology.resources.wrack ?? 1, 0.15, 1.5) : 1.0;
    a.satiation = Math.min(1, (a.satiation ?? 0.4) + dt * 0.055 * wrackRich);
    if (carcasses?.length) {
     for (let i = 0; i < carcasses.length; i++) {
      const c = carcasses[i];
      if (c.nutrition > 0.01 && Math.hypot(c.x - a.x, c.z - a.z) < 0.6) {
       a.satiation = Math.min(1, (a.satiation ?? 0.4) + dt * 0.12);
       c.nutrition = Math.max(0, c.nutrition - dt * 0.02);
       ecology?.recordCarcassScavenge?.(dt * 0.01);
       break;
      }
     }
    }
   }
  }
  const supH = cachedGroundSupport(a, land, Math.max(0.03, (a.len || 0.018) * (a.sizeScale ?? 1) * 1.4));
  a.bedY = supH;
  a.y = supH + (a.airY || 0) + (a.height || 0.008) * (a.sizeScale ?? 1) * 0.72;
  a.yawRate = wrapAngle(a.yaw - prevYaw) / Math.max(1e-3, dt);
  return;
 }

 // ---------------- GHOST CRAB (Ocypode quadrata) ----------------
 if (a.speciesId === 'ghost-crab') {
  const bx = isPlaced ? (a.anchorX ?? a.burrowX ?? a.x) : (a.burrowX ?? a.x);
  const bz = isPlaced ? (a.anchorZ ?? a.burrowZ ?? a.z) : (a.burrowZ ?? a.z);
  const distBurrow = Math.hypot(bx - a.x, bz - a.z);

  const sense = stimuli ? stimuli.senseThreat(a, predatorsSea, seaLevel) : {threat: 0, looming: 0, nearDist: Infinity};
  if (sense.threat > 0.14) {
   a.fear = Math.min(1, Math.max(a.fear, sense.threat));
   a.threatX = sense.threatX;
   a.threatZ = sense.threatZ;
  }

  const fidThresh = (0.36 + 0.16 * a.hunger) / (1 + 0.04 * Math.min(8, distBurrow));

  if (a.alertStage === 3) {
   a.state = 'burrowed';
   a.stateLabel = localW.saltation > 0.55 ? 'sheltered inside burrow from blowing sand' : 'sheltered in sand burrow';
   a.vx = 0; a.vz = 0; a.speed = 0;
   a.alertTimer -= dt;
   if (a.alertTimer <= 0 && a.fear < 0.20 && a.fatigue < 0.30 && localW.saltation < 0.65) {
    a.alertStage = 0;
    a.state = 'foraging';
    a.stateLabel = 'emerging from burrow';
   }
  } else if (a.fear > fidThresh && a.alertStage === 0) {
   a.alertStage = 1;
   a.alertTimer = clamp(0.45 + detHash(idNum * 11 + Math.floor(time)) * 0.45, 0.35, 0.9);
   a.vx = 0; a.vz = 0; a.speed = 0;
   a.state = 'vigilant';
   a.stateLabel = 'alert freeze (assessing looming threat)';
  } else if (a.alertStage === 1) {
   a.vx = 0; a.vz = 0; a.speed = 0;
   a.state = 'vigilant';
   a.stateLabel = 'alert freeze (eyestalks raised)';
   if (Number.isFinite(a.threatX) && Number.isFinite(a.threatZ)) {
    const faceThreat = Math.atan2(a.threatZ - a.z, a.threatX - a.x) + Math.sin(time * 2.2 + idNum) * 0.08;
    a.yaw = wrapAngle(a.yaw + clamp(wrapAngle(faceThreat - a.yaw), -3.5 * dt, 3.5 * dt));
   }
   a.alertTimer -= dt;
   if (a.fear > fidThresh * 1.55 || sense.nearDist < 1.35 || (a.alertTimer <= 0 && a.fear > fidThresh * 0.85)) {
    a.alertStage = 2;
   } else if (a.alertTimer <= 0 && a.fear <= fidThresh * 0.75) {
    a.alertStage = 0;
   }
  } else if (a.alertStage === 2) {
   const toBX = bx - a.x, toBZ = bz - a.z;
   const dB = Math.hypot(toBX, toBZ);
   const tx = a.threatX - a.x, tz = a.threatZ - a.z;
   const dT = Math.max(0.05, Math.hypot(tx, tz));
   const pathBlocked = dB > 0.45 && dT < 1.15 && ((toBX * tx + toBZ * tz) / (dB * dT)) > 0.55;

   if (pathBlocked && dT < 0.95) {
    a.state = 'threat-display';
    a.stateLabel = 'defensive meral claw spread';
    a.vx = -(tx / dT) * 0.25; a.vz = -(tz / dT) * 0.25;
    a.yaw = Math.atan2(tz, tx);
   } else if (dB < 0.14 && !isPlaced) {
    a.alertStage = 3;
    a.state = 'burrowed';
    a.stateLabel = 'retreated down burrow';
    a.vx = 0; a.vz = 0;
    a.alertTimer = 2.0 + detHash(idNum * 23) * 1.8;
   } else if (dB > 0.18) {
    const sprintSpd = (1.12 - 0.35 * a.fatigue) * (0.75 + 0.35 * (a.activity ?? 1));
    a.vx = lerp(a.vx, (toBX / dB) * sprintSpd, Math.min(1, dt * 8));
    a.vz = lerp(a.vz, (toBZ / dB) * sprintSpd, Math.min(1, dt * 8));
    a.yaw = advanceSidewaysYaw(a.yaw, a.vx, a.vz, dt);
    a.state = 'dashing-burrow';
    a.stateLabel = isPlaced ? 'scuttling rapidly away from threat' : 'home-run sprint to burrow';
   } else {
    a.vx = lerp(a.vx, 0, Math.min(1, dt * 8));
    a.vz = lerp(a.vz, 0, Math.min(1, dt * 8));
    if (a.fear < 0.35) a.alertStage = 0;
   }
  } else {
   const windEase = clamp(1 - localW.saltation, 0.25, 1.0);
   const cyberGhost = stepCyberneticLoop(a, dt, {threat: a.fear, satiation: clamp(a.satiation ?? a.energy, 0, 1), fatigue: a.fatigue, foodAvail: a.patchRichness, windEase}, {wSafe: 2.6, satiatedRest: 0.72, hysteresis: 0.15});
   const wantBurrowRest = !isPlaced && (cyberGhost.activeDrive === 'rest' || localW.saltation > 0.58 || ((a.activity ?? 1) < 0.55 && a.energy > 0.58));
   a.stateTimer -= dt;
   const wrackWeight = ecology ? clamp(1.15 - ecology.resources.wrack * 0.55, 0.2, 1.0) : 0.45;
   const preferMole = wrackWeight > 0.68;
   let best = null, bestD2 = isPlaced ? 36 : 120, bestIsCarcass = false;
   if (!wantBurrowRest && carcasses?.length) {
    for (let i = 0; i < carcasses.length; i++) {
     const c = carcasses[i];
     if (c.nutrition <= 0.02) continue;
     const d2 = (c.x - a.x) ** 2 + (c.z - a.z) ** 2;
     if (d2 < bestD2) { bestD2 = d2; best = c; bestIsCarcass = true; }
    }
   }
   const preyLists = preferMole ? [localMoleCrabs, localHoppers, localDunePrey] : [localHoppers, localMoleCrabs, localDunePrey];
   if (!wantBurrowRest && !best) {
    for (let li = 0; li < preyLists.length; li++) {
     const list = preyLists[li];
     if (!list?.length) continue;
     for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p === a || p.alive === false || p.isPlaced || (p.airY || 0) > 0.08) continue;
      const d2 = (p.x - a.x) ** 2 + (p.z - a.z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = p; }
     }
    }
   }

   if (wantBurrowRest) {
    const dx = bx - a.x, dz = bz - a.z, d = Math.hypot(dx, dz);
    if (d > 0.18) {
     const spd = localW.saltation > 0.55 ? 0.52 : 0.28;
     a.vx = lerp(a.vx, (dx / d) * spd, Math.min(1, dt * 4));
     a.vz = lerp(a.vz, (dz / d) * spd, Math.min(1, dt * 4));
     a.yaw = advanceSidewaysYaw(a.yaw, a.vx, a.vz, dt);
     a.state = 'returning';
     a.stateLabel = localW.saltation > 0.55 ? 'retreating to burrow shelter' : 'returning to burrow rim';
    } else if (localW.saltation > 0.65 && !isPlaced) {
     a.alertStage = 3; a.alertTimer = 2.4; a.vx = 0; a.vz = 0;
     a.state = 'burrowed'; a.stateLabel = 'sheltered inside burrow from blowing sand';
    } else {
     a.vx = 0; a.vz = 0;
     a.state = 'burrow-watching'; a.stateLabel = 'resting sentinel beside burrow';
    }
   } else if (best && a.hunger > 0.14 && distBurrow < (isPlaced ? 4.5 : 12.5)) {
    const dx = best.x - a.x, dz = best.z - a.z;
    const d = Math.max(0.01, Math.hypot(dx, dz));
    if (d < 0.26) {
     if (bestIsCarcass) {
      const bite = Math.min(best.nutrition, dt * 0.25);
      best.nutrition -= bite;
      a.satiation = Math.min(1, (a.satiation ?? 0.3) + bite * 1.4);
      ecology?.recordCarcassScavenge?.(bite);
      a.feedTimer = 0.8; a.state = 'feeding'; a.stateLabel = 'scavenging beach carcass';
     } else if (consumePrey(a, best, 0.36, ctx, 'consumed beach prey')) {
      a.state = 'feeding'; a.stateLabel = `consuming ${best.commonName || 'wrack prey'}`;
     }
     a.vx = lerp(a.vx, 0, Math.min(1, dt * 6));
     a.vz = lerp(a.vz, 0, Math.min(1, dt * 6));
    } else {
     const walkSpd = (d < 1.3 ? 0.24 : 0.44 + 0.18 * a.hunger) * (0.7 + 0.5 * (a.activity ?? 1));
     a.vx = lerp(a.vx, (dx / d) * walkSpd, Math.min(1, dt * 4.5));
     a.vz = lerp(a.vz, (dz / d) * walkSpd, Math.min(1, dt * 4.5));
     a.yaw = advanceSidewaysYaw(a.yaw, a.vx, a.vz, dt);
     a.state = d < 0.9 ? 'lunging' : 'foraging';
     a.stateLabel = bestIsCarcass ? 'approaching stranded carcass' : (preferMole ? 'stalking swash mole crabs' : 'foraging wrack hoppers');
    }
   } else {
    if (a.stateTimer <= 0) {
     const ang = detHash(idNum * 37 + Math.floor(time * 0.4)) * Math.PI * 2;
     const rad = isPlaced ? lerp(0.5, 2.2, detHash(idNum * 13 + Math.floor(time))) : lerp(1.0, 3.8, detHash(idNum * 13 + Math.floor(time)));
     a.forageX = bx + Math.cos(ang) * rad;
     a.forageZ = bz + Math.sin(ang) * rad;
     a.stateTimer = lerp(2.8, 5.5, detHash(idNum * 7));
    }
    const dx = (a.forageX ?? bx) - a.x, dz = (a.forageZ ?? bz) - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.22) {
     a.vx = lerp(a.vx, 0, Math.min(1, dt * 5)); a.vz = lerp(a.vz, 0, Math.min(1, dt * 5));
     a.state = 'vigilant'; a.stateLabel = 'alert carapace stance';
    } else {
     const spd = 0.30 * (0.65 + 0.5 * (a.activity ?? 1));
     a.vx = lerp(a.vx, (dx / d) * spd, Math.min(1, dt * 4));
     a.vz = lerp(a.vz, (dz / d) * spd, Math.min(1, dt * 4));
     a.yaw = advanceSidewaysYaw(a.yaw, a.vx, a.vz, dt);
     a.state = 'foraging'; a.stateLabel = 'patrolling berm patch';
     if (ecology && ecology.resources.wrack > 0.25 && distBurrow < 8 && Math.abs(land.shoreDistance(a.x, a.z) - wrackDAt(land, alongWorldFn(land, a.x, a.z), seaLevel)) < 2.2) {
      a.satiation = Math.min(1, (a.satiation ?? 0.4) + dt * 0.025 * clamp(ecology.resources.wrack, 0.2, 1.3));
     }
    }
   }
  }

  a.x += a.vx * dt; a.z += a.vz * dt;
  a.speed = Math.hypot(a.vx, a.vz);
  const targetBurrow = isPlaced ? 0 : (a.alertStage === 3 ? (a.height || 0.025) * 1.35 : 0);
  a.burrowDepth = (!isPlaced && a.alertStage === 3) ? lerp(a.burrowDepth || 0, targetBurrow, Math.min(1, dt * 6)) : 0;
  const supGh = cachedGroundSupport(a, land, (a.width || 0.04) * (a.sizeScale ?? 1) * 1.25);
  const rawGh = a._gRaw ?? land.height(a.x, a.z);
  a.bedY = (!isPlaced && a.alertStage === 3) ? rawGh : supGh;
  stepCrabIK(a, dt, land, a.vx, a.vz, a.speed, a.alertStage === 2, a.alertStage, time);
  a.y = (!isPlaced && a.alertStage === 3)
   ? (rawGh - a.burrowDepth + (a.height || 0.025) * (a.sizeScale ?? 1) * 0.60 + (a.crabRig?.comHeave || 0))
   : (supGh + (a.height || 0.025) * (a.sizeScale ?? 1) * 0.92 + (a.crabRig?.comHeave || 0));
  a.yawRate = wrapAngle(a.yaw - prevYaw) / Math.max(1e-3, dt);
  return;
 }

 // ---------------- FIDDLER CRAB (Leptuca pugilator) ----------------
 if (a.speciesId === 'fiddler-crab') {
  const bx = isPlaced ? (a.anchorX ?? a.burrowX ?? a.x) : (a.burrowX ?? a.x);
  const bz = isPlaced ? (a.anchorZ ?? a.burrowZ ?? a.z) : (a.burrowZ ?? a.z);
  const sense = stimuli ? stimuli.senseThreat(a, localGhostCrabs, seaLevel) : {threat: 0, nearDist: Infinity};
  if (sense.threat > 0.16) {
   a.fear = Math.min(1, Math.max(a.fear, sense.threat * 1.15));
   a.threatX = sense.threatX; a.threatZ = sense.threatZ;
  }

  const fid = 0.34 + 0.12 * a.hunger;
  if (a.alertStage === 3) {
   a.state = 'burrowed'; a.stateLabel = 'sheltered in swale burrow';
   a.vx = 0; a.vz = 0; a.speed = 0; a.alertTimer -= dt;
   if (a.alertTimer <= 0 && a.fear < 0.18) a.alertStage = 0;
  } else if (a.fear > fid && a.alertStage === 0) {
   a.alertStage = 1; a.alertTimer = 0.28; a.vx = 0; a.vz = 0;
   a.state = 'vigilant'; a.stateLabel = 'freeze on colony flat';
  } else if (a.alertStage === 1) {
   a.vx = 0; a.vz = 0;
   if (Number.isFinite(a.threatX) && Number.isFinite(a.threatZ)) {
    const faceThreat = Math.atan2(a.threatZ - a.z, a.threatX - a.x);
    a.yaw = wrapAngle(a.yaw + clamp(wrapAngle(faceThreat - a.yaw), -3.5 * dt, 3.5 * dt));
   }
   a.alertTimer -= dt;
   if (a.fear > fid * 1.25 || sense.nearDist < 1.1 || a.alertTimer <= 0) {
    a.alertStage = 2;
    stimuli?.emitAlarmWave(a.x, a.y, a.z, a.id);
   }
  } else if (a.alertStage === 2) {
   const dx = bx - a.x, dz = bz - a.z, dB = Math.hypot(dx, dz);
   if (dB < 0.10 && !isPlaced) {
    a.alertStage = 3; a.vx = 0; a.vz = 0;
    a.alertTimer = 1.6 + detHash(idNum * 41) * 1.6;
   } else if (dB > 0.12) {
    const spd = 0.52;
    a.vx = (dx / dB) * spd; a.vz = (dz / dB) * spd;
    a.yaw = advanceSidewaysYaw(a.yaw, a.vx, a.vz, dt);
    a.state = 'dashing-burrow'; a.stateLabel = 'bolting into colony burrow';
   } else {
    a.vx = 0; a.vz = 0;
    if (a.fear < 0.3) a.alertStage = 0;
   }
  } else {
   a.waveTimer = (a.waveTimer ?? 2) - dt;
   if (a.waveTimer <= 0) {
    if (a.sex === 'M' && a.hunger < 0.65 && localW.spd < 10) {
     a.state = a.state === 'waving' ? 'feeding' : 'waving';
     a.stateLabel = a.state === 'waving' ? 'waving major claw' : 'deposit-feeding on mud rim';
    } else {
     a.state = 'feeding'; a.stateLabel = 'deposit-feeding on mud rim';
    }
    a.waveTimer = lerp(2.0, 4.8, detHash(idNum * 47 + Math.floor(time * 0.5)));
   }
   if (a.state !== 'waving') {
    const candX = bx + Math.cos(idNum + time * 0.35) * 0.42;
    const candZ = bz + Math.sin(idNum + time * 0.35) * 0.42;
    const candH = land.height(candX, candZ);
    const tgtX = candH >= seaLevel + 0.01 ? candX : bx;
    const tgtZ = candH >= seaLevel + 0.01 ? candZ : bz;
    const dx = tgtX - a.x, dz = tgtZ - a.z, d = Math.hypot(dx, dz);
    const spd = d > 0.04 ? Math.min(0.14, d * 1.4) : 0;
    a.vx = d > 1e-4 ? (dx / d) * spd : 0; a.vz = d > 1e-4 ? (dz / d) * spd : 0;
    if (spd > 0.02) a.yaw = advanceSidewaysYaw(a.yaw, a.vx, a.vz, dt);
    const algRich = ecology ? clamp(0.6 * (ecology.resources.benthicAlgae ?? 1) + 0.4 * (ecology.resources.wrack ?? 1), 0.2, 1.5) : 1.0;
    a.satiation = Math.min(1, (a.satiation ?? 0.4) + dt * 0.038 * algRich);
   } else {
    a.vx = lerp(a.vx, 0, Math.min(1, dt * 6)); a.vz = lerp(a.vz, 0, Math.min(1, dt * 6));
    a.yaw = Math.atan2(a.z - bz, a.x - bx) + Math.sin(time * 1.4 + idNum) * 0.35;
   }
  }

  const nextX = a.x + a.vx * dt, nextZ = a.z + a.vz * dt;
  const nextBed = land.height(nextX, nextZ);
  if (isPlaced || nextBed >= seaLevel) { a.x = nextX; a.z = nextZ; }
  else { a.vx = 0; a.vz = 0; }
  a.speed = Math.hypot(a.vx, a.vz);
  stepCyberneticLoop(a, dt, {threat: a.fear, satiation: clamp(a.satiation ?? a.energy, 0, 1), fatigue: a.fatigue, foodAvail: a.patchRichness}, {wSafe: 2.5, hysteresis: 0.14});
  a.burrowDepth = !isPlaced && a.alertStage === 3 ? (a.height || 0.014) * (a.sizeScale ?? 1) * 1.3 : 0;
  const rawGh = land.height(a.x, a.z);
  const supGh = groundSupportHeight(land, a.x, a.z, (a.width || 0.024) * (a.sizeScale ?? 1) * 1.25);
  a.bedY = (!isPlaced && a.alertStage === 3) ? rawGh : supGh;
  stepCrabIK(a, dt, land, a.vx, a.vz, a.speed, a.alertStage === 2, a.alertStage, time);
  a.y = (!isPlaced && a.alertStage === 3)
   ? (rawGh - a.burrowDepth + (a.height || 0.014) * (a.sizeScale ?? 1) * 0.52 + (a.crabRig?.comHeave || 0))
   : (supGh + (a.height || 0.014) * (a.sizeScale ?? 1) * 0.92 + (a.crabRig?.comHeave || 0));
  a.yawRate = wrapAngle(a.yaw - prevYaw) / Math.max(1e-3, dt);
  return;
 }

 // ---------------- SWIMMING CRABS: BLUE & SPECKLED (Callinectes / Arenaeus) ----------------
 if (a.speciesId === 'blue-crab' || a.speciesId === 'speckled-crab') {
  const sense = stimuli ? stimuli.senseThreat(a, localRaysSharks, seaLevel) : {threat: 0, nearDist: Infinity};
  if (sense.threat > 0.22) {
   a.fear = Math.min(1, Math.max(a.fear, sense.threat * 1.15));
   a.threatX = sense.threatX; a.threatZ = sense.threatZ;
  }

  const cyber = stepCyberneticLoop(a, dt, {threat: a.fear, satiation: clamp(a.satiation ?? a.energy, 0, 1), fatigue: a.fatigue, foodAvail: 0.72}, {wSafe: 2.5, wRest: 1.15, satiatedRest: 0.68, hysteresis: 0.15});
  let desVx = 0, desVz = 0;
  if (a.fear > 0.42 || cyber.activeDrive === 'escape') {
   a.alertStage = 2;
   a.pelagicSwim = lerp(a.pelagicSwim, 1, Math.min(1, dt * 6));
   const dx = a.x - a.threatX, dz = a.z - a.threatZ;
   const d = Math.max(0.05, Math.hypot(dx, dz));
   const awayIn = a.band === 'bay' ? 0 : -0.16;
   desVx = (dx / d) * 0.62 + INLAND_DIR_X * awayIn;
   desVz = (dz / d) * 0.62 + INLAND_DIR_Z * awayIn;
   a.yaw = advanceSidewaysYaw(a.yaw, desVx, desVz, dt);
   a.state = 'swimming-escape';
   a.stateLabel = 'paddle-swimming away from threat';
  } else if (cyber.activeDrive === 'rest') {
   a.alertStage = 0;
   a.pelagicSwim = lerp(a.pelagicSwim, 0, Math.min(1, dt * 4));
   desVx = 0; desVz = 0; a.vx = 0; a.vz = 0;
   a.state = 'hiding';
   a.stateLabel = a.speciesId === 'blue-crab' ? 'ambush-hiding in seagrass' : 'hiding cryptically in surf sand';
  } else {
   a.alertStage = 0;
   a.pelagicSwim = lerp(a.pelagicSwim, 0, Math.min(1, dt * 3.5));
   const flow = sea?.flow ? sea.flow(a.x, a.z) : {x: -INLAND_DIR_X * 0.25, z: -INLAND_DIR_Z * 0.25};
   const flowMag = Math.hypot(flow.x, flow.z);
   const fux = flowMag > 0.02 ? flow.x / flowMag : -INLAND_DIR_X;
   const fuz = flowMag > 0.02 ? flow.z / flowMag : -INLAND_DIR_Z;
   const crossX = -fuz, crossZ = fux;

   let preyTarget = null, bestD2 = 36;
   const lists = a.speciesId === 'blue-crab' ? [localScallops, localShrimp, localSnails, localMoleCrabs] : [localMoleCrabs, localSnails, localShrimp];
   for (const list of lists) {
    if (!list?.length) continue;
    for (let i = 0; i < list.length; i++) {
     const p = list[i];
     if (p === a || p.alive === false || p.isPlaced || (p.visibility ?? 1) <= 0.1) continue;
     const d2 = (p.x - a.x) ** 2 + (p.z - a.z) ** 2;
     if (d2 < bestD2) { bestD2 = d2; preyTarget = p; }
    }
   }

   if (preyTarget && a.hunger > 0.20) {
    const dx = preyTarget.x - a.x, dz = preyTarget.z - a.z;
    const d = Math.max(0.04, Math.hypot(dx, dz));
    if (d < 0.22 && consumePrey(a, preyTarget, 0.30, ctx, 'crab capture')) {
     a.state = 'feeding'; a.stateLabel = `crushing ${preyTarget.commonName || 'benthic prey'}`;
    } else {
     const castOsc = Math.sin(time * 1.4 + idNum) * 0.45;
     desVx = (dx / d) * 0.26 - fux * 0.06 + crossX * castOsc * 0.12;
     desVz = (dz / d) * 0.26 - fuz * 0.06 + crossZ * castOsc * 0.12;
     a.state = 'prowling'; a.stateLabel = 'tracking benthic odor plume up-current';
    }
   } else {
    const orbitAlong = (a.homeAlong ?? alongWorldFn(land, a.anchorX ?? a.x, a.anchorZ ?? a.z)) + Math.sin(time * 0.18 + idNum * 1.7) * (isPlaced ? 2.6 : 5.2);
    const baseD = a.band === 'bay' ? (a.homeD ?? land.shoreDistance(a.anchorX ?? a.x, a.anchorZ ?? a.z)) : Math.min(-4.5, (a.homeD ?? land.shoreDistance(a.anchorX ?? a.x, a.anchorZ ?? a.z)));
    const orbitD = baseD + Math.cos(time * 0.23 + idNum * 2.3) * (isPlaced ? 1.5 : 2.4);
    const [tx, tz] = worldAtShoreFn(land, orbitD, orbitAlong);
    const dx = tx - a.x, dz = tz - a.z, d = Math.max(0.05, Math.hypot(dx, dz));
    const spd = Math.min(0.28, d * 0.55);
    const castOsc = Math.sin(time * 1.1 + idNum) * 0.06;
    desVx = (dx / d) * spd + crossX * castOsc;
    desVz = (dz / d) * spd + crossZ * castOsc;
    a.state = 'foraging';
    a.stateLabel = a.speciesId === 'blue-crab' ? 'casting across seagrass bed' : 'foraging surf trough';
    if (ecology && (ecology.resources.benthicAlgae ?? 1) > 0.3 && d < 1.2) {
     a.satiation = Math.min(1, (a.satiation ?? 0.4) + dt * 0.022);
    }
   }
   a.yaw = advanceSidewaysYaw(a.yaw, desVx, desVz, dt);
  }

  const waterY0 = waterHeightAtFn(sea, land, a.x, a.z);
  const av = avoidShallowGradient(a, land, seaLevel, waterY0, 0.24, 0.85, dt, isPlaced);
  if (av.weight > 0.01 && a.state !== 'hiding') {
   desVx = lerp(desVx, av.avoidX * 0.38, av.weight);
   desVz = lerp(desVz, av.avoidZ * 0.38, av.weight);
  }
  a.vx = a.state === 'hiding' ? 0 : lerp(a.vx, desVx, Math.min(1, dt * 4.5));
  a.vz = a.state === 'hiding' ? 0 : lerp(a.vz, desVz, Math.min(1, dt * 4.5));
  a.x += a.vx * dt; a.z += a.vz * dt;
  a.speed = Math.hypot(a.vx, a.vz);

  const supBed = cachedGroundSupport(a, land, (a.width || 0.11) * (a.sizeScale ?? 1) * 0.75);
  const bedNow = a._gRaw ?? land.height(a.x, a.z);
  a.bedY = supBed;
  const waterNow = waterHeightAtFn(sea, land, a.x, a.z);
  const effH = (a.height || 0.03) * (a.sizeScale ?? 1);
  if (!isPlaced && waterNow - bedNow < 0.11) {
   a.visibility = 0; a.y = supBed + effH * 0.82;
  } else if (waterNow - bedNow >= 0.11) {
   const swimLift = a.pelagicSwim * 0.14;
   const targetY = a.state === 'hiding' ? supBed + effH * 0.68 : supBed + effH * 0.92 + swimLift;
   const clY = Math.min(waterNow - 0.08, Math.max(supBed + effH * 0.65, targetY));
   a.y = lerp(a.y || clY, clY, 1 - Math.exp(-5.0 * dt));
  } else {
   a.y = supBed + effH * 0.90;
  }
  stepCrabIK(a, dt, land, a.vx, a.vz, a.speed, a.alertStage === 2, a.alertStage, time);
  a.yawRate = lerp(a.yawRate || 0, wrapAngle(a.yaw - prevYaw) / Math.max(1e-3, dt), Math.min(1, dt * 6));
  return;
 }

 // ---------------- SAND GNAT (Culicoides furens) ----------------
 if (a.speciesId === 'sand-gnat') {
  const cloud = isPlaced ? {x: a.anchorX ?? a.x, z: a.anchorZ ?? a.z} : (a.cloudX !== undefined ? {x: a.cloudX, z: a.cloudZ} : gnatClouds[a.cloudIdx || 0] || {x: a.x, z: a.z});
  const cExp = land?.windExposure ? land.windExposure(cloud.x, cloud.z) : 1.0;
  const effWind = localW.spd || windSpd * cExp;
  const lee = effWind > 2.2 && !isPlaced ? leewardShelterGradient(land, a.x, a.z, 3.5) : {gx: 0, gz: 0};
  const windShelterScale = clamp(1.0 - Math.max(0, effWind - 2.2) * 0.24, 0.16, 1.0);
  const sense = stimuli ? stimuli.senseThreat(a, null, seaLevel) : {threat: 0};
  const scare = sense.threat > 0.35;

  a.zipTimer = (a.zipTimer || 0) - dt;
  if (a.zipTimer <= 0 || a.zipTargetX === undefined) {
   a.zipSeed = (a.zipSeed || 0) + 1;
   const h0 = detHash(idNum * 79 + a.zipSeed * 37);
   const h1 = detHash(idNum * 113 + a.zipSeed * 53);
   const h2 = detHash(idNum * 157 + a.zipSeed * 71);
   const dartAng = h0 * Math.PI * 2;
   const maxR = (a.orbitR || 0.58) * windShelterScale * (scare ? 1.85 : 1.45);
   const dartR = lerp(0.14, Math.max(0.24, maxR), Math.sqrt(h1));
   const leeShift = effWind > 2.4 && !isPlaced ? clamp((effWind - 2.2) * 0.45, 0, 2.2) : 0;
   a.zipTargetX = cloud.x + lee.gx * leeShift + Math.cos(dartAng) * dartR;
   a.zipTargetZ = cloud.z + lee.gz * leeShift + Math.sin(dartAng) * dartR;
   a.zipAltOff = (h2 - 0.32) * 0.44 * windShelterScale;
   a.zipTimer = lerp(scare ? 0.09 : 0.15, scare ? 0.20 : 0.34, detHash(idNum * 199 + a.zipSeed));
  }

  const dx = a.zipTargetX - a.x, dz = a.zipTargetZ - a.z;
  const d = Math.max(0.01, Math.hypot(dx, dz));
  const desSpd = clamp(d * (scare ? 8.2 : 6.2), 0.75, scare ? 3.2 : 2.35) * (0.45 + 0.55 * windShelterScale);
  const desVx = (dx / d) * desSpd + localW.wx * 0.18;
  const desVz = (dz / d) * desSpd + localW.wz * 0.18;
  const gain = Math.min(1, dt * (scare ? 18 : 13));
  a.vx = lerp(a.vx || 0, desVx, gain);
  a.vz = lerp(a.vz || 0, desVz, gain);
  a.x += a.vx * dt; a.z += a.vz * dt;
  a.speed = Math.hypot(a.vx, a.vz);

  const ground = groundSupportHeight(land, a.x, a.z, 0.04);
  a.bedY = ground;
  const baseAlt = 0.14 + (a.orbitH ?? 0.48) * windShelterScale + (a.zipAltOff || 0);
  const targetY = Math.max(ground, seaLevel) + Math.max(0.12, baseAlt);
  a.y = Math.max(Math.max(ground, seaLevel) + 0.12, lerp(a.y || targetY, targetY, Math.min(1, dt * 11)));
  if (a.speed > 0.04) a.yaw = Math.atan2(a.vz, a.vx);
  a.satiation = Math.min(1, (a.satiation ?? 0.4) + dt * 0.025);
  a.state = scare ? 'scattering' : (effWind > 2.6 ? 'sheltering' : 'zipping');
  a.stateLabel = scare ? 'zip-scattering from disturbance' : (effWind > 2.6 ? 'seeking lee shelter below grass crest' : 'zipping mating swarm');
  a.yawRate = wrapAngle(a.yaw - prevYaw) / Math.max(1e-3, dt);
  return;
 }

 // ---------------- KELP FLY (Coelopa / Ephydridae) ----------------
 if (a.speciesId === 'kelp-fly') {
  const sense = stimuli ? stimuli.senseThreat(a, null, seaLevel) : {threat: 0};
  if (sense.threat > 0.30) a.fear = Math.min(1, Math.max(a.fear, sense.threat * 1.2));
  const windEase = clamp(1 - Math.max(0, localW.spd - 4.5) / 8.0, 0.08, 1);
  const cyber = stepCyberneticLoop(a, dt, {threat: a.fear, satiation: clamp(a.satiation ?? a.energy, 0, 1), fatigue: a.fatigue, foodAvail: 0.78, windEase}, {wSafe: 2.8, wForage: 1.15, wRest: 1.30, satiatedRest: 0.72, hysteresis: 0.16});

  if ((cyber.activeDrive === 'rest' || localW.spd > 8.8) && a.fear < 0.24) {
   a.vx = 0; a.vz = 0; a.speed = 0;
   const ground = cachedGroundSupport(a, land, 0.03);
   a.bedY = ground; a.y = Math.max(ground, seaLevel) + 0.012;
   a.state = 'alighted'; a.stateLabel = localW.spd > 8.8 ? 'sheltering flat on wrack against wind' : 'alighted motionless on wrack';
   a.yawRate = 0;
   return;
  }

  const lee = localW.spd > 3.5 && !isPlaced ? leewardShelterGradient(land, a.x, a.z, 3.0) : {gx: 0, gz: 0};
  let tx, tz;
  if (carcasses?.length && !isPlaced) {
   let nearC = null, bestD2 = 25;
   for (let i = 0; i < carcasses.length; i++) {
    const c = carcasses[i];
    if (c.nutrition <= 0.02) continue;
    const d2 = (c.x - a.x) ** 2 + (c.z - a.z) ** 2;
    if (d2 < bestD2) { bestD2 = d2; nearC = c; }
   }
   if (nearC) {
    tx = nearC.x + Math.cos(time * 2.2 + idNum) * 0.22;
    tz = nearC.z + Math.sin(time * 2.2 + idNum) * 0.22;
    if (bestD2 < 0.4) {
     a.satiation = Math.min(1, (a.satiation ?? 0.4) + dt * 0.09);
     nearC.nutrition = Math.max(0, nearC.nutrition - dt * 0.012);
    }
   }
  }
  if (tx === undefined) {
   const flyAlong = (a.homeAlong ?? alongWorldFn(land, a.anchorX ?? a.x, a.anchorZ ?? a.z)) + Math.sin(time * 1.3 + idNum * 2.1) * (isPlaced ? 0.65 : 1.4);
   const baseD = isPlaced ? land.shoreDistance(a.anchorX ?? a.x, a.anchorZ ?? a.z) : wrackDAt(land, flyAlong, seaLevel);
   const wrackD = baseD + Math.cos(time * 1.9 + idNum) * (sense.threat > 0.3 ? 1.2 : 0.7);
   [tx, tz] = worldAtShoreFn(land, wrackD, flyAlong);
  }
  tx += lee.gx * clamp((localW.spd - 3.5) * 0.35, 0, 1.5);
  tz += lee.gz * clamp((localW.spd - 3.5) * 0.35, 0, 1.5);
  const kFly = Math.min(1, dt * (sense.threat > 0.3 ? 4.8 : 2.5));
  const desVx = (tx - a.x) * (sense.threat > 0.3 ? 4.8 : 2.5) + localW.wx * 0.16;
  const desVz = (tz - a.z) * (sense.threat > 0.3 ? 4.8 : 2.5) + localW.wz * 0.16;
  a.vx = lerp(a.vx || 0, desVx, kFly);
  a.vz = lerp(a.vz || 0, desVz, kFly);
  a.x += a.vx * dt; a.z += a.vz * dt;
  a.speed = Math.hypot(a.vx, a.vz);
  const ground = cachedGroundSupport(a, land, 0.03);
  a.bedY = ground;
  const buzz = (a.hoverAlt ?? 0.22) * (0.45 + 0.55 * (a.activity ?? 1)) * clamp(1 - localW.spd * 0.04, 0.35, 1) + (sense.threat > 0.3 ? 0.28 : Math.abs(Math.sin(time * 5.2 + a.phase)) * 0.08);
  a.y = Math.max(ground, seaLevel) + buzz;
  if (a.speed > 0.02) a.yaw = Math.atan2(a.vz, a.vx);
  const wrackRich = ecology ? clamp(ecology.resources.wrack ?? 1, 0.2, 1.5) : 1.0;
  a.satiation = Math.min(1, (a.satiation ?? 0.4) + dt * 0.035 * wrackRich);
  a.state = sense.threat > 0.3 ? 'evading' : 'hovering';
  a.stateLabel = sense.threat > 0.3 ? 'flushing above wrack' : 'foraging wrack surface';
  a.yawRate = wrapAngle(a.yaw - prevYaw) / Math.max(1e-3, dt);
  return;
 }

 // ---------------- SEASIDE DRAGONLET (Erythrodiplax berenice) ----------------
 if (a.speciesId === 'dragonlet') {
  const sense = stimuli ? stimuli.senseThreat(a, null, seaLevel) : {threat: 0};
  const px0 = isPlaced ? (a.anchorX ?? a.x) : (a.perchX ?? a.x);
  const pz0 = isPlaced ? (a.anchorZ ?? a.z) : (a.perchZ ?? a.z);
  const py0 = (a.perchY ?? (land.height(px0, pz0) + (a.hoverAlt ?? 0.65)));

  if (sense.threat > 0.38) {
   a.fear = Math.min(1, Math.max(a.fear, sense.threat));
   a.threatX = sense.threatX; a.threatZ = sense.threatZ;
  }

  // Real aerial insect prey detection (gnats & kelp flies in dune/swale airspace)
  let prey = null, bestPreyD2 = 3.8 * 3.8;
  if (localDunePrey?.length && a.hunger > 0.14) {
   for (let i = 0; i < localDunePrey.length; i++) {
    const p = localDunePrey[i];
    if ((p.speciesId !== 'sand-gnat' && p.speciesId !== 'kelp-fly') || p.alive === false || p.isPlaced || (p.visibility ?? 1) <= 0.1) continue;
    const d2 = (p.x - a.x) ** 2 + (p.z - a.z) ** 2;
    if (d2 < bestPreyD2) { bestPreyD2 = d2; prey = p; }
   }
  }
  const windEase = clamp(1 - Math.max(0, localW.spd - 4.5) / 7.5, 0.1, 1);
  const cyber = stepCyberneticLoop(a, dt, {threat: a.fear, satiation: clamp(a.satiation ?? a.energy, 0, 1), fatigue: a.fatigue, foodAvail: prey ? 0.92 : 0.25, windEase}, {wSafe: 2.7, wForage: 1.15, wRest: 1.35, satiatedRest: 0.78, hysteresis: 0.18});

  if (cyber.activeDrive === 'escape' || a.fear > 0.38) {
   a.state = 'evading'; a.stateLabel = 'darting away from disturbance';
  } else if (cyber.activeDrive === 'rest' || localW.spd > 10.5 || (!prey && cyber.activeDrive !== 'explore')) {
   const distPerch = Math.hypot(px0 - a.x, pz0 - a.z);
   if (distPerch < 0.08 && Math.abs((a.y ?? py0) - py0) < 0.08) {
    a.x = px0; a.y = py0; a.z = pz0; a.vx = 0; a.vz = 0; a.speed = 0;
    a.bedY = land.height(px0, pz0);
    a.state = 'perched'; a.stateLabel = localW.spd > 10.5 ? 'perched sheltered against high wind' : 'perched lookout scanning for gnats';
    a.wingFore = -0.18; a.wingHind = -0.26; a.pitch = 0.22; a.yawRate = 0;
    return;
   }
   a.state = 'returning'; a.stateLabel = 'gliding back to perch';
  } else {
   a.state = 'hawking';
  }

  let tx = px0, ty = py0, tz = pz0;
  if (a.state === 'evading') {
   const dx = a.x - a.threatX, dz = a.z - a.threatZ, d = Math.max(0.05, Math.hypot(dx, dz));
   tx = a.x + (dx / d) * 1.8; tz = a.z + (dz / d) * 1.8; ty = land.height(tx, tz) + 1.15;
  } else if (a.state === 'hawking') {
   if (prey) {
    tx = prey.x; tz = prey.z; ty = Math.max(land.height(tx, tz) + 0.22, prey.y);
    a.stateLabel = `sallying on ${prey.commonName || 'midge'}`;
    if (bestPreyD2 < 0.16 * 0.16 && consumePrey(a, prey, 0.26, ctx, 'aerial insect hawked')) {
     a.stateLabel = 'snared airborne gnat';
    }
   } else {
    const lee = localW.spd > 3.5 && !isPlaced ? leewardShelterGradient(land, px0, pz0, 4.0) : {gx: 0, gz: 0};
    const ang = time * 1.65 + (a.phase || 0);
    tx = px0 + lee.gx * 1.2 + Math.cos(ang) * (isPlaced ? 1.4 : 2.4);
    tz = pz0 + lee.gz * 1.2 + Math.sin(ang) * (isPlaced ? 1.4 : 2.4);
    ty = Math.max(land.height(tx, tz), seaLevel) + 0.68 + Math.sin(ang * 2.5) * 0.20;
    a.stateLabel = 'patrolling swale airspace';
   }
  }
  const dx = tx - a.x, dz = tz - a.z;
  const blend = Math.min(1, dt * (a.state === 'evading' ? 4.8 : 3.2));
  a.vx = lerp(a.vx || 0, dx * 3.2 + localW.wx * 0.22, blend);
  a.vz = lerp(a.vz || 0, dz * 3.2 + localW.wz * 0.22, blend);
  a.x += a.vx * dt; a.z += a.vz * dt;
  a.speed = Math.hypot(a.vx, a.vz);
  a.bedY = cachedGroundSupport(a, land, 0.03);
  a.wingFore = Math.sin(time * 36 + idNum) * 0.34;
  a.wingHind = Math.sin(time * 36 + idNum + Math.PI * 0.78) * 0.34;
  a.pitch = lerp(a.pitch || 0, clamp((ty - a.y) * 0.45, -0.35, 0.35), Math.min(1, dt * 6));
  a.y = Math.max(a.bedY + 0.05, lerp(a.y, ty, blend));
  if (a.speed > 0.04) a.yaw = Math.atan2(a.vz, a.vx);
  a.yawRate = wrapAngle(a.yaw - prevYaw) / Math.max(1e-3, dt);
  return;
 }

 // ---------------- SCHOOLING BAITFISH (Anchoa mitchilli) ----------------
 if (a.speciesId === 'baitfish') {
  let sepX = 0, sepZ = 0, aliX = 0, aliZ = 0, cohX = 0, cohZ = 0, cohY = 0, nNbr = 0;
  if (!isPlaced && baitPodLists) {
   const podKey = a.podObj?.key ?? a.podId ?? 0;
   const peers = (baitPodLists instanceof Map ? baitPodLists.get(podKey) : baitPodLists[podKey]) || [];
   for (let i = 0; i < peers.length; i++) {
    const o = peers[i];
    if (o === a || o.alive === false) continue;
    const dx = o.x - a.x, dz = o.z - a.z, d2 = dx * dx + dz * dz;
    if (d2 < 9.0) {
     nNbr++; cohX += o.x; cohZ += o.z; cohY += o.y; aliX += o.vx; aliZ += o.vz;
     if (d2 < 0.0625 && d2 > 1e-6) {
      const d = Math.sqrt(d2), inv = 1 / d;
      sepX -= dx * inv * (0.25 - d) * 12; sepZ -= dz * inv * (0.25 - d) * 12;
     }
    }
   }
  }

  let podX = a.anchorX ?? a.x, podZ = a.anchorZ ?? a.z;
  if (!isPlaced) {
   const pod = a.podObj || (baitPods ? baitPods[a.podId || 0] : null);
   if (pod) [podX, podZ] = worldAtShoreFn(land, pod.centerD, pod.centerAlong);
  }
  let ax = (podX - a.x) * 0.45, az = (podZ - a.z) * 0.45, targetY = a.y;
  if (nNbr > 0) {
   ax += (cohX / nNbr - a.x) * 0.65 + (aliX / nNbr - a.vx) * 1.1 + sepX;
   az += (cohZ / nNbr - a.z) * 0.65 + (aliZ / nNbr - a.vz) * 1.1 + sepZ;
   targetY = lerp(a.y, cohY / nNbr, 0.35);
  }

  const sense = stimuli ? stimuli.senseThreat(a, localPredatorsSea, seaLevel) : {threat: 0, nearDist: Infinity};
  let flee = sense.threat > 0.30 || sense.nearDist < 2.2;
  let fleeDx = a.x - sense.threatX, fleeDz = a.z - sense.threatZ;
  if (localPredatorsSea?.length) {
   for (let i = 0; i < localPredatorsSea.length; i++) {
    const pr = localPredatorsSea[i];
    if (pr.alive === false) continue;
    const dx = a.x - pr.x, dz = a.z - pr.z, d2 = dx * dx + dz * dz;
    if (d2 < 2.2 * 2.2 && d2 > 1e-5) {
     const inv = 1 / Math.sqrt(d2);
     ax += dx * inv * 4.0; az += dz * inv * 4.0;
     flee = true; fleeDx = dx; fleeDz = dz;
    }
   }
  }
  if (flee) {
   if ((a.panicTimer || 0) <= 0.15 || (sense.kind === 'splash' && sense.threat > 0.45 && (a.cStartTimer || 0) <= 0)) {
    a.cStartTimer = 0.24;
    a.cStartDir = (Math.cos(prevYaw) * fleeDz - Math.sin(prevYaw) * fleeDx) >= 0 ? 1 : -1;
   }
   a.fear = Math.min(1, Math.max(a.fear, 0.90));
   const d = Math.max(0.05, Math.hypot(fleeDx, fleeDz));
   ax += (fleeDx / d) * 3.6; az += (fleeDz / d) * 3.6;
   a.panicTimer = 0.80; a.state = 'evading'; a.stateLabel = 'C-start flash-evading predator';
  } else if ((a.panicTimer || 0) > 0) {
   a.panicTimer = Math.max(0, a.panicTimer - dt);
  } else {
   a.state = 'schooling';
   a.stateLabel = a.band === 'bay' ? 'schooling over bay grass flats' : 'schooling in surf trough';
   const plRich = ecology ? clamp(ecology.resources.plankton ?? 1, 0.2, 1.5) : 1.0;
   a.satiation = Math.min(1, (a.satiation ?? 0.4) + dt * 0.032 * plRich);
  }
  if ((a.cStartTimer || 0) > 0) a.cStartTimer = Math.max(0, a.cStartTimer - dt);

  if (a.band !== 'bay') {
   const dCurr = land.shoreDistance(a.x, a.z);
   if (dCurr > -4.0) { ax -= INLAND_DIR_X * 3.2; az -= INLAND_DIR_Z * 3.2; }
   else if (dCurr < -26.5) { ax += INLAND_DIR_X * 2.2; az += INLAND_DIR_Z * 2.2; }
  }

  const waterY0 = waterHeightAtFn(sea, land, a.x, a.z);
  const av = avoidShallowGradient(a, land, seaLevel, waterY0, 0.24, 0.95, dt, isPlaced);
  ax += av.avoidX * av.weight * 4.2;
  az += av.avoidZ * av.weight * 4.2;

  const predVx = (a.vx || 0) + ax * dt, predVz = (a.vz || 0) + az * dt;
  const tgtYaw = Math.hypot(predVx, predVz) > 1e-4 ? Math.atan2(predVz, predVx) : prevYaw;
  const cBurst = a.cStartTimer > 0 && a.cStartTimer < 0.15 ? 1.15 : 0;
  const targetSpd = (a.panicTimer > 0 ? 0.95 : 0.38) + cBurst;
  smoothSteer(a, tgtYaw, dt, {
   maxYawRate: a.cStartTimer > 0 ? 6.5 : 3.2,
   yawAccel: a.cStartTimer > 0 ? 16.0 : 8.5,
   targetSpeed: targetSpd,
   speedRate: 4.5,
   rollGain: 0.14,
   maxRoll: 0.32,
  });
  a.vx = Math.cos(a.yaw) * a.speed;
  a.vz = Math.sin(a.yaw) * a.speed;
  a.x += a.vx * dt; a.z += a.vz * dt;

  const bed = land.height(a.x, a.z);
  a.bedY = bed;
  const waterY = waterHeightAtFn(sea, land, a.x, a.z);
  if (!isPlaced && waterY - bed < 0.11) {
   a.visibility = 0; a.y = bed + 0.015;
  } else if (waterY - bed >= 0.11) {
   const loY = bed + 0.055;
   const chopSink = localW.surfChop * 0.14;
   const hiY = Math.max(loY + 0.005, seaLevel - 0.09 - chopSink * 0.4);
   const rawTgt = clamp(targetY + Math.sin(a.phase * 0.4) * 0.012 - chopSink * 0.35, loY, hiY);
   a.y = clamp(lerp(a.y || rawTgt, rawTgt, 1 - Math.exp(-3.2 * dt)), loY, Math.min(waterY - 0.08, hiY));
  } else {
   a.y = bed + 0.03;
  }
  solveFishSpine(a, dt, a.speed, a.smoothYawRate, a.cStartTimer, a.cStartDir, time);
  return;
 }

 // ---------------- FLORIDA POMPANO (Trachinotus carolinus) ----------------
 if (a.speciesId === 'pompano') {
  const sense = stimuli ? stimuli.senseThreat(a, localRaysSharks, seaLevel) : {threat: 0, nearDist: Infinity};
  if (sense.threat > 0.45 && (a.cStartTimer || 0) <= 0) {
   a.fear = Math.min(1, sense.threat); a.threatX = sense.threatX; a.threatZ = sense.threatZ;
   a.cStartTimer = 0.24;
   a.cStartDir = (Math.cos(prevYaw) * (a.z - a.threatZ) - Math.sin(prevYaw) * (a.x - a.threatX)) >= 0 ? 1 : -1;
  }
  if ((a.cStartTimer || 0) > 0) a.cStartTimer = Math.max(0, a.cStartTimer - dt);

  const along = alongWorldFn(land, a.x, a.z), homeA = a.homeAlong ?? 0;
  if (!isPlaced) { if (along > homeA + 22) a.patrolSign = -1; if (along < homeA - 22) a.patrolSign = 1; }
  let dx = 0, dz = 0, hunting = false;
  if (a.fear > 0.38) {
   dx = a.x - a.threatX - INLAND_DIR_X * 1.4; dz = a.z - a.threatZ - INLAND_DIR_Z * 1.4;
   a.state = 'evading'; a.stateLabel = 'C-start surf-trough escape';
  } else {
   const surgeD = isPlaced ? clamp(land.shoreDistance(a.anchorX ?? a.x, a.anchorZ ?? a.z) + Math.sin(time * 0.55) * 1.6, -12, -4.5) : clamp((a.homeD ?? -8.5) + Math.sin(time * 0.45 + idNum * 1.4) * 2.2, -11.0, -4.5);
   const tgtAlong = isPlaced ? alongWorldFn(land, a.anchorX ?? a.x, a.anchorZ ?? a.z) + Math.sin(time * 0.5 + idNum) * 2.2 : (along + (a.patrolSign || 1) * 3.2);
   const [tx, tz] = worldAtShoreFn(land, surgeD, tgtAlong);
   dx = tx - a.x; dz = tz - a.z;
   let prey = null, bestD2 = 4.2 * 4.2;
   const podKey = a.podObj?.key ?? a.podId ?? 0;
   const pod = (baitPodLists instanceof Map ? baitPodLists.get(podKey) : baitPodLists?.[0]) || null;
   const preySources = [pod, localMoleCrabs, localSnails, localShrimp];
   if (a.hunger > 0.14) {
    for (const src of preySources) {
     if (!src?.length) continue;
     for (let i = 0; i < src.length; i++) {
      const bf = src[i];
      if (bf === a || bf.alive === false || bf.isPlaced || (bf.visibility ?? 1) <= 0.1) continue;
      const d2 = (bf.x - a.x) ** 2 + (bf.z - a.z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; prey = bf; }
     }
    }
   }
   if (prey) {
    dx = prey.x - a.x; dz = prey.z - a.z; hunting = true;
    if (bestD2 < 0.25 * 0.25) consumePrey(a, prey, 0.28, ctx, 'surf catch');
   }
   a.state = hunting ? 'hunting' : 'cruising';
   a.stateLabel = hunting ? `pursuing ${prey.commonName || 'silversides'}` : 'cruising breaking surf';
  }
  const waterY0 = waterHeightAtFn(sea, land, a.x, a.z);
  const av = avoidShallowGradient(a, land, seaLevel, waterY0, 0.28, 1.15, dt, isPlaced);
  const dist = Math.max(0.01, Math.hypot(dx, dz));
  let dirX = lerp(dx / dist, av.avoidX, av.weight * 0.85);
  let dirZ = lerp(dz / dist, av.avoidZ, av.weight * 0.85);
  const desSpd = (a.fear > 0.38 ? 1.15 : (hunting ? 0.82 : 0.54));
  smoothSteer(a, Math.atan2(dirZ, dirX), dt, {maxYawRate: 2.5, yawAccel: 6.2, targetSpeed: desSpd, speedRate: 3.4, rollGain: 0.16, maxRoll: 0.34});
  a.vx = Math.cos(a.yaw) * a.speed; a.vz = Math.sin(a.yaw) * a.speed;
  a.x += a.vx * dt; a.z += a.vz * dt;

  const bed = land.height(a.x, a.z); a.bedY = bed;
  const waterY = waterHeightAtFn(sea, land, a.x, a.z);
  if (!isPlaced && waterY - bed < 0.11) {
   a.visibility = 0; a.y = bed + 0.015;
  } else if (waterY - bed >= 0.11) {
   const loY = bed + 0.055;
   const hiY = Math.max(loY + 0.005, seaLevel - 0.09);
   const tgtY = clamp(lerp(bed + 0.16, seaLevel - 0.14, 0.4), loY, hiY);
   a.y = clamp(lerp(a.y || tgtY, tgtY, 1 - Math.exp(-3.4 * dt)), loY, Math.min(waterY - 0.08, hiY));
  } else {
   a.y = bed + 0.04;
  }
  solveFishSpine(a, dt, a.speed, a.smoothYawRate, a.cStartTimer, a.cStartDir, time);
  return;
 }

 // ---------------- GULF PINFISH (Lagodon rhomboides) ----------------
 if (a.speciesId === 'pinfish') {
  const sense = stimuli ? stimuli.senseThreat(a, localRaysSharks, seaLevel) : {threat: 0};
  if (sense.threat > 0.35) {
   a.fear = Math.min(1, sense.threat); a.threatX = sense.threatX; a.threatZ = sense.threatZ;
   if ((a.cStartTimer || 0) <= 0) {
    a.cStartTimer = 0.22;
    a.cStartDir = (Math.cos(prevYaw) * (a.z - a.threatZ) - Math.sin(prevYaw) * (a.x - a.threatX)) >= 0 ? 1 : -1;
   }
  }
  if ((a.cStartTimer || 0) > 0) a.cStartTimer = Math.max(0, a.cStartTimer - dt);

  const ang = time * 0.44 + (a.phase || 0);
  const hx = isPlaced ? (a.anchorX ?? a.x) : (a.homeX ?? a.x);
  const hz = isPlaced ? (a.anchorZ ?? a.z) : (a.homeZ ?? a.z);
  const tx = a.fear > 0.35 ? hx : (hx + Math.cos(ang) * 1.4 + Math.sin(ang * 0.5) * 0.5);
  const tz = a.fear > 0.35 ? hz : (hz + Math.sin(ang * 0.85) * 1.4);
  const waterY0 = waterHeightAtFn(sea, land, a.x, a.z);
  const av = avoidShallowGradient(a, land, seaLevel, waterY0, 0.25, 0.95, dt, isPlaced);
  const dx = tx - a.x, dz = tz - a.z, dm = Math.max(0.01, Math.hypot(dx, dz));
  const dirX = lerp(dx / dm, av.avoidX, av.weight * 0.85);
  const dirZ = lerp(dz / dm, av.avoidZ, av.weight * 0.85);
  const tgtSpd = a.fear > 0.35 ? 0.62 : clamp(dm * 0.45, 0.14, 0.34);
  smoothSteer(a, Math.atan2(dirZ, dirX), dt, {maxYawRate: 2.7, yawAccel: 6.5, targetSpeed: tgtSpd, speedRate: 3.5, rollGain: 0.15, maxRoll: 0.30});
  a.vx = Math.cos(a.yaw) * a.speed; a.vz = Math.sin(a.yaw) * a.speed;
  a.x += a.vx * dt; a.z += a.vz * dt;
  a.state = a.fear > 0.35 ? 'evading' : 'browsing';
  a.stateLabel = a.fear > 0.35 ? 'darting into seagrass shelter' : 'browsing seagrass & reef';
  if (a.state === 'browsing') {
   const algRich = ecology ? clamp(ecology.resources.benthicAlgae ?? 1, 0.2, 1.5) : 1.0;
   a.satiation = Math.min(1, (a.satiation ?? 0.4) + dt * 0.032 * algRich);
  }

  const bed = land.height(a.x, a.z); a.bedY = bed;
  const waterY = waterHeightAtFn(sea, land, a.x, a.z);
  if (!isPlaced && waterY - bed < 0.11) {
   a.visibility = 0; a.y = bed + 0.015;
  } else if (waterY - bed >= 0.11) {
   const loY = bed + 0.065;
   const hiY = Math.max(loY + 0.005, seaLevel - 0.095);
   const tgtY = clamp(bed + 0.22 + Math.sin(ang * 1.7) * 0.05, loY, hiY);
   a.y = clamp(lerp(a.y || tgtY, tgtY, 1 - Math.exp(-3.4 * dt)), loY, Math.min(waterY - 0.08, hiY));
  } else {
   a.y = bed + 0.04;
  }
  a.pitch = lerp(a.pitch || 0, a.state === 'browsing' ? 0.20 + 0.10 * Math.sin(time * 4.5 + idNum) : 0, Math.min(1, dt * 6));
  solveFishSpine(a, dt, a.speed, a.smoothYawRate, a.cStartTimer, a.cStartDir, time);
  return;
 }

 // ---------------- SHEEPSHEAD MINNOW / KILLIFISH (Cyprinodon variegatus) ----------------
 if (a.speciesId === 'killifish') {
  const sense = stimuli ? stimuli.senseThreat(a, null, seaLevel) : {threat: 0};
  if (sense.threat > 0.30) {
   a.fear = Math.min(1, sense.threat); a.threatX = sense.threatX; a.threatZ = sense.threatZ;
   if ((a.cStartTimer || 0) <= 0) {
    a.cStartTimer = 0.22;
    a.cStartDir = (Math.cos(prevYaw) * (a.z - a.threatZ) - Math.sin(prevYaw) * (a.x - a.threatX)) >= 0 ? 1 : -1;
   }
  }
  if ((a.cStartTimer || 0) > 0) a.cStartTimer = Math.max(0, a.cStartTimer - dt);

  const basin = isPlaced ? {x: a.anchorX ?? a.x, z: a.anchorZ ?? a.z} : (a.basinX !== undefined ? {x: a.basinX, z: a.basinZ} : (swaleBasins[a.basinIdx || 0] || {x: a.homeX ?? a.x, z: a.homeZ ?? a.z}));
  const ang = time * 0.55 + (a.phase || 0);
  const tx = a.fear > 0.30 ? basin.x : (basin.x + Math.cos(ang) * lerp(0.3, 1.5, detHash(idNum * 47)));
  const tz = a.fear > 0.30 ? basin.z : (basin.z + Math.sin(ang * 1.2) * lerp(0.3, 1.3, detHash(idNum * 31)));
  const dx = tx - a.x, dz = tz - a.z, dm = Math.max(0.01, Math.hypot(dx, dz));
  const tgtSpd = a.fear > 0.30 ? 0.45 : clamp(dm * 0.42, 0.10, 0.25);
  smoothSteer(a, Math.atan2(dz, dx), dt, {maxYawRate: 3.1, yawAccel: 7.5, targetSpeed: tgtSpd, speedRate: 4.0, rollGain: 0.14, maxRoll: 0.28});
  a.vx = Math.cos(a.yaw) * a.speed; a.vz = Math.sin(a.yaw) * a.speed;
  a.x += a.vx * dt; a.z += a.vz * dt;
  a.state = a.fear > 0.30 ? 'evading' : 'foraging';
  a.stateLabel = a.fear > 0.30 ? 'darting to deep pool center' : 'foraging swale pool';
  if (a.state === 'foraging') {
   const larvRich = ecology ? clamp(ecology.resources.swaleLarvae ?? 1, 0.2, 1.5) : 1.0;
   a.satiation = Math.min(1, (a.satiation ?? 0.4) + dt * 0.036 * larvRich);
  }

  const bed = land.height(a.x, a.z);
  if (!isPlaced && bed >= seaLevel - 0.11) {
   a.x = lerp(a.x, basin.x, dt * 3.0); a.z = lerp(a.z, basin.z, dt * 3.0);
  }
  const bedNow = land.height(a.x, a.z); a.bedY = bedNow;
  const env = land.environment ? land.environment(a.x, a.z, bedNow) : {moisture: 0.92};
  if (!isPlaced && (bedNow >= seaLevel - 0.08 || (env.moisture ?? 0.92) < 0.84)) a.visibility = 0;
  a.y = clamp(bedNow + 0.035 + Math.sin(a.phase * 0.5) * 0.010, bedNow + 0.025, Math.max(bedNow + 0.028, seaLevel - 0.07));
  solveFishSpine(a, dt, a.speed, a.smoothYawRate, a.cStartTimer, a.cStartDir, time);
  return;
 }

 // ---------------- BAY SCALLOP (Argopecten irradians — Cheng & DeMont 1996) ----------------
 if (a.speciesId === 'bay-scallop') {
  const threatPeers = localRaysSharks || localPredatorsSea || [];
  const sense = stimuli ? stimuli.senseThreat(a, threatPeers, seaLevel) : {threat: 0, nearDist: Infinity};
  let closeThreat = sense.threat, thx = sense.threatX, thz = sense.threatZ;
  if (localSwimmingCrabs?.length) {
   for (let i = 0; i < localSwimmingCrabs.length; i++) {
    const c = localSwimmingCrabs[i];
    if (c.alive === false) continue;
    const d2 = (c.x - a.x) * (c.x - a.x) + (c.z - a.z) * (c.z - a.z);
    if (d2 < 1.15 * 1.15) {
     const sc = (1 - Math.sqrt(d2) / 1.15) * 1.1;
     if (sc > closeThreat) { closeThreat = sc; thx = c.x; thz = c.z; }
    }
   }
  }
  if (closeThreat > 0.22) {
   a.fear = Math.min(1, Math.max(a.fear, closeThreat * 1.1));
   a.threatX = thx; a.threatZ = thz;
  }

  const cyber = stepCyberneticLoop(a, dt, {threat: a.fear, satiation: clamp(a.satiation ?? a.energy, 0, 1), fatigue: a.fatigue, foodAvail: 0.84}, {wSafe: 2.9, wForage: 1.0, hysteresis: 0.16});
  a.jetCooldown = Math.max(0, (a.jetCooldown || 0) - dt);
  if ((cyber.activeDrive === 'escape' || a.fear > 0.30) && (a.jetTimer || 0) <= 0 && a.jetCooldown <= 0 && (a.fatigue || 0) < 0.72) {
   a.jetTimer = 0.88; a.jetCooldown = 1.85;
   const awayX = a.x - (a.threatX ?? a.x), awayZ = a.z - (a.threatZ ?? a.z);
   const mag = Math.hypot(awayX, awayZ);
   const jetAng = mag > 0.03 ? Math.atan2(awayZ, awayX) : (a.yaw + Math.PI);
   a.yaw = jetAng; a.vx = Math.cos(jetAng) * 0.78; a.vz = Math.sin(jetAng) * 0.78;
  }

  let jetAlt = 0;
  const swimming = (a.jetTimer || 0) > 0;
  stepScallopValves(a, dt, swimming, time);
  if (swimming) {
   a.jetTimer = Math.max(0, a.jetTimer - dt);
   a.stamina = Math.max(0, (a.stamina ?? 0.8) - dt * 0.45);
   a.fatigue = clamp(1 - a.stamina, 0, 1);
   const prog = 1 - a.jetTimer / 0.88;
   const clapPulse = Math.max(0, 0.35 - (a.valveGape || 0.18)) * 0.14;
   jetAlt = Math.sin(Math.PI * clamp(prog, 0, 1)) * 0.22 + clapPulse;
   a.x += (a.vx || 0) * dt; a.z += (a.vz || 0) * dt;
   a.vx *= Math.exp(-dt * 1.2); a.vz *= Math.exp(-dt * 1.2);
   a.state = 'jet-swimming'; a.stateLabel = 'valve-clap jet escape';
  } else {
   a.vx = 0; a.vz = 0;
   a.state = 'filter-feeding';
   a.stateLabel = (a.fatigue || 0) > 0.55 ? 'recovering shell-clamped on grass bed' : 'filter-feeding on seagrass bed';
   const plRich = ecology ? clamp(ecology.resources.plankton ?? 1, 0.2, 1.5) : 1.0;
   a.satiation = Math.min(1, (a.satiation ?? 0.4) + dt * 0.042 * plRich);
  }

  const waterY0 = waterHeightAtFn(sea, land, a.x, a.z);
  const av = avoidShallowGradient(a, land, seaLevel, waterY0, 0.20, 0.65, dt, isPlaced);
  if (swimming && av.weight > 0.1) { a.vx += av.avoidX * 0.35 * dt; a.vz += av.avoidZ * 0.35 * dt; }
  const supBed = cachedGroundSupport(a, land, Math.max(0.04, (a.width || 0.065) * (a.sizeScale ?? 1) * 0.75));
  const bedNow = a._gRaw ?? land.height(a.x, a.z);
  const waterNow = waterHeightAtFn(sea, land, a.x, a.z);
  a.bedY = supBed;
  a.speed = Math.hypot(a.vx || 0, a.vz || 0);
  if (!isPlaced && waterNow - bedNow < 0.08) a.visibility = 0;
  const effH = (a.height || 0.024) * (a.sizeScale ?? 1);
  const minCenterY = supBed + effH * 0.58;
  const maxCenterY = waterNow - bedNow > 0.12 ? Math.max(minCenterY + 0.01, waterNow - 0.07) : minCenterY + 0.25;
  a.y = clamp(minCenterY + jetAlt, minCenterY, maxCenterY);
  a.pitch = swimming ? -0.18 - 0.12 * Math.sin(time * 22 + idNum) : 0.04;
  a.yawRate = wrapAngle(a.yaw - prevYaw) / Math.max(1e-3, dt);
  return;
 }

 // ---------------- SANDERLING (Calidris alba — Myers, Connors & Pitelka 1979 swash PCT) ----------------
 if (a.speciesId === 'sanderling') {
  const sense = stimuli ? stimuli.senseThreat(a, null, seaLevel) : {threat: 0};
  if (sense.threat > 0.28) {
   a.fear = Math.min(1, Math.max(a.fear, sense.threat * 1.1));
   a.threatX = sense.threatX;
   a.threatZ = sense.threatZ;
  }
  const waterY0 = waterHeightAtFn(sea, land, a.x, a.z);
  const bed0 = land.height(a.x, a.z);
  const inSwashBand = waterY0 - bed0 >= -0.10 && waterY0 - bed0 <= 0.04;
  const cyber = stepCyberneticLoop(a, dt, {threat: a.fear, satiation: a.energy, fatigue: a.fatigue, foodAvail: inSwashBand ? 0.86 : 0.58}, {wSafe: 2.7, wForage: 1.35, wRest: 1.15, satiatedRest: 0.62, hysteresis: 0.14});

  if (cyber.activeDrive === 'escape' && !a.airborne && a.fear > 0.44) {
   a.flightTimer = 2.6;
   a.airborne = true;
   a.flightAlt = 1.45 + detHash(idNum * 73) * 0.85;
  }
  if ((a.flightTimer || 0) > 0) a.flightTimer = Math.max(0, a.flightTimer - dt);

  let probing = false;
  a.preening = false;
  const waterY = waterY0;
  const bedHere = bed0;
  const waterDepth = waterY - bedHere;

  if (a.airborne && ((a.flightTimer || 0) > 0 || a.fear > 0.30)) {
   const flyAng = (a.castBias || 1) > 0 ? Math.atan2(land.alongZ || 1, land.alongX || 0) : Math.atan2(-(land.alongZ || 1), -(land.alongX || 0));
   const orbitAlong = (a.anchorAlong ?? a.homeAlong ?? alongWorldFn(land, a.anchorX ?? a.x, a.anchorZ ?? a.z)) + Math.sin(time * 0.7 + idNum) * 9.0;
   const [tx, tz] = isPlaced ? [a.anchorX ?? a.x, a.anchorZ ?? a.z] : worldAtShoreFn(land, 0.8 + Math.sin(time * 0.5 + idNum) * 1.5, orbitAlong);
   const dx = tx - a.x + Math.cos(flyAng) * 0.3, dz = tz - a.z + Math.sin(flyAng) * 0.3;
   smoothSteer(a, Math.atan2(dz, dx), dt, {maxYawRate: 3.4, yawAccel: 6.5, targetSpeed: 4.6, speedRate: 3.8, rollGain: 0.18, maxRoll: 0.36});
   a.vx = Math.cos(a.yaw) * a.speed + localW.wx * 0.18;
   a.vz = Math.sin(a.yaw) * a.speed + localW.wz * 0.18;
   a.x += a.vx * dt;
   a.z += a.vz * dt;
   a.speed = Math.hypot(a.vx, a.vz);
   a.state = 'flushing';
   a.stateLabel = 'wheeling along surf line';
  } else if ((cyber.activeDrive === 'rest' || localW.saltation > 0.45) && a.fear < 0.25) {
   a.airborne = false;
   let rx = isPlaced ? (a.anchorX ?? a.x) : (a.roostX ?? a.x);
   let rz = isPlaced ? (a.anchorZ ?? a.z) : (a.roostZ ?? a.z);
   if (!isPlaced && localW.saltation > 0.45) {
    const lee = leewardShelterGradient(land, a.x, a.z, 4.5);
    rx += lee.gx * 3.5 * localW.saltation;
    rz += lee.gz * 3.5 * localW.saltation;
   }
   const dx = rx - a.x, dz = rz - a.z;
   const distR = Math.hypot(dx, dz);
   if (distR > 0.45 && !isPlaced) {
    a.vx = lerp(a.vx || 0, (dx / distR) * 0.62, Math.min(1, dt * 6));
    a.vz = lerp(a.vz || 0, (dz / distR) * 0.62, Math.min(1, dt * 6));
    a.x += a.vx * dt; a.z += a.vz * dt;
    a.speed = Math.hypot(a.vx, a.vz);
    if (a.speed > 0.04) a.yaw = Math.atan2(a.vz, a.vx);
    a.state = 'roosting-approach';
    a.stateLabel = localW.saltation > 0.45 ? 'sheltering leeward from blowing sand' : 'trotting up berm to roost';
   } else {
    a.vx = 0; a.vz = 0; a.speed = 0;
    a.yaw = wrapAngle(a.yaw + wrapAngle(upwindYaw - a.yaw) * Math.min(1, dt * 3.5));
    a.preening = Math.sin(time * 0.55 + idNum * 2.1) > 0.72;
    a.state = 'roosting';
    a.stateLabel = localW.saltation > 0.45 ? 'hunkered in lee shelter from saltation' : (a.preening ? 'preening windward on berm' : 'roosting windward on upper berm');
   }
  } else {
   a.airborne = false;
   // PCT reference wet-sand water film: chase receding swash, sprint upslope from incoming surge
   const anchorAlong = isPlaced ? alongWorldFn(land, a.anchorX ?? a.x, a.anchorZ ?? a.z) : (a.homeAlong ?? alongWorldFn(land, a.x, a.z)) + Math.sin(time * 0.14 + idNum * 1.9) * 8.5;
   const anchorD = isPlaced ? land.shoreDistance(a.anchorX ?? a.x, a.anchorZ ?? a.z) : clamp(land.shoreDistance(a.x, a.z), -2.5, 4.8);
   const alongVecX = -INLAND_DIR_Z, alongVecZ = INLAND_DIR_X;
   let dirX = 0, dirZ = 0, tgtSpd = 0;

   let nearPrey = null, bestPD2 = 0.45 * 0.45;
   for (const arr of [localMoleCrabs, localSnails, localHoppers]) {
    if (!arr?.length) continue;
    for (let i = 0; i < arr.length; i++) {
     const p = arr[i];
     if (p.alive === false || p.isPlaced || (p.visibility ?? 1) <= 0.1) continue;
     if (p.speciesId === 'marsh-periwinkle' || p.speciesId === 'hermit-crab') continue;
     const d2 = (p.x - a.x) ** 2 + (p.z - a.z) ** 2;
     if (d2 < bestPD2) { bestPD2 = d2; nearPrey = p; }
    }
   }

   if (waterDepth > 0.016) {
    dirX = INLAND_DIR_X + alongVecX * (a.castBias || 1) * 0.35;
    dirZ = INLAND_DIR_Z + alongVecZ * (a.castBias || 1) * 0.35;
    tgtSpd = 1.42;
    a.state = 'outrunning-wave';
    a.stateLabel = 'sprinting upslope ahead of swash';
   } else if (waterDepth < -0.095) {
    const [wtX, wtZ] = worldAtShoreFn(land, isPlaced ? anchorD : 0.25, anchorAlong);
    dirX = wtX - a.x; dirZ = wtZ - a.z;
    tgtSpd = isPlaced && Math.hypot(dirX, dirZ) < 0.35 ? 0.18 : 0.88;
    a.state = 'chasing-swash';
    a.stateLabel = 'chasing receding swash wave';
   } else {
    const stitchOsc = Math.sin(time * 2.4 + idNum * 3.1);
    probing = !!nearPrey || stitchOsc > -0.15;
    if (nearPrey && bestPD2 > 0.08 * 0.08) {
     dirX = nearPrey.x - a.x; dirZ = nearPrey.z - a.z;
     tgtSpd = 0.62;
    } else {
     const sweepAlong = (a.castBias || 1) * (stitchOsc < 0 ? 1 : 0.35);
     dirX = alongVecX * sweepAlong - INLAND_DIR_X * 0.12;
     dirZ = alongVecZ * sweepAlong - INLAND_DIR_Z * 0.12;
     tgtSpd = probing ? 0.26 : 0.72;
    }
    a.state = probing ? 'probing' : 'scuttling';
    a.stateLabel = probing ? 'stitch-probing wet sand' : 'trotting along swash edge';
    if (probing) {
     if (nearPrey && bestPD2 < 0.24 * 0.24 && consumePrey(a, nearPrey, 0.28, ctx, 'swash-probe')) {
      a.stateLabel = `captured ${nearPrey.commonName || 'swash invertebrate'}`;
     } else if (waterDepth >= -0.08 && waterDepth <= 0.03) {
      a.satiation = Math.min(1, (a.satiation ?? 0.35) + dt * 0.015);
      a.feedTimer = Math.max(a.feedTimer || 0, 0.18);
     }
    }
   }
   const mag = Math.max(1e-4, Math.hypot(dirX, dirZ));
   a.vx = lerp(a.vx || 0, (dirX / mag) * tgtSpd, Math.min(1, dt * 8));
   a.vz = lerp(a.vz || 0, (dirZ / mag) * tgtSpd, Math.min(1, dt * 8));
   a.x += a.vx * dt;
   a.z += a.vz * dt;
   a.speed = Math.hypot(a.vx, a.vz);
   if (a.speed > 0.05) a.yaw = Math.atan2(a.vz, a.vx);
  }

  const scSz = a.sizeScale ?? 1;
  const dune = birdDuneSlope(a, land, Math.max(0.11, (a.len || 0.20) * scSz * 0.55));
  const legH = a.bipedRig?.legH || 0.046;
  const effH = (a.height || 0.055) * scSz;
  a.bedY = dune.supH;
  if (a.airborne) {
   const targetAltY = Math.max(dune.supH, seaLevel) + (a.flightAlt || 1.6);
   a.y = Math.max(Math.max(dune.supH, waterHeightAtFn(sea, land, a.x, a.z)) + 0.18, lerp(a.y || targetAltY, targetAltY, Math.min(1, dt * 3.2)));
   a.pitch = -0.06;
  } else {
   a.y = dune.supH + legH + effH * 0.54 + dune.extraClear;
   a.pitch = clamp(dune.slopePitch + (probing ? 0.24 * Math.max(0, Math.sin(time * 22 + idNum)) : 0), -0.34, 0.38);
  }
  stepBipedIK(a, dt, land, a.vx, a.vz, a.speed, a.airborne, probing, time);
  a.yawRate = wrapAngle(a.yaw - prevYaw) / Math.max(1e-3, dt);
  return;
 }

 // ---------------- LAUGHING GULL (Leucophaeus atricilla) ----------------
 if (a.speciesId === 'laughing-gull') {
  const sense = stimuli ? stimuli.senseThreat(a, null, seaLevel) : {threat: 0};
  if (sense.threat > 0.24) {
   a.fear = Math.min(1, Math.max(a.fear, sense.threat * 1.1));
   a.threatX = sense.threatX;
   a.threatZ = sense.threatZ;
  }
  const windEase = clamp(1 - localW.spd / 11, 0, 1);
  let targetCarcass = null, bestCarD2 = 22 * 22;
  if (carcasses?.length && !isPlaced) {
   for (let i = 0; i < carcasses.length; i++) {
    const c = carcasses[i];
    if (!c || c.nutrition <= 0.02) continue;
    const d2 = (c.x - a.x) ** 2 + (c.z - a.z) ** 2;
    if (d2 < bestCarD2) { bestCarD2 = d2; targetCarcass = c; }
   }
  }
  let targetPrey = null, bestPrD2 = 12 * 12;
  for (const arr of [localHoppers, localMoleCrabs, localSnails]) {
   if (!arr?.length || isPlaced) continue;
   for (let i = 0; i < arr.length; i++) {
    const p = arr[i];
    if (p.alive === false || p.isPlaced || (p.visibility ?? 1) <= 0.12) continue;
    const d2 = (p.x - a.x) ** 2 + (p.z - a.z) ** 2;
    if (d2 < bestPrD2) { bestPrD2 = d2; targetPrey = p; }
   }
  }
  const wrackRes = ecology ? clamp(ecology.resources.wrack ?? 0.6, 0.05, 1.5) : 0.72;
  const availFood = clamp((targetCarcass ? 0.96 : 0) + (targetPrey ? 0.78 : 0) + wrackRes * 0.45, 0.25, 0.98);
  const cyber = stepCyberneticLoop(a, dt, {threat: a.fear, satiation: a.energy, fatigue: a.fatigue, foodAvail: availFood, windEase}, {wSafe: 2.5, wForage: 1.25, wRest: 1.25, wExplore: 0.65, satiatedRest: 0.68, hysteresis: 0.18});
  const breeding = (land.climate?.dayOfYear ?? 155) >= 105 && (land.climate?.dayOfYear ?? 155) <= 225;
  const galeGround = localW.spd > 13.5 && a.fear < 0.30;
  const wantRest = (cyber.activeDrive === 'rest' || galeGround) && a.fear < 0.22;

  let probing = false;
  a.tucked = false;
  a.preening = false;
  if (wantRest) {
   const targetNest = breeding && a.hasNest && !isPlaced && !galeGround;
   let rx = isPlaced ? (a.anchorX ?? a.x) : (targetNest ? (a.nestX ?? a.roostX ?? a.x) : (a.roostX ?? a.x));
   let rz = isPlaced ? (a.anchorZ ?? a.z) : (targetNest ? (a.nestZ ?? a.roostZ ?? a.z) : (a.roostZ ?? a.z));
   if (galeGround && !isPlaced) {
    const lee = leewardShelterGradient(land, rx, rz, 5.0);
    rx += lee.gx * 4.0;
    rz += lee.gz * 4.0;
   }
   const dx = rx - a.x, dz = rz - a.z;
   const dist = Math.hypot(dx, dz);
   if (dist > 0.55) {
    const spd = Math.min(5.2, Math.max(2.0, dist * 1.4));
    smoothSteer(a, Math.atan2(dz, dx), dt, {maxYawRate: 3.0, yawAccel: 5.5, targetSpeed: spd, speedRate: 3.2, rollGain: 0.20, maxRoll: 0.38});
    a.vx = Math.cos(a.yaw) * a.speed + localW.wx * 0.20;
    a.vz = Math.sin(a.yaw) * a.speed + localW.wz * 0.20;
    a.x += a.vx * dt; a.z += a.vz * dt;
    a.speed = Math.hypot(a.vx, a.vz);
    a.airborne = true;
    a.state = 'landing';
    a.stateLabel = galeGround ? 'dropping to lee shelter in gale' : (targetNest ? 'flying back to nest scrape' : 'gliding down toward roost');
   } else {
    a.airborne = false;
    a.vx = 0; a.vz = 0; a.speed = 0; a.yawVel = 0; a.smoothYawRate = 0;
    a.yaw = wrapAngle(a.yaw + wrapAngle(upwindYaw - a.yaw) * Math.min(1, dt * 3.5));
    a.preening = Math.sin(time * 0.45 + idNum * 1.7) > 0.72;
    if (targetNest) {
     a.tucked = true;
     a.state = 'incubating';
     a.stateLabel = 'incubating sand-shell nest scrape';
    } else {
     a.state = 'loafing';
     a.stateLabel = galeGround ? 'sheltered low windward in storm' : (a.preening ? 'preening plumage windward' : 'loafing windward on berm');
    }
   }
  } else if (cyber.activeDrive === 'forage' && a.fear < 0.22 && (idNum % 2 === 0 || isPlaced || targetCarcass || targetPrey)) {
   let rx, rz;
   if (targetCarcass) {
    rx = targetCarcass.x; rz = targetCarcass.z;
   } else if (targetPrey) {
    rx = targetPrey.x; rz = targetPrey.z;
   } else if (isPlaced) {
    rx = a.anchorX ?? a.x; rz = a.anchorZ ?? a.z;
   } else {
    const along = (a.homeAlong ?? 0) + Math.sin(time * 0.12 + idNum) * 5.0;
    const wrD = wrackDAt ? wrackDAt(land, along, seaLevel) : lerp(1.5, 6.5, detHash(idNum * 43));
    [rx, rz] = worldAtShoreFn(land, wrD + lerp(-0.8, 1.4, detHash(idNum * 43)), along);
   }
   const dist = Math.hypot(rx - a.x, rz - a.z);
   if (dist > 3.5 && a.airborne) {
    const spd = Math.min(5.2, dist * 1.2);
    smoothSteer(a, Math.atan2(rz - a.z, rx - a.x), dt, {maxYawRate: 3.0, yawAccel: 5.5, targetSpeed: spd, speedRate: 3.2, rollGain: 0.20, maxRoll: 0.38});
    a.vx = Math.cos(a.yaw) * a.speed + localW.wx * 0.20;
    a.vz = Math.sin(a.yaw) * a.speed + localW.wz * 0.20;
    a.x += a.vx * dt; a.z += a.vz * dt;
    a.speed = Math.hypot(a.vx, a.vz);
    a.state = 'landing';
    a.stateLabel = targetCarcass ? 'descending to beach carcass' : 'gliding down to wrack line';
   } else {
    a.airborne = false;
    const tx = (targetCarcass || targetPrey) ? rx : rx + Math.cos(time * 0.42 + idNum * 2.1) * (isPlaced ? 0.85 : 1.6);
    const tz = (targetCarcass || targetPrey) ? rz : rz + Math.sin(time * 0.42 + idNum * 2.1) * (isPlaced ? 0.85 : 1.6);
    const ldx = tx - a.x, ldz = tz - a.z;
    const ld = Math.max(0.04, Math.hypot(ldx, ldz));
    const walkSlope = birdDuneSlope(a, land, Math.max(0.24, (a.len || 0.40) * 0.65));
    let steerX = ldx / ld, steerZ = ldz / ld;
    if (walkSlope.slopeMag > 0.26) {
     const w = clamp((walkSlope.slopeMag - 0.26) * 2.4, 0, 1);
     const dMag = Math.hypot(walkSlope.downX, walkSlope.downZ) || 1;
     steerX = lerp(steerX, walkSlope.downX / dMag, w);
     steerZ = lerp(steerZ, walkSlope.downZ / dMag, w);
     const sNorm = Math.hypot(steerX, steerZ) || 1;
     steerX /= sNorm; steerZ /= sNorm;
    }
    a.vx = lerp(a.vx || 0, steerX * 0.34, Math.min(1, dt * 4));
    a.vz = lerp(a.vz || 0, steerZ * 0.34, Math.min(1, dt * 4));
    a.x += a.vx * dt; a.z += a.vz * dt;
    a.speed = Math.hypot(a.vx, a.vz);
    if (a.speed > 0.03) a.yaw = Math.atan2(a.vz, a.vx);
    if (targetCarcass && ld < 0.48) {
     probing = true;
     a.feedTimer = 0.45;
     if (ctx.scavengeCarcass) ctx.scavengeCarcass(a, targetCarcass, dt);
     else {
      const bite = Math.min(targetCarcass.nutrition, dt * 0.22);
      targetCarcass.nutrition -= bite;
      a.satiation = Math.min(1, (a.satiation ?? 0.3) + bite);
      a.energy = Math.min(1, a.energy + bite * 0.35);
     }
     a.state = 'scavenging';
     a.stateLabel = 'scavenging beach carrion';
    } else if (targetPrey && ld < 0.55) {
     probing = true;
     consumePrey(a, targetPrey, 0.30, ctx, 'shore-prey');
     a.state = 'scavenging';
     a.stateLabel = `seized ${targetPrey.commonName || 'shore prey'}`;
    } else {
     const onWrack = wrackCenterFn ? Math.abs(land.shoreDistance(a.x, a.z) - wrackCenterFn(alongWorldFn(land, a.x, a.z), seaLevel)) < 2.4 : true;
     probing = onWrack && wrackRes > 0.12 && Math.sin(time * 2.0 + idNum) > 0.25;
     if (probing) {
      a.feedTimer = 0.25;
      a.satiation = Math.min(1, (a.satiation ?? 0.35) + dt * 0.045 * wrackRes);
     }
     a.state = 'scavenging';
     a.stateLabel = 'scavenging wrack line';
    }
   }
  } else {
   a.airborne = true;
   const center = isPlaced ? {x: a.anchorX ?? a.x, z: a.anchorZ ?? a.z} : null;
   const ang = time * 0.48 + (a.phase || 0);
   let tx, tz;
   if (isPlaced) {
    const rad = 4.6 + Math.sin(ang * 1.7) * 1.4;
    tx = center.x + Math.cos(ang) * rad;
    tz = center.z + Math.sin(ang) * rad;
   } else {
    const soarD = a.band === 'bay' ? (245 + Math.cos(ang) * 12) : (-2.5 + Math.cos(ang) * 9.5);
    const soarAlong = (a.homeAlong ?? 0) + Math.sin(ang * 0.7) * 16.0;
    [tx, tz] = worldAtShoreFn(land, soarD, soarAlong);
   }
   const dx = tx - a.x, dz = tz - a.z;
   const d = Math.max(0.05, Math.hypot(dx, dz));
   const flySpd = cyber.activeDrive === 'escape' ? 7.4 : 5.8;
   smoothSteer(a, Math.atan2(tz - a.z, tx - a.x), dt, {maxYawRate: 2.6, yawAccel: 4.8, targetSpeed: flySpd, speedRate: 3.0, rollGain: 0.24, maxRoll: 0.42});
   a.vx = Math.cos(a.yaw) * a.speed + localW.wx * 0.22;
   a.vz = Math.sin(a.yaw) * a.speed + localW.wz * 0.22;
   a.x += a.vx * dt; a.z += a.vz * dt;
   a.speed = Math.hypot(a.vx, a.vz);
   const slopeUpdraft = land.height(a.x, a.z) > seaLevel + 0.55 && localW.spd > 2.5 ? clamp((localW.spd - 2.0) * 0.04, 0, 0.25) : 0;
   if (slopeUpdraft > 0.05) a.stamina = Math.min(1, (a.stamina ?? 0.7) + dt * slopeUpdraft * 0.25);
   a.state = cyber.activeDrive === 'escape' ? 'flushing' : 'soaring';
   a.stateLabel = cyber.activeDrive === 'escape' ? 'flushing upward from threat' : (slopeUpdraft > 0.08 ? 'soaring dune ridge updrafts' : 'patrolling coastline for carrion & wrack');
  }

  const scSz = a.sizeScale ?? 1;
  const dune = birdDuneSlope(a, land, Math.max(0.24, (a.len || 0.40) * scSz * 0.65));
  const legH = a.bipedRig?.legH || 0.088;
  const effH = (a.height || 0.11) * scSz;
  a.bedY = dune.supH;
  if (a.airborne) {
   const cruiseAlt = (cyber.activeDrive === 'escape' ? 4.8 : 3.4) + Math.sin(time * 0.65 + idNum) * 0.75;
   const targetY = Math.max(dune.supH, seaLevel) + cruiseAlt;
   a.y = Math.max(dune.supH + legH + 0.18, lerp(a.y || targetY, targetY, Math.min(1, dt * 2.4)));
   a.pitch = a.state === 'landing' ? -0.24 : -0.04;
   a.headYaw = 0;
  } else if (a.tucked) {
   a.y = dune.supH + effH * 0.64 + dune.extraClear;
   a.roll = dune.slopeRoll;
   a.pitch = dune.slopePitch;
   a.headYaw = a.preening ? (1.65 + 0.22 * Math.sin(time * 6.5 + idNum)) : Math.sin(time * 0.85 + idNum * 1.3) * 0.32;
  } else {
   a.y = dune.supH + legH + effH * 0.56 + dune.extraClear;
   a.roll = dune.slopeRoll;
   a.pitch = clamp(dune.slopePitch + (probing ? 0.22 * Math.max(0, Math.sin(time * 16 + idNum)) : 0), -0.38, 0.44);
   a.headYaw = a.preening ? (1.65 + 0.22 * Math.sin(time * 6.5 + idNum)) : Math.sin(time * 0.85 + idNum * 1.3) * 0.32;
  }
  stepBipedIK(a, dt, land, a.vx, a.vz, a.speed, a.airborne, probing, time);
  a.yawRate = wrapAngle(a.yaw - prevYaw) / Math.max(1e-3, dt);
  return;
 }

 // ---------------- ROYAL TERN (Thalasseus maximus — Prey-gated plunge-diving & roosting) ----------------
 if (a.speciesId === 'royal-tern') {
  const sense = stimuli ? stimuli.senseThreat(a, null, seaLevel) : {threat: 0};
  if (sense.threat > 0.28) a.fear = Math.min(1, Math.max(a.fear, sense.threat));
  const windEase = clamp(1 - localW.spd / 12, 0, 1);

  let detectedPrey = null;
  let bestScore = 1e9;
  const detR = 5.5 * clamp(1 - 0.65 * localW.surfChop, 0.22, 1.0);
  const detR2 = detR * detR;
  const maxPreyDepth = 0.52 * clamp(1 - 0.50 * localW.surfChop, 0.30, 1.0);
  if (!isPlaced) {
   for (const arr of [localFishSurface, localShrimp]) {
    if (!arr?.length) continue;
    for (let i = 0; i < arr.length; i++) {
     const p = arr[i];
     if (p.alive === false || p.isPlaced || (p.visibility ?? 1) <= 0.08) continue;
     const dx = p.x - a.x, dz = p.z - a.z;
     const d2 = dx * dx + dz * dz;
     if (d2 > detR2) continue;
     const wSurf = waterHeightAtFn(sea, land, p.x, p.z);
     const subDepth = wSurf - p.y;
     if (subDepth < 0.015 || subDepth > maxPreyDepth) continue;
     const score = d2 + subDepth * 4.0;
     if (score < bestScore) { bestScore = score; detectedPrey = p; }
    }
   }
  }

  const cyber = stepCyberneticLoop(a, dt, {threat: a.fear, satiation: a.energy, fatigue: a.fatigue, foodAvail: detectedPrey ? 0.92 : 0.22, windEase}, {wSafe: 2.4, wForage: 1.50, wRest: 1.25, wExplore: 0.75, satiatedRest: 0.64, hysteresis: 0.16});

  a.diveCooldown = Math.max(0, (a.diveCooldown || 0) - dt);
  if (!a.divePhase) a.divePhase = 'patrol';
  a.preening = false;
  a.tucked = false;

  const galeRoost = localW.spd > 14.5 && a.fear < 0.25 && a.divePhase === 'patrol';
  const forcingFlight = isPlaced || a.divePhase === 'diving' || a.divePhase === 'rising' || cyber.activeDrive === 'escape';
  if (!forcingFlight && (cyber.activeDrive === 'rest' || galeRoost) && a.fear < 0.25 && a.roostX !== undefined) {
   const dx = a.roostX - a.x, dz = a.roostZ - a.z;
   const dist = Math.hypot(dx, dz);
   if (dist > 0.65) {
    a.airborne = true;
    const spd = Math.min(5.6, Math.max(2.0, dist * 1.4));
    smoothSteer(a, Math.atan2(dz, dx), dt, {maxYawRate: 2.8, yawAccel: 5.0, targetSpeed: spd, speedRate: 3.2, rollGain: 0.20, maxRoll: 0.36});
    a.vx = Math.cos(a.yaw) * a.speed + localW.wx * 0.20;
    a.vz = Math.sin(a.yaw) * a.speed + localW.wz * 0.20;
    a.x += a.vx * dt; a.z += a.vz * dt;
    a.speed = Math.hypot(a.vx, a.vz);
    const supH = cachedGroundSupport(a, land, 0.08);
    a.bedY = supH;
    a.y = Math.max(supH + 0.18, lerp(a.y || supH + 1.5, Math.max(supH, seaLevel) + Math.min(2.2, dist * 0.45), Math.min(1, dt * 2.5)));
    a.pitch = -0.24;
    a.headYaw = 0;
    a.state = 'landing';
    a.stateLabel = galeRoost ? 'gliding to sheltered foreshore roost in gale' : 'gliding down to foreshore roost';
   } else {
    a.airborne = false;
    a.vx = 0; a.vz = 0; a.speed = 0; a.yawVel = 0; a.smoothYawRate = 0;
    a.yaw = wrapAngle(a.yaw + wrapAngle(upwindYaw - a.yaw) * Math.min(1, dt * 3.5));
    const scSz = a.sizeScale ?? 1;
    const ternDune = birdDuneSlope(a, land, Math.max(0.24, (a.len || 0.46) * scSz * 0.62));
    a.roll = ternDune.slopeRoll;
    a.pitch = ternDune.slopePitch;
    a.preening = Math.sin(time * 0.42 + idNum * 1.9) > 0.78;
    a.headYaw = a.preening ? (1.65 + 0.22 * Math.sin(time * 6.5 + idNum)) : Math.sin(time * 0.85 + idNum * 1.3) * 0.32;
    const legH = a.bipedRig?.legH || 0.068;
    const effH = (a.height || 0.10) * scSz;
    a.bedY = ternDune.supH;
    a.y = ternDune.supH + legH + effH * 0.56 + ternDune.extraClear;
    a.state = 'roosting';
    a.stateLabel = galeRoost ? 'roosting low windward in gale' : 'roosting windward in tern flock';
   }
   stepBipedIK(a, dt, land, a.vx, a.vz, a.speed, a.airborne, false, time);
   a.yawRate = wrapAngle(a.yaw - prevYaw) / Math.max(1e-3, dt);
   return;
  }

  a.headYaw = 0;
  a.airborne = true;
  if (a.divePhase === 'patrol') {
   const ang = time * 0.52 + (a.phase || 0);
   let tx, tz;
   if (isPlaced) {
    const cx = a.anchorX ?? a.x, cz = a.anchorZ ?? a.z;
    tx = cx + Math.cos(ang) * 5.2;
    tz = cz + Math.sin(ang * 0.9) * 5.2;
   } else {
    const pD = -13.5 + Math.cos(ang * 0.85) * 6.5;
    const pAlong = (a.homeAlong ?? 0) + Math.sin(ang * 0.65) * 16.0;
    [tx, tz] = worldAtShoreFn(land, pD, pAlong);
   }
   smoothSteer(a, Math.atan2(tz - a.z, tx - a.x), dt, {maxYawRate: 2.5, yawAccel: 4.5, targetSpeed: 6.8, speedRate: 3.2, rollGain: 0.24, maxRoll: 0.42});
   a.vx = Math.cos(a.yaw) * a.speed + localW.wx * 0.20;
   a.vz = Math.sin(a.yaw) * a.speed + localW.wz * 0.20;
   a.x += a.vx * dt; a.z += a.vz * dt;
   const supH = cachedGroundSupport(a, land, 0.08);
   a.bedY = supH;
   const tgtY = Math.max(supH, seaLevel) + 4.2 + Math.sin(time * 0.7 + idNum) * 0.65;
   a.y = lerp(a.y || tgtY, tgtY, Math.min(1, dt * 2.5));
   a.pitch = 0.08;
   a.state = 'patrolling';
   a.stateLabel = localW.surfChop > 0.65 ? 'quartering rough chop for baitfish' : 'scanning nearshore for surface baitfish';

   // Strictly prey-gated dive trigger: zero empty-water swoops!
   if (detectedPrey && cyber.activeDrive === 'forage' && a.diveCooldown <= 0 && a.fear < 0.25 && localW.spd < 15.0) {
    a.preyTarget = detectedPrey;
    a.diveTargetX = detectedPrey.x;
    a.diveTargetZ = detectedPrey.z;
    a.divePhase = 'diving';
   }
  } else if (a.divePhase === 'diving') {
   if (a.preyTarget) {
    const p = a.preyTarget;
    const surfPrey = waterHeightAtFn(sea, land, p.x, p.z);
    if (p.alive === false || (p.visibility ?? 1) <= 0.05 || (surfPrey - p.y > 0.72 && a.y > surfPrey + 0.9)) {
     a.preyTarget = null;
     a.divePhase = 'rising';
     a.diveCooldown = 2.0;
     a.state = 'climbing';
     a.stateLabel = 'aborting dive — prey sounded';
    } else {
     a.diveTargetX = p.x;
     a.diveTargetZ = p.z;
    }
   }
   if (a.divePhase === 'diving') {
    const dx = (a.diveTargetX ?? a.x) - a.x;
    const dz = (a.diveTargetZ ?? a.z) - a.z;
    const hDist = Math.max(0.04, Math.hypot(dx, dz));
    const surfEst = waterHeightAtFn(sea, land, a.diveTargetX ?? a.x, a.diveTargetZ ?? a.z);
    const fallH = Math.max(0.15, a.y - (surfEst + 0.14));
    const diveTime = Math.max(0.12, fallH / 8.8);
    const horizSpd = hDist > 0.25 ? clamp(hDist / diveTime, 2.2, 8.8) : hDist * 2.5;
    smoothSteer(a, Math.atan2(dz, dx), dt, {maxYawRate: 5.5, yawAccel: 12.0, targetSpeed: horizSpd, speedRate: 11.0, rollGain: 0.16, maxRoll: 0.35});
    a.vx = Math.cos(a.yaw) * a.speed + localW.wx * 0.10;
    a.vz = Math.sin(a.yaw) * a.speed + localW.wz * 0.10;
    a.x += a.vx * dt; a.z += a.vz * dt;
    const sinkRate = hDist > 0.45 && fallH < hDist * 1.1 ? clamp(8.8 * (fallH / Math.max(0.35, hDist * 1.1)), 2.6, 8.8) : 8.8;
    a.y -= sinkRate * dt;
    a.pitch = 0.82;
    a.state = 'plunge-diving';
    a.stateLabel = a.preyTarget ? `plunge-diving on ${a.preyTarget.commonName || 'baitfish'}` : 'plunge-diving on fish';
    const surfY = waterHeightAtFn(sea, land, a.x, a.z);
    const supH = cachedGroundSupport(a, land, 0.08);
    a.bedY = supH;
    if (a.y <= Math.max(surfY + 0.14, supH + 0.16)) {
     a.y = Math.max(surfY + 0.10, supH + 0.16);
     stimuli?.emit(a.x, surfY, a.z, 'splash', 1.35, 5.5, 0, -4.5, 0, 0.85, a.id);
     sea?.ripple?.(a.x, a.z, 0.055, false, 4.5);
     if (a.preyTarget && a.preyTarget.alive !== false && Math.hypot(a.preyTarget.x - a.x, a.preyTarget.z - a.z) < 0.65 && consumePrey(a, a.preyTarget, 0.38, ctx, 'plunge-dive')) {
      a.stateLabel = 'climbing with silver catch';
     } else {
      a.stateLabel = 'climbing empty-billed after missed dive';
     }
     a.preyTarget = null;
     a.diveCooldown = 5.2;
     a.divePhase = 'rising';
    }
   }
  } else {
   a.x += (a.vx || 2.5) * dt;
   a.z += (a.vz || 2.5) * dt;
   a.y += 4.2 * dt;
   a.pitch = -0.34;
   a.state = 'climbing';
   if (!a.stateLabel) a.stateLabel = 'climbing from plunge dive';
   const supH = cachedGroundSupport(a, land, 0.08);
   a.bedY = supH;
   if (a.y >= Math.max(supH, seaLevel) + 3.4) a.divePhase = 'patrol';
  }

  a.speed = Math.hypot(a.vx || 0, a.vz || 0);
  if (a.speed > 0.1) a.yaw = Math.atan2(a.vz, a.vx);
  a.roll = clamp(-(a.smoothYawRate ?? a.yawRate ?? 0) * 0.22, -0.45, 0.45);
  stepBipedIK(a, dt, land, a.vx || 0, a.vz || 0, a.speed, true, false, time);
  a.yawRate = wrapAngle(a.yaw - prevYaw) / Math.max(1e-3, dt);
  return;
 }

 // ---------------- ATLANTIC STINGRAY (Hypanus sabinus — Cryptic burial & saltatory benthic foraging) ----------------
 if (a.speciesId === 'atlantic-stingray') {
  const threatPeers = localRaysSharks ? localRaysSharks.filter(r => r.speciesId === 'bonnethead-shark') : [];
  const sense = stimuli ? stimuli.senseThreat(a, threatPeers, seaLevel) : {threat: 0};
  if (sense.threat > 0.22) {
   a.fear = Math.min(1, Math.max(a.fear, sense.threat * 1.15));
   a.threatX = sense.threatX;
   a.threatZ = sense.threatZ;
  }
  const cyber = stepCyberneticLoop(a, dt, {threat: a.fear, satiation: a.energy, fatigue: a.fatigue, foodAvail: 0.78}, {wSafe: 2.55, wForage: 1.20, wRest: 1.35, satiatedRest: 0.72, hysteresis: 0.16});

  const shX = isPlaced ? (a.anchorX ?? a.x) : (a.shelterX ?? a.x);
  const shZ = isPlaced ? (a.anchorZ ?? a.z) : (a.shelterZ ?? a.z);
  const distShelter = Math.hypot(shX - a.x, shZ - a.z);
  let desVx = 0, desVz = 0;

  if (cyber.activeDrive === 'escape' || a.fear > 0.34) {
   a.settleTimer = 0;
   const ax = a.x - (a.threatX ?? a.x);
   const az = a.z - (a.threatZ ?? a.z);
   const mag = Math.max(0.05, Math.hypot(ax, az));
   desVx = (ax / mag) * 0.92 + (shX - a.x) * 0.22;
   desVz = (az / mag) * 0.92 + (shZ - a.z) * 0.22;
   a.state = 'evading';
   a.stateLabel = 'rajiform jet burst off seabed';
  } else if ((a.settleTimer || 0) > 0) {
   a.settleTimer = Math.max(0, a.settleTimer - dt);
   a.vx = 0; a.vz = 0;
   a.state = a.settleTimer > 0.01 ? 'settling' : 'buried-resting';
   a.stateLabel = 'fluttering pectoral fins to cover disc with sand';
  } else if (cyber.activeDrive === 'rest') {
   if (distShelter > 1.25 && !isPlaced) {
    const inv = 1 / distShelter;
    desVx = (shX - a.x) * inv * 0.42;
    desVz = (shZ - a.z) * inv * 0.42;
    a.state = 'seeking-shelter';
    a.stateLabel = 'gliding to calm seagrass-edge sand shelter';
   } else if (a.state !== 'buried-resting' && Math.hypot(a.vx || 0, a.vz || 0) > 0.08) {
    a.settleTimer = 1.25;
    a.vx = 0; a.vz = 0;
    a.state = 'settling';
    a.stateLabel = 'fanning sand over disc to settle';
   } else {
    a.vx = 0; a.vz = 0;
    a.state = 'buried-resting';
    a.stateLabel = 'resting cryptically covered in sand beside seagrass';
   }
  } else {
   // Saltatory benthic electroreceptive foraging: short glides + benthic prey capture / sediment excavating
   const bout = (time + (a.phase || 0)) % 6.0;
   if (bout > 3.9) {
    a.vx = 0; a.vz = 0;
    a.feedTimer = 0.35;
    a.satiation = Math.min(1, (a.satiation ?? 0.35) + dt * 0.025);
    a.state = 'excavating';
    a.stateLabel = 'electro-sensing & excavating benthic infauna';
   } else {
    let prey = null, bestD2 = 6.5 * 6.5;
    if (!isPlaced) {
     for (const arr of [localScallops, localSwimmingCrabs, localShrimp]) {
      if (!arr?.length) continue;
      for (let i = 0; i < arr.length; i++) {
       const c = arr[i];
       if (c.alive === false || c.isPlaced || (c.visibility ?? 1) <= 0.1) continue;
       const d2 = (c.x - a.x) * (c.x - a.x) + (c.z - a.z) * (c.z - a.z);
       if (d2 < bestD2) { bestD2 = d2; prey = c; }
      }
     }
    }
    let tx, tz;
    if (prey) {
     tx = prey.x; tz = prey.z;
     if (bestD2 < 0.36 * 0.36) consumePrey(a, prey, 0.28, ctx, 'benthic-prey');
    } else {
     const ang = time * 0.22 + (a.phase || 0);
     if (isPlaced) {
      tx = shX + Math.cos(ang) * 2.2;
      tz = shZ + Math.sin(ang * 0.8) * 1.6;
     } else {
      tx = shX + Math.cos(ang) * 4.5;
      tz = shZ + Math.sin(ang * 1.1) * 4.5;
     }
    }
    const dx = tx - a.x, dz = tz - a.z;
    const d = Math.max(0.05, Math.hypot(dx, dz));
    const spd = clamp(d * 0.55, 0.24, 0.48);
    desVx = (dx / d) * spd;
    desVz = (dz / d) * spd;
    a.state = 'saltatory-foraging';
    a.stateLabel = 'gliding low scanning benthic sand for prey';
   }
  }

  if (a.state === 'buried-resting' || a.state === 'settling' || a.state === 'excavating') {
   a.vx = 0; a.vz = 0; a.speed = 0; a.yawVel = 0; a.smoothYawRate = 0;
  } else {
   const waterY0 = waterHeightAtFn(sea, land, a.x, a.z);
   const av = avoidShallowGradient(a, land, seaLevel, waterY0, 0.30, 1.3, dt, isPlaced);
   const desSpd = Math.hypot(desVx, desVz);
   let tgtYaw = desSpd > 0.02 ? Math.atan2(desVz, desVx) : a.yaw;
   if (!isPlaced && av.weight > 0.02) {
    tgtYaw = Math.atan2(lerp(Math.sin(tgtYaw), av.avoidZ, av.weight), lerp(Math.cos(tgtYaw), av.avoidX, av.weight));
   }
   smoothSteer(a, tgtYaw, dt, {maxYawRate: 1.4, yawAccel: 3.6, targetSpeed: desSpd, speedRate: 2.8, rollGain: 0.14, maxRoll: 0.22});
   a.vx = Math.cos(a.yaw) * a.speed;
   a.vz = Math.sin(a.yaw) * a.speed;
   a.x += a.vx * dt;
   a.z += a.vz * dt;
  }

  const scSz = a.sizeScale ?? 1;
  const supBed = cachedGroundSupport(a, land, Math.max(0.12, (a.width || 0.38) * scSz * 0.65));
  const bedNow = a._gRaw ?? land.height(a.x, a.z);
  const waterNow = waterHeightAtFn(sea, land, a.x, a.z);
  a.bedY = supBed;
  if (!isPlaced && waterNow - bedNow < 0.12) a.visibility = 0;

  const restY = supBed + (a.height || 0.045) * scSz * 0.44 + 0.008;
  const glideY = (a.state === 'buried-resting' || a.state === 'settling' || a.state === 'excavating')
   ? restY
   : (supBed + 0.095 + Math.sin(time * 1.15 + idNum) * 0.032);
  const maxWaterY = waterNow - bedNow > 0.16 ? Math.max(restY + 0.01, waterNow - 0.10) : restY + 0.08;
  const targetY = clamp(glideY, restY, maxWaterY);
  a.y = clamp(lerp(a.y ?? targetY, targetY, 1 - Math.exp(-4.5 * Math.max(dt, 0.001))), restY, maxWaterY);
  stepRayUndulation(a, dt, a.speed, land);
  return;
 }

 // ---------------- JUVENILE BONNETHEAD SHARK (Sphyrna tiburo — Smooth obligate ram cruiser) ----------------
 if (a.speciesId === 'bonnethead-shark') {
  a.strikeCooldown = Math.max(0, (a.strikeCooldown || 0) - dt);
  const sense = stimuli ? stimuli.senseThreat(a, null, seaLevel) : {threat: 0};
  if (sense.threat > 0.32) {
   a.fear = Math.min(1, Math.max(a.fear, sense.threat));
   a.threatX = sense.threatX;
   a.threatZ = sense.threatZ;
  }
  const cyber = stepCyberneticLoop(a, dt, {threat: a.fear, satiation: a.energy, fatigue: 0, foodAvail: 0.80}, {wSafe: 2.0, wForage: 1.45, wRest: 0, satiatedRest: 0, wExplore: 0.85, hysteresis: 0.15});

  let prey = null, bestD2 = 8.5 * 8.5;
  if (!isPlaced && cyber.activeDrive === 'forage') {
   for (const arr of [localSwimmingCrabs, localShrimp]) {
    if (!arr?.length) continue;
    for (let i = 0; i < arr.length; i++) {
     const c = arr[i];
     if (c.alive === false || c.isPlaced || (c.visibility ?? 1) <= 0.08) continue;
     const d2 = (c.x - a.x) * (c.x - a.x) + (c.z - a.z) * (c.z - a.z);
     if (d2 < bestD2) { bestD2 = d2; prey = c; }
    }
   }
  }

  let desSpd = 0.64;
  let tgtYaw = a.yaw;
  if (cyber.activeDrive === 'escape' || a.fear > 0.38) {
   tgtYaw = Math.atan2(a.z - (a.threatZ ?? a.z) - INLAND_DIR_Z * 2, a.x - (a.threatX ?? a.x) - INLAND_DIR_X * 2);
   desSpd = 1.38;
   a.state = 'darting';
   a.stateLabel = 'burst swimming seaward';
  } else if (prey) {
   tgtYaw = Math.atan2(prey.z - a.z, prey.x - a.x);
   desSpd = bestD2 < 2.2 * 2.2 ? 1.15 : 0.86;
   if (bestD2 < 0.48 * 0.48 && a.strikeCooldown <= 0) {
    if (consumePrey(a, prey, 0.34, ctx, 'shark-strike')) a.strikeCooldown = 2.8;
   }
   a.state = 'hunting';
   a.stateLabel = 'stalking blue crab along seagrass edge';
  } else {
   const ang = time * 0.18 + (a.phase || 0);
   let tx, tz;
   if (isPlaced) {
    tx = (a.anchorX ?? a.x) + Math.cos(ang) * 3.8;
    tz = (a.anchorZ ?? a.z) + Math.sin(ang * 1.4) * 2.6;
   } else {
    const baseD = a.band === 'bay' ? (a.homeD ?? 250) : -15.5;
    [tx, tz] = worldAtShoreFn(land, baseD + Math.cos(ang * 1.1) * 5.2, (a.homeAlong ?? 0) + Math.sin(ang * 0.6) * 26.0);
   }
   tgtYaw = Math.atan2(tz - a.z, tx - a.x);
   desSpd = a.energy > 0.72 ? 0.58 : 0.74;
   a.state = 'cruising';
   a.stateLabel = 'ram-ventilating coastal cruise';
  }

  const waterY0 = waterHeightAtFn(sea, land, a.x, a.z);
  const av = avoidShallowGradient(a, land, seaLevel, waterY0, 0.58, 2.8, dt, isPlaced);
  if (!isPlaced && av.weight > 0.02) {
   tgtYaw = Math.atan2(lerp(Math.sin(tgtYaw), av.avoidZ, av.weight), lerp(Math.cos(tgtYaw), av.avoidX, av.weight));
  }
  smoothSteer(a, tgtYaw, dt, {maxYawRate: 1.35, yawAccel: 2.6, targetSpeed: desSpd, speedRate: 2.0, rollGain: 0.24, maxRoll: 0.30, kp: 1.85, rateFilter: 4.0});
  a.vx = Math.cos(a.yaw) * a.speed;
  a.vz = Math.sin(a.yaw) * a.speed;
  a.x += a.vx * dt;
  a.z += a.vz * dt;

  const scSz = a.sizeScale ?? 1;
  const supBed = cachedGroundSupport(a, land, Math.max(0.14, (a.width || 0.22) * scSz * 0.75));
  const bedNow = a._gRaw ?? land.height(a.x, a.z);
  const waterNow = waterHeightAtFn(sea, land, a.x, a.z);
  a.bedY = supBed;
  if (!isPlaced && waterNow - bedNow < 0.24) a.visibility = 0;
  const minSubY = supBed + (a.height || 0.11) * scSz * 0.78 + 0.05;
  const maxSubY = waterNow - bedNow > 0.28 ? Math.max(minSubY + 0.02, waterNow - 0.16) : minSubY + 0.15;
  const targetY = clamp(lerp(minSubY + 0.18, maxSubY, 0.5) + Math.sin(time * 0.65 + idNum) * 0.035, minSubY, maxSubY);
  a.y = clamp(lerp(a.y ?? targetY, targetY, 1 - Math.exp(-3.2 * Math.max(dt, 0.001))), minSubY, maxSubY);
  a.headSweep = Math.sin((a.fishSpine?.swimPhase || 0) - 0.8) * 0.055;
  solveFishSpine(a, dt, a.speed, a.smoothYawRate, a.cStartTimer, a.cStartDir, time);
  return;
 }

 // ---------------- VARIABLE COQUINA CLAM (Donax variabilis — Swash tidal migrator) ----------------
 if (a.speciesId === 'coquina-clam') {
  const seaShift = -seaLevel * 7.0;
  const sense = stimuli ? stimuli.senseThreat(a, localGhostCrabs, seaLevel) : {threat: 0, nearDist: Infinity};
  let flowSurf = 0;
  if (sea?.flow) flowSurf = (sea.flow(a.x, a.z).x * INLAND_DIR_X + sea.flow(a.x, a.z).z * INLAND_DIR_Z) * 0.45;
  const waveSurge = Math.sin(time * 0.90 + (a.homeAlong || 0) * 0.18) * (1.2 + 0.3 * localW.surfChop) + flowSurf;
  const bed = land.height(a.x, a.z);
  const waterY = waterHeightAtFn(sea, land, a.x, a.z);
  const waterDepth = waterY - bed;

  if (sense.threat > 0.22) a.fear = Math.min(1, Math.max(a.fear, sense.threat * 1.1));
  const swimmingWash = waterDepth > 0.015 && waterDepth < 0.22 && a.fear < 0.25;
  if (swimmingWash) {
   const targetD = isPlaced ? land.shoreDistance(a.anchorX ?? a.x, a.anchorZ ?? a.z) + waveSurge * 0.25 : (seaShift + (a.dOffset || 0) * 0.45 + waveSurge);
   const [tx, tz] = worldAtShoreFn(land, targetD, a.homeAlong ?? alongWorldFn(land, a.x, a.z));
   const nextX = lerp(a.x, tx, Math.min(1, dt * 1.5));
   const nextZ = lerp(a.z, tz, Math.min(1, dt * 1.5));
   a.vx = (nextX - a.x) / Math.max(1e-3, dt);
   a.vz = (nextZ - a.z) / Math.max(1e-3, dt);
   a.x = nextX; a.z = nextZ;
   a.burrowDepth = lerp(a.burrowDepth || 0, 0, Math.min(1, dt * 4.5));
   a.state = 'swash-emerging';
   a.stateLabel = 'tumbling cleanly in thin swash';
   a.satiation = Math.min(1, (a.satiation ?? 0.35) + dt * 0.035);
   a.pitch = lerp(a.pitch || 0, 0.15, Math.min(1, dt * 5));
  } else {
   a.vx = 0; a.vz = 0;
   const targetBurrow = (a.fear > 0.25 || waterDepth <= 0.015) ? 0.022 : 0.006;
   a.burrowDepth = lerp(a.burrowDepth || 0, targetBurrow, Math.min(1, dt * 4.8));
   a.state = a.burrowDepth > 0.010 ? 'burrowing' : 'resting';
   a.stateLabel = a.burrowDepth > 0.010 ? 'burrowing rapidly foot-first in wet sand' : 'anchored in foreshore sand';
   a.pitch = lerp(a.pitch || 0, a.burrowDepth > 0.010 ? 0.72 : 0.18, Math.min(1, dt * 5));
  }
  a.speed = Math.hypot(a.vx || 0, a.vz || 0);
  const bedNow = land.height(a.x, a.z);
  const supH = cachedGroundSupport(a, land, Math.max(0.024, (a.len || 0.016) * 1.1));
  a.bedY = bedNow;
  const effH = (a.height || 0.008) * (a.sizeScale ?? 1);
  a.y = (a.burrowDepth > 0.002 ? bedNow : Math.max(bedNow, supH)) + effH * 0.65 - (a.burrowDepth || 0);
  a.yaw = Math.atan2(-INLAND_DIR_Z, -INLAND_DIR_X) + Math.sin(idNum) * 0.25;
  a.yawRate = wrapAngle(a.yaw - prevYaw) / Math.max(1e-3, dt);
  return;
 }

 // ---------------- THIN-STRIPED HERMIT CRAB (Clibanarius vittatus — Shell-carrying scavenger) ----------------
 if (a.speciesId === 'hermit-crab') {
  const threatPeers = localGhostCrabs || [];
  const sense = stimuli ? stimuli.senseThreat(a, threatPeers, seaLevel) : {threat: 0};
  const birdSense = stimuli && birds?.length ? stimuli.senseThreat(a, nearList ? nearList('birds', a) : birds, seaLevel) : {threat: 0};
  const combThreat = Math.max(sense.threat, birdSense.threat);
  if (combThreat > 0.24) {
   a.fear = Math.min(1, Math.max(a.fear, combThreat * 1.15));
   a.threatX = birdSense.threat > sense.threat ? birdSense.threatX : sense.threatX;
   a.threatZ = birdSense.threat > sense.threat ? birdSense.threatZ : sense.threatZ;
  }
  const cyber = stepCyberneticLoop(a, dt, {threat: a.fear, satiation: a.energy, fatigue: a.fatigue, foodAvail: 0.75}, {wSafe: 2.8, wForage: 1.15, wRest: 1.10, satiatedRest: 0.70, hysteresis: 0.16});

  if (a.fear > 0.28 || cyber.activeDrive === 'escape') {
   a.retracted = true;
   a.vx = 0; a.vz = 0; a.speed = 0;
   a.state = 'shell-retracted';
   a.stateLabel = 'retracted tightly inside gastropod shell';
  } else if (cyber.activeDrive === 'rest' || localW.saltation > 0.55) {
   a.retracted = false;
   a.vx = 0; a.vz = 0; a.speed = 0;
   a.state = 'resting';
   a.stateLabel = 'resting at waterline tide margin';
  } else {
   a.retracted = false;
   let car = null, bestC2 = 4.0 * 4.0;
   if (carcasses?.length && !isPlaced) {
    for (let i = 0; i < carcasses.length; i++) {
     const c = carcasses[i];
     if (!c || c.nutrition <= 0.02) continue;
     const d2 = (c.x - a.x) ** 2 + (c.z - a.z) ** 2;
     if (d2 < bestC2) { bestC2 = d2; car = c; }
    }
   }
   let tx, tz;
   if (car) {
    tx = car.x; tz = car.z;
    if (bestC2 < 0.20 * 0.20) {
     if (ctx.scavengeCarcass) ctx.scavengeCarcass(a, car, dt);
     else a.satiation = Math.min(1, (a.satiation ?? 0.35) + dt * 0.12);
    }
   } else {
    const ang = time * 0.22 + (a.phase || 0);
    const targD = a.band === 'bay' ? (a.homeD ?? 242) : lerp(-0.2, 2.6, 0.5 + 0.5 * Math.sin(ang * 0.5));
    [tx, tz] = isPlaced ? [(a.anchorX ?? a.x) + Math.cos(ang) * 0.8, (a.anchorZ ?? a.z) + Math.sin(ang) * 0.8] : worldAtShoreFn(land, targD, (a.homeAlong ?? 0) + Math.sin(ang) * 2.5);
   }
   smoothSteer(a, Math.atan2(tz - a.z, tx - a.x), dt, {maxYawRate: 2.2, yawAccel: 4.5, targetSpeed: car ? 0.11 : 0.075, speedRate: 3.5, rollGain: 0.05});
   a.vx = Math.cos(a.yaw) * a.speed;
   a.vz = Math.sin(a.yaw) * a.speed;
   a.x += a.vx * dt; a.z += a.vz * dt;
   a.satiation = Math.min(1, (a.satiation ?? 0.4) + dt * 0.022);
   a.state = 'foraging';
   a.stateLabel = car ? 'scavenging carrion along foreshore' : 'crawling slowly carrying striped shell';
  }
  const scSz = a.sizeScale ?? 1;
  const supBed = cachedGroundSupport(a, land, Math.max(0.032, (a.len || 0.028) * scSz * 1.1));
  a.bedY = supBed;
  const effH = (a.height || 0.018) * scSz;
  a.y = supBed + Math.max(0.008, effH * 0.58);
  if (a.crabRig) stepCrabIK(a, dt, land, a.vx, a.vz, a.speed, false, a.retracted ? 1 : 0, time);
  return;
 }

 // ---------------- EASTERN BEACH TIGER BEETLE (Habroscelimorpha dorsalis — Stop-and-go hunter) ----------------
 if (a.speciesId === 'tiger-beetle') {
  const localBirds = nearList ? nearList('birds', a) : birds;
  const localLizards = nearList ? nearList('dunePredators', a) : ctx.dunePredators;
  const peerList = localBirds && localLizards ? localBirds.concat(localLizards) : (localBirds || localLizards);
  const sense = stimuli ? stimuli.senseThreat(a, peerList, seaLevel) : {threat: 0};
  if (sense.threat > 0.30) {
   a.fear = Math.min(1, Math.max(a.fear, sense.threat * 1.1));
   a.threatX = sense.threatX; a.threatZ = sense.threatZ;
  }
  if ((a.flightTimer || 0) > 0) a.flightTimer = Math.max(0, a.flightTimer - dt);
  if (a.fear > 0.44 && !a.airborne && (a.flightTimer || 0) <= 0) {
   a.airborne = true;
   a.flightTimer = 1.05;
   a.flightAlt = 0.32 + detHash(idNum * 37) * 0.14;
  }
  if (a.airborne && (a.flightTimer || 0) <= 0) a.airborne = false;

  const isColdDark = (a.activity ?? 1) < 0.22;
  if (a.airborne) {
   const ax = a.x - (a.threatX ?? a.x), az = a.z - (a.threatZ ?? a.z);
   const flyYaw = Math.hypot(ax, az) > 0.02 ? Math.atan2(az, ax) : a.yaw;
   smoothSteer(a, flyYaw, dt, {maxYawRate: 6.0, yawAccel: 10.0, targetSpeed: 2.2, speedRate: 6.0, rollGain: 0.12});
   a.vx = Math.cos(a.yaw) * a.speed + localW.wx * 0.24;
   a.vz = Math.sin(a.yaw) * a.speed + localW.wz * 0.24;
   a.x += a.vx * dt; a.z += a.vz * dt;
   a.state = 'flushing';
   a.stateLabel = 'buzzing low escape flight over dry beach';
  } else if (localW.saltation > 0.40) {
   const lee = leewardShelterGradient(land, a.x, a.z, 3.5);
   smoothSteer(a, Math.atan2(lee.gz, lee.gx), dt, {maxYawRate: 5.0, yawAccel: 9.0, targetSpeed: 0.42, speedRate: 5.0});
   a.vx = Math.cos(a.yaw) * a.speed; a.vz = Math.sin(a.yaw) * a.speed;
   a.x += a.vx * dt; a.z += a.vz * dt;
   a.state = 'wind-sheltering';
   a.stateLabel = 'retreating leeward from blowing sand';
  } else if (isColdDark) {
   a.vx = 0; a.vz = 0; a.speed = 0;
   a.state = 'resting';
   a.stateLabel = 'sheltered dormant during cool night';
  } else {
   // Gilbert (1997) stop-and-go sprint -> pause visual re-acquisition loop
   if (!a.runPhase) { a.runPhase = 'sprint'; a.runPauseTimer = 0.34; }
   a.runPauseTimer = (a.runPauseTimer ?? 0) - dt;
   if (a.runPauseTimer <= 0) {
    if (a.runPhase === 'sprint') {
     a.runPhase = 'pause';
     a.runPauseTimer = 0.24 + detHash(idNum * 19 + Math.floor(time * 5)) * 0.10;
    } else {
     a.runPhase = 'sprint';
     a.runPauseTimer = 0.30 + detHash(idNum * 23 + Math.floor(time * 5)) * 0.16;
    }
   }

   let prey = null, bestD2 = 3.2 * 3.2;
   if (!isPlaced && localDunePrey?.length) {
    for (let i = 0; i < localDunePrey.length; i++) {
     const p = localDunePrey[i];
     if (p === a || p.alive === false || p.isPlaced || (p.visibility ?? 1) <= 0.1 || p.speciesId === 'tiger-beetle' || p.speciesId === 'racerunner') continue;
     const d2 = (p.x - a.x) ** 2 + (p.z - a.z) ** 2;
     if (d2 < bestD2) { bestD2 = d2; prey = p; }
    }
   }

   if (a.runPhase === 'pause') {
    a.vx = 0; a.vz = 0; a.speed = 0;
    if (prey) a.yaw = Math.atan2(prey.z - a.z, prey.x - a.x);
    a.state = 're-acquiring';
    a.stateLabel = 'pausing to visually re-acquire prey';
   } else {
    let tx, tz;
    if (prey) {
     tx = prey.x; tz = prey.z;
     if (bestD2 < 0.15 * 0.15) consumePrey(a, prey, 0.32, ctx, 'tiger-beetle-strike');
    } else {
     const ang = Math.floor(time * 1.4 + idNum) * 1.7 + (a.phase || 0);
     const [bx, bz] = isPlaced ? [a.anchorX ?? a.x, a.anchorZ ?? a.z] : worldAtShoreFn(land, lerp(3.0, 11.0, detHash(idNum * 29)), (a.homeAlong ?? 0));
     tx = bx + Math.cos(ang) * 2.2; tz = bz + Math.sin(ang) * 2.2;
    }
    smoothSteer(a, Math.atan2(tz - a.z, tx - a.x), dt, {maxYawRate: 7.5, yawAccel: 14.0, targetSpeed: prey ? 0.98 : 0.78, speedRate: 9.0, rollGain: 0.04});
    a.vx = Math.cos(a.yaw) * a.speed; a.vz = Math.sin(a.yaw) * a.speed;
    a.x += a.vx * dt; a.z += a.vz * dt;
    a.state = 'hunting';
    a.stateLabel = prey ? `sprinting after ${prey.commonName || 'prey'}` : 'cursorial stop-and-go patrolling';
   }
  }

  const scSz = a.sizeScale ?? 1;
  const sup = cachedGroundSupport(a, land, Math.max(0.035, (a.len || 0.015) * scSz * 1.4));
  a.bedY = sup;
  const effH = (a.height || 0.0055) * scSz;
  a.y = a.airborne ? (sup + (a.flightAlt || 0.35)) : (sup + Math.max(0.006, effH * 0.72));
  a.pitch = a.airborne ? -0.10 : 0.02;
  return;
 }

 // ---------------- SIX-LINED RACERUNNER (Aspidoscelis sexlineata — Diurnal foredune whiptail) ----------------
 if (a.speciesId === 'racerunner') {
  const localBirds = nearList ? nearList('birds', a) : birds;
  const sense = stimuli ? stimuli.senseThreat(a, localBirds, seaLevel) : {threat: 0};
  if (sense.threat > 0.28) {
   a.fear = Math.min(1, Math.max(a.fear, sense.threat * 1.15));
   a.threatX = sense.threatX; a.threatZ = sense.threatZ;
  }
  const tempOk = (land.climate?.airTemperature ?? 27) >= 21.5;
  const thermalOk = tempOk && (a.activity ?? 1) >= 0.25;
  const cyber = stepCyberneticLoop(a, dt, {threat: a.fear, satiation: a.energy, fatigue: a.fatigue, foodAvail: thermalOk ? 0.82 : 0.15}, {wSafe: 2.8, wForage: 1.30, wRest: 1.30, satiatedRest: 0.65, hysteresis: 0.16});

  if (cyber.activeDrive === 'escape' || a.fear > 0.34) {
   const ax = a.x - (a.threatX ?? a.x) + INLAND_DIR_X * 1.5;
   const az = a.z - (a.threatZ ?? a.z) + INLAND_DIR_Z * 1.5;
   smoothSteer(a, Math.atan2(az, ax), dt, {maxYawRate: 5.5, yawAccel: 11.0, targetSpeed: 1.85, speedRate: 7.5, rollGain: 0.05});
   a.vx = Math.cos(a.yaw) * a.speed; a.vz = Math.sin(a.yaw) * a.speed;
   a.x += a.vx * dt; a.z += a.vz * dt;
   a.state = 'sprinting-cover';
   a.stateLabel = 'sprinting rapidly into foredune scrub cover';
  } else if (localW.saltation > 0.42) {
   const lee = leewardShelterGradient(land, a.x, a.z, 4.5);
   smoothSteer(a, Math.atan2(lee.gz, lee.gx), dt, {maxYawRate: 4.5, yawAccel: 9.0, targetSpeed: 0.65, speedRate: 5.0});
   a.vx = Math.cos(a.yaw) * a.speed; a.vz = Math.sin(a.yaw) * a.speed;
   a.x += a.vx * dt; a.z += a.vz * dt;
   a.state = 'wind-sheltering';
   a.stateLabel = 'sheltering leeward of foredune crest';
  } else if (!thermalOk || cyber.activeDrive === 'rest') {
   a.vx = 0; a.vz = 0; a.speed = 0; a.yawVel = 0; a.smoothYawRate = 0;
   a.state = 'basking';
   a.stateLabel = thermalOk ? 'thermoregulating sunlit on open foredune sand' : 'resting sheltered in cool conditions';
  } else {
   let prey = null, bestD2 = 5.5 * 5.5;
   if (!isPlaced && localDunePrey?.length) {
    for (let i = 0; i < localDunePrey.length; i++) {
     const p = localDunePrey[i];
     if (p === a || p.alive === false || p.isPlaced || (p.visibility ?? 1) <= 0.1 || p.speciesId === 'racerunner') continue;
     const d2 = (p.x - a.x) ** 2 + (p.z - a.z) ** 2;
     if (d2 < bestD2) { bestD2 = d2; prey = p; }
    }
   }
   let tx, tz;
   if (prey) {
    tx = prey.x; tz = prey.z;
    if (bestD2 < 0.25 * 0.25) consumePrey(a, prey, 0.30, ctx, 'racerunner-strike');
   } else {
    const ang = time * 0.48 + (a.phase || 0);
    [tx, tz] = isPlaced ? [(a.anchorX ?? a.x) + Math.cos(ang) * 1.4, (a.anchorZ ?? a.z) + Math.sin(ang * 1.3) * 1.4] : worldAtShoreFn(land, clamp(20 + Math.cos(ang * 0.9) * 8.5, 11, 35), (a.homeAlong ?? 0) + Math.sin(ang * 0.7) * 9.0);
   }
   smoothSteer(a, Math.atan2(tz - a.z, tx - a.x), dt, {maxYawRate: 4.5, yawAccel: 9.0, targetSpeed: prey ? 0.88 : 0.56, speedRate: 5.5, rollGain: 0.06});
   a.vx = Math.cos(a.yaw) * a.speed; a.vz = Math.sin(a.yaw) * a.speed;
   a.x += a.vx * dt; a.z += a.vz * dt;
   a.state = 'foraging';
   a.stateLabel = prey ? `pursuing ${prey.commonName || 'dune arthropod'}` : 'wide-foraging sunlit foredune sand';
  }

  const scSz = a.sizeScale ?? 1;
  const sup = cachedGroundSupport(a, land, Math.max(0.07, (a.len || 0.17) * scSz * 0.45));
  a.bedY = sup;
  const effH = (a.height || 0.017) * scSz;
  a.y = sup + Math.max(0.010, effH * 0.68);
  solveLizardSpine(a, dt, a.speed, a.smoothYawRate, land);
  return;
 }

 // ---------------- DAGGERBLADE GRASS SHRIMP (Palaemonetes pugio — Seagrass caridoid tail-flipper) ----------------
 if (a.speciesId === 'grass-shrimp') {
  a.flipCooldown = Math.max(0, (a.flipCooldown || 0) - dt);
  a.tailFlipTimer = Math.max(0, (a.tailFlipTimer || 0) - dt);
  const sense = stimuli ? stimuli.senseThreat(a, localPredatorsSea, seaLevel) : {threat: 0};
  if (sense.threat > 0.22) {
   a.fear = Math.min(1, Math.max(a.fear, sense.threat * 1.2));
   a.threatX = sense.threatX; a.threatZ = sense.threatZ;
  }
  if ((a.fear > 0.28 || sense.nearDist < 1.3) && a.tailFlipTimer <= 0 && a.flipCooldown <= 0) {
   a.tailFlipTimer = 0.28;
   a.flipCooldown = 1.5;
   const toThreatX = (a.threatX ?? a.x) - a.x, toThreatZ = (a.threatZ ?? a.z) - a.z;
   if (Math.hypot(toThreatX, toThreatZ) > 0.03) a.yaw = Math.atan2(toThreatZ, toThreatX); // face threat while tail-flipping backward away
   a.vx = -Math.cos(a.yaw) * 1.25;
   a.vz = -Math.sin(a.yaw) * 1.25;
  }

  const waterY0 = waterHeightAtFn(sea, land, a.x, a.z);
  if (a.tailFlipTimer > 0) {
   a.tailFlex = 1.0;
   a.x += (a.vx || 0) * dt; a.z += (a.vz || 0) * dt;
   a.speed = Math.hypot(a.vx || 0, a.vz || 0);
   a.state = 'tail-flipping';
   a.stateLabel = 'caridoid backward tail-flip escape';
  } else {
   a.tailFlex = lerp(a.tailFlex || 0, 0, Math.min(1, dt * 8));
   const ang = time * 0.55 + (a.phase || 0);
   const gx = (a.homeX ?? a.x) + Math.cos(ang) * (isPlaced ? 0.55 : 1.1);
   const gz = (a.homeZ ?? a.z) + Math.sin(ang * 1.2) * (isPlaced ? 0.55 : 1.1);
   let tgtYaw = Math.atan2(gz - a.z, gx - a.x);
   const av = avoidShallowGradient(a, land, seaLevel, waterY0, 0.22, 0.7, dt, isPlaced);
   if (!isPlaced && av.weight > 0.05) {
    tgtYaw = Math.atan2(lerp(Math.sin(tgtYaw), av.avoidZ, av.weight), lerp(Math.cos(tgtYaw), av.avoidX, av.weight));
   }
   smoothSteer(a, tgtYaw, dt, {maxYawRate: 3.5, yawAccel: 7.0, targetSpeed: 0.12, speedRate: 4.5, rollGain: 0.04});
   a.vx = Math.cos(a.yaw) * a.speed; a.vz = Math.sin(a.yaw) * a.speed;
   a.x += a.vx * dt; a.z += a.vz * dt;
   const algRich = ecology ? clamp(ecology.resources.benthicAlgae ?? 1, 0.2, 1.5) : 1.0;
   a.satiation = Math.min(1, (a.satiation ?? 0.4) + dt * 0.032 * algRich);
   a.state = 'grazing';
   a.stateLabel = 'grazing epiphytes inside seagrass canopy';
  }

  const scSz = a.sizeScale ?? 1;
  const supBed = cachedGroundSupport(a, land, Math.max(0.03, (a.width || 0.008) * scSz * 1.4));
  const bedNow = a._gRaw ?? land.height(a.x, a.z);
  const waterNow = waterHeightAtFn(sea, land, a.x, a.z);
  a.bedY = supBed;
  if (!isPlaced && waterNow - bedNow < 0.10) a.visibility = 0;
  const effH = (a.height || 0.008) * scSz;
  const minSubY = supBed + Math.max(0.014, effH * 0.85);
  const maxSubY = waterNow - bedNow > 0.14 ? Math.max(minSubY + 0.006, waterNow - 0.075) : minSubY + 0.05;
  const targetY = clamp(supBed + 0.065 + Math.sin(time * 1.8 + idNum) * 0.025, minSubY, maxSubY);
  a.y = clamp(lerp(a.y ?? targetY, targetY, 1 - Math.exp(-5.0 * Math.max(dt, 0.001))), minSubY, maxSubY);
  return;
 }

 // ---------------- SALTMARSH PERIWINKLE (Littoraria irrorata — Tidal & predator climber) ----------------
 if (a.speciesId === 'marsh-periwinkle') {
  const localFid = nearList ? nearList('fiddlers', a) : fiddlers;
  const crabThreatList = localSwimmingCrabs && localFid ? localSwimmingCrabs.concat(localFid) : (localSwimmingCrabs || localFid);
  const sense = stimuli ? stimuli.senseThreat(a, crabThreatList, seaLevel) : {threat: 0};
  const waterY = waterHeightAtFn(sea, land, a.x, a.z);
  const bed = land.height(a.x, a.z);
  const risingWater = waterY - bed > -0.025;
  if (sense.threat > 0.25) a.fear = Math.min(1, Math.max(a.fear, sense.threat * 1.1));

  if ((risingWater || a.fear > 0.30 || sense.nearDist < 1.2) && !isPlaced) {
   const e = 0.25;
   const gx = (land.height(a.x + e, a.z) - land.height(a.x - e, a.z)) / (2 * e);
   const gz = (land.height(a.x, a.z + e) - land.height(a.x, a.z - e)) / (2 * e);
   const gm = Math.hypot(gx, gz);
   const upYaw = gm > 0.01 ? Math.atan2(gz, gx) : Math.atan2(INLAND_DIR_Z, INLAND_DIR_X);
   smoothSteer(a, upYaw, dt, {maxYawRate: 2.0, yawAccel: 4.0, targetSpeed: 0.024, speedRate: 4.0});
   a.vx = Math.cos(a.yaw) * a.speed; a.vz = Math.sin(a.yaw) * a.speed;
   a.x += a.vx * dt; a.z += a.vz * dt;
   a.state = 'climbing-shelter';
   a.stateLabel = 'climbing upslope above rising tide & crabs';
  } else if (localW.spd > 10.0) {
   a.vx = 0; a.vz = 0; a.speed = 0;
   a.state = 'estivating';
   a.stateLabel = 'sealed in shell during gale winds';
  } else {
   const ang = time * 0.14 + (a.phase || 0);
   smoothSteer(a, a.yaw + Math.sin(ang) * 0.35, dt, {maxYawRate: 1.2, yawAccel: 3.0, targetSpeed: 0.012, speedRate: 4.0});
   a.vx = Math.cos(a.yaw) * a.speed; a.vz = Math.sin(a.yaw) * a.speed;
   a.x += a.vx * dt; a.z += a.vz * dt;
   const algRich = ecology ? clamp(ecology.resources.benthicAlgae ?? 1, 0.2, 1.5) : 1.0;
   a.satiation = Math.min(1, (a.satiation ?? 0.4) + dt * 0.025 * algRich);
   a.state = 'grazing';
   a.stateLabel = 'grazing microfungi along swale rim';
  }
  const scSz = a.sizeScale ?? 1;
  const sup = cachedGroundSupport(a, land, Math.max(0.03, (a.len || 0.019) * scSz * 1.4));
  a.bedY = sup;
  const effH = (a.height || 0.015) * scSz;
  a.y = sup + Math.max(0.007, effH * 0.62);
  a.pitch = 0.05;
  a.yawRate = wrapAngle(a.yaw - prevYaw) / Math.max(1e-3, dt);
 }
}
