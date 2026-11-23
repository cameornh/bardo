// Analytical inverse kinematics, decentralized arthropod gait coordination,
// and Lighthill / C-start aquatic propulsion for St. Andrews / Shell Island fauna.
//
// Grounded in:
// - Barnes (1975): crab sideways alternating tetrapod / metachronal coordination
// - Blickhan & Full (1987): Ocypode quadrata pendulum walk -> bouncing run gait
// - Cruse (1990): decentralized PEP/AEP rules with neighbor stance inhibition
// - Sfakiotakis, Lane & Davies (1999) / Lighthill (1971): carangiform vs subcarangiform waves
// - Domenici & Blake (1997): Mauthner-cell C-start escape kinematics

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => {
 const u = clamp(t, 0, 1);
 return u * u * (3 - 2 * u);
};

/**
 * Sample 5-point terrain envelope around (x, z) so non-burrowing animals
 * clear discrete terrain grid chord sag and surface grain micro-relief.
 */
export function groundSupportHeight(land, x, z, radius = 0.05, margin = 0.012) {
 if (!land) return 0;
 const r = Math.max(0.02, radius);
 const d = r * 0.72;
 return Math.max(
  land.height(x, z),
  land.height(x + r, z),
  land.height(x - r, z),
  land.height(x, z + r),
  land.height(x, z - r),
  land.height(x + d, z + d),
  land.height(x - d, z + d),
  land.height(x + d, z - d),
  land.height(x - d, z - d)
 ) + margin;
}

/**
 * Exact closed-form 3D two-link inverse kinematics using the Law of Cosines.
 * Guarantees |knee - hip| === L1 and |foot - knee| === L2 while bending cleanly
 * toward the anatomical pole vector (px, py, pz).
 */
export function solveTwoLinkIK(hx, hy, hz, tx, ty, tz, L1, L2, px, py, pz, out = {}) {
 let dx = tx - hx;
 let dy = ty - hy;
 let dz = tz - hz;
 let dRaw = Math.hypot(dx, dy, dz);

 if (dRaw < 1e-6) {
  const pLen = Math.hypot(px, py, pz) || 1;
  dx = px / pLen;
  dy = py / pLen;
  dz = pz / pLen;
  dRaw = 1e-6;
 } else {
  const invD = 1 / dRaw;
  dx *= invD;
  dy *= invD;
  dz *= invD;
 }

 const total = Math.max(1e-5, L1 + L2);
 const dMin = Math.max(1e-5, Math.abs(L1 - L2) + 0.02 * total, 0.12 * total);
 const dMax = total * 0.994;
 const d = clamp(dRaw, dMin, dMax);

 const fx = hx + dx * d;
 const fy = hy + dy * d;
 const fz = hz + dz * d;

 // Law of Cosines for hip angle alpha
 const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
 const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
 const along = L1 * cosA;
 const perp = L1 * sinA;

 // Gram-Schmidt projection of pole vector onto plane perpendicular to target dir
 const dotP = px * dx + py * dy + pz * dz;
 let ux = px - dx * dotP;
 let uy = py - dy * dotP;
 let uz = pz - dz * dotP;
 let uLen = Math.hypot(ux, uy, uz);
 if (uLen < 1e-5) {
  // Collinear pole fallback: cross dir with world Y or X
  const refX = Math.abs(dy) > 0.85 ? 1 : 0;
  const refY = Math.abs(dy) > 0.85 ? 0 : 1;
  const refZ = 0;
  ux = dy * refZ - dz * refY;
  uy = dz * refX - dx * refZ;
  uz = dx * refY - dy * refX;
  uLen = Math.hypot(ux, uy, uz) || 1;
 }
 const invU = 1 / uLen;
 ux *= invU;
 uy *= invU;
 uz *= invU;

 out.kx = hx + dx * along + ux * perp;
 out.ky = hy + dy * along + uy * perp;
 out.kz = hz + dz * along + uz * perp;
 out.fx = fx;
 out.fy = fy;
 out.fz = fz;
 out.reachRatio = dRaw / total;
 out.kneeBend = Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
 return out;
}

function buildBodyBasis(agent, out) {
 const yaw = agent.yaw || 0;
 const cosY = Math.cos(yaw);
 const sinY = Math.sin(yaw);
 const fx0 = cosY;
 const fz0 = sinY;
 const lx0 = -sinY;
 const lz0 = cosY;

 const pitch = clamp(agent.pitch || 0, -0.48, 0.48);
 const roll = clamp(agent.roll || 0, -0.48, 0.48);
 const sinP = Math.sin(pitch);
 const sinR = Math.sin(roll);
 const cosPR = Math.sqrt(Math.max(0.25, 1 - Math.min(0.75, sinP * sinP + sinR * sinR)));

 let ux = fx0 * sinP + lx0 * sinR;
 let uy = cosPR;
 let uz = fz0 * sinP + lz0 * sinR;
 const uInv = 1 / (Math.hypot(ux, uy, uz) || 1);
 ux *= uInv;
 uy *= uInv;
 uz *= uInv;

 // Forward orthogonalized against tilted up vector
 const fDotU = fx0 * ux + fz0 * uz;
 let fx = fx0 - ux * fDotU;
 let fy = -uy * fDotU;
 let fz = fz0 - uz * fDotU;
 const fInv = 1 / (Math.hypot(fx, fy, fz) || 1);
 fx *= fInv;
 fy *= fInv;
 fz *= fInv;

 // Left = Up x Forward in right-handed Y-up (wait: +Y x +X = +Z, and at pitch=0,roll=0: ux=0,uy=1,uz=0; fx=1,fy=0,fz=0 => u x f = (0,0,-1); we want lx0 = -sinY = 0, lz0 = 1 -> f x u gives -Z? Wait: (1,0,0)x(0,1,0)=(0,0,1)!)
 // Check: f x u = (fy*uz - fz*uy, fz*ux - fx*uz, fx*uy - fy*ux). At yaw=0 (f=(1,0,0), u=(0,1,0)) -> (0,0,1) = lx0,lz0=(0,1)! Exact!
 let lx = fy * uz - fz * uy;
 let ly = fz * ux - fx * uz;
 let lz = fx * uy - fy * ux;
 const lInv = 1 / (Math.hypot(lx, ly, lz) || 1);
 lx *= lInv;
 ly *= lInv;
 lz *= lInv;

 out.fx = fx; out.fy = fy; out.fz = fz;
 out.lx = lx; out.ly = ly; out.lz = lz;
 out.ux = ux; out.uy = uy; out.uz = uz;
 return out;
}

const _basis = {};
const _ik = {};

/**
 * Create zero-allocation 8-leg + 2-claw kinematic rig for a crab agent or placed crab link.
 */
