// Subtle, physically deposited static coastal detritus & benthic seafloor habitat
// for Shell Island / St. Andrews State Park:
// - 3D sculptural weathered driftwood across 6 archetypes & 4 weathering colorways
// - Heavy-mineral & deflation-lag small dark pebbles, quartz gravel & coquina cobbles
// - Wave-sorted bivalves, spiral whelks, bleached sand dollars & rare dried sea stars
// - Sinuous Sargassum & seagrass wrack windrows + shaded forest pine cones
// - Depth-zoned benthic seafloor: shoal/turtle/manatee seagrasses, karstic limestone
//   hardbottom ledges, loggerhead sponges, sea-whip gorgonians, benthic macroalgae,
//   live keyhole sand dollar beds, and stiff pen shell clusters.
import * as T from 'three';
import {randomSequence} from './family.js';
import {REED_TILE} from './wetland.js';
import {ALONG_DIR_X, ALONG_DIR_Z, INLAND_DIR_X, INLAND_DIR_Z} from './coastal-climate.js';
import {reflectedSurfaceClip} from './wave-surface.js';

const PROP_MAX_DIST = 86;
const MAX_TILE_ELLIPSOIDS = 340;

export const PROP_LABELS = Object.freeze({
 driftwood: 'Weathered driftwood',
 'shell-calc': 'Mollusk shell hash',
 'coquina-rock': 'Coastal limestone cobble',
 'pebble-quartz': 'Quartz pebbles',
 'pebble-dark': 'Dark mineral pebbles',
 'sargassum-wrack': 'Sargassum seaweed wrack',
 'seagrass-wrack': 'Seagrass wrack',
 'seagrass-bed': 'Submerged turtle grass',
 'shoal-grass': 'Shoal grass (Halodule)',
 'manatee-grass': 'Manatee grass (Syringodium)',
 'limestone-ledge': 'Gulf limestone hardbottom',
 'sea-sponge': 'Gulf reef sponge',
 'sea-whip': 'Sea-whip gorgonian',
 'benthic-algae': 'Benthic macroalgae',
 'live-sand-dollar': 'Live sand dollar bed',
 'pen-shell': 'Stiff pen shell (Atrina)',
 'sand-dollar': 'Bleached sand dollar',
 'sea-star': 'Dried sea star',
 'pine-cone': 'Fallen pine cone'
});

function tileHash(tx, tz, salt) {
 let n = (Math.imul(tx, 1597334677) ^ Math.imul(tz, 3812015801) ^ salt) >>> 0;
 n = Math.imul(n ^ (n >>> 16), 2246822519);
 return (n ^ (n >>> 13)) >>> 0;
}

function hash2(ix, iz) {
 let n = (Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263)) >>> 0;
 n = Math.imul(n ^ (n >>> 13), 1274126177);
 return ((n ^ (n >>> 16)) >>> 8) / 16777216;
}

function smooth2(wx, wz) {
 const ix = Math.floor(wx), iz = Math.floor(wz);
 const fx = wx - ix, fz = wz - iz;
 const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
 return (1 - uz) * ((1 - ux) * hash2(ix, iz) + ux * hash2(ix + 1, iz))
  + uz * ((1 - ux) * hash2(ix, iz + 1) + ux * hash2(ix + 1, iz + 1));
}

export function bedPatch(wx, wz) {
 return 0.65 * smooth2(wx / 14 + 2.3, wz / 14 - 4.1) + 0.35 * smooth2(wx / 5.5 - 3.7, wz / 5.5 + 1.9);
}

function surfaceNormalAndSlope(land, x, z, h) {
 const dhx = (land.height(x + 0.35, z) - h) / 0.35;
 const dhz = (land.height(x, z + 0.35) - h) / 0.35;
 const inv = 1 / Math.hypot(-dhx, 1, -dhz);
 return {
  nx: -dhx * inv,
  ny: inv,
  nz: -dhz * inv,
  slope: Math.hypot(dhx, dhz)
 };
}

function makeAxes(nx, ny, nz, dx, dz, len, halfW, halfT) {
 const dot = dx * nx + dz * nz;
 let tx = dx - nx * dot;
 let ty = -ny * dot;
 let tz = dz - nz * dot;
 let tLen = Math.hypot(tx, ty, tz);
 if (tLen < 1e-4) {
  tx = 1 - nx * nx;
  ty = -ny * nx;
  tz = -nz * nx;
  tLen = Math.hypot(tx, ty, tz) || 1;
 }
 tx /= tLen; ty /= tLen; tz /= tLen;
 let sx = ny * tz - nz * ty;
 let sy = nz * tx - nx * tz;
 let sz = nx * ty - ny * tx;
 const sLen = Math.hypot(sx, sy, sz) || 1;
 sx /= sLen; sy /= sLen; sz /= sLen;
 const hl = len * 0.5;
 return [
  tx * hl, ty * hl, tz * hl,
  sx * halfW, sy * halfW, sz * halfW,
  nx * halfT, ny * halfT, nz * halfT
 ];
}

export function wrackCenter(along, sea) {
 return 9.8 + sea * 5.0 + 2.2 * Math.sin(along * 0.14) + 1.8 * Math.sin(along * 0.053 + 1.4);
}

function cuspTrough(along) {
 return 0.5 - 0.5 * Math.sin(along * 0.14);
}

const DARK_PEBBLE_PALETTE = [
 [0.046, 0.048, 0.052], // charcoal slate
 [0.078, 0.056, 0.040], // deep iron-umber chert
 [0.036, 0.036, 0.038], // blackened sub-fossil shell lag
 [0.042, 0.050, 0.044], // dark moss-slate
 [0.062, 0.056, 0.049]  // dark brown-grey phosphorite
];

const QUARTZ_PEBBLE_PALETTE = [
 [0.39, 0.36, 0.31],
 [0.46, 0.42, 0.36],
 [0.32, 0.28, 0.23]
];

const DRIFTWOOD_PALETTES = [
 // Damp storm-cast dark walnut / mahogany
 {rgb: [0.18, 0.125, 0.082], rough: 0.56},
 // Warm sun-baked Gulf cedar / chestnut
 {rgb: [0.31, 0.22, 0.145], rough: 0.84},
 // Aged grey-taupe weathered oak
 {rgb: [0.39, 0.35, 0.30], rough: 0.89},
 // Sun-bleached silver-ash pine/cypress
 {rgb: [0.49, 0.46, 0.41], rough: 0.92}
];