export function createCrabRig(agent, land = null) {
 const width = agent.width || 0.04;
 const len = agent.len || width * 0.82;
 const height = agent.height || width * 0.45;
 const hw = width * 0.5;
 const hl = len * 0.5;
 const ht = height * 0.5;
 const isSwimming = agent.speciesId === 'blue-crab' || agent.speciesId === 'speckled-crab';
 const isGhost = agent.speciesId === 'ghost-crab';

 const legs = [];
 for (const side of [-1, 1]) {
  for (let index = 0; index < 4; index++) {
   const isPaddle = isSwimming && index === 3;
   const spanScale = index === 1 || index === 2 ? 1.08 : 0.94;
   const reach = (isPaddle ? width * 0.46 : (isGhost ? width * 0.68 : width * 0.58)) * spanScale;
   const L1 = reach * 0.48;
   const L2 = reach * 0.66;
   const hipSide = side * hw * (isPaddle ? 0.78 : 0.88);
   const hipFwd = hl * (0.56 - index * 0.42);
   const hipUp = -ht * 0.14;
   const restSide = side * (hw * 0.88 + reach * (isPaddle ? 0.70 : 0.74));
   const restFwd = hl * (0.80 - index * 0.54);

   const yaw = agent.yaw || 0;
   const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
   const fX = cosY, fZ = sinY, lX = -sinY, lZ = cosY;
   const footX = agent.x + lX * restSide + fX * restFwd;
   const footZ = agent.z + lZ * restSide + fZ * restFwd;
   const footY = land ? land.height(footX, footZ) : (agent.bedY ?? agent.y - ht);

   const leg = {
    side,
    index,
    isPaddle,
    phaseGroup: ((side > 0) !== (index % 2 === 0)) ? 0 : 1,
    hipSide,
    hipFwd,
    hipUp,
    restSide,
    restFwd,
    reach,
    L1,
    L2,
    hipX: agent.x + lX * hipSide + fX * hipFwd,
    hipY: agent.y + hipUp,
    hipZ: agent.z + lZ * hipSide + fZ * hipFwd,
    footX,
    footY,
    footZ,
    startX: footX,
    startY: footY,
    startZ: footZ,
    targetX: footX,
    targetY: footY,
    targetZ: footZ,
    kneeX: footX,
    kneeY: agent.y + ht * 0.6,
    kneeZ: footZ,
    inSwing: false,
    swingT: 0,
    swingDur: 0.14,
    swingLift: ht * 0.9,
    restKneeAngle: 0,
   };
   // Evaluate initial IK so joints are valid before the first step
   const poleX = lX * (side * 0.55);
   const poleY = 1.25;
   const poleZ = lZ * (side * 0.55);
   solveTwoLinkIK(leg.hipX, leg.hipY, leg.hipZ, footX, footY, footZ, L1, L2, poleX, poleY, poleZ, _ik);
   leg.kneeX = _ik.kx;
   leg.kneeY = _ik.ky;
   leg.kneeZ = _ik.kz;
   leg.footX = _ik.fx;
   leg.footY = _ik.fy;
   leg.footZ = _ik.fz;
   leg.restKneeAngle = Math.atan2(leg.kneeY - leg.hipY, Math.hypot(leg.kneeX - leg.hipX, leg.kneeZ - leg.hipZ));
   legs.push(leg);
  }
 }

 const claws = [];
 for (const side of [-1, 1]) {
  claws.push({
   side,
   shX: agent.x, shY: agent.y, shZ: agent.z,
   elX: agent.x, elY: agent.y, elZ: agent.z,
   tipX: agent.x, tipY: agent.y, tipZ: agent.z,
   waveAngle: 0,
  });
 }

 const rig = {
  legs,
  claws,
  gaitClock: (agent.phase || 0) * 0.5,
  comHeave: 0,
  pelagicSwim: 0,
  supportCount: 8,
 };
 agent.crabRig = rig;
 return rig;
}

/**
 * Step crab gait using Blickhan & Full (1987) walk->bounce transition,
 * Barnes (1975) alternating tetrapod phase grouping, Cruse (1990) PEP/AEP rules,
 * and analytical 2-link IK + terrain pitch/roll alignment.
 */
export function stepCrabIK(agent, dt, land, vx, vz, speed, fleeing = false, alertStage = 0, time = 0) {
 const rig = agent.crabRig || createCrabRig(agent, land);
 const width = agent.width || 0.04;
 const len = agent.len || width * 0.82;
 const height = agent.height || width * 0.45;
 const hw = width * 0.5;
 const hl = len * 0.5;
 const ht = height * 0.5;
 const legs = rig.legs;

 const runBlend = clamp((speed - 0.12) / Math.max(0.18, width * 8.5), 0, 1);
 const dutyFactor = lerp(0.72, 0.45, runBlend); // Blickhan & Full (1987)
 const cycleT = clamp((width * 0.42) / Math.max(0.03, speed), 0.08, 0.46);
 const swingDur = clamp(cycleT * (1 - dutyFactor), 0.038, 0.14);
 const velLead = Math.min(swingDur * 0.65, (width * 0.24) / Math.max(0.05, speed));
 const pepScale = lerp(0.32, 0.48, runBlend);
 const strideFreq = 2.6 + (speed / Math.max(0.03, width * 1.4));
 rig.gaitClock += dt * strideFreq;

 const b = buildBodyBasis(agent, _basis);
 const bodyX = agent.x;
 const bodyY = agent.y;
 const bodyZ = agent.z;

 const swimBlend = clamp(agent.pelagicSwim || 0, 0, 1);
 rig.pelagicSwim = swimBlend;

 // First pass: check if body moved far from feet (e.g., teleport/spawn) and re-seat cleanly
 let maxFootErr = 0;
 for (let i = 0; i < legs.length; i++) {
  const leg = legs[i];
  const d = Math.hypot(leg.footX - bodyX, leg.footZ - bodyZ);
  if (d > maxFootErr) maxFootErr = d;
 }
 if (maxFootErr > width * 2.8) {
  for (let i = 0; i < legs.length; i++) {
   const leg = legs[i];
   const rx = bodyX + b.lx * leg.restSide + b.fx * leg.restFwd;
   const rz = bodyZ + b.lz * leg.restSide + b.fz * leg.restFwd;
   const ry = land ? land.height(rx, rz) : (agent.bedY ?? bodyY - ht);
   leg.footX = leg.startX = leg.targetX = rx;
   leg.footY = leg.startY = leg.targetY = ry;
   leg.footZ = leg.startZ = leg.targetZ = rz;
   leg.inSwing = false;
   leg.swingT = 0;
  }
 }

 // Advance active swings and evaluate PEP drift for stance legs
 const drifts = new Float32Array(legs.length);
 const targetsX = new Float32Array(legs.length);
 const targetsY = new Float32Array(legs.length);
 const targetsZ = new Float32Array(legs.length);

 for (let i = 0; i < legs.length; i++) {
  const leg = legs[i];
  leg.hipX = bodyX + b.lx * leg.hipSide + b.fx * leg.hipFwd + b.ux * leg.hipUp;
  leg.hipY = bodyY + b.ly * leg.hipSide + b.fy * leg.hipFwd + b.uy * leg.hipUp;
  leg.hipZ = bodyZ + b.lz * leg.hipSide + b.fz * leg.hipFwd + b.uz * leg.hipUp;

  const ax = bodyX + b.lx * leg.restSide + b.fx * leg.restFwd + vx * velLead;
  const az = bodyZ + b.lz * leg.restSide + b.fz * leg.restFwd + vz * velLead;
  const ay = swimBlend > 0.25
   ? bodyY - ht * 0.35
   : (land ? land.height(ax, az) + Math.max(0.002, hw * 0.16) : (agent.bedY ?? bodyY - ht));

  targetsX[i] = ax;
  targetsY[i] = ay;
  targetsZ[i] = az;

  if (leg.inSwing) {
   leg.targetX = ax;
   leg.targetY = ay;
   leg.targetZ = az;
   leg.swingT += dt / Math.max(0.03, leg.swingDur);
   if (leg.swingT >= 1) {
    leg.inSwing = false;
    leg.swingT = 0;
    leg.footX = ax;
    leg.footY = ay;
    leg.footZ = az;
   } else {
    const u = smoothstep(leg.swingT);
    leg.footX = lerp(leg.startX, ax, u);
    leg.footZ = lerp(leg.startZ, az, u);
    leg.footY = lerp(leg.startY, ay, u) + Math.sin(Math.PI * leg.swingT) * leg.swingLift;
   }
  } else if (swimBlend > 0.25 && leg.isPaddle) {
   // Pelagic swimming crab rear paddle sculling (figure-8 thrust stroke)
   const scull = time * 16.5 + agent.phase + leg.side * 0.7;
   leg.footX = ax + b.fx * (-hl * 0.65 + Math.cos(scull) * hl * 0.68) + b.lx * (Math.sin(scull * 2) * hw * 0.22);
   leg.footZ = az + b.fz * (-hl * 0.65 + Math.cos(scull) * hl * 0.68) + b.lz * (Math.sin(scull * 2) * hw * 0.22);
   leg.footY = bodyY + ht * 0.35 + Math.sin(scull) * ht * 0.95;
  } else if (swimBlend > 0.25) {
   // Tucked hydrodynamic walking legs during swimming escape
   const tuck = time * 8.5 + leg.index * 0.9;
   leg.footX = ax - b.fx * hl * 0.25;
   leg.footZ = az - b.fz * hl * 0.25;
   leg.footY = bodyY + Math.sin(tuck) * ht * 0.28;
  } else {
   drifts[i] = Math.hypot(leg.footX - ax, leg.footZ - az);
  }
 }

 // Cruse (1990) decentralized PEP triggering with Rule 1 neighbor inhibition
 // & Blickhan-Full duty factor ceiling
 if (swimBlend <= 0.25 && alertStage !== 3) {
  let maxAirborne = Math.max(1, Math.min(4, Math.round(legs.length * (1 - dutyFactor))));
  if (speed < 0.04) maxAirborne = 1;
  let swingingCount = 0;
  for (let i = 0; i < legs.length; i++) if (legs[i].inSwing) swingingCount++;

  const prefGroup = Math.floor(rig.gaitClock) % 2;

  // First catch emergency overstretch up to the alternating tetrapod swing budget;
  // beyond that, slide lagging stance feet softly forward without lifting all legs off sand
  const hardSwingCap = legs.length - (runBlend < 0.65 ? 4 : 2);
  for (let i = 0; i < legs.length; i++) {
   const leg = legs[i];
   if (!leg.inSwing && drifts[i] > (leg.L1 + leg.L2) * 0.90) {
    if (swingingCount < hardSwingCap) {
     leg.inSwing = true;
     leg.swingT = 0;
     leg.swingDur = swingDur;
     leg.swingLift = ht * (0.7 + 0.8 * runBlend);
     leg.startX = leg.footX;
     leg.startY = leg.footY;
     leg.startZ = leg.footZ;
     leg.targetX = targetsX[i];
     leg.targetY = targetsY[i];
     leg.targetZ = targetsZ[i];
     swingingCount++;
    } else {
     leg.footX = lerp(leg.footX, targetsX[i], 0.45);
     leg.footZ = lerp(leg.footZ, targetsZ[i], 0.45);
     leg.footY = land ? land.height(leg.footX, leg.footZ) : targetsY[i];
    }
   }
  }

  // Initiate orderly Cruse steps from highest excess PEP ratio while protecting neighbor support
  while (swingingCount < maxAirborne) {
   let bestIdx = -1;
   let bestScore = 0;
   for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (leg.inSwing) continue;
    const pepDist = leg.reach * pepScale;
    const excess = drifts[i] - pepDist;
    if (excess <= 0) continue;
    // Cruse Rule 1: prevent adjacent ipsilateral legs from swinging simultaneously;
    // at slow walk also inhibit direct contralateral partner
    const sideOffset = leg.side < 0 ? 0 : 4;
    const prevSwing = leg.index > 0 && legs[sideOffset + leg.index - 1].inSwing;
    const nextSwing = leg.index < 3 && legs[sideOffset + leg.index + 1].inSwing;
    if (prevSwing || nextSwing) continue;
    const contraIdx = (leg.side < 0 ? 4 : 0) + leg.index;
    if (runBlend < 0.45 && legs[contraIdx].inSwing) continue;
    const groupBonus = leg.phaseGroup === prefGroup ? 1.25 : 0.92;
    const score = (excess / Math.max(1e-4, pepDist)) * groupBonus;
    if (score > bestScore) {
     bestScore = score;
     bestIdx = i;
    }
   }
   if (bestIdx < 0) break;
   const leg = legs[bestIdx];
   leg.inSwing = true;
   leg.swingT = 0;
   leg.swingDur = swingDur;
   leg.swingLift = ht * (0.68 + 0.85 * runBlend);
   leg.startX = leg.footX;
   leg.startY = leg.footY;
   leg.startZ = leg.footZ;
   leg.targetX = targetsX[bestIdx];
   leg.targetY = targetsY[bestIdx];
   leg.targetZ = targetsZ[bestIdx];
   swingingCount++;
  }
 }

 // Evaluate 2-link analytical IK for all 8 limbs and accumulate stance ground heights for pitch/roll
 let supportCount = 0;
 let leftY = 0, leftN = 0, rightY = 0, rightN = 0;
 let fwdY = 0, fwdN = 0, backY = 0, backN = 0;
 const footClear = Math.max(0.002, hw * 0.16);
 const groundedClamp = !!(land && swimBlend <= 0.25 && alertStage !== 3 && (agent.burrowDepth || 0) <= 0.001);

 for (let i = 0; i < legs.length; i++) {
  const leg = legs[i];
  if (!leg.inSwing) supportCount++;
  if (groundedClamp) {
   leg.footY = Math.max(leg.footY, land.height(leg.footX, leg.footZ) + footClear);
  }
  const poleX = b.ux * 1.45 + b.lx * (leg.side * 0.45);
  const poleY = b.uy * 1.45 + b.ly * (leg.side * 0.45);
  const poleZ = b.uz * 1.45 + b.lz * (leg.side * 0.45);
  solveTwoLinkIK(leg.hipX, leg.hipY, leg.hipZ, leg.footX, leg.footY, leg.footZ, leg.L1, leg.L2, poleX, poleY, poleZ, _ik);
  leg.kneeX = _ik.kx;
  leg.kneeY = _ik.ky;
  leg.kneeZ = _ik.kz;
  leg.footX = _ik.fx;
  leg.footY = _ik.fy;
  leg.footZ = _ik.fz;

  if (!leg.inSwing && swimBlend <= 0.25) {
   if (leg.side < 0) { leftY += leg.footY; leftN++; }
   else { rightY += leg.footY; rightN++; }
   if (leg.index <= 1) { fwdY += leg.footY; fwdN++; }
   else { backY += leg.footY; backN++; }
  }
 }
 rig.supportCount = supportCount;

 // Terrain pitch & roll smoothing from planted feet (or hydrodynamic pitch during swim)
 if (swimBlend <= 0.25 && leftN > 0 && rightN > 0 && fwdN > 0 && backN > 0) {
  const targetRoll = clamp(Math.atan2((rightY / rightN) - (leftY / leftN), Math.max(0.015, width)), -0.40, 0.40);
  const targetPitch = clamp(Math.atan2((fwdY / fwdN) - (backY / backN), Math.max(0.015, len)), -0.40, 0.40);
  const blend = Math.min(1, dt * 8.5);
  agent.roll = lerp(agent.roll || 0, targetRoll, blend);
  agent.pitch = lerp(agent.pitch || 0, targetPitch, blend);
 } else {
  const blend = Math.min(1, dt * 6.0);
  agent.roll = lerp(agent.roll || 0, 0, blend);
  agent.pitch = lerp(agent.pitch || 0, swimBlend > 0.25 ? 0.14 : 0, blend);
 }

 // COM bounce / pendulum heave: small pendulum dip while walking, spring bounce when sprinting sideways
 const activeSpeed = clamp(speed / 0.15, 0, 1);
 const walkHeave = Math.sin(rig.gaitClock * Math.PI * 2) * ht * 0.08 * activeSpeed * (1 - runBlend);
 const bounceHeave = Math.abs(Math.sin(rig.gaitClock * Math.PI)) * ht * 0.22 * runBlend;
 rig.comHeave = swimBlend > 0.25 ? 0 : (walkHeave + bounceHeave);

 // Articulated 2-segment chelipeds (claws)
 const isFiddler = agent.speciesId === 'fiddler-crab';
 const isMaleFiddler = isFiddler && agent.sex === 'M';
 const state = agent.state || 'active';
 for (let c = 0; c < 2; c++) {
  const claw = rig.claws[c];
  const s = claw.side;
  const isMajorFiddler = isMaleFiddler && ((agent.clawRight ? 1 : -1) === s);
  const meralSpread = state === 'threat-display' ? 1 : 0;
  const strike = state === 'hunting' || state === 'lunging' ? 0.5 + 0.5 * Math.sin(time * 8 + agent.phase) : 0;
  let lift = meralSpread * 0.85 + strike * 0.35;
  let spread = 1 + meralSpread * 0.52;
  let sweepFwd = 0;
  let clawOpen = 0.14;
  if (isMajorFiddler) {
   const wArg = time * 4.8 + agent.id;
   const wavePhase = 0.5 + 0.5 * Math.sin(wArg);
   lift = state === 'waving' ? 0.45 + 0.88 * wavePhase : 0.18;
   spread = state === 'waving' ? 1.24 + 0.18 * Math.cos(wArg) : 1.05;
   sweepFwd = state === 'waving' ? 0.24 * Math.cos(wArg) : 0;
   clawOpen = state === 'waving' ? 0.25 + 0.65 * wavePhase : 0.16;
  } else if (state === 'threat-display') {
   clawOpen = 0.72;
  } else if (state === 'hunting' || state === 'lunging') {
   clawOpen = 0.55;
  } else if (state === 'feeding' || state === 'deposit-feeding') {
   const scoop = 0.5 + 0.5 * Math.sin(time * 6.2 + c * 2.1 + agent.phase);
   lift = -0.35 + scoop * 0.42;
   clawOpen = 0.12 + scoop * 0.28;
  }
  claw.waveAngle = lift;
  claw.open = clawOpen;
  const shS = s * hw * 0.72, shF = hl * 0.82, shU = -ht * 0.05;
  const elS = s * hw * 1.18 * spread, elF = hl * (1.12 + sweepFwd), elU = ht * (0.1 + lift * 0.65);
  const tpS = s * hw * (isMajorFiddler ? 0.68 * (0.9 + spread * 0.12) : 0.72 * spread);
  const tpF = hl * (isMajorFiddler ? 1.48 + sweepFwd : 1.38 + strike * 0.38);
  const tpU = ht * (0.05 + lift * 1.15);

  claw.shX = bodyX + b.lx * shS + b.fx * shF + b.ux * shU;
  claw.shY = bodyY + b.ly * shS + b.fy * shF + b.uy * shU;
  claw.shZ = bodyZ + b.lz * shS + b.fz * shF + b.uz * shU;
  claw.elX = bodyX + b.lx * elS + b.fx * elF + b.ux * elU;
  claw.elY = bodyY + b.ly * elS + b.fy * elF + b.uy * elU;
  claw.elZ = bodyZ + b.lz * elS + b.fz * elF + b.uz * elU;
  claw.tipX = bodyX + b.lx * tpS + b.fx * tpF + b.ux * tpU;
  claw.tipY = bodyY + b.ly * tpS + b.fy * tpF + b.uy * tpU;
  claw.tipZ = bodyZ + b.lz * tpS + b.fz * tpF + b.uz * tpU;
  if (groundedClamp) {
   const cClr = Math.max(0.002, hw * 0.22);
   claw.elY = Math.max(claw.elY, land.height(claw.elX, claw.elZ) + cClr);
   claw.tipY = Math.max(claw.tipY, land.height(claw.tipX, claw.tipZ) + cClr);
  }
 }
 return rig;
}