export function coastalPropsForTile(land, tx, tz) {
 if (!land) return {ellipsoids: [], items: []};
 const sea = land.climate?.seaLevelOffset ?? 0;

 // Fast 5-point tile envelope filter (corners + center)
 const x0 = tx * REED_TILE, z0 = tz * REED_TILE;
 const samplePts = [
  [x0, z0],
  [x0 + REED_TILE, z0],
  [x0, z0 + REED_TILE],
  [x0 + REED_TILE, z0 + REED_TILE],
  [x0 + REED_TILE * 0.5, z0 + REED_TILE * 0.5]
 ];
 let minD = Infinity, maxD = -Infinity, minH = Infinity, maxH = -Infinity;
 for (const [sx, sz] of samplePts) {
  const sd = land.shoreDistance(sx, sz);
  const sh = land.height(sx, sz);
  if (sd < minD) minD = sd;
  if (sd > maxD) maxD = sd;
  if (sh < minH) minH = sh;
  if (sh > maxH) maxH = sh;
 }
 if (maxD < -36 || maxH < sea - 3.0) return {ellipsoids: [], items: []};

 const hasNearshore = minD < 2 && minH < sea - 0.14;
 const hasBeach = maxD > 0.5 && minD < 28;
 const hasBlowout = maxD > 20 && minD < 78;
 const hasScrub = maxD > 62 && minD < 226;
 const hasBay = maxD > 218;
 if (!hasNearshore && !hasBeach && !hasBlowout && !hasScrub && !hasBay) {
  return {ellipsoids: [], items: [], groups: []};
 }

 const rng = randomSequence(tileHash(tx, tz, (land.seed ^ 0x517cc1b7) >>> 0));
 const ellipsoids = [];
 const items = [];
 const groups = [];
 let activeGroup = null;
 const originX = land.x ?? 0, originZ = land.z ?? 0;

 const beginGroup = (gx, gz, r = 0.2, mass = 0.8, fixed = false) => {
  const g = {id: groups.length, x: gx, z: gz, baseH: land.height(gx, gz), r, mass, fixed, indices: [], itemIndices: []};
  groups.push(g);
  activeGroup = g;
  return g;
 };
 const pushItem = (it) => {
  const idx = items.length;
  items.push(it);
  if (activeGroup) activeGroup.itemIndices.push(idx);
  return idx;
 };

 const pushEllipsoid = (cx, cy, cz, axes, r, g, b, rough, maxRange) => {
  if (ellipsoids.length >= MAX_TILE_ELLIPSOIDS) return false;
  const [ax, ay, az, bx, by, bz, nx, ny, nz] = axes;
  const boundR = Math.hypot(ax, ay, az) + Math.hypot(bx, by, bz) + Math.hypot(nx, ny, nz);
  const idx = ellipsoids.length;
  ellipsoids.push({
   cx, cy, cz,
   ax, ay, az, bx, by, bz, nx, ny, nz,
   r, g, b, rough, maxRange, boundR
  });
  if (activeGroup) activeGroup.indices.push(idx);
  return true;
 };

 // Full 3D cylindrical spline segment helper with round volume & guaranteed sky-facing normal axis C
 const push3DSegment = (x0s, y0s, z0s, x1s, y1s, z1s, rad, col, rough, maxR, overlap = 1.56) => {
  const dx = x1s - x0s, dy = y1s - y0s, dz = z1s - z0s;
  const span = Math.hypot(dx, dy, dz);
  if (span < 1e-4) return false;
  const tx3 = dx / span, ty3 = dy / span, tz3 = dz / span;
  // Build horizontal side B = normalize(cross(T, UP)) so C = normalize(cross(T, B)) has C.y >= 0
  let bx = -tz3, by = 0, bz = tx3;
  let bLen = Math.hypot(bx, bz);
  if (bLen < 1e-4) {
   bx = 1; bz = 0; bLen = 1;
  }
  bx /= bLen; bz /= bLen;
  let cx3 = ty3 * bz - tz3 * by;
  let cy3 = tz3 * bx - tx3 * bz;
  let cz3 = tx3 * by - ty3 * bx;
  const cLen = Math.hypot(cx3, cy3, cz3) || 1;
  cx3 /= cLen; cy3 /= cLen; cz3 /= cLen;
  if (cy3 < 0) {cx3 = -cx3; cy3 = -cy3; cz3 = -cz3;}
  const hl = span * 0.5 * overlap;
  const axes = [
   tx3 * hl, ty3 * hl, tz3 * hl,
   bx * rad, by * rad, bz * rad,
   cx3 * rad * 0.93, cy3 * rad * 0.93, cz3 * rad * 0.93
  ];
  return pushEllipsoid(
   (x0s + x1s) * 0.5, (y0s + y1s) * 0.5, (z0s + z1s) * 0.5,
   axes, col[0], col[1], col[2], rough, maxR
  );
 };

 // Soft feathered AO sand-shadow beneath heavy trunks, root wads & arched limbs (negative maxRange flags soft pass)
 const pushContactShadow = (sx, sz, yaw, len, wid, maxR = 62) => {
  const sh = land.height(sx, sz);
  if (sh < sea + 0.01) return false;
  const sn = surfaceNormalAndSlope(land, sx, sz, sh);
  const axes = makeAxes(sn.nx, sn.ny, sn.nz, Math.cos(yaw), Math.sin(yaw), len, wid * 0.5, 0.004);
  return pushEllipsoid(sx, sh + 0.004, sz, axes, 0.30, 0.27, 0.21, 0.96, -maxR);
 };

 const pickWoodStyle = (h, d) => {
  const dampZone = h < sea + 0.55 || d < 12;
  const roll = rng();
  const idx = dampZone
   ? (roll < 0.48 ? 0 : roll < 0.80 ? 1 : 2)
   : (roll < 0.14 ? 0 : roll < 0.42 ? 1 : roll < 0.72 ? 2 : 3);
  const base = DRIFTWOOD_PALETTES[idx];
  const tone = 0.88 + 0.24 * rng();
  const col = [base.rgb[0] * tone, base.rgb[1] * tone, base.rgb[2] * tone];
  const crevice = [col[0] * 0.62, col[1] * 0.62, col[2] * 0.62];
  return {col, crevice, rough: base.rough};
 };

 const emitDriftwood = (px, pz, h, d, env, inScrubTwig) => {
  const prevGroup = activeGroup;
  beginGroup(px, pz, inScrubTwig ? 0.25 : 0.95, inScrubTwig ? 0.55 : 4.2, false);
  const done = (ok) => { activeGroup = prevGroup; return ok; };
  const yaw = rng() * Math.PI * 2;
  const alongBias = d < 28 || d > 218;
  const aOff = (rng() - 0.5) * 0.95;
  const dx = alongBias ? (ALONG_DIR_X * Math.cos(aOff) - ALONG_DIR_Z * Math.sin(aOff)) : Math.cos(yaw);
  const dz = alongBias ? (ALONG_DIR_X * Math.sin(aOff) + ALONG_DIR_Z * Math.cos(aOff)) : Math.sin(yaw);
  const {col, crevice, rough} = pickWoodStyle(h, d);

  const inLogWrack = d >= 9.5 + sea * 3 && d <= 27.5 + sea * 3 && h >= sea + 0.24 && h <= 2.25;
  const inBlowout = d > 25 && d < 70 && h >= 0.40 && (env?.sandMobility ?? 0) > 0.25;
  const inBay = d > 218 && h >= sea + 0.06 && h <= 1.35;

  if (inScrubTwig) {
   const stickLen = 0.22 + 0.28 * rng();
   const rad = 0.013 + 0.012 * rng();
   const hx = px + dx * stickLen * 0.5, hz = pz + dz * stickLen * 0.5;
   const xA = px - dx * stickLen * 0.5, zA = pz - dz * stickLen * 0.5;
   const hA = land.height(xA, zA), hB = land.height(hx, hz);
   const ok = push3DSegment(xA, hA + rad * 0.75, zA, hx, hB + rad * 0.75 + 0.04 * rng(), hz, rad, col, rough, 34);
   if (ok) {
    pushItem({x: px, y: h + rad * 0.8, z: pz, r: stickLen * 0.55, materialId: 'driftwood', label: PROP_LABELS.driftwood});
    return done(true);
   }
   return done(false);
  }

  const archRoll = rng();
  // Archetype 1: Massive weathered coastal trunk (2.2–4.2 m, proud 3D radius 0.09–0.16 m, lifted stubs & root buttresses)
  if ((inLogWrack || inBay || inBlowout) && archRoll < 0.20) {
   const logLen = 2.2 + 2.0 * rng();
   const baseRad = 0.09 + 0.07 * rng();
   const segs = 5;
   let px0 = px - dx * logLen * 0.5, pz0 = pz - dz * logLen * 0.5;
   let py0 = land.height(px0, pz0) + baseRad * 0.68;
   let curDx = dx, curDz = dz;
   let placed = false;
   const archPeak = 0.04 + 0.14 * rng();
   for (let s = 0; s < segs; s++) {
    const u = (s + 1) / segs;
    const stepLen = logLen / segs;
    const turn = (rng() - 0.5) * 0.24;
    const ca = Math.cos(turn), sa = Math.sin(turn);
    const nxD = curDx * ca - curDz * sa, nzD = curDx * sa + curDz * ca;
    curDx = nxD; curDz = nzD;
    const px1 = px0 + curDx * stepLen, pz1 = pz0 + curDz * stepLen;
    const rad = baseRad * (1.0 - 0.36 * u);
    const archLift = Math.sin(u * Math.PI) * archPeak;
    const py1 = land.height(px1, pz1) + rad * 0.68 + archLift;
    const segTone = 0.82 + 0.22 * u;
    const segCol = [col[0] * segTone, col[1] * segTone, col[2] * segTone];
    if (push3DSegment(px0, py0, pz0, px1, py1, pz1, rad, segCol, rough, 128, 1.58)) placed = true;
    // Integral dark damp-bark basal crevice strip along sand contact + weathered bark ridge
    if (s % 2 === 0) {
     const ribTone = [col[0] * 0.54, col[1] * 0.54, col[2] * 0.54];
     push3DSegment(px0, py0 - rad * 0.34, pz0, px1, py1 - rad * 0.34, pz1, rad * 0.56, ribTone, 0.94, 72, 1.44);
    }
    if (s === 1 || s === 3) {
     const crkCol = [col[0] * 0.72, col[1] * 0.72, col[2] * 0.72];
     push3DSegment(px0, py0 + rad * 0.52, pz0, px1, py1 + rad * 0.50, pz1, rad * 0.34, crkCol, 0.96, 68, 1.38);
    }
    // Root-buttress flares on basal segment
    if (s === 0) {
     const spurs = 2 + (rng() < 0.5 ? 1 : 0);
     for (let sp = 0; sp < spurs; sp++) {
      const sAng = Math.atan2(dz, dx) + Math.PI + (sp - 1) * 0.72 + (rng() - 0.5) * 0.3;
      const sLen = 0.28 + 0.24 * rng();
      const sLift = 0.04 + 0.22 * rng();
      const sx1 = px0 + Math.cos(sAng) * sLen, sz1 = pz0 + Math.sin(sAng) * sLen;
      push3DSegment(px0, py0, pz0, sx1, land.height(sx1, sz1) + sLift, sz1, baseRad * 0.52, segCol, rough, 115, 1.46);
     }
    }
    // Crooked upward-lifting limb stubs (pitch +0.25..+0.72 rad into 3D space)
    if (s >= 1 && s <= 3 && rng() < 0.75) {
     const limbYaw = Math.atan2(curDz, curDx) + (rng() < 0.5 ? 1 : -1) * (0.45 + 0.45 * rng());
     const limbLen = 0.30 + 0.36 * rng();
     const pitch = 0.25 + 0.47 * rng();
     const lx1 = px1 + Math.cos(limbYaw) * Math.cos(pitch) * limbLen;
     const lz1 = pz1 + Math.sin(limbYaw) * Math.cos(pitch) * limbLen;
     const ly1 = py1 + Math.sin(pitch) * limbLen;
     push3DSegment(px1, py1, pz1, lx1, ly1, lz1, rad * 0.54, segCol, rough, 118, 1.48);
    }
    px0 = px1; py0 = py1; pz0 = pz1;
   }
   if (placed) {
    pushItem({x: px, y: h + baseRad * 0.75, z: pz, r: logLen * 0.55, materialId: 'driftwood', label: PROP_LABELS.driftwood});
    return done(true);
   }
  }

  // Archetype 2: Gnarled upturned root-wad / stump (0.9–1.7 m span, 4–6 twisting 3D roots lifting 20–60 cm)
  if ((inLogWrack || inBay || inBlowout) && archRoll < 0.38) {
   const coreRad = 0.10 + 0.06 * rng();
   const cyCore = h + coreRad * 0.82;
   let placed = push3DSegment(
    px - dx * 0.22, cyCore - 0.04, pz - dz * 0.22,
    px + dx * 0.24, cyCore + 0.14 + 0.08 * rng(), pz + dz * 0.24,
    coreRad, crevice, rough, 112, 1.50
   );
   const roots = 4 + Math.floor(rng() * 3);
   for (let rIdx = 0; rIdx < roots; rIdx++) {
    const rYaw = yaw + (rIdx * Math.PI * 2) / roots + (rng() - 0.5) * 0.38;
    const reach1 = 0.32 + 0.26 * rng();
    const peakY = cyCore + 0.16 + 0.36 * rng();
    const mx = px + Math.cos(rYaw) * reach1 * 0.55;
    const mz = pz + Math.sin(rYaw) * reach1 * 0.55;
    const ex = px + Math.cos(rYaw + (rng() - 0.5) * 0.45) * (reach1 + 0.25 + 0.22 * rng());
    const ez = pz + Math.sin(rYaw + (rng() - 0.5) * 0.45) * (reach1 + 0.25 + 0.22 * rng());
    const rRad = coreRad * (0.42 + 0.18 * rng());
    if (push3DSegment(px, cyCore, pz, mx, peakY, mz, rRad, col, rough, 102, 1.54)) placed = true;
    const endH = land.height(ex, ez) + (rng() < 0.45 ? 0.12 + 0.18 * rng() : rRad * 0.5);
    push3DSegment(mx, peakY, mz, ex, endH, ez, rRad * 0.68, col, rough, 98, 1.54);
   }
   if (placed) {
    pushItem({x: px, y: h + 0.22, z: pz, r: 0.72, materialId: 'driftwood', label: PROP_LABELS.driftwood});
    return done(true);
   }
  }

  // Archetype 3: Crooked forked oak bough / Y-branch (1.1–2.3 m, main bough + 2–3 asymmetric lifted branches)
  if ((inLogWrack || inBay || inBlowout) && archRoll < 0.58) {
   const bLen = 1.1 + 1.2 * rng();
   const bRad = 0.045 + 0.040 * rng();
   let bx0 = px - dx * bLen * 0.45, bz0 = pz - dz * bLen * 0.45;
   let by0 = land.height(bx0, bz0) + bRad * 0.68;
   let cdx = dx, cdz = dz;
   let placed = false;
   for (let s = 0; s < 3; s++) {
    const step = bLen / 3;
    const bend = (rng() - 0.5) * 0.34;
    const ca = Math.cos(bend), sa = Math.sin(bend);
    const ndx = cdx * ca - cdz * sa, ndz = cdx * sa + cdz * ca;
    cdx = ndx; cdz = ndz;
    const bx1 = bx0 + cdx * step, bz1 = bz0 + cdz * step;
    const rad = bRad * (1 - 0.18 * s);
    const by1 = land.height(bx1, bz1) + rad * 0.70 + (s === 1 ? 0.06 + 0.09 * rng() : 0.03 * rng());
    const segTone = 0.86 + 0.16 * (s / 2);
    const segCol = [col[0] * segTone, col[1] * segTone, col[2] * segTone];
    if (push3DSegment(bx0, by0, bz0, bx1, by1, bz1, rad, segCol, rough, 98, 1.56)) placed = true;
    if (s >= 1) {
     const forkYaw = Math.atan2(cdz, cdx) + (s === 1 ? 1 : -1) * (0.45 + 0.40 * rng());
     const forkLen = 0.45 + 0.48 * rng();
     const pitch = 0.12 + 0.36 * rng();
     const fx = bx1 + Math.cos(forkYaw) * Math.cos(pitch) * forkLen;
     const fz = bz1 + Math.sin(forkYaw) * Math.cos(pitch) * forkLen;
     const fy = Math.max(land.height(fx, fz) + rad * 0.5, by1 + Math.sin(pitch) * forkLen);
     push3DSegment(bx1, by1, bz1, fx, fy, fz, rad * 0.62, segCol, rough, 92, 1.52);
    }
    bx0 = bx1; by0 = by1; bz0 = bz1;
   }
   if (placed) {
    pushItem({x: px, y: h + bRad * 0.75, z: pz, r: bLen * 0.52, materialId: 'driftwood', label: PROP_LABELS.driftwood});
    return done(true);
   }
  }

  // Archetype 4: Arched sun-warped bow-limb (0.75–1.55 m, 8–22 cm clear arch above sand at midpoint)
  if ((inLogWrack || inBay || (d >= 8 && d <= 25 && h >= sea + 0.20)) && archRoll < 0.76) {
   const len = 0.75 + 0.80 * rng();
   const rad = 0.032 + 0.028 * rng();
   const bowH = 0.08 + 0.14 * rng();
   const sideYaw = yaw + Math.PI * 0.5;
   const xA = px - dx * len * 0.5, zA = pz - dz * len * 0.5;
   const xM1 = px - dx * len * 0.16 + Math.cos(sideYaw) * 0.08 * (rng() - 0.5);
   const zM1 = pz - dz * len * 0.16 + Math.sin(sideYaw) * 0.08 * (rng() - 0.5);
   const xM2 = px + dx * len * 0.16 + Math.cos(sideYaw) * 0.08 * (rng() - 0.5);
   const zM2 = pz + dz * len * 0.16 + Math.sin(sideYaw) * 0.08 * (rng() - 0.5);
   const xB = px + dx * len * 0.5, zB = pz + dz * len * 0.5;
   const yA = land.height(xA, zA) + rad * 0.62;
   const yM1 = land.height(xM1, zM1) + bowH;
   const yM2 = land.height(xM2, zM2) + bowH * 0.92;
   const yB = land.height(xB, zB) + rad * 0.62;
   const ok = push3DSegment(xA, yA, zA, xM1, yM1, zM1, rad, col, rough, 82, 1.56);
   push3DSegment(xM1, yM1, zM1, xM2, yM2, zM2, rad * 0.95, col, rough, 82, 1.56);
   push3DSegment(xM2, yM2, zM2, xB, yB, zB, rad * 0.82, col, rough, 82, 1.56);
   if (ok) {
    pushItem({x: px, y: h + bowH, z: pz, r: len * 0.52, materialId: 'driftwood', label: PROP_LABELS.driftwood});
    return done(true);
   }
  }

  // Archetype 5: Angular split driftwood knee / fractured stump chunk (0.38–0.85 m, wedged beam + upturned splinter + dark crevice)
  if ((inLogWrack || inBay || (d >= 7 && d <= 26)) && archRoll < 0.89) {
   const sLen = 0.38 + 0.46 * rng();
   const kRad = 0.046 + 0.036 * rng();
   const xA = px - dx * sLen * 0.5, zA = pz - dz * sLen * 0.5;
   const xM = px, zM = pz;
   const xB = px + dx * sLen * 0.5, zB = pz + dz * sLen * 0.5;
   const yA = land.height(xA, zA) + kRad * 0.65;
   const yM = land.height(xM, zM) + kRad * 0.95 + 0.04 * rng();
   const yB = land.height(xB, zB) + kRad * 1.15 + 0.08 * rng();
   const ok = push3DSegment(xA, yA, zA, xM, yM, zM, kRad, col, rough, 74, 1.50);
   push3DSegment(xM, yM, zM, xB, yB, zB, kRad * 0.72, col, rough, 74, 1.50);
   if (ok) {
    const spAng = yaw + (rng() - 0.5) * 0.65;
    const spLen = sLen * 0.62;
    push3DSegment(
     xM, yM - kRad * 0.20, zM,
     xM + Math.cos(spAng) * spLen, land.height(xM + Math.cos(spAng) * spLen, zM + Math.sin(spAng) * spLen) + kRad * 0.45, zM + Math.sin(spAng) * spLen,
     kRad * 0.52, crevice, rough, 68, 1.38
    );
    pushItem({x: px, y: h + kRad * 1.1, z: pz, r: sLen * 0.55, materialId: 'driftwood', label: PROP_LABELS.driftwood});
    return done(true);
   }
  }

  // Archetype 6: Crooked smaller 3D wrack stick / twig (0.18–0.48 m)
  const stickLen = 0.18 + 0.30 * rng();
  const rad = 0.012 + 0.012 * rng();
  const x0t = px - Math.cos(yaw) * stickLen * 0.5, z0t = pz - Math.sin(yaw) * stickLen * 0.5;
  const x1t = px + Math.cos(yaw) * stickLen * 0.5, z1t = pz + Math.sin(yaw) * stickLen * 0.5;
  const ok = push3DSegment(
   x0t, land.height(x0t, z0t) + rad * 0.72, z0t,
   x1t, land.height(x1t, z1t) + rad * 0.72 + (0.02 + 0.05 * rng()), z1t,
   rad, col, rough, 46, 1.32
  );
  if (ok) {
   pushItem({x: px, y: h + rad, z: pz, r: stickLen * 0.55, materialId: 'driftwood', label: PROP_LABELS.driftwood});
   return done(true);
  }
  return done(false);
 };

 const emitDarkOrQuartzPebble = (gx, gz, forceDark = false, sizeScale = 1, rangeBoost = 0) => {
  const prevGroup = activeGroup;
  const g = beginGroup(gx, gz, 0.04 * sizeScale, 0.08 * sizeScale, false);
  const gh = land.height(gx, gz);
  const {nx, ny, nz} = surfaceNormalAndSlope(land, gx, gz, gh);
  const yaw = rng() * Math.PI * 2;
  const isDark = forceDark || rng() < 0.75;
  const largeLag = isDark && rng() < 0.12;
  const len = (isDark ? (largeLag ? 0.045 + 0.030 * rng() : 0.014 + 0.024 * rng()) : 0.018 + 0.024 * rng()) * sizeScale;
  const halfW = len * (0.34 + 0.14 * rng());
  const halfT = len * (0.22 + 0.11 * rng());
  const axes = makeAxes(nx, ny, nz, Math.cos(yaw), Math.sin(yaw), len, halfW, halfT);
  const wet = gh < sea + 0.25 ? 0.72 : 1.0;
  const pal = isDark ? DARK_PEBBLE_PALETTE : QUARTZ_PEBBLE_PALETTE;
  const base = pal[Math.floor(rng() * pal.length)];
  const shade = (0.86 + 0.28 * rng()) * wet;
  const rough = gh < sea + 0.25 ? 0.24 : (isDark ? 0.62 + 0.16 * rng() : 0.56 + 0.12 * rng());
  const maxR = (largeLag ? 26 + 6 * rng() : 18 + 8 * rng()) + rangeBoost;
  const ok = pushEllipsoid(gx, gh + halfT * 0.58 + 0.004, gz, axes, base[0] * shade, base[1] * shade, base[2] * shade, rough, maxR);
  activeGroup = prevGroup;
  return {ok, gh, isDark, group: g};
 };

 const emitShell = (sx, sz, allowBlackened = true, maxRangeOver = 0) => {
  const sh = land.height(sx, sz);
  if (sh < sea - 2.6) return null;
  const prevGroup = activeGroup;
  const g = beginGroup(sx, sz, 0.06, 0.15, false);
  const {nx, ny, nz} = surfaceNormalAndSlope(land, sx, sz, sh);
  const yaw = rng() * Math.PI * 2;
  const dx = Math.cos(yaw), dz = Math.sin(yaw);
  const size = 0.026 + 0.036 * rng();
  const roll = rng();
  const wet = sh < sea + 0.25 ? 0.80 : 1.0;
  const rough = sh < sea + 0.25 ? 0.26 : 0.44;
  if (roll < 0.20) {
   const bodyAxes = makeAxes(nx, ny, nz, dx, dz, size * 1.15, size * 0.36, size * 0.30);
   const spireLen = size * 0.72;
   const spAxes = makeAxes(nx, ny, nz, dx, dz, spireLen, size * 0.18, size * 0.15);
   const tint = rng() < 0.5 ? [0.80, 0.72, 0.60] : [0.74, 0.65, 0.53];
   const ok1 = pushEllipsoid(sx, sh + size * 0.16 + 0.004, sz, bodyAxes, tint[0] * wet, tint[1] * wet, tint[2] * wet, rough, maxRangeOver || 26);
   if (ok1) {
    const ox = sx - dx * size * 0.68, oz = sz - dz * size * 0.68;
    const oh = land.height(ox, oz);
    pushEllipsoid(ox, oh + size * 0.09 + 0.003, oz, spAxes, tint[0] * 0.94 * wet, tint[1] * 0.92 * wet, tint[2] * 0.90 * wet, rough, maxRangeOver || 24);
   }
   activeGroup = prevGroup;
   return {ok: ok1, sh, group: g};
  }
  const axes = makeAxes(nx, ny, nz, dx, dz, size * (0.95 + 0.22 * rng()), size * 0.45, size * 0.14);
  const pRoll = rng();
  const col = allowBlackened && pRoll > 0.84
   ? [0.22 * wet, 0.22 * wet, 0.21 * wet]
   : pRoll < 0.44
    ? [0.84 * wet, 0.80 * wet, 0.72 * wet]
    : pRoll < 0.68
     ? [0.80 * wet, 0.66 * wet, 0.58 * wet]
     : [0.70 * wet, 0.67 * wet, 0.65 * wet];
  const ok = pushEllipsoid(sx, sh + size * 0.08 + 0.004, sz, axes, col[0], col[1], col[2], rough, maxRangeOver || (20 + 8 * rng()));
  activeGroup = prevGroup;
  return {ok, sh, group: g};
 };

 // Helper to clamp an axis-oriented submerged shoot/tuft safely <= sea - 0.16
 const emitSubmergedBlade = (bx, bz, bh, az, tilt, maxLen, sideLen, thick, col, ceilingY, maxR) => {
  const room = ceilingY - bh;
  if (room < 0.06) return false;
  const uy = Math.sqrt(Math.max(0.22, 1 - tilt * tilt));
  const ux = Math.cos(az) * tilt, uz = Math.sin(az) * tilt;
  const bladeLen = Math.min(maxLen, (room - 0.012) / Math.max(0.32, uy));
  if (bladeLen < 0.055) return false;
  const fx = -Math.sin(az), fz = Math.cos(az);
  let nbx = uy * fz, nby = uz * fx - ux * fz, nbz = -uy * fx;
  const nLen = Math.hypot(nbx, nby, nbz) || 1;
  nbx /= nLen; nby /= nLen; nbz /= nLen;
  const hl = bladeLen * 0.5;
  const axes = [
   ux * hl, uy * hl, uz * hl,
   fx * sideLen, 0, fz * sideLen,
   nbx * thick, nby * thick, nbz * thick
  ];
  let cy = bh + uy * hl * 0.86;
  const topExt = Math.abs(axes[1]) + Math.abs(axes[4]) + Math.abs(axes[7]);
  if (cy + topExt > ceilingY) {
   cy = ceilingY - topExt;
   if (cy < bh) return false;
  }
  return pushEllipsoid(bx, cy, bz, axes, col[0], col[1], col[2], 0.42, maxR);
 };

 // ---------------------------------------------------------------------------
 // Layer A1: Submerged Seafloor Benthic Pass (stratified 5x5 when hasNearshore || hasBay)
 // ---------------------------------------------------------------------------
 if (hasNearshore || hasBay) {
  for (let gz = 0; gz < 5; gz++) for (let gx = 0; gx < 5; gx++) {
   if (ellipsoids.length >= MAX_TILE_ELLIPSOIDS) break;
   const px = (tx + (gx + 0.10 + 0.80 * rng()) / 5) * REED_TILE;
   const pz = (tz + (gz + 0.10 + 0.80 * rng()) / 5) * REED_TILE;
   const d = land.shoreDistance(px, pz);
   if (!((d >= -34 && d <= -2.8) || d > 222)) continue;
   const h = land.height(px, pz);
   if (h >= sea - 0.22 || h <= sea - 2.95) continue;
   const {slope} = surfaceNormalAndSlope(land, px, pz, h);
   if (slope > 0.38) continue;

   const patch = bedPatch(px + originX, pz + originZ);
   const depth = sea - h;

   // 1. Craggy Karstic Gulf limestone reef outcrops + attached sponges & sea-whip gorgonians
   if (d >= -32 && d <= -5.0 && depth >= 0.42 && depth <= 2.75 && patch > 0.34 && rng() < 0.36) {
    const boulders = 6 + Math.floor(rng() * 3);
    let placedLedge = false;
    let ledgeTopY = h + 0.05;
    for (let s = 0; s < boulders; s++) {
     const rx = px + (rng() - 0.5) * 0.68, rz = pz + (rng() - 0.5) * 0.68;
     const rh = land.height(rx, rz);
     const room = sea - 0.22 - rh;
     if (room < 0.10) continue;
     const rn = surfaceNormalAndSlope(land, rx, rz, rh);
     const yaw = rng() * Math.PI * 2;
     const tilt = (rng() - 0.5) * 0.65;
     const nrx = rn.nx + Math.cos(yaw) * tilt, nry = rn.ny, nrz = rn.nz + Math.sin(yaw) * tilt;
     const nLen = Math.hypot(nrx, nry, nrz) || 1;
     const len = 0.11 + 0.11 * rng();
     const wid = len * (0.45 + 0.22 * rng());
     const thk = Math.min(0.09 + 0.10 * rng(), room * 0.78);
     const axes = makeAxes(nrx / nLen, nry / nLen, nrz / nLen, Math.cos(yaw), Math.sin(yaw), len, wid * 0.5, thk * 0.5);
     const tCol = 0.78 + 0.44 * rng();
     if (pushEllipsoid(rx, rh + thk * 0.38, rz, axes, 0.048 * tCol, 0.056 * tCol, 0.036 * tCol, 0.94, 64)) {
      placedLedge = true;
      ledgeTopY = Math.max(ledgeTopY, rh + thk * 0.62);
     }
    }
    if (placedLedge) {
     items.push({x: px, y: Math.min(sea - 0.22, h + 0.06), z: pz, r: 0.54, materialId: 'limestone-ledge', label: PROP_LABELS['limestone-ledge']});
     // Perched Gulf reef sponges
     if (sea - ledgeTopY > 0.24) {
      const sponges = 3 + Math.floor(rng() * 3);
      const spRoll = rng();
      const spCol = spRoll < 0.45 ? [0.34, 0.21, 0.075] : spRoll < 0.75 ? [0.15, 0.14, 0.075] : [0.30, 0.12, 0.078];
      let addedSponge = false;
      for (let k = 0; k < sponges; k++) {
       const sx = px + (rng() - 0.5) * 0.56, sz = pz + (rng() - 0.5) * 0.56;
       const sh = Math.max(land.height(sx, sz) + 0.04, ledgeTopY - 0.02);
       const rad = 0.042 + 0.040 * rng();
       const ht = Math.min(0.08 + 0.07 * rng(), (sea - 0.20 - sh) * 0.85);
       if (ht < 0.03) continue;
       const axes = [0, ht * 0.5, 0, rad, 0, 0, 0, 0, rad * 0.92];
       if (pushEllipsoid(sx, sh + ht * 0.45, sz, axes, spCol[0], spCol[1], spCol[2], 0.82, 58)) addedSponge = true;
      }
      if (addedSponge) {
       items.push({x: px, y: Math.min(sea - 0.20, ledgeTopY + 0.05), z: pz, r: 0.36, materialId: 'sea-sponge', label: PROP_LABELS['sea-sponge']});
      }
     }
     // Perched sea-whip gorgonians
     if (sea - ledgeTopY > 0.28 && rng() < 0.82) {
      const whips = 4 + Math.floor(rng() * 3);
      const wCol = rng() < 0.6 ? [0.40, 0.26, 0.09] : [0.26, 0.11, 0.18];
      let addedWhip = false;
      for (let k = 0; k < whips; k++) {
       const wx = px + (rng() - 0.5) * 0.54, wz = pz + (rng() - 0.5) * 0.54;
       const wh = Math.max(land.height(wx, wz) + 0.04, ledgeTopY - 0.02);
       const ok = emitSubmergedBlade(wx, wz, wh, rng() * Math.PI * 2, 0.18 + 0.28 * rng(), 0.16 + 0.18 * rng(), 0.014, 0.011, wCol, sea - 0.22, 60);
       if (ok) addedWhip = true;
      }
      if (addedWhip) {
       items.push({x: px, y: Math.min(sea - 0.22, ledgeTopY + 0.09), z: pz, r: 0.36, materialId: 'sea-whip', label: PROP_LABELS['sea-whip']});
      }
     }
     continue;
    }
   }

   // 2. Lush depth-zoned submerged seagrass beds (Shoal grass, Turtle grass, Manatee grass)
   if (patch > 0.22 && rng() < (0.58 + 0.32 * (patch - 0.22))) {
    const blades = 7 + Math.floor(rng() * 5);
    let spMat = 'seagrass-bed';
    let spCol = [0.045, 0.118, 0.052];
    let bWid = 0.030 + 0.018 * rng();
    let bMaxLen = 0.22 + 0.20 * rng();
    if (depth < 0.75 && (depth < 0.50 || rng() < 0.65)) {
     spMat = 'shoal-grass';
     spCol = [0.065, 0.160, 0.058];
     bWid = 0.014 + 0.009 * rng();
     bMaxLen = 0.15 + 0.14 * rng();
    } else if (depth > 0.88 && d <= -5 && rng() < 0.45) {
     spMat = 'manatee-grass';
     spCol = [0.080, 0.175, 0.062];
     bWid = 0.016 + 0.008 * rng();
     bMaxLen = 0.24 + 0.24 * rng();
    }
    let placedGrass = false;
    const subClusters = patch > 0.52 ? 3 : 2;
    for (let sc = 0; sc < subClusters && ellipsoids.length < 305; sc++) {
     const scx = sc === 0 ? px : px + (rng() - 0.5) * 1.35;
     const scz = sc === 0 ? pz : pz + (rng() - 0.5) * 1.35;
     const subBlades = 5 + Math.floor(rng() * 2);
     for (let b = 0; b < subBlades && ellipsoids.length < 305; b++) {
      const bx = scx + (rng() - 0.5) * 0.44, bz = scz + (rng() - 0.5) * 0.44;
      const bh = land.height(bx, bz);
      if (bh >= sea - 0.20) continue;
      const tone = 0.82 + 0.36 * rng();
      const ok = emitSubmergedBlade(
       bx, bz, bh, rng() * Math.PI * 2, 0.22 + 0.44 * rng(),
       bMaxLen, bWid, 0.008, [spCol[0] * tone, spCol[1] * tone, spCol[2] * tone],
       sea - 0.16, 64 + 12 * rng()
      );
      if (ok) placedGrass = true;
     }
    }
    // Stiff pen shell clusters embedded vertically near seagrass edges
    if (depth >= 0.34 && depth <= 2.25 && rng() < 0.36) {
     const pens = 2 + Math.floor(rng() * 3);
     let addedPen = false;
     for (let p = 0; p < pens; p++) {
      const ppx = px + (rng() - 0.5) * 0.58, ppz = pz + (rng() - 0.5) * 0.58;
      const pph = land.height(ppx, ppz);
      const okPen = emitSubmergedBlade(
       ppx, ppz, pph, rng() * Math.PI * 2, 0.12 + 0.16 * rng(),
       0.11 + 0.06 * rng(), 0.038 + 0.018 * rng(), 0.012, [0.085, 0.070, 0.060],
       sea - 0.18, 52
      );
      if (okPen) addedPen = true;
     }
     if (addedPen) {
      items.push({x: px, y: Math.min(sea - 0.18, h + 0.07), z: pz, r: 0.34, materialId: 'pen-shell', label: PROP_LABELS['pen-shell']});
     }
    }
    if (placedGrass) {
     items.push({x: px, y: Math.min(sea - 0.16, h + 0.10), z: pz, r: 0.44, materialId: spMat, label: PROP_LABELS[spMat]});
     continue;
    }
   }

   // 3. Live keyhole sand dollar beds resting in shallow clear sand troughs
   if (d >= -22 && d <= -4.0 && depth >= 0.32 && depth <= 1.55 && rng() < 0.34) {
    const dollars = 4 + Math.floor(rng() * 4);
    let addedDollar = false;
    let firstDG = null;
    for (let k = 0; k < dollars; k++) {
     const dxp = px + (rng() - 0.5) * 0.95, dzp = pz + (rng() - 0.5) * 0.95;
     const dh = land.height(dxp, dzp);
     if (dh >= sea - 0.24) continue;
     const dg = beginGroup(dxp, dzp, 0.05, 0.14, false);
     const dn = surfaceNormalAndSlope(land, dxp, dzp, dh);
     const rad = 0.032 + 0.016 * rng();
     const axes = makeAxes(dn.nx, dn.ny, dn.nz, Math.cos(rng() * Math.PI * 2), Math.sin(rng() * Math.PI * 2), rad * 2, rad * 0.96, 0.008);
     const shade = 0.85 + 0.30 * rng();
     if (pushEllipsoid(dxp, dh + 0.008, dzp, axes, 0.16 * shade, 0.13 * shade, 0.085 * shade, 0.78, 46)) {
      addedDollar = true;
      if (!firstDG) firstDG = dg;
     }
     activeGroup = null;
    }
    if (addedDollar) {
     activeGroup = firstDG;
     pushItem({x: px, y: Math.min(sea - 0.24, h + 0.02), z: pz, r: 0.45, materialId: 'live-sand-dollar', label: PROP_LABELS['live-sand-dollar']});
     activeGroup = null;
     continue;
    }
   }

   // 4. Benthic drift macroalgae clumps (burgundy Gracilaria & green Halimeda/Caulerpa)
   if (depth >= 0.32 && rng() < 0.32) {
    const lobes = 3 + Math.floor(rng() * 3);
    const isRed = rng() < 0.55;
    const baseC = isRed ? [0.22, 0.075, 0.065] : [0.10, 0.21, 0.085];
    let addedAlg = false;
    beginGroup(px, pz, 0.16, 0.25, false);
    for (let l = 0; l < lobes; l++) {
     const ax = px + (rng() - 0.5) * 0.28, az = pz + (rng() - 0.5) * 0.28;
     const ah = land.height(ax, az);
     if (ah >= sea - 0.20) continue;
     const an = surfaceNormalAndSlope(land, ax, az, ah);
     const sz = 0.08 + 0.06 * rng();
     const axes = makeAxes(an.nx, an.ny, an.nz, Math.cos(rng() * Math.PI * 2), Math.sin(rng() * Math.PI * 2), sz, sz * 0.42, sz * 0.28);
     const tone = 0.85 + 0.30 * rng();
     if (pushEllipsoid(ax, Math.min(sea - 0.18, ah + sz * 0.14), az, axes, baseC[0] * tone, baseC[1] * tone, baseC[2] * tone, 0.46, 54)) addedAlg = true;
    }
    if (addedAlg) {
     pushItem({x: px, y: Math.min(sea - 0.18, h + 0.04), z: pz, r: 0.30, materialId: 'benthic-algae', label: PROP_LABELS['benthic-algae']});
    }
    activeGroup = null;
   }
  }
 }

 // ---------------------------------------------------------------------------
 // Layer A2: Terrestrial Macro & Meso Detritus (3D Driftwood, Cobbles, Pine Cones)
 // ---------------------------------------------------------------------------
 for (let gz = 0; gz < 4; gz++) for (let gx = 0; gx < 4; gx++) {
  if (ellipsoids.length >= MAX_TILE_ELLIPSOIDS) break;
  const px = (tx + (gx + 0.12 + 0.76 * rng()) / 4) * REED_TILE;
  const pz = (tz + (gz + 0.12 + 0.76 * rng()) / 4) * REED_TILE;
  const d = land.shoreDistance(px, pz);
  if (d < -18 || d > 250) continue;
  const h = land.height(px, pz);
  if (h < sea - 1.35 || h > 4.2) continue;

  const {slope} = surfaceNormalAndSlope(land, px, pz, h);
  const env = (d > 22 && d < 74) || (d >= 64 && d <= 224) ? land.environment(px, pz, h) : null;

  // 1. Sculptural 3D Weathered Driftwood across 6 archetypes
  const onBeachWrack = d >= 7.5 + sea * 3 && d <= 27.5 + sea * 3 && h >= sea + 0.18 && h <= 2.25 && slope < 0.32;
  const onBlowout = d > 25 && d < 70 && h >= 0.40 && (env?.sandMobility ?? 0) > 0.25 && slope < 0.26;
  const onBayMargin = d > 218 && h >= sea + 0.06 && h <= 1.35 && slope < 0.28;
  const inScrubTwig = d >= 64 && d <= 224 && h > 0.85 && (env?.organicMatter ?? 0) > 0.20 && (env?.rosemaryInhibition ?? 0) < 0.35 && slope < 0.35;

  const woodProb = onBeachWrack ? 0.30 : (onBlowout ? 0.10 : (onBayMargin ? 0.22 : (inScrubTwig ? 0.11 : 0)));
  if (woodProb > 0 && rng() < woodProb) {
   if (emitDriftwood(px, pz, h, d, env, inScrubTwig)) continue;
  }

  // 2. Gulf limestone / coquina cobble clusters
  const cobbleBeach = d >= 1.2 && d <= 20.5 && h >= sea - 0.10 && h <= 1.35 && slope < 0.28;
  const cobbleBlowout = d >= 24 && d <= 62 && h >= 0.38 && (env?.sandMobility ?? 0) > 0.30 && slope < 0.24;
  const cobbleSubmerged = d >= -18 && d <= 1.2 && h >= sea - 1.30 && h <= sea - 0.05 && slope < 0.26;
  const cobbleProb = cobbleBeach ? 0.15 : (cobbleBlowout ? 0.065 : (cobbleSubmerged ? 0.08 : 0));
  if (cobbleProb > 0 && rng() < cobbleProb) {
   const count = 1 + Math.floor(rng() * 3.4);
   let placedCobble = false;
   for (let k = 0; k < count; k++) {
    const rx = px + (rng() - 0.5) * (k === 0 ? 0.1 : 0.48);
    const rz = pz + (rng() - 0.5) * (k === 0 ? 0.1 : 0.48);
    const rh = land.height(rx, rz);
    const rn = surfaceNormalAndSlope(land, rx, rz, rh);
    const yaw = rng() * Math.PI * 2;
    const len = (k === 0 ? 0.14 + 0.14 * rng() : 0.075 + 0.10 * rng());
    const wid = len * (0.54 + 0.26 * rng());
    const thk = len * (0.26 + 0.16 * rng());
    beginGroup(rx, rz, len * 0.65, Math.max(0.45, len * 12), false);
    const axes = makeAxes(rn.nx, rn.ny, rn.nz, Math.cos(yaw), Math.sin(yaw), len, wid * 0.5, thk * 0.5);
    const isSub = rh < sea - 0.04;
    const wet = rh < sea + 0.28 ? 0.68 : 1.0;
    const tone = (0.86 + 0.24 * rng()) * wet;
    const col = isSub
     ? [0.32 * (0.85 + 0.25 * rng()), 0.35 * (0.85 + 0.25 * rng()), 0.25 * (0.85 + 0.25 * rng())]
     : [0.47 * tone, 0.43 * tone, 0.35 * tone];
    const ok = pushEllipsoid(rx, rh + thk * 0.22 + 0.004, rz, axes, col[0], col[1], col[2], rh < sea + 0.28 ? 0.34 : 0.88, 58 + 14 * rng());
    if (ok && !placedCobble) {
     pushItem({x: rx, y: rh + thk * 0.25, z: rz, r: Math.max(0.28, len * 0.7), materialId: 'coquina-rock', label: PROP_LABELS['coquina-rock']});
     placedCobble = true;
    }
    activeGroup = null;
   }
   if (placedCobble && h >= sea - 0.02) {
    const basal = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < basal; k++) {
     emitDarkOrQuartzPebble(px + (rng() - 0.5) * 0.52, pz + (rng() - 0.5) * 0.52, true, 0.95, 4);
    }
    continue;
   }
  }

  // 3. Backdune slash / sand pine cones under sheltered pine/oak humus (never in rosemary balds)
  if (inScrubTwig && rng() < 0.12) {
   const cones = 2 + Math.floor(rng() * 2);
   let addedCone = false;
   for (let c = 0; c < cones; c++) {
    const cx = px + (rng() - 0.5) * 0.8, cz = pz + (rng() - 0.5) * 0.8;
    const ch = land.height(cx, cz);
    const cn = surfaceNormalAndSlope(land, cx, cz, ch);
    const yaw = rng() * Math.PI * 2;
    const len = 0.055 + 0.036 * rng();
    const rad = len * 0.33;
    beginGroup(cx, cz, len * 0.6, 0.14, false);
    const axes = makeAxes(cn.nx, cn.ny, cn.nz, Math.cos(yaw), Math.sin(yaw), len, rad, rad * 0.94);
    const tone = 0.82 + 0.32 * rng();
    const ok = pushEllipsoid(cx, ch + rad * 0.62 + 0.004, cz, axes, 0.19 * tone, 0.125 * tone, 0.075 * tone, 0.88, 22 + 6 * rng());
    if (ok && !addedCone) {
     pushItem({x: cx, y: ch + rad * 0.6, z: cz, r: 0.28, materialId: 'pine-cone', label: PROP_LABELS['pine-cone']});
     addedCone = true;
    }
    activeGroup = null;
   }
  }
 }

 // ---------------------------------------------------------------------------
 // Sinuous Alongshore Wrack-Line Pass (low wispy bronze Sargassum & olive seagrass windrows)
 // ---------------------------------------------------------------------------
 if (hasBeach || hasBay) {
  for (let w = 0; w < 7; w++) {
   if (ellipsoids.length >= MAX_TILE_ELLIPSOIDS) break;
   const sx0 = (tx + (w + 0.15 + 0.70 * rng()) / 7) * REED_TILE;
   const sz0 = (tz + (0.15 + 0.70 * rng())) * REED_TILE;
   const d0 = land.shoreDistance(sx0, sz0);
   const along0 = ALONG_DIR_X * (sx0 + originX) + ALONG_DIR_Z * (sz0 + originZ);
   const onBay = hasBay && d0 > 205;
   const isStorm = !onBay && rng() < 0.24;
   const targetD = onBay
    ? 232 + 2.4 * Math.sin(along0 * 0.11) + (rng() - 0.5) * 1.8
    : isStorm
     ? 18.2 + sea * 4.0 + (rng() - 0.5) * 2.6
     : wrackCenter(along0, sea) + (rng() - 0.5) * 1.8;
   const shift = targetD - d0;
   const px = sx0 + INLAND_DIR_X * shift;
   const pz = sz0 + INLAND_DIR_Z * shift;
   if (px < x0 || px >= x0 + REED_TILE || pz < z0 || pz >= z0 + REED_TILE) continue;
   const h = land.height(px, pz);
   if (h < sea + 0.02 || h > sea + 1.45) continue;
   const {slope} = surfaceNormalAndSlope(land, px, pz, h);
   if (slope > 0.30) continue;
   if (bedPatch(px + originX, pz + originZ) < 0.36) continue;

   const isSargassum = !onBay && rng() < (isStorm ? 0.40 : 0.65);
   const matId = isSargassum ? 'sargassum-wrack' : 'seagrass-wrack';
   const yawOff = (rng() - 0.5) * 0.52;
   const ca = Math.cos(yawOff), sa = Math.sin(yawOff);
   const dirX = ALONG_DIR_X * ca - ALONG_DIR_Z * sa;
   const dirZ = ALONG_DIR_X * sa + ALONG_DIR_Z * ca;
   const patchLen = 0.34 + 0.30 * rng();
   const segs = 4 + Math.floor(rng() * 3);
   let placedMat = false;
   let firstWrackG = null;
   for (let s = 0; s < segs; s++) {
    const t = (s + 0.5) / segs - 0.5;
    const jitterAngle = (rng() - 0.5) * (isSargassum ? 0.95 : 1.35);
    const sx = px + dirX * t * patchLen + (rng() - 0.5) * 0.16;
    const sz = pz + dirZ * t * patchLen + (rng() - 0.5) * 0.16;
    const sh = land.height(sx, sz);
    if (sh < sea - 0.02) continue;
    const sn = surfaceNormalAndSlope(land, sx, sz, sh);
    const caJ = Math.cos(jitterAngle), saJ = Math.sin(jitterAngle);
    const lx = dirX * caJ - dirZ * saJ, lz = dirX * saJ + dirZ * caJ;
    const segLen = 0.15 + 0.14 * rng();
    const halfW = 0.012 + 0.012 * rng();
    const halfT = 0.005 + 0.004 * rng();
    const wg = beginGroup(sx, sz, segLen * 0.6, 0.12, false);
    const axes = makeAxes(sn.nx, sn.ny, sn.nz, lx, lz, segLen, halfW, halfT);
    const shade = (0.84 + 0.30 * rng()) * (sh < sea + 0.25 ? 0.78 : 1.0);
    const col = isSargassum
     ? (isStorm ? [0.19 * shade, 0.14 * shade, 0.06 * shade] : [0.16 * shade, 0.11 * shade, 0.036 * shade])
     : (isStorm ? [0.21 * shade, 0.19 * shade, 0.11 * shade] : [0.075 * shade, 0.092 * shade, 0.042 * shade]);
    const rough = sh < sea + 0.25 ? 0.36 : (isSargassum ? 0.72 : 0.80);
    if (pushEllipsoid(sx, sh + halfT * 0.55 + 0.004, sz, axes, col[0], col[1], col[2], rough, 48 + 14 * rng())) {
     placedMat = true;
     if (!firstWrackG) firstWrackG = wg;
    }
    activeGroup = null;
   }
   const trapped = 1 + (rng() < 0.5 ? 1 : 0);
   for (let k = 0; k < trapped; k++) {
    const ox = px + (rng() - 0.5) * 0.52, oz = pz + (rng() - 0.5) * 0.42;
    if (rng() < 0.55) emitShell(ox, oz, true);
    else emitDarkOrQuartzPebble(ox, oz, rng() < 0.80);
   }
   if (placedMat) {
    activeGroup = firstWrackG;
    pushItem({x: px, y: h + 0.015, z: pz, r: patchLen * 0.55, materialId: matId, label: PROP_LABELS[matId]});
    activeGroup = null;
   }
  }
 }

 // ---------------------------------------------------------------------------
 // Layer B1: Clean 5x5 Beach / Bay Micro-Texture Pass — Small Dark Pebbles & Shell Assemblage
 // ---------------------------------------------------------------------------
 if (hasBeach || hasBay) {
  for (let mz = 0; mz < 5; mz++) for (let mx = 0; mx < 5; mx++) {
   if (ellipsoids.length >= MAX_TILE_ELLIPSOIDS) break;
   const px = (tx + (mx + 0.10 + 0.80 * rng()) / 5) * REED_TILE;
   const pz = (tz + (mz + 0.10 + 0.80 * rng()) / 5) * REED_TILE;
   const d = land.shoreDistance(px, pz);
   if (!((d >= 1.4 && d <= 26.5) || d >= 220)) continue;
   const h = land.height(px, pz);
   if (h < sea - 0.05 || h > 2.4) continue;
   const {slope} = surfaceNormalAndSlope(land, px, pz, h);
   if (slope > 0.30) continue;

   const along = ALONG_DIR_X * (px + originX) + ALONG_DIR_Z * (pz + originZ);
   const cusp = cuspTrough(along);

   const onBerm = d >= 1.8 && d <= 26.5 && h >= sea + 0.01;
   const onBayShore = d >= 220 && h >= sea - 0.04 && h <= sea + 0.45;
   const darkProb = onBerm ? (0.72 + 0.22 * cusp) : (onBayShore ? 0.26 : 0);
   if (darkProb > 0 && rng() < darkProb) {
    const isSolo = rng() < 0.24;
    const count = isSolo ? (1 + (rng() < 0.45 ? 1 : 0)) : (2 + Math.floor(rng() * 3));
    const spread = isSolo ? 0.28 : (0.95 + 0.60 * rng());
    let firstItem = null;
    let firstIsDark = false;
    let firstG = null;
    for (let k = 0; k < count; k++) {
     const gx = px + (rng() - 0.5) * spread, gz = pz + (rng() - 0.5) * spread;
     const res = emitDarkOrQuartzPebble(gx, gz, isSolo ? true : (rng() < 0.76));
     if (res.ok && !firstItem) {
      firstItem = {x: gx, y: res.gh + 0.015, z: gz};
      firstIsDark = res.isDark;
      firstG = res.group;
     }
    }
    if (firstItem) {
     const matId = firstIsDark ? 'pebble-dark' : 'pebble-quartz';
     activeGroup = firstG;
     pushItem({...firstItem, r: 0.30, materialId: matId, label: PROP_LABELS[matId]});
     activeGroup = null;
    }
   }

   const inShellZone = d >= 1.2 && d <= 21.5 && h >= sea - 0.05 && h <= 1.35;
   const wrackDist = Math.abs(d - wrackCenter(along, sea));
   const shellProb = inShellZone ? (0.28 + 0.22 * cusp + (wrackDist < 3.0 ? 0.18 : 0)) : (onBayShore ? 0.12 : 0);
   if (shellProb > 0 && rng() < shellProb) {
    if (d >= 3.0 && d <= 15.5 && h >= sea + 0.03 && rng() < 0.11) {
     const dh = land.height(px, pz);
     const dn = surfaceNormalAndSlope(land, px, pz, dh);
     const yaw = rng() * Math.PI * 2;
     const rad = 0.028 + 0.014 * rng();
     beginGroup(px, pz, rad * 1.4, 0.12, false);
     const axes = makeAxes(dn.nx, dn.ny, dn.nz, Math.cos(yaw), Math.sin(yaw), rad * 2, rad * (0.94 + 0.06 * rng()), 0.005);
     if (pushEllipsoid(px, dh + 0.006, pz, axes, 0.88, 0.85, 0.79, 0.72, 32)) {
      pushItem({x: px, y: dh + 0.01, z: pz, r: 0.22, materialId: 'sand-dollar', label: PROP_LABELS['sand-dollar']});
     }
     activeGroup = null;
    }
    if (d >= 3.5 && d <= 13.5 && h >= sea + 0.04 && wrackDist < 3.5 && rng() < 0.025) {
     const sh = land.height(px, pz);
     const sn = surfaceNormalAndSlope(land, px, pz, sh);
     const baseYaw = rng() * Math.PI * 2;
     const armSpan = 0.036 + 0.014 * rng();
     beginGroup(px, pz, armSpan, 0.22, false);
     let okStar = false;
     for (let a = 0; a < 5; a++) {
      const ang = baseYaw + (a * Math.PI * 2) / 5 + (rng() - 0.5) * 0.14;
      const adx = Math.cos(ang), adz = Math.sin(ang);
      const ax = px + adx * armSpan * 0.42, az = pz + adz * armSpan * 0.42;
      const ah = land.height(ax, az);
      const axes = makeAxes(sn.nx, sn.ny, sn.nz, adx, adz, armSpan, 0.0085, 0.0055);
      if (pushEllipsoid(ax, ah + 0.006, az, axes, 0.46, 0.31, 0.19, 0.78, 30)) okStar = true;
     }
     if (okStar) {
      pushItem({x: px, y: sh + 0.012, z: pz, r: 0.22, materialId: 'sea-star', label: PROP_LABELS['sea-star']});
     }
     activeGroup = null;
    }

    const shells = 3 + Math.floor(rng() * 3);
    let addedShell = false;
    for (let s = 0; s < shells; s++) {
     const sx = px + (rng() - 0.5) * 1.15, sz = pz + (rng() - 0.5) * 1.15;
     const res = emitShell(sx, sz, true);
     if (res?.ok && !addedShell) {
      activeGroup = res.group;
      pushItem({x: sx, y: res.sh + 0.018, z: sz, r: 0.34, materialId: 'shell-calc', label: PROP_LABELS['shell-calc']});
      activeGroup = null;
      addedShell = true;
     }
    }
   }
  }
 }

 // ---------------------------------------------------------------------------
 // Layer B2: Sparse 4x4 Aeolian Blowout Deflation & Swale Edge Pebbles
 // ---------------------------------------------------------------------------
 if (hasBlowout) {
  for (let bz = 0; bz < 4; bz++) for (let bx = 0; bx < 4; bx++) {
   if (ellipsoids.length >= MAX_TILE_ELLIPSOIDS) break;
   const px = (tx + (bx + 0.12 + 0.76 * rng()) / 4) * REED_TILE;
   const pz = (tz + (bz + 0.12 + 0.76 * rng()) / 4) * REED_TILE;
   const d = land.shoreDistance(px, pz);
   if (d < 25 || d > 72) continue;
   const h = land.height(px, pz);
   if (h < sea - 0.04 || h > 2.6) continue;
   const {slope} = surfaceNormalAndSlope(land, px, pz, h);
   if (slope > 0.28) continue;
   const onSwale = d >= 42 && h <= sea + 0.40;
   let prob = 0;
   if (onSwale) prob = 0.24;
   else {
    const mob = land.environment(px, pz, h).sandMobility;
    if (mob > 0.24) prob = Math.min(0.42, 0.10 + 0.38 * mob);
   }
   if (prob > 0 && rng() < prob) {
    const count = 2 + Math.floor(rng() * 3);
    let firstItem = null;
    let firstIsDark = false;
    let firstG = null;
    for (let k = 0; k < count; k++) {
     const gx = px + (rng() - 0.5) * 0.85, gz = pz + (rng() - 0.5) * 0.85;
     const res = emitDarkOrQuartzPebble(gx, gz, rng() < 0.76, 1, 0);
     if (res.ok && !firstItem) {
      firstItem = {x: gx, y: res.gh + 0.015, z: gz};
      firstIsDark = res.isDark;
      firstG = res.group;
     }
    }
    if (firstItem) {
     const matId = firstIsDark ? 'pebble-dark' : 'pebble-quartz';
     activeGroup = firstG;
     pushItem({...firstItem, r: 0.30, materialId: matId, label: PROP_LABELS[matId]});
     activeGroup = null;
    }
   }
  }
 }

 return {ellipsoids, items, groups};
}

const propsVertex = /* glsl */`
 attribute vec4 propCenter,propColor;
 attribute vec3 propAxisA,propAxisB,propAxisC;
 uniform vec2 viewport;
 varying vec2 uvG;
 varying vec3 worldPos,vViewPos,vBaseCol,vSurfNorm;
 varying float vThick,vFade,vSoft,vRough,vHaze;
 void main(){
  float maxRange=abs(propCenter.w);
  float dist=length(cameraPosition-propCenter.xyz);
  float fade=1.-smoothstep(maxRange*.70,maxRange,dist);
  if(fade<=.015){gl_Position=vec4(2.,2.,2.,1.);return;}
  vSoft=propCenter.w<0.?1.:0.;
  vec3 n0=propAxisC;
  float n0Len=length(n0);
  float upAlign=smoothstep(.50,.90,abs(n0.y)/max(1e-5,n0Len));
  float chordBias=smoothstep(9.,28.,dist)*.012*upAlign;
  vec3 centerW=propCenter.xyz+vec3(0.,chordBias,0.);
  vec3 A=propAxisA*fade,B=propAxisB*fade,C=propAxisC*fade;
  vec4 v=viewMatrix*vec4(centerW,1.);
  float z=-v.z;
  float lA=length(A),lB=length(B),lC=length(C);
  float reach=1.78*(lA+lB+lC);
  if(z<.03||any(greaterThan(abs(v.xy),(z+reach)/vec2(projectionMatrix[0][0],projectionMatrix[1][1])+reach))){
   gl_Position=vec4(2.,2.,2.,1.);return;
  }
  mat3 M=mat3(A,B,C);
  mat3 basis=mat3(viewMatrix)*M;
  vec3 px=vec3(1.,0.,v.x/z)*basis*(.5*projectionMatrix[0][0]*viewport.x/z);
  vec3 py=vec3(0.,1.,v.y/z)*basis*(.5*projectionMatrix[1][1]*viewport.y/z);
  float xx=dot(px,px)+.20,yy=dot(py,py)+.20,xy=dot(px,py);
  float a=sqrt(xx),b=xy/a;
  float minor=sqrt(max(.005,yy-b*b));
  uvG=position.xy*1.78;
  vec2 off=vec2(a*uvG.x,b*uvG.x+minor*uvG.y);
  vec3 sCoord=px*(uvG.x/a)+(py-px*(b/a))*(uvG.y/minor);
  worldPos=centerW+M*sCoord;
  vec3 uHat=A/max(1e-5,lA),vHat=B/max(1e-5,lB),nHat=C/max(1e-5,lC);
  float endCurve=smoothstep(1.45,1.05,lA/max(1e-5,lB));
  vSurfNorm=normalize(nHat+.32*(uHat*clamp(sCoord.x,-1.2,1.2)*endCurve+vHat*clamp(sCoord.y,-1.2,1.2)));
  vBaseCol=propColor.rgb;
  vRough=propColor.a;
  vHaze=1.-exp(-length(cameraPosition-worldPos)*.00028);
  vec3 viewDir=normalize(centerW-cameraPosition);
  vec3 invRay=vec3(dot(viewDir,A)/max(1e-10,dot(A,A)),dot(viewDir,B)/max(1e-10,dot(B,B)),dot(viewDir,C)/max(1e-10,dot(C,C)));
  vThick=min(1./max(1e-4,length(invRay)),max(lA,max(lB,lC)));
  vViewPos=(viewMatrix*vec4(worldPos,1.)).xyz;
  vFade=fade;
  vec4 clip=projectionMatrix*v;
  clip.xy+=off*2./viewport*clip.w;
  vec4 pointClip=projectionMatrix*vec4(vViewPos,1.);
  clip.z=pointClip.z/max(.03,pointClip.w)*clip.w;
  gl_Position=clip;
 }`;