/**
 * Create a 2-link bipedal avian rig (intertarsal "backward" knee) + wing/neck state
 * for shorebirds & gulls.
 */
export function createBipedRig(agent, land = null) {
 const width = agent.width || 0.045;
 const height = agent.height || 0.055;
 const legH = agent.speciesId === 'laughing-gull' ? 0.088 : (agent.speciesId === 'royal-tern' ? 0.068 : 0.046);
 const L1 = legH * 0.68;
 const L2 = legH * 0.76;
 const yaw = agent.yaw || 0;
 const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
 const fX = cosY, fZ = sinY, lX = -sinY, lZ = cosY;

 const legs = [];
 for (const side of [-1, 1]) {
  const hipSide = side * width * 0.28;
  const hipFwd = -height * 0.05;
  const footX = agent.x + lX * hipSide;
  const footZ = agent.z + lZ * hipSide;
  const footY = (land ? land.height(footX, footZ) : (agent.bedY ?? agent.y - legH)) + 0.004;
  legs.push({
   side,
   hipSide,
   hipFwd,
   legH,
   L1,
   L2,
   hipX: agent.x + lX * hipSide + fX * hipFwd,
   hipY: agent.y - height * 0.35,
   hipZ: agent.z + lZ * hipSide + fZ * hipFwd,
   kneeX: footX, kneeY: footY + L2 * 0.85, kneeZ: footZ,
   footX, footY, footZ,
   startX: footX, startY: footY, startZ: footZ,
   inSwing: false,
   swingT: 0,
   swingDur: 0.14,
   swingLift: legH * 0.36,
  });
 }
 const rig = {legs, legH, wingFlap: 0, wingOuterFlap: 0, neckPitch: 0, supportCount: 2, gaitClock: agent.phase || 0};
 agent.bipedRig = rig;
 return rig;
}

/**
 * Step avian 2-link leg IK with backward-bending intertarsal pole and strict non-clipping terrain clamp.
 */
export function stepBipedIK(agent, dt, land, vx, vz, speed, airborne, probing, time = 0) {
 const rig = agent.bipedRig || createBipedRig(agent, land);
 const b = buildBodyBasis(agent, _basis);
 const legs = rig.legs;
 const width = agent.width || 0.045;
 const height = agent.height || 0.055;
 const legH = rig.legH;
 const footClr = 0.004;

 rig.gaitClock += dt * (4.5 + speed * 9.5);

 if (airborne) {
  // Tuck feet cleanly behind tail during flight and compute continuous phase-lagged wingbeat
  rig.supportCount = 0;
  const flapHz = agent.speciesId === 'sanderling' ? 11.5 : 4.2;
  const soaring = agent.state === 'soaring';
  const flapPhase = time * flapHz * Math.PI + (agent.phase || 0);
  rig.wingFlap = soaring ? Math.sin(time * 1.4 + (agent.phase || 0)) * 0.10 : Math.sin(flapPhase) * 0.56;
  rig.wingOuterFlap = soaring ? Math.sin(time * 1.4 + (agent.phase || 0) - 0.5) * 0.14 : Math.sin(flapPhase - 0.70) * 0.64;
  rig.neckPitch = 0;
  for (let i = 0; i < legs.length; i++) {
   const leg = legs[i];
   leg.inSwing = false;
   leg.hipX = agent.x + b.lx * leg.hipSide;
   leg.hipY = agent.y - height * 0.35;
   leg.hipZ = agent.z + b.lz * leg.hipSide;
   leg.footX = leg.hipX - b.fx * legH * 0.95;
   leg.footY = leg.hipY - height * 0.18;
   leg.footZ = leg.hipZ - b.fz * legH * 0.95;
   solveTwoLinkIK(leg.hipX, leg.hipY, leg.hipZ, leg.footX, leg.footY, leg.footZ, leg.L1, leg.L2, -b.fx, b.uy * 0.4, -b.fz, _ik);
   leg.kneeX = _ik.kx; leg.kneeY = _ik.ky; leg.kneeZ = _ik.kz;
   leg.footX = _ik.fx; leg.footY = _ik.fy; leg.footZ = _ik.fz;
  }
  return rig;
 }

 rig.wingFlap = 0;
 rig.wingOuterFlap = 0;
 if (agent.tucked) {
  // Sitting/incubating bird on sand-shell scrape: fold legs cleanly underneath torso above terrain
  rig.supportCount = 2;
  rig.neckPitch = agent.preening
   ? 0.42 + 0.16 * Math.sin(time * 9.0 + (agent.phase || 0))
   : 0.06 * Math.sin(time * 2.2 + (agent.phase || 0));
  for (let i = 0; i < legs.length; i++) {
   const leg = legs[i];
   leg.inSwing = false;
   leg.swingT = 0;
   leg.hipX = agent.x + b.lx * leg.hipSide + b.fx * leg.hipFwd;
   leg.hipY = agent.y - height * 0.28;
   leg.hipZ = agent.z + b.lz * leg.hipSide + b.fz * leg.hipFwd;
   const fx = leg.hipX + b.fx * legH * 0.18;
   const fz = leg.hipZ + b.fz * legH * 0.18;
   const groundY = land ? land.height(fx, fz) : (agent.bedY ?? agent.y - height * 0.5);
   const fy = Math.max(groundY + footClr, agent.y - height * 0.36);
   solveTwoLinkIK(leg.hipX, leg.hipY, leg.hipZ, fx, fy, fz, leg.L1, leg.L2, -b.fx * 1.1 + b.ux * 0.4, -b.fy * 1.1 + b.uy * 0.4, -b.fz * 1.1 + b.uz * 0.4, _ik);
   leg.kneeX = _ik.kx; leg.kneeY = _ik.ky; leg.kneeZ = _ik.kz;
   leg.footX = _ik.fx; leg.footY = _ik.fy; leg.footZ = _ik.fz;
  }
  return rig;
 }

 rig.neckPitch = probing
  ? Math.max(0, Math.sin(time * 22 + (agent.phase || 0))) * 0.72
  : (agent.preening ? 0.42 + 0.16 * Math.sin(time * 9.0 + (agent.phase || 0)) : 0.08 * Math.sin(time * 2.5 + (agent.phase || 0)));

 // Ensure feet aren't stranded if bird just landed from flight
 for (let i = 0; i < legs.length; i++) {
  const leg = legs[i];
  if (Math.hypot(leg.footX - agent.x, leg.footZ - agent.z) > legH * 2.6) {
   leg.footX = agent.x + b.lx * leg.hipSide;
   leg.footZ = agent.z + b.lz * leg.hipSide;
   leg.footY = (land ? land.height(leg.footX, leg.footZ) : (agent.bedY ?? agent.y - legH)) + footClr;
   leg.inSwing = false;
   leg.swingT = 0;
  }
 }

 const restingQuiet = speed < 0.015 && !probing;
 const swingDur = clamp((legH * 1.1) / Math.max(0.08, speed), 0.075, 0.18);
 const velLead = restingQuiet ? 0 : Math.min(swingDur * 0.65, (legH * 0.55) / Math.max(0.08, speed));
 const pepDist = restingQuiet ? legH * 1.15 : legH * 0.36;

 const ax = new Float32Array(2), ay = new Float32Array(2), az = new Float32Array(2), drifts = new Float32Array(2);
 let swingCount = 0;
 for (let i = 0; i < 2; i++) {
  const leg = legs[i];
  leg.hipX = agent.x + b.lx * leg.hipSide + b.fx * leg.hipFwd;
  leg.hipY = agent.y - height * 0.35;
  leg.hipZ = agent.z + b.lz * leg.hipSide + b.fz * leg.hipFwd;
  ax[i] = agent.x + b.lx * leg.hipSide + vx * velLead;
  az[i] = agent.z + b.lz * leg.hipSide + vz * velLead;
  ay[i] = (land ? land.height(ax[i], az[i]) : (agent.bedY ?? agent.y - legH)) + footClr;
  if (leg.inSwing) {
   swingCount++;
   leg.swingT += dt / Math.max(0.04, leg.swingDur);
   if (leg.swingT >= 1) {
    leg.inSwing = false; leg.swingT = 0;
    leg.footX = ax[i]; leg.footY = ay[i]; leg.footZ = az[i];
    swingCount--;
   } else {
    const u = smoothstep(leg.swingT);
    leg.footX = lerp(leg.startX, ax[i], u);
    leg.footZ = lerp(leg.startZ, az[i], u);
    const swingGround = land ? land.height(leg.footX, leg.footZ) + footClr : leg.startY;
    leg.footY = Math.max(swingGround, lerp(leg.startY, ay[i], u) + Math.sin(Math.PI * leg.swingT) * leg.swingLift);
   }
  } else {
   drifts[i] = Math.hypot(leg.footX - ax[i], leg.footZ - az[i]);
  }
 }

 // Strictly alternate 1 foot at a time so at least 1 foot stays planted on sand (supportCount >= 1)
 if (swingCount === 0) {
  let pick = -1, bestDrift = pepDist;
  for (let i = 0; i < 2; i++) {
   if (drifts[i] > bestDrift) { bestDrift = drifts[i]; pick = i; }
  }
  if (pick >= 0) {
   const leg = legs[pick];
   leg.inSwing = true; leg.swingT = 0; leg.swingDur = swingDur;
   leg.swingLift = legH * 0.36;
   leg.startX = leg.footX; leg.startY = leg.footY; leg.startZ = leg.footZ;
  }
 }

 let sup = 0;
 for (let i = 0; i < 2; i++) {
  const leg = legs[i];
  if (!leg.inSwing) sup++;
  if (land) leg.footY = Math.max(leg.footY, land.height(leg.footX, leg.footZ) + footClr);
  // Avian intertarsal "backward knee": pole points strongly backward (-forward) + slightly upward
  const poleX = -b.fx * 1.15 + b.ux * 0.45;
  const poleY = -b.fy * 1.15 + b.uy * 0.45;
  const poleZ = -b.fz * 1.15 + b.uz * 0.45;
  solveTwoLinkIK(leg.hipX, leg.hipY, leg.hipZ, leg.footX, leg.footY, leg.footZ, leg.L1, leg.L2, poleX, poleY, poleZ, _ik);
  leg.kneeX = _ik.kx; leg.kneeY = _ik.ky; leg.kneeZ = _ik.kz;
  leg.footX = _ik.fx; leg.footY = _ik.fy; leg.footZ = _ik.fz;
 }
 rig.supportCount = sup;
 return rig;
}