const propsShadowVertex = /* glsl */`
 attribute vec4 propCenter,propColor;
 attribute vec3 propAxisA,propAxisB,propAxisC;
 varying vec2 vG;
 void main(){
  if(propCenter.w < 0.0){
   gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
   vG = vec2(9.0);
   return;
  }
  vec3 wPos = propCenter.xyz + propAxisA * position.x + propAxisB * position.y;
  vG = position.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(wPos, 1.0);
 }`;

function makePropsGeometry(cap = 64) {
 const g = new T.InstancedBufferGeometry();
 g.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
 g.setIndex([0, 1, 2, 0, 2, 3]);
 for (const [k, n] of [['propCenter', 4], ['propAxisA', 3], ['propAxisB', 3], ['propAxisC', 3], ['propColor', 4]]) {
  g.setAttribute(k, new T.InstancedBufferAttribute(new Float32Array(cap * n), n));
 }
 g.instanceCount = 0;
 return g;
}

function uploadPropRows(mesh, rows) {
 const g = mesh.geometry;
 if (g.attributes.propCenter.count < rows.length) {
  const cap = 2 ** Math.ceil(Math.log2(Math.max(64, rows.length)));
  g.setAttribute('propCenter', new T.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
  g.setAttribute('propAxisA', new T.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
  g.setAttribute('propAxisB', new T.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
  g.setAttribute('propAxisC', new T.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
  g.setAttribute('propColor', new T.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
  delete g._maxInstanceCount;
 }
 const cAttr = g.attributes.propCenter, aAttr = g.attributes.propAxisA, bAttr = g.attributes.propAxisB, nAttr = g.attributes.propAxisC, colAttr = g.attributes.propColor;
 for (let idx = 0; idx < rows.length; idx++) {
  const e = rows[idx];
  cAttr.setXYZW(idx, e.cx, e.cy, e.cz, e.maxRange);
  aAttr.setXYZ(idx, e.ax, e.ay, e.az);
  bAttr.setXYZ(idx, e.bx, e.by, e.bz);
  nAttr.setXYZ(idx, e.nx, e.ny, e.nz);
  colAttr.setXYZW(idx, e.r, e.g, e.b, e.rough);
 }
 if (rows.length > 0) {
  cAttr.needsUpdate = aAttr.needsUpdate = bAttr.needsUpdate = nAttr.needsUpdate = colAttr.needsUpdate = true;
 }
 g.instanceCount = rows.length;
 mesh.visible = rows.length > 0;
}

export class CoastalPropsView {
 constructor(view, lighting) {
  const g = makePropsGeometry(64);
  const softG = makePropsGeometry(32);
  this.uniforms = {
   ...view.uniforms,
   sunDirection: view.uniforms.sunDirection,
   sunColor: view.uniforms.sunColor,
   hazeColor: view.uniforms.hazeColor
  };
  const makeFrag = (isOpaque) => lighting + reflectedSurfaceClip + `
   uniform vec2 viewport;
   uniform mat4 projectionMatrix;
   uniform vec3 hazeColor;
   varying vec2 uvG;
   varying vec3 worldPos,vViewPos,vBaseCol,vSurfNorm;
   varying float vThick,vFade,vSoft,vRough,vHaze;
   void main(){
    if(vFade<=.02)discard;
    if(clipWaves&&belowReflector(worldPos))discard;
    float r2=dot(uvG,uvG);
    if(r2>3.1684)discard;
    float w=exp(-.5*r2*(1.+.45*r2));
    ${isOpaque
     ? `if(vSoft>.5)discard;float aa=clamp(fwidth(w),.004,.04);if(w<.22-aa*.35)discard;`
     : `if(vSoft<.5)discard;float fadeAlpha=smoothstep(.02,.35,vFade);float alpha=exp(-.75*r2)*.22*fadeAlpha;if(alpha<.02)discard;`}
    float dome=sqrt(max(0.,1.-r2/3.1684));
    float vz=max(.03,-vViewPos.z);
    float depth=max(.03,vz-vThick*dome);
    vec3 pView=vec3(vViewPos.xy*(depth/vz),-depth);
    vec4 dclip=projectionMatrix*vec4(pView,1.);
    gl_FragDepth=clamp(.5+.5*dclip.z/dclip.w,0.,1.);
    vec3 lit=mix(shade(vBaseCol,normalize(vSurfNorm),worldPos,vec4(vRough,0.,1.,0.)),hazeColor,vHaze);
    gl_FragColor=vec4(lit,${isOpaque ? '1.0' : 'alpha'});
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`;
  const mat = new T.ShaderMaterial({
   uniforms: this.uniforms,
   transparent: false,
   depthWrite: true,
   side: T.DoubleSide,
   vertexShader: propsVertex,
   fragmentShader: makeFrag(true)
  });
  this.softMaterial = new T.ShaderMaterial({
   uniforms: this.uniforms,
   transparent: true,
   depthWrite: false,
   side: T.DoubleSide,
   vertexShader: propsVertex,
   fragmentShader: makeFrag(false)
  });
  this.shadowMaterial = new T.ShaderMaterial({
   colorWrite: false,
   depthWrite: true,
   depthTest: true,
   side: T.DoubleSide,
   vertexShader: propsShadowVertex,
   fragmentShader: 'varying vec2 vG; void main(){ if(dot(vG,vG) > 1.35) discard; gl_FragColor = vec4(0.0); }',
  });
  this.renderMat = mat;
  this.mesh = new T.Mesh(g, mat);
  this.mesh.frustumCulled = false;
  this.mesh.visible = false;
  view.scene.add(this.mesh);
  this.softMesh = new T.Mesh(softG, this.softMaterial);
  this.softMesh.frustumCulled = false;
  this.softMesh.visible = false;
  this.softMesh.renderOrder = 1;
  view.scene.add(this.softMesh);
  this.frustum = new T.Frustum();
  this.vp = new T.Matrix4();
  this.bounds = new T.Box3();
  this.tiles = new Map();
  this.visibleItems = [];
  this.lastSeed = undefined;
  this.lastSea = undefined;
  this.lastCamWorld = new T.Matrix4();
  this.lastCamProj = new T.Matrix4();
  this.camDir = new T.Vector3();
  this.dynamicGroups = new Map();
  this.settledEdits = new Map();
  this._lastSandVersion = 0;
 }

 configure() {
  this.tiles.clear();
  this.visibleItems = [];
  this.signature = undefined;
  this.lastSeed = undefined;
  this.lastSea = undefined;
  this.dynamicGroups.clear();
  this.settledEdits.clear();
  this._lastSandVersion = 0;
  this.mesh.geometry.instanceCount = 0;
  this.softMesh.geometry.instanceCount = 0;
  this.mesh.visible = false;
  this.softMesh.visible = false;
 }

 resetDisturbances() {
  for (const st of this.dynamicGroups.values()) {
   for (const o of st.origEllipsoids) {
    Object.assign(st.tile.ellipsoids[o.idx], o.vals);
   }
   for (const oi of st.origItems) {
    const it = st.tile.items[oi.idx];
    it.x = oi.x; it.y = oi.y; it.z = oi.z;
   }
  }
  this.dynamicGroups.clear();
  this.settledEdits.clear();
  this._lastSandVersion = 0;
  this.signature = undefined;
 }

 _activateGroup(tileKey, tile, g) {
  const key = tileKey + ':' + g.id;
  let st = this.dynamicGroups.get(key);
  if (st) return st;
  st = {
   key, tile, g,
   dx: 0, dy: 0, dz: 0,
   vx: 0, vy: 0, vz: 0,
   pitch: 0, roll: 0, vPitch: 0, vRoll: 0,
   sleeping: false,
   origEllipsoids: g.indices.map(idx => {
    const e = tile.ellipsoids[idx];
    return {idx, vals: {cx: e.cx, cy: e.cy, cz: e.cz, ax: e.ax, ay: e.ay, az: e.az, bx: e.bx, by: e.by, bz: e.bz, nx: e.nx, ny: e.ny, nz: e.nz}};
   }),
   origItems: g.itemIndices.map(idx => {
    const it = tile.items[idx];
    return {idx, x: it.x, y: it.y, z: it.z};
   }),
  };
  const settled = this.settledEdits.get(key);
  if (settled) {
   st.dx = settled.dx; st.dy = settled.dy; st.dz = settled.dz; st.pitch = settled.pitch; st.roll = settled.roll;
  }
  this.dynamicGroups.set(key, st);
  return st;
 }

 _applyGroupTransform(st) {
  const {g, dx, dy, dz, pitch, roll} = st;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const rot = (x, y, z) => {
   const y1 = y * cp - z * sp;
   const z1 = y * sp + z * cp;
   return [x * cr - y1 * sr, x * sr + y1 * cr, z1];
  };
  const pivX = g.x, pivY = g.baseH, pivZ = g.z;
  for (const o of st.origEllipsoids) {
   const v = o.vals, e = st.tile.ellipsoids[o.idx];
   const [rx, ry, rz] = rot(v.cx - pivX, v.cy - pivY, v.cz - pivZ);
   e.cx = pivX + dx + rx;
   e.cy = pivY + dy + ry;
   e.cz = pivZ + dz + rz;
   [e.ax, e.ay, e.az] = rot(v.ax, v.ay, v.az);
   [e.bx, e.by, e.bz] = rot(v.bx, v.by, v.bz);
   [e.nx, e.ny, e.nz] = rot(v.nx, v.ny, v.nz);
  }
  for (const oi of st.origItems) {
   const it = st.tile.items[oi.idx];
   const [rx, ry, rz] = rot(oi.x - pivX, oi.y - pivY, oi.z - pivZ);
   it.x = pivX + dx + rx;
   it.y = pivY + dy + ry;
   it.z = pivZ + dz + rz;
  }
 }

 disturb(ev, land, sandTerrain = null) {
  if (!ev || !land) return;
  if (this.lastSeed === undefined) {
   this.lastSeed = land.seed;
   this.lastSea = land.climate?.seaLevelOffset ?? 0;
  }
  const reach = ev.reach || 1.4;
  const rad = reach + 2.2;
  const tx0 = Math.floor((ev.point.x - rad) / REED_TILE), tx1 = Math.floor((ev.point.x + rad) / REED_TILE);
  const tz0 = Math.floor((ev.point.z - rad) / REED_TILE), tz1 = Math.floor((ev.point.z + rad) / REED_TILE);
  let touched = false;
  for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) {
   const key = tx + ',' + tz;
   let tile = this.tiles.get(key);
   if (!tile) { tile = coastalPropsForTile(land, tx, tz); this.tiles.set(key, tile); }
   for (const g of tile.groups || []) {
    if (g.fixed) continue;
    const dist = Math.hypot(g.x - ev.point.x, g.z - ev.point.z);
    if (dist > reach + g.r + 0.85) continue;
    const st = this._activateGroup(key, tile, g);
    st.sleeping = false;
    if (ev.kind === 'impulse') {
     const fall = Math.exp(-dist / Math.max(0.45, reach * 0.45));
     const spd = Math.min(4.8, Math.sqrt(Math.max(100, ev.force || 1500) / 1400) * 1.9 / Math.sqrt(Math.max(0.35, g.mass))) * fall;
     const nx = dist > 1e-4 ? (g.x - ev.point.x) / dist : 0;
     const nz = dist > 1e-4 ? (g.z - ev.point.z) / dist : 0;
     st.vx += nx * spd * 0.85;
     st.vy += Math.max(0.35, spd * 1.15);
     st.vz += nz * spd * 0.85;
     st.vRoll += -nx * spd * 1.4;
     st.vPitch += nz * spd * 1.4;
    }
    touched = true;
   }
  }
  if (touched) this.signature = undefined;
 }

 beginGrab(point,radius){
  this.endGrab();
  this.hand=[];
  for(const [key,tile] of this.tiles)for(const g of tile.groups??[]){
   if(g.fixed)continue;
   const current=this.dynamicGroups.get(key+':'+g.id);
   const center=new T.Vector3(g.x+(current?.dx??0),g.baseH+(current?.dy??0),g.z+(current?.dz??0));
   if(center.distanceTo(point)>radius+g.r)continue;
   const st=this._activateGroup(key,tile,g);st.sleeping=false;st.held=true;
   this.hand.push({st,offset:center.sub(point)});
  }
  return this.hand.length;
 }
 moveGrab(point){
  for(const {st,offset} of this.hand??[]){
   st.dx=point.x+offset.x-st.g.x;st.dy=point.y+offset.y-st.g.baseH;st.dz=point.z+offset.z-st.g.z;
   st.vx=st.vy=st.vz=0;this._applyGroupTransform(st);this.signature=undefined;
  }
 }
 endGrab(){
  for(const {st} of this.hand??[]){st.held=false;st.sleeping=false;}
  this.hand=null;
 }
 stepDynamic(dt, land, sandTerrain = null) {
  let anyMoved = false;
  const eStep = 0.24;
  for (const st of this.dynamicGroups.values()) {
   if (st.sleeping || st.held) continue;
   const {g} = st;
   st.vy -= 9.81 * dt;
   st.dx += st.vx * dt;
   st.dy += st.vy * dt;
   st.dz += st.vz * dt;
   st.pitch += st.vPitch * dt;
   st.roll += st.vRoll * dt;

   const wx = g.x + st.dx, wz = g.z + st.dz;
   const hAt = (qx, qz) => land.height(qx, qz) + (sandTerrain ? sandTerrain.offset(qx, qz) : 0);
   const groundNow = hAt(wx, wz);
   const floorDy = groundNow - g.baseH;
   const hx = (hAt(wx + eStep, wz) - hAt(wx - eStep, wz)) / (2 * eStep);
   const hz = (hAt(wx, wz + eStep) - hAt(wx, wz - eStep)) / (2 * eStep);
   const targetPitch = -Math.atan(hz);
   const targetRoll = Math.atan(hx);

   if (st.dy <= floorDy + 0.002) {
    st.dy = floorDy;
    st.vy = st.vy < -0.5 ? -st.vy * 0.18 : 0;
    const damp = Math.exp(-10 * dt);
    st.vx *= damp;
    st.vz *= damp;
    const slopeMag = Math.hypot(hx, hz);
    if (slopeMag > 0.34) {
     st.vx -= hx * 2.2 * dt;
     st.vz -= hz * 2.2 * dt;
    }
    const rotBlend = Math.min(1, dt * 10);
    st.pitch += (targetPitch - st.pitch) * rotBlend;
    st.roll += (targetRoll - st.roll) * rotBlend;
    st.vPitch *= Math.exp(-12 * dt);
    st.vRoll *= Math.exp(-12 * dt);
    if (st.vy === 0 && Math.hypot(st.vx, st.vz) < 0.025 && Math.abs(st.pitch - targetPitch) < 0.015 && Math.abs(st.roll - targetRoll) < 0.015) {
     st.pitch = targetPitch;
     st.roll = targetRoll;
     st.vx = 0; st.vz = 0; st.vPitch = 0; st.vRoll = 0;
     st.sleeping = true;
    }
   }
   this._applyGroupTransform(st);
   this.settledEdits.set(st.key, {dx: st.dx, dy: st.dy, dz: st.dz, pitch: st.pitch, roll: st.roll});
   anyMoved = true;
  }
  return anyMoved;
 }

 update(land, camera, dt = 0, sandTerrain = null) {
  if (!land) {this.mesh.visible = false; this.softMesh.visible = false; return;}
  const sea = land.climate?.seaLevelOffset ?? 0;
  if (land.seed !== this.lastSeed || sea !== this.lastSea) {
   this.tiles.clear();
   this.dynamicGroups.clear();
   this.settledEdits.clear();
   this._lastSandVersion = 0;
   this.signature = undefined;
   this.lastSeed = land.seed;
   this.lastSea = sea;
  }
  if (!sandTerrain && this.dynamicGroups.size > 0) {
   this.resetDisturbances();
  }
  if (sandTerrain && sandTerrain.version !== this._lastSandVersion) {
   this._lastSandVersion = sandTerrain.version;
   for (const [key, tile] of this.tiles.entries()) {
    for (const g of tile.groups || []) {
     if (g.fixed) continue;
     if (Math.abs(sandTerrain.offset(g.x, g.z)) > 0.010) {
      const st = this._activateGroup(key, tile, g);
      st.sleeping = false;
     }
    }
   }
   this.signature = undefined;
  }
  if (this.dynamicGroups.size > 0 && dt > 0) {
   if (this.stepDynamic(dt, land, sandTerrain)) {
    this.signature = undefined;
   }
  }
  camera.updateMatrixWorld();
  if (
   this.signature !== undefined &&
   camera.matrixWorld.equals(this.lastCamWorld) &&
   camera.projectionMatrix.equals(this.lastCamProj)
  ) {
   this.mesh.visible = this.mesh.geometry.instanceCount > 0;
   this.softMesh.visible = this.softMesh.geometry.instanceCount > 0;
   return;
  }

  const eye = camera.position;
  const ex = eye.x, ey = eye.y, ez = eye.z;
  const cx = Math.floor(ex / REED_TILE), cz = Math.floor(ez / REED_TILE);
  this.frustum.setFromProjectionMatrix(this.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const rad = Math.ceil((PROP_MAX_DIST + 4) / REED_TILE);
  const keep = [];
  if (ey < 140 && ey > -40) {
   for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) {
    const x = cx + i, z = cz + j;
    this.bounds.min.set(x * REED_TILE - 2, -4, z * REED_TILE - 2);
    this.bounds.max.set((x + 1) * REED_TILE + 2, 8, (z + 1) * REED_TILE + 2);
    if (this.bounds.distanceToPoint(eye) > PROP_MAX_DIST || !this.frustum.intersectsBox(this.bounds)) continue;
    const key = x + ',' + z;
    let tile = this.tiles.get(key);
    if (!tile) {
     tile = coastalPropsForTile(land, x, z);
     this.tiles.set(key, tile);
     for (const g of tile.groups || []) {
      if (g.fixed) continue;
      const gKey = key + ':' + g.id;
      if (this.settledEdits.has(gKey)) {
       const st = this._activateGroup(key, tile, g);
       this._applyGroupTransform(st);
       st.sleeping = !(sandTerrain?.version > 0 && Math.abs(sandTerrain.offset(g.x + st.dx, g.z + st.dz)) > 0.010);
      } else if (sandTerrain?.version > 0 && Math.abs(sandTerrain.offset(g.x, g.z)) > 0.010) {
       const st = this._activateGroup(key, tile, g);
       st.sleeping = false;
      }
     }
    }
    if (tile.ellipsoids.length || tile.items.length) keep.push({key, tile});
   }
  }
  camera.getWorldDirection(this.camDir);
  const dirQuant = [Math.round(this.camDir.x * 16), Math.round(this.camDir.y * 16), Math.round(this.camDir.z * 16)].join(',');
  const sig = [Math.floor(ex), Math.floor(ey), Math.floor(ez)].join(',') + '/' + dirQuant + '/' + keep.map(t => t.key).join('|') + '/' + sea + '/' + land.seed;
  if (sig === this.signature) {
   this.lastCamWorld.copy(camera.matrixWorld);
   this.lastCamProj.copy(camera.projectionMatrix);
   return;
  }
  this.signature = sig;
  this.lastCamWorld.copy(camera.matrixWorld);
  this.lastCamProj.copy(camera.projectionMatrix);

  for (const key of this.tiles.keys()) {
   const [x, z] = key.split(',').map(Number);
   if (Math.abs(cx - x) > rad || Math.abs(cz - z) > rad) {
    this.tiles.delete(key);
    const pref = key + ':';
    for (const dk of this.dynamicGroups.keys()) {
     if (dk.startsWith(pref)) this.dynamicGroups.delete(dk);
    }
   }
  }

  const planes = this.frustum.planes;
  const p0 = planes[0], p1 = planes[1], p2 = planes[2], p3 = planes[3], p4 = planes[4], p5 = planes[5];
  const n0x = p0.normal.x, n0y = p0.normal.y, n0z = p0.normal.z, c0 = p0.constant;
  const n1x = p1.normal.x, n1y = p1.normal.y, n1z = p1.normal.z, c1 = p1.constant;
  const n2x = p2.normal.x, n2y = p2.normal.y, n2z = p2.normal.z, c2 = p2.constant;
  const n3x = p3.normal.x, n3y = p3.normal.y, n3z = p3.normal.z, c3 = p3.constant;
  const n4x = p4.normal.x, n4y = p4.normal.y, n4z = p4.normal.z, c4 = p4.constant;
  const n5x = p5.normal.x, n5y = p5.normal.y, n5z = p5.normal.z, c5 = p5.constant;

  const rows = [];
  const softRows = [];
  const items = [];
  for (const {tile} of keep) {
   for (const e of tile.ellipsoids) {
    const dx = e.cx - ex, dy = e.cy - ey, dz = e.cz - ez;
    const lim = Math.abs(e.maxRange) + 2;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > lim * lim) continue;
    const pad = e.boundR + Math.max(1.5, Math.sqrt(d2) * 0.14);
    if (
     n0x * e.cx + n0y * e.cy + n0z * e.cz + c0 < -pad ||
     n1x * e.cx + n1y * e.cy + n1z * e.cz + c1 < -pad ||
     n2x * e.cx + n2y * e.cy + n2z * e.cz + c2 < -pad ||
     n3x * e.cx + n3y * e.cy + n3z * e.cz + c3 < -pad ||
     n4x * e.cx + n4y * e.cy + n4z * e.cz + c4 < -pad ||
     n5x * e.cx + n5y * e.cy + n5z * e.cz + c5 < -pad
    ) continue;
    if (e.maxRange < 0) softRows.push(e);
    else rows.push(e);
   }
   for (const it of tile.items) {
    if (Math.hypot(it.x - ex, it.z - ez) <= 55) items.push(it);
   }
  }
  this.visibleItems = items;
  uploadPropRows(this.mesh, rows);
  uploadPropRows(this.softMesh, softRows);
 }

 pick(ray, nearest) {
  const p = new T.Vector3(), q = new T.Vector3();
  for (const it of this.visibleItems) {
   p.set(it.x, it.y, it.z);
   if (ray.distanceSqToPoint(p) > it.r * it.r) continue;
   ray.closestPointToPoint(p, q);
   const dist = q.distanceTo(ray.origin);
   if (nearest && nearest.distance <= dist) continue;
   nearest = {point: q.clone(), normal: new T.Vector3(0, 1, 0), distance: dist, materialId: it.materialId, propLabel: it.label};
  }
  return nearest;
 }

  dispose() {
   this.mesh.removeFromParent();
   this.mesh.geometry.dispose();
   this.mesh.material.dispose();
   this.softMesh.removeFromParent();
   this.softMesh.geometry.dispose();
   this.softMaterial.dispose();
   this.shadowMaterial.dispose();
   this.tiles.clear();
  }

  drawShadows(renderer, shadowCamera) {
   if (!this.mesh.visible || !this.mesh.geometry.instanceCount) return;
   const orig = this.mesh.material;
   this.mesh.material = this.shadowMaterial;
   renderer.render(this.mesh, shadowCamera);
   this.mesh.material = orig;
  }
 }