/**
 * Create & update Rosenberger (2001) rajiform pectoral undulation rig for Atlantic stingrays.
 */
export function createRayRig() {
 return {
  phase: 0,
  left: [{x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0}],
  right: [{x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0}],
  tail: [{x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0}],
 };
}

export function stepRayUndulation(agent, dt, speed, land = null) {
 const rig = agent.rayRig || (agent.rayRig = createRayRig());
 if (rig.left.length < 5) rig.left.push({x: 0, y: 0, z: 0});
 if (rig.right.length < 5) rig.right.push({x: 0, y: 0, z: 0});
 const isSettling = agent.state === 'settling';
 const isBuried = agent.state === 'buried-resting' || agent.state === 'resting';
 const active = !isBuried;
 const freq = isSettling ? 13.5 : isBuried ? 0.65 : (3.6 + speed * 7.5);
 rig.phase += dt * freq;

 const hw = (agent.width || 0.36) * 0.5;
 const hl = (agent.len || 0.36) * 0.5;
 const cosY = Math.cos(agent.yaw || 0), sinY = Math.sin(agent.yaw || 0);
 const fx = cosY, fz = sinY, lx = -sinY, lz = cosY;
 const amp = isSettling
  ? hw * 0.16
  : isBuried
   ? hw * 0.015
   : hw * clamp(0.14 + speed * 0.16, 0.14, 0.28);
 const floorClear = (agent.bedY ?? (land ? land.height(agent.x, agent.z) : agent.y)) + (isBuried ? 0.010 : 0.014);

 const stations = [0.16, 0.36, 0.56, 0.76, 0.94];
 const profiles = [0.54, 0.86, 0.98, 0.76, 0.38];
 for (let i = 0; i < 5; i++) {
  const s = stations[i];
  const fwd = (0.55 - s) * hl * 1.45;
  const lat = hw * profiles[i];
  const wave = Math.sin(5.4 * s - rig.phase) * amp * (0.45 + 0.55 * s);
  for (const side of [-1, 1]) {
   const node = side < 0 ? rig.left[i] : rig.right[i];
   node.x = agent.x + fx * fwd + lx * side * lat;
   node.z = agent.z + fz * fwd + lz * side * lat;
   node.y = Math.max(floorClear, agent.y + wave);
  }
 }
 for (let tIdx = 0; tIdx < 3; tIdx++) {
  const u = (tIdx + 1) / 3;
  const back = hl * (0.85 + u * 1.35);
  const whip = Math.sin(rig.phase * 0.7 - u * 2.2) * hw * 0.10 * u * (active ? 1 : 0.2);
  const tn = rig.tail[tIdx];
  tn.x = agent.x - fx * back + lx * whip;
  tn.z = agent.z - fz * back + lz * whip;
  tn.y = Math.max(floorClear, agent.y + Math.sin(rig.phase - u * 1.5) * amp * 0.15);
 }
 return rig;
}

/**
 * Cheng & DeMont (1996) Argopecten irradians valve clapping kinematics.
 */
export function stepScallopValves(agent, dt, swimming, time = 0) {
 if (swimming) {
  agent.valveGape = 0.04 + 0.46 * Math.abs(Math.sin(time * 22 + (agent.phase || 0)));
 } else {
  const target = 0.18 + 0.04 * Math.sin(time * 1.6 + (agent.phase || 0));
  agent.valveGape = lerp(agent.valveGape ?? 0.16, target, Math.min(1, dt * 6));
 }
 return agent.valveGape;
}

/**
 * Create a 4-node centerline spine for fish swimming & C-start escapes.
 */
export function createFishSpine() {
 return {
  swimPhase: 0,
  cStartAngle: 0,
  nodes: [
   {s: 0.0, x: 0, y: 0, z: 0, fx: 1, fz: 0, lx: 0, lz: 1, offset: 0},
   {s: 0.33, x: 0, y: 0, z: 0, fx: 1, fz: 0, lx: 0, lz: 1, offset: 0},
   {s: 0.67, x: 0, y: 0, z: 0, fx: 1, fz: 0, lx: 0, lz: 1, offset: 0},
   {s: 1.0, x: 0, y: 0, z: 0, fx: 1, fz: 0, lx: 0, lz: 1, offset: 0},
  ],
 };
}

/**
 * Lighthill / Sfakiotakis (1999) posteriorly traveling flexural wave +
 * Domenici & Blake (1997) Mauthner C-start rapid escape bend.
 */
export function solveFishSpine(agent, dt, speed, turnRate, cStartTimer, cStartDir, time) {
 const spine = agent.fishSpine || (agent.fishSpine = createFishSpine());
 const len = (agent.len || 0.07) * (agent.sizeScale ?? 1);
 const isShark = agent.speciesId === 'bonnethead-shark';
 const isCarangiform = agent.speciesId === 'pompano' || agent.speciesId === 'pinfish' || isShark;
 const safeDt = Math.max(0, dt || 0);
 spine.smoothSpeed = spine.smoothSpeed === undefined ? speed : lerp(spine.smoothSpeed, speed, Math.min(1, safeDt * 5.0));
 spine.smoothTurn = spine.smoothTurn === undefined ? clamp(turnRate || 0, -2.5, 2.5) : lerp(spine.smoothTurn, clamp(turnRate || 0, -2.5, 2.5), Math.min(1, safeDt * 6.0));
 const freq = isShark
  ? 2.2 + (spine.smoothSpeed / Math.max(0.35, len)) * 0.95
  : isCarangiform
   ? 4.2 + (spine.smoothSpeed / Math.max(0.05, len)) * 1.45
   : 5.5 + (spine.smoothSpeed / Math.max(0.05, len)) * 1.75;
 spine.swimPhase += safeDt * freq;

 const cosY = Math.cos(agent.yaw || 0);
 const sinY = Math.sin(agent.yaw || 0);
 const fx = cosY, fz = sinY;
 const lx = -sinY, lz = cosY;

 // Strouhal / C-start bend contribution
 let cBend = 0;
 if (cStartTimer > 0) {
  const elapsed = clamp(0.24 - cStartTimer, 0, 0.24);
  if (elapsed < 0.09) {
   // Stage 1: strong rapid unilateral C-bend
   cBend = Math.sin((elapsed / 0.09) * Math.PI * 0.5) * 0.92 * cStartDir;
  } else {
   // Stage 2: explosive counter-stroke whip
   const u = (elapsed - 0.09) / 0.15;
   cBend = Math.cos(u * Math.PI) * 0.85 * cStartDir;
  }
 }
 spine.cStartAngle = cBend;

 const waveK = isShark ? 4.4 : (isCarangiform ? 5.2 : 6.4);
 const ampScale = isShark
  ? clamp(0.42 + spine.smoothSpeed * 0.60, 0.42, 1.02) * len * 0.18
  : clamp(0.45 + spine.smoothSpeed * 1.15, 0.45, 1.35) * len * (isCarangiform ? 0.26 : 0.28);
 const turnCurve = spine.smoothTurn * 0.10 * len;

 const nodes = spine.nodes;
 for (let i = 0; i < nodes.length; i++) {
  const node = nodes[i];
  const s = node.s; // 0 = snout, 1 = caudal tail tip
  const env = isShark
   ? (0.04 + 0.14 * s + 0.82 * s * s)
   : isCarangiform
    ? (0.08 + 0.14 * s + 0.78 * s * s)
    : (0.16 + 0.28 * s + 0.56 * s * s);
  const travel = Math.sin(waveK * s - spine.swimPhase) * env * ampScale;
  const cCurve = Math.sin(s * Math.PI) * len * 0.36 * cBend;
  const bendTurn = s * s * turnCurve;
  const lat = travel + cCurve - bendTurn;
  const alongOffset = (0.36 - s) * len * 0.96;
  node.offset = lat;
  node.x = agent.x + fx * alongOffset + lx * lat;
  node.y = agent.y;
  node.z = agent.z + fz * alongOffset + lz * lat;
 }

 // Derive local segment tangents along snout -> tail
 for (let i = 0; i < nodes.length; i++) {
  const prev = nodes[Math.max(0, i - 1)];
  const next = nodes[Math.min(nodes.length - 1, i + 1)];
  let sx = prev.x - next.x; // points tail -> head (forward!)
  let sz = prev.z - next.z;
  const sl = Math.hypot(sx, sz) || 1;
  sx /= sl;
  sz /= sl;
  nodes[i].fx = sx;
  nodes[i].fz = sz;
  nodes[i].lx = -sz;
  nodes[i].lz = sx;
 }
 return spine;
}

/**
 * Lateral traveling undulation spine + alternating trotting footfall phase for Aspidoscelis six-lined racerunner.
 */
export function solveLizardSpine(agent, dt, speed, turnRate, land = null) {
 const spine = agent.lizardSpine || (agent.lizardSpine = createFishSpine());
 const sz = agent.sizeScale ?? 1;
 const len = (agent.len || 0.17) * sz;
 const safeDt = Math.max(0, dt || 0);
 spine.smoothSpeed = spine.smoothSpeed === undefined ? speed : lerp(spine.smoothSpeed, speed, Math.min(1, safeDt * 8));
 spine.smoothTurn = spine.smoothTurn === undefined ? clamp(turnRate || 0, -4, 4) : lerp(spine.smoothTurn, clamp(turnRate || 0, -4, 4), Math.min(1, safeDt * 8));
 spine.swimPhase += safeDt * (3.2 + spine.smoothSpeed * 24.0);
 const cosY = Math.cos(agent.yaw || 0), sinY = Math.sin(agent.yaw || 0);
 const fx = cosY, fz = sinY, lx = -sinY, lz = cosY;
 const amp = clamp(0.18 + spine.smoothSpeed * 0.55, 0.12, 0.85) * len * 0.085;
 const nodes = spine.nodes;
 for (let i = 0; i < nodes.length; i++) {
  const node = nodes[i], s = node.s;
  const env = 0.08 + 0.25 * Math.sin(s * Math.PI) + 0.72 * s * s;
  const lat = Math.sin(5.6 * s - spine.swimPhase) * amp * env - s * s * spine.smoothTurn * 0.04 * len;
  const alongOffset = (0.34 - s) * len * 0.92;
  node.offset = lat;
  node.x = agent.x + fx * alongOffset + lx * lat;
  node.z = agent.z + fz * alongOffset + lz * lat;
  const gh = land ? groundSupportHeight(land, node.x, node.z, 0.015) : (agent.bedY ?? agent.y);
  node.y = Math.max(gh + (agent.height || 0.014) * sz * (0.48 - 0.18 * s), agent.y - (s > 0.45 ? 0.004 * s : 0));
 }
 for (let i = 0; i < nodes.length; i++) {
  const prev = nodes[Math.max(0, i - 1)], next = nodes[Math.min(nodes.length - 1, i + 1)];
  let sx = prev.x - next.x, szv = prev.z - next.z;
  const sl = Math.hypot(sx, szv) || 1;
  nodes[i].fx = sx / sl; nodes[i].fz = szv / sl; nodes[i].lx = -nodes[i].fz; nodes[i].lz = nodes[i].fx;
 }
 return spine;
}

/**
 * Convert live IK rig / spine state into joint swing angles (radians)
 * for PaintedView user-dropped animal marks.
 */
export function computePlacedMarkSwings(link, speed = 0, time = 0) {
 const swings = {};
 const ph = (link.phase || 0) + time * (3.2 + speed * 4.5);

 if (link.crabRig) {
  const legs = link.crabRig.legs;
  for (let i = 0; i < legs.length; i++) {
   const leg = legs[i];
   const kAngle = Math.atan2(leg.kneeY - leg.hipY, Math.hypot(leg.kneeX - leg.hipX, leg.kneeZ - leg.hipZ));
   const swingBoost = leg.inSwing ? Math.sin(Math.PI * clamp(leg.swingT, 0, 1)) * 0.42 : -0.06;
   const delta = clamp((kAngle - leg.restKneeAngle) * 1.85 + swingBoost, -0.78, 0.78);
   const sideName = leg.side > 0 ? 'r' : 'l';
   if (leg.isPaddle) {
    swings[`paddle-${sideName}`] = clamp(
     link.crabRig.pelagicSwim > 0.2 ? Math.sin(time * 16 + leg.side) * 0.65 : delta * 0.9,
     -0.85,
     0.85
    );
   } else {
    swings[`leg-${sideName}-${leg.index}`] = delta;
   }
  }
  for (let c = 0; c < link.crabRig.claws.length; c++) {
   const cl = link.crabRig.claws[c];
   const sideName = cl.side > 0 ? 'r' : 'l';
   swings[`dactyl-${sideName}`] = clamp((cl.open || 0.14) * 0.72 + (cl.waveAngle || 0) * 0.38, -0.75, 0.85);
  }
  const eyeAlert = link.alertStage === 1 ? 0.16 : 0;
  swings['eye-l'] = eyeAlert;
  swings['eye-r'] = eyeAlert;
  return swings;
 }

 if (link.fishSpine) {
  const nodes = link.fishSpine.nodes;
  const tailLat = (nodes[3].offset - nodes[1].offset) / Math.max(0.02, link.len || 0.08);
  const tailSwing = clamp(tailLat * 1.45, -0.82, 0.82);
  swings['tail-up'] = tailSwing;
  swings['tail-dn'] = tailSwing;
  swings['tail-mid'] = tailSwing;
  swings['dorsal-fin'] = clamp(tailSwing * 0.35, -0.35, 0.35);
  swings['dorsal-2'] = clamp(tailSwing * 0.55, -0.45, 0.45);
  swings['anal-fin'] = clamp(-tailSwing * 0.42, -0.40, 0.40);
  const pecOsc = Math.sin(link.fishSpine.swimPhase) * clamp(0.18 + speed * 0.35, 0.15, 0.52);
  swings['pec-l'] = pecOsc;
  swings['pec-r'] = -pecOsc;
  return swings;
 }

 if (link.speciesId === 'beach-hopper') {
  const leaping = (link.airY || 0) > 0.01;
  swings['uro-l'] = leaping ? -0.65 : Math.sin(ph * 1.4) * 0.12;
  swings['uro-r'] = leaping ? -0.65 : Math.cos(ph * 1.4) * 0.12;
  swings['ant-l'] = Math.sin(ph * 1.8) * 0.28;
  swings['ant-r'] = -Math.sin(ph * 1.8) * 0.28;
  return swings;
 }

 if (link.speciesId === 'mole-crab') {
  const feeding = link.state === 'filter-feeding' ? 0.35 : 0.10;
  swings['antenna-l'] = Math.sin(ph * 2.2) * feeding;
  swings['antenna-r'] = -Math.sin(ph * 2.2) * feeding;
  return swings;
 }

 if (link.speciesId === 'dragonlet') {
  const perched = link.state === 'perched';
  const fore = perched ? -0.14 : (link.wingFore ?? Math.sin(time * 34 + link.phase) * 0.44);
  const hind = perched ? -0.22 : (link.wingHind ?? -fore * 0.88);
  swings['wing-f-l'] = fore;
  swings['wing-f-r'] = fore;
  swings['wing-h-l'] = hind;
  swings['wing-h-r'] = hind;
  return swings;
 }

 if (link.speciesId === 'sand-gnat' || link.speciesId === 'kelp-fly') {
  const beat = Math.sin(time * 38 + link.phase) * 0.52;
  swings['wing-l'] = beat;
  swings['wing-r'] = beat;
  return swings;
 }

 if (link.bipedRig) {
  const f = link.bipedRig.wingFlap || 0;
  const of = link.bipedRig.wingOuterFlap ?? f;
  swings['wing-l'] = f;
  swings['wing-r'] = f;
  swings['wing-tip-l'] = of;
  swings['wing-tip-r'] = of;
  swings['leg-l'] = link.bipedRig.legs[0].inSwing ? 0.35 : -0.10;
  swings['leg-r'] = link.bipedRig.legs[1].inSwing ? 0.35 : -0.10;
  swings['bill'] = (link.bipedRig.neckPitch || 0) * 0.45;
  swings['tail'] = clamp((link.yawRate || 0) * 0.15, -0.35, 0.35);
  return swings;
 }

 if (link.speciesId === 'royal-tern') {
  const beat = link.state === 'plunge-diving' ? -0.55 : Math.sin(time * 12 + (link.phase || 0)) * 0.45;
  const outer = link.state === 'plunge-diving' ? -0.68 : Math.sin(time * 12 + (link.phase || 0) - 0.65) * 0.54;
  swings['wing-l'] = beat;
  swings['wing-r'] = beat;
  swings['wing-tip-l'] = outer;
  swings['wing-tip-r'] = outer;
  const tailYaw = clamp((link.yawRate || 0) * 0.2, -0.35, 0.35);
  swings['tail'] = tailYaw;
  swings['tail-l'] = tailYaw;
  swings['tail-r'] = tailYaw;
  return swings;
 }

 if (link.rayRig) {
  const osc = Math.sin(link.rayRig.phase) * 0.42;
  swings['wing-l'] = osc;
  swings['wing-r'] = osc;
  swings['tail'] = Math.sin(link.rayRig.phase * 0.7) * 0.24;
  swings['spine'] = Math.sin(link.rayRig.phase * 0.7) * 0.12;
  return swings;
 }

 if (link.lizardSpine) {
  const nodes = link.lizardSpine.nodes;
  const tLat = (nodes[3].offset - nodes[1].offset) / Math.max(0.02, link.len || 0.16);
  const tailSwing = clamp(tLat * 1.4, -0.78, 0.78);
  swings['tail-mid'] = tailSwing * 0.65;
  swings['tail-tip'] = tailSwing;
  const stride = Math.sin(link.lizardSpine.swimPhase) * clamp(0.10 + speed * 1.1, 0.08, 0.58);
  swings['leg-fl'] = stride;
  swings['leg-br'] = stride;
  swings['leg-fr'] = -stride;
  swings['leg-bl'] = -stride;
  return swings;
 }

 if (link.speciesId === 'coquina-clam') {
  const digging = link.state === 'burrowing';
  swings['foot'] = digging ? Math.abs(Math.sin(ph * 2.4)) * 0.65 : -0.35;
  swings['siphon'] = link.state === 'filter-feeding' ? Math.sin(ph * 0.8) * 0.25 : -0.45;
  return swings;
 }

 if (link.speciesId === 'hermit-crab') {
  const hide = link.state === 'shell-retracted';
  swings['claw-l'] = hide ? -0.68 : Math.sin(ph * 1.1) * 0.22;
  swings['claw-r'] = hide ? -0.68 : -Math.sin(ph * 1.1) * 0.22;
  swings['leg-l'] = hide ? -0.65 : Math.sin(ph * 1.5) * 0.34;
  swings['leg-r'] = hide ? -0.65 : -Math.sin(ph * 1.5) * 0.34;
  return swings;
 }

 if (link.speciesId === 'tiger-beetle') {
  const sprint = speed > 0.05 ? Math.sin(ph * 2.2) * 0.45 : 0;
  swings['leg-l-0'] = sprint;
  swings['leg-r-0'] = -sprint;
  swings['leg-l-1'] = -sprint;
  swings['leg-r-1'] = sprint;
  swings['wing-l'] = link.airborne ? Math.sin(time * 38 + (link.phase || 0)) * 0.48 : -0.32;
  swings['wing-r'] = link.airborne ? Math.sin(time * 38 + (link.phase || 0)) * 0.48 : -0.32;
  return swings;
 }

 if (link.speciesId === 'grass-shrimp') {
  const tailFlip = (link.tailFlipTimer || 0) > 0 ? Math.sin((link.tailFlipTimer || 0) * 28) * 0.72 : Math.sin(ph * 1.2) * 0.14;
  swings['abdomen'] = tailFlip;
  swings['tail-fan'] = tailFlip * 1.15;
  swings['ant-l'] = Math.sin(ph * 1.5) * 0.22;
  swings['ant-r'] = -Math.sin(ph * 1.5) * 0.22;
  return swings;
 }

 if (link.speciesId === 'marsh-periwinkle') {
  swings['tentacle-l'] = Math.sin(ph * 0.7) * 0.18;
  swings['tentacle-r'] = -Math.sin(ph * 0.7) * 0.18;
  return swings;
 }

 if (link.speciesId === 'bay-scallop') {
  const g = link.valveGape ?? 0.18;
  swings['valve-top'] = g;
  for (let i = 0; i < 5; i++) swings[`rib-${i}`] = g * 0.65;
  return swings;
 }

 return swings;
}
