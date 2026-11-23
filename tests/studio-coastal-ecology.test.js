import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {Wetland, waterSurfaceHeight, isDrySandAt} from '../src/asset-studio/wetland.js';
import {DEFAULT_COASTAL_CLIMATE} from '../src/asset-studio/coastal-climate.js';
import {CoastalEcologySim, GUILD_KEYS, RESOURCE_KEYS} from '../src/asset-studio/coastal-ecology.js';
import {bedPatch, coastalPropsForTile, CoastalPropsView} from '../src/asset-studio/coastal-props.js';
import {buildSandPatchGeometry, WetlandView} from '../src/asset-studio/wetland-view.js';
import {groundSurface} from '../src/asset-studio/ground-surface.js';
import {GroundFinish, groundFinishShader} from '../src/asset-studio/ground-finish.js';
import {createImpactSandSpray, MatterView} from '../src/asset-studio/matter-view.js';
import {WindSand} from '../src/asset-studio/wind-sand.js';
import {SandDriftView} from '../src/asset-studio/sand-drift-view.js';
import {ReedStand} from '../src/asset-studio/reed-stand.js';
import {WetlandReeds} from '../src/asset-studio/wetland-reeds.js';
import {SandTerrain} from '../src/asset-studio/sand-terrain.js';
import {CELL} from '../src/asset-studio/ground-tools.js';
import {
 CoastalFaunaSim,
 FAUNA_SECTOR_M,
 FAUNA_SPECIES,
 MAX_FAUNA_ELLIPSOIDS,
 collectFaunaEllipsoids,
 worldAtShore,
} from '../src/asset-studio/coastal-fauna.js';
import {
 solveTwoLinkIK,
 createCrabRig,
 stepCrabIK,
 createBipedRig,
 stepBipedIK,
 createRayRig,
 stepRayUndulation,
 createFishSpine,
 solveFishSpine,
 solveLizardSpine,
 computePlacedMarkSwings,
} from '../src/asset-studio/coastal-kinematics.js';
import {stepCyberneticLoop, updateAgentAI} from '../src/asset-studio/coastal-ai.js';
import {computeCascadeMatrix} from '../src/asset-studio/coastal-shadows.js';
import {stepWASDCamera} from '../src/asset-studio/view.js';
import {exampleWorlds} from '../src/asset-studio/example-worlds.js';
import {validateLibrary, worldPartCount, transform} from '../src/asset-studio/model.js';
import {supportedMark} from '../src/asset-studio/gaussian-marks.js';

test('CoastalEcologySim converges cleanly, obeys Culicoides wind gate, prey-switches on wrack loss, and partitions day/night activity', () => {
 const a = new CoastalEcologySim();
 const b = new CoastalEcologySim();
 a.reset(2187);
 b.reset(2187);

 // 1500 eco-hour baseline run stays bounded inside self-balancing positive attractor
 for (let i = 0; i < 60; i++) {
  a.step(25, DEFAULT_COASTAL_CLIMATE, {speed: 4.5, heading: -145});
  b.step(25, DEFAULT_COASTAL_CLIMATE, {speed: 4.5, heading: -145});
 }
 assert.deepEqual(a.snapshot(), b.snapshot(), 'CoastalEcologySim integrates deterministically');
 for (const k of RESOURCE_KEYS) {
  assert.ok(Number.isFinite(a.resources[k]) && a.resources[k] > 0.08 && a.resources[k] < 3.5, `Resource ${k} converged cleanly (${a.resources[k]})`);
 }
 for (const k of GUILD_KEYS) {
  assert.ok(Number.isFinite(a.guilds[k]) && a.guilds[k] > 0.08 && a.guilds[k] < 3.5, `Guild ${k} converged cleanly (${a.guilds[k]})`);
 }

 // Extreme weather / sea-level forcing must remain bounded without NaN, explosion, or collapse
 const extremes = [
  [{...DEFAULT_COASTAL_CLIMATE, airTemperature: 37, relativeHumidity: 0.4, precipitation: 0.2}, {speed: 22, heading: 0}],
  [{...DEFAULT_COASTAL_CLIMATE, airTemperature: 8, relativeHumidity: 0.95, precipitation: 3.2, seaLevelOffset: 0.9}, {speed: 0.4, heading: 0}],
 ];
 for (const [clim, w] of extremes) {
  const sim = new CoastalEcologySim();
  sim.step(600, clim, w);
  for (const k of RESOURCE_KEYS) assert.ok(sim.resources[k] > 0.05 && sim.resources[k] < 4.5);
  for (const k of GUILD_KEYS) assert.ok(sim.guilds[k] > 0.05 && sim.guilds[k] < 4.5);
 }

 // Culicoides 2.5 m/s sheltered wind gate: calm dusk vs strong gale
 const duskCalm = {...DEFAULT_COASTAL_CLIMATE, solarHour: 18.8, relativeHumidity: 0.85};
 const actCalm = a.activity('sandGnats', duskCalm, {speed: 1.0});
 const actGale = a.activity('sandGnats', duskCalm, {speed: 14.0});
 assert.ok(actCalm > actGale * 2.5, `Sand gnats suppressed above 2.5 m/s sheltered wind (calm=${actCalm.toFixed(3)}, gale=${actGale.toFixed(3)})`);

 // Diurnal partitioning: ghost crabs & hoppers higher at dusk/night, fiddlers & dragonlets higher at sunny noon
 const noonClim = {...DEFAULT_COASTAL_CLIMATE, solarHour: 12.2, cloudCover: 0.05};
 const nightClim = {...DEFAULT_COASTAL_CLIMATE, solarHour: 22.0, cloudCover: 0.25};
 assert.ok(a.activity('ghostCrabs', nightClim) > a.activity('ghostCrabs', noonClim), 'Ghost crabs more active at night than harsh midday');
 assert.ok(a.activity('dragonlets', noonClim) > a.activity('dragonlets', nightClim), 'Seaside dragonlets hawking in warm sun vs night');
 assert.ok(a.activity('fiddlerCrabs', noonClim) > a.activity('fiddlerCrabs', nightClim), 'Fiddler crabs more active in midday sun');

 // Dugan/McLachlan wrack depletion: ghost crabs persist via mole-crab/swash prey switching rather than collapsing
 const wrackStarved = new CoastalEcologySim();
 wrackStarved.resources.wrack = 0.04;
 wrackStarved.step(120, {...DEFAULT_COASTAL_CLIMATE, seaLevelOffset: -0.2}, {speed: 0.5});
 assert.ok(wrackStarved.guilds.ghostCrabs > 0.25, 'Ghost crabs buffer wrack scarcity via swash mole crab prey switching');
});

test('CoastalFaunaSim spawns 25 biological morphotypes deterministically, prevents ground clipping, and limits gnat Gaussians', () => {
 const land = new Wetland(2187, DEFAULT_COASTAL_CLIMATE);
 const eco = new CoastalEcologySim();
 const wind = {speed: 3.5, x: -2.0, z: -2.0};
 const sea = {seaLevel: DEFAULT_COASTAL_CLIMATE.seaLevelOffset, height: () => DEFAULT_COASTAL_CLIMATE.seaLevelOffset};

 const simA = new CoastalFaunaSim(2187);
 const simB = new CoastalFaunaSim(2187);
 simA.spawn(land);
 simB.spawn(land);

 // Snapshot exact baseCounts right at spawn before dynamic feeding/mortality/recruitment
 const initialBySpecies = new Map();
 for (const a of simA.agents) {
  if (!initialBySpecies.has(a.speciesId)) initialBySpecies.set(a.speciesId, []);
  initialBySpecies.get(a.speciesId).push(a);
 }
 assert.equal(initialBySpecies.size, 25, 'All 25 coastal fauna morphotypes spawn');
 for (const meta of FAUNA_SPECIES) {
  const list = initialBySpecies.get(meta.id);
  assert.ok(list && list.length === meta.baseCount, `${meta.id} spawned expected count ${meta.baseCount}`);
  const maxSpanM = Math.max(...list.map(a => Math.max(a.len, a.width)));
  const minSpanM = Math.min(...list.map(a => Math.max(a.len, a.width)));
  assert.ok(minSpanM >= meta.scaleRangeCm[0] * 0.0085 && maxSpanM <= meta.scaleRangeCm[1] * 0.0115,
   `${meta.id} spans ${(minSpanM * 100).toFixed(2)}-${(maxSpanM * 100).toFixed(2)} cm vs target ${meta.scaleRangeCm.join('-')} cm`);
 }

 for (let i = 0; i < 120; i++) {
  simA.step(0.03, land, wind, sea, eco);
  simB.step(0.03, land, wind, sea, eco);
  if (i % 10 === 0) {
   for (const a of simA.agents) {
    if (a.alive === false || (a.visibility ?? 1) <= 0.05) continue;
    const gh = land.height(a.x, a.z);
    const nonBurrowing =
     a.speciesId === 'beach-hopper' ||
     ((a.speciesId === 'ghost-crab' || a.speciesId === 'fiddler-crab') && a.alertStage !== 3) ||
     a.speciesId === 'hermit-crab' ||
     a.speciesId === 'tiger-beetle' ||
     (a.speciesId === 'racerunner' && (a.visibility ?? 1) > 0.1) ||
     a.speciesId === 'marsh-periwinkle' ||
     (a.speciesId === 'coquina-clam' && !(a.burrowDepth > 0.002)) ||
     a.speciesId === 'sanderling' ||
     (a.speciesId === 'laughing-gull' && !a.airborne) ||
     a.speciesId === 'bay-scallop' ||
     a.speciesId === 'atlantic-stingray' ||
     a.speciesId === 'bonnethead-shark';
    if (nonBurrowing) {
     assert.ok(a.y >= gh + 0.004, `${a.speciesId} stays above terrain at step ${i} (y=${a.y.toFixed(4)}, gh=${gh.toFixed(4)})`);
    }
    if (a.crabRig && a.alertStage !== 3 && a.visibility > 0.1) {
     for (const l of a.crabRig.legs) {
      assert.ok(l.footY >= land.height(l.footX, l.footZ) - 0.001, `${a.speciesId} foot above terrain`);
      assert.ok(l.kneeY >= land.height(l.kneeX, l.kneeZ) - 0.001, `${a.speciesId} knee above terrain`);
     }
    }
    if (a.bipedRig && !a.airborne && a.visibility > 0.1) {
     for (const l of a.bipedRig.legs) {
      assert.ok(l.footY >= land.height(l.footX, l.footZ) - 0.001, `${a.speciesId} foot above terrain`);
      assert.ok(l.kneeY >= land.height(l.kneeX, l.kneeZ) - 0.001, `${a.speciesId} knee above terrain`);
     }
    }
   }
  }
 }
 assert.equal(simA.agents.length, simB.agents.length);
 for (let i = 0; i < simA.agents.length; i++) {
  assert.equal(simA.agents[i].x, simB.agents[i].x);
  assert.equal(simA.agents[i].y, simB.agents[i].y);
  assert.equal(simA.agents[i].z, simB.agents[i].z);
 }

 // Verify all 25 morphotypes remain represented and Florida Gulf trophic biomass pyramid holds
 const bySpecies = new Map();
 for (const a of simA.agents) {
  if (!bySpecies.has(a.speciesId)) bySpecies.set(a.speciesId, []);
  bySpecies.get(a.speciesId).push(a);
 }
 assert.equal(bySpecies.size, 25, 'All 25 coastal fauna morphotypes remain represented after stepping');

 const sumSpecies = ids => ids.reduce((s, id) => s + (bySpecies.get(id)?.length || 0), 0);
 const forageN = sumSpecies(['baitfish', 'sand-gnat', 'mole-crab', 'beach-hopper', 'fiddler-crab', 'kelp-fly', 'killifish', 'pinfish', 'coquina-clam', 'marsh-periwinkle', 'grass-shrimp', 'hermit-crab']);
 const consumerN = sumSpecies(['bay-scallop', 'ghost-crab', 'pompano', 'dragonlet', 'blue-crab', 'speckled-crab', 'tiger-beetle', 'racerunner']);
 const birdsN = sumSpecies(['sanderling', 'laughing-gull', 'royal-tern']);
 const sharksRaysN = sumSpecies(['atlantic-stingray', 'bonnethead-shark']);
 assert.ok(forageN > consumerN && consumerN > birdsN && birdsN > sharksRaysN, `Ecological biomass pyramid holds (${forageN} > ${consumerN} > ${birdsN} > ${sharksRaysN})`);
 assert.ok(sumSpecies(['baitfish']) >= 80 && sumSpecies(['mole-crab']) >= 60, 'Primary forage baitfish and mole crabs form dense populations');
 assert.ok(sumSpecies(['ghost-crab']) >= 12 && sumSpecies(['ghost-crab']) <= 72, 'Ghost crab abundance matches natural 5-30 per 100 m barrier shoreline band');
 assert.ok(sumSpecies(['bonnethead-shark']) <= 4 && sumSpecies(['atlantic-stingray']) <= 8, 'Elasmobranch top consumers stay sparse');
 const scallops = bySpecies.get('bay-scallop') || [];
 assert.ok(scallops.every(s => bedPatch(s.x + land.x, s.z + land.z) >= 0.31), 'Bay scallops settle on Gulf seagrass beds');

 // Strict aquatic boundary & swale pool checks
 const seaLevel = sea.seaLevel;
 for (const a of simA.agents) {
  const bed = land.height(a.x, a.z);
  if (['blue-crab', 'speckled-crab', 'bay-scallop', 'baitfish', 'pompano', 'pinfish', 'atlantic-stingray', 'bonnethead-shark', 'grass-shrimp'].includes(a.speciesId)) {
   assert.ok(a.y >= bed + 0.01 && a.y <= seaLevel - 0.065, `${a.speciesId} stays submerged (y=${a.y.toFixed(3)}, bed=${bed.toFixed(3)}, sea=${seaLevel.toFixed(3)})`);
   if (a.speciesId === 'baitfish') {
    assert.ok(land.shoreDistance(a.x, a.z) < -2.5, 'Baitfish schools remain strictly offshore');
   }
  }
  if (a.speciesId === 'killifish' && a.visibility > 0) {
   assert.ok(bed < seaLevel - 0.075, `Killifish stays inside submerged swale hollow (bed=${bed.toFixed(3)})`);
  }
  if (a.speciesId === 'fiddler-crab') {
   assert.ok(bed >= seaLevel, `Fiddler crab rests on exposed swale bank (bed=${bed.toFixed(3)})`);
  }
 }

 // Sand gnats render with strictly 1-2 Gaussians per visible gnat and zip actively
 const gnats = simA.agents.filter(a => a.speciesId === 'sand-gnat' && (a.visibility ?? 0) > 0.03);
 assert.ok(gnats.length >= 10 && gnats.some(g => g.speed > 0.2), 'Active sand gnats zip rapidly around mating swarms');
 const gnatEllClose = collectFaunaEllipsoids({agents: gnats, time: simA.time}, null, 68, []);
 const gnatEllFar = collectFaunaEllipsoids({agents: gnats, time: simA.time}, {x: 500, y: 150, z: 500}, 1500, []);
 assert.ok(gnatEllClose.length >= gnats.length && gnatEllClose.length <= gnats.length * 2, `Close sand gnats emit <= 2 Gaussians each (${gnatEllClose.length} for ${gnats.length})`);
 assert.ok(gnatEllFar.length === gnats.length, `Far sand gnats emit strictly 1 Gaussian each (${gnatEllFar.length} for ${gnats.length})`);

 // Mole crabs track tide shift (seaLevelOffset +0.55 shifts shoreline inland / negative shift relative to baseline)
 const baseMoles = simA.agents.filter(a => a.speciesId === 'mole-crab');
 const baseMoleD = baseMoles.reduce((s, a) => s + land.shoreDistance(a.x, a.z), 0) / baseMoles.length;
 const raisedLand = new Wetland(2187, {...DEFAULT_COASTAL_CLIMATE, seaLevelOffset: 0.55});
 const raisedSea = {seaLevel: 0.55, height: () => 0.55};
 const raisedSim = new CoastalFaunaSim(2187);
 raisedSim.spawn(raisedLand);
 for (let i = 0; i < 60; i++) raisedSim.step(0.05, raisedLand, wind, raisedSea, eco);
 const raisedMoles = raisedSim.agents.filter(a => a.speciesId === 'mole-crab');
 const raisedMoleD = raisedMoles.reduce((s, a) => s + raisedLand.shoreDistance(a.x, a.z), 0) / raisedMoles.length;
 assert.ok(raisedMoleD < baseMoleD - 1.5, `Mole crabs track shifted swash zone cleanly (${baseMoleD.toFixed(2)} -> ${raisedMoleD.toFixed(2)})`);

 // Beach hoppers leap when a ghost crab approaches closely
 const simLeap = new CoastalFaunaSim(2187);
 simLeap.spawn(land);
 const hopper = simLeap.agents.find(a => a.speciesId === 'beach-hopper');
 const ghost = simLeap.agents.find(a => a.speciesId === 'ghost-crab');
 hopper.airY = 0; hopper.vy = 0; hopper.jumpCooldown = 50; hopper.emerged = true;
 ghost.emerged = true; ghost.x = hopper.x + 0.35; ghost.z = hopper.z + 0.25;
 simLeap.step(0.02, land, wind, sea, eco);
 assert.ok(hopper.vy > 1.0 && hopper.state === 'leaping', 'Nearby ghost crab triggers evasive ballistic beach-hopper leap');

 // Ellipsoid collection stays finite, uses physical optical channels (no fake dark pancake or underwater soft splats), & fits budget
 const ell = collectFaunaEllipsoids(simA, null, 52, []);
 assert.ok(ell.length > 200 && ell.length <= MAX_FAUNA_ELLIPSOIDS, `Ellipsoids fit budget (${ell.length} <= ${MAX_FAUNA_ELLIPSOIDS})`);
 const fakePancakes = ell.filter(e => e.soft >= 0.7 && e.r < 0.06 && e.g < 0.06 && e.b < 0.06);
 assert.equal(fakePancakes.length, 0, 'Real cast shadows replace fake dark-pancake contact shadow ellipsoids');
 const underwaterSoft = ell.filter(e => e.underwater > 0 && e.soft >= 0.42);
 assert.equal(underwaterSoft.length, 0, 'Zero underwater soft splats prevent edge halo artifacts');
 for (const e of ell) {
  for (const v of [e.cx, e.cy, e.cz, e.ax, e.ay, e.az, e.sx, e.sy, e.sz, e.thirdRatio, e.r, e.g, e.b, e.density, e.soft, e.underwater, e.rough, e.metal, e.trans, e.bedClear]) {
   assert.ok(Number.isFinite(v), 'Fauna ellipsoid attributes remain finite');
  }
 }
});

test('all 25 coastal animal species register as valid, editable, drop-in Asset Studio assets coupled to wild fauna', () => {
 const garden = exampleWorlds.find(t => t.id === 'wetland');
 const lib = garden.create(null, 2187);
 validateLibrary(lib);
 assert.ok(worldPartCount(lib) <= 18, `Opening placements leave generous user drop budget (used ${worldPartCount(lib)} / 32)`);

 const faunaFam = lib.families.find(f => f.id === 'example-coastal-fauna');
 assert.ok(faunaFam && faunaFam.members.length === 25, 'Coastal fauna asset family contains all 25 animal species');
 const matMap = new Map(lib.materials.map(m => [m.id, m]));

 for (const meta of FAUNA_SPECIES) {
  const a = lib.assets.find(x => x.id === 'fauna-' + meta.id);
  assert.ok(a && a.fauna?.speciesId === meta.id, `Asset registered for ${meta.id}`);
  assert.ok(a.name.includes(meta.commonName), `Readable dropdown name for ${meta.commonName}`);
  assert.equal(a.parts.length, 1, `${meta.id} uses single-part sculpt budget for maximal user placements`);
  assert.ok(a.parts[0].stamps.length >= 2, `${meta.id} has multi-stamp SDF sculpture`);
  assert.ok(a.parts[0].marks.length >= 2, `${meta.id} has surface Gaussian details`);
  for (const mk of a.parts[0].marks) {
   assert.ok(supportedMark(a.parts[0], mk, matMap), `Mark ${mk.id} on ${meta.id} is surface-supported`);
  }
 }

 // Dropping a user ghost crab near wild beach hoppers triggers evasive leaps; dropping a pompano triggers baitfish panic
 const land = new Wetland(2187, DEFAULT_COASTAL_CLIMATE);
 const eco = new CoastalEcologySim();
 const sea = {seaLevel: DEFAULT_COASTAL_CLIMATE.seaLevelOffset, height: () => DEFAULT_COASTAL_CLIMATE.seaLevelOffset};
 const sim = new CoastalFaunaSim(2187);
 sim.spawn(land);
 const hopper = sim.agents.find(a => a.speciesId === 'beach-hopper');
 hopper.airY = 0; hopper.vy = 0; hopper.jumpCooldown = 50; hopper.emerged = true;
 const bait = sim.agents.find(a => a.speciesId === 'baitfish');
 bait.panicTimer = 0; bait.emerged = true;

 const tCrab = transform(); tCrab.position = [hopper.x + 0.3, hopper.y, hopper.z + 0.2]; tCrab.scale = [0.24, 0.24, 0.24];
 const tPomp = transform(); tPomp.position = [bait.x + 0.4, bait.y, bait.z + 0.3]; tPomp.scale = [0.46, 0.46, 0.46];
 lib.world.instances.push(
  {id: 'user-crab', assetId: 'fauna-ghost-crab', transform: tCrab},
  {id: 'user-pompano', assetId: 'fauna-pompano', transform: tPomp},
 );
 validateLibrary(lib);
 sim.syncPlaced(lib, land);
 assert.equal(sim.placedLinks.length, 2, 'User-dropped fauna register in simulation');
 sim.step(0.02, land, {speed: 3.0}, sea, eco);
 assert.ok(hopper.vy > 1.0 && hopper.state === 'leaping', 'User-placed ghost crab spooks nearby wild beach hoppers');
 assert.ok(bait.panicTimer > 0.5 && bait.state === 'evading', 'User-placed pompano triggers baitfish school flash-evasion');
});

test('two-link IK, Cruse/Barnes crab gait, Lighthill/C-start fish spines, and stimulus-response AI are accurate and camera-independent', () => {
 // 1. Analytical 2-link Law-of-Cosines IK accuracy, fixed limb lengths, pole orientation & safe clamping
 const L1 = 0.042, L2 = 0.058;
 const ik = solveTwoLinkIK(1, 2, 3, 1.055, 1.97, 3.035, L1, L2, 0, 1, 0.3, {});
 const d1 = Math.hypot(ik.kx - 1, ik.ky - 2, ik.kz - 3);
 const d2 = Math.hypot(ik.fx - ik.kx, ik.fy - ik.ky, ik.fz - ik.kz);
 const errT = Math.hypot(ik.fx - 1.055, ik.fy - 1.97, ik.fz - 3.035);
 assert.ok(Math.abs(d1 - L1) < 1e-6, `Upper segment exact L1 (${d1} vs ${L1})`);
 assert.ok(Math.abs(d2 - L2) < 1e-6, `Lower segment exact L2 (${d2} vs ${L2})`);
 assert.ok(errT < 1e-5, `Reachable end-effector reaches exact target (${errT})`);
 assert.ok(ik.ky > Math.max(2, 1.97), 'Arched crab knee bends upward toward pole vector');

 const ikClamp = solveTwoLinkIK(0, 0, 0, 10, 0, 0, L1, L2, 0, 1, 0, {});
 assert.ok(Math.hypot(ikClamp.fx, ikClamp.fy, ikClamp.fz) <= (L1 + L2) * 0.996, 'Over-extended target clamps smoothly inside workspace');

 // 2. Terrain-adapted crab gait: alternating tetrapod stance support (>= 4 feet on ground during walking)
 const land = new Wetland(2187, DEFAULT_COASTAL_CLIMATE);
 const sea = {seaLevel: DEFAULT_COASTAL_CLIMATE.seaLevelOffset, height: () => DEFAULT_COASTAL_CLIMATE.seaLevelOffset, flow: () => ({x: -0.3, y: 0, z: 0.1})};
 const eco = new CoastalEcologySim();
 const crabAgent = {
  id: 901,
  speciesId: 'ghost-crab',
  width: 0.048,
  len: 0.040,
  height: 0.024,
  x: 0,
  y: land.height(0, 0) + 0.012,
  z: 0,
  yaw: 0,
  phase: 0,
  pitch: 0,
  roll: 0,
 };
 createCrabRig(crabAgent, land);
 let minSupportWalk = 8;
 let swingEvents = 0;
 let prevSwingMask = 0;
 for (let step = 0; step < 90; step++) {
  crabAgent.x += 0.0045;
  crabAgent.z += 0.0020;
  crabAgent.y = land.height(crabAgent.x, crabAgent.z) + 0.012;
  stepCrabIK(crabAgent, 0.02, land, 0.225, 0.10, 0.246, false, 0, step * 0.02);
  minSupportWalk = Math.min(minSupportWalk, crabAgent.crabRig.supportCount);
  let mask = 0;
  for (let l = 0; l < 8; l++) {
   const leg = crabAgent.crabRig.legs[l];
   if (leg.inSwing) mask |= (1 << l);
   const limbErr1 = Math.abs(Math.hypot(leg.kneeX - leg.hipX, leg.kneeY - leg.hipY, leg.kneeZ - leg.hipZ) - leg.L1);
   const limbErr2 = Math.abs(Math.hypot(leg.footX - leg.kneeX, leg.footY - leg.kneeY, leg.footZ - leg.kneeZ) - leg.L2);
   assert.ok(limbErr1 < 1e-5 && limbErr2 < 1e-5, `Leg ${l} maintains rigid bone lengths during walking`);
  }
  if (mask !== prevSwingMask && mask !== 0) swingEvents++;
  prevSwingMask = mask;
 }
 assert.ok(minSupportWalk >= 4, `Cruse/Barnes crab walking keeps >= 4 stance feet on terrain (min=${minSupportWalk})`);
 assert.ok(swingEvents >= 4, `Ordered metachronal/tetrapod stepping progresses cleanly (events=${swingEvents})`);

 // 3. Lighthill carangiform wave (tail RMS amplitude > head RMS amplitude) & Domenici-Blake Mauthner C-start bend
 const fish = {id: 902, speciesId: 'pompano', len: 0.14, x: 0, y: -0.4, z: 0, yaw: 0, fishSpine: createFishSpine()};
 let maxHead = 0, maxTail = 0;
 for (let s = 0; s < 25; s++) {
  solveFishSpine(fish, 0.025, 0.55, 0, 0, 1, s * 0.025);
  maxHead = Math.max(maxHead, Math.abs(fish.fishSpine.nodes[0].offset));
  maxTail = Math.max(maxTail, Math.abs(fish.fishSpine.nodes[3].offset));
 }
 assert.ok(maxTail > maxHead * 2.5, `Carangiform tail beats stronger than head (head=${maxHead.toFixed(4)}, tail=${maxTail.toFixed(4)})`);
 solveFishSpine(fish, 0.04, 1.4, 2.0, 0.20, 1, 0.70);
 const midCBend = Math.max(Math.abs(fish.fishSpine.nodes[1].offset), Math.abs(fish.fishSpine.nodes[2].offset));
 assert.ok(midCBend > 0.008, `C-start flexes fish torso strongly (midCBend=${midCBend.toFixed(4)})`);

 // 4. Emergent stimulus-response AI: vibration scare -> freeze/home-run -> burrow recovery, plus baitfish splash C-start & colony alarm
 const simA = new CoastalFaunaSim(2187);
 const simB = new CoastalFaunaSim(2187);
 simA.spawn(land);
 simB.spawn(land);

 const ghost = simA.agents.find(a => a.speciesId === 'ghost-crab' && a.emerged);
 ghost.burrowX = ghost.x - 1.2; ghost.burrowZ = ghost.z; // place crab 1.2 m from burrow so home-run is measurable
 ghost.fear = 0; ghost.alertStage = 0;
 const dStart = Math.hypot(ghost.x - ghost.burrowX, ghost.z - ghost.burrowZ);
 simA.emitStimulus(ghost.x + 0.3, ghost.y, ghost.z + 0.2, 'vibration', 1.5, 4.5, 0, 0, 0, 1.2, 'test-tap');
 let sawFreezeOrSprint = false;
 let minBurrowDist = dStart;
 for (let i = 0; i < 120; i++) {
  simA.step(0.03, land, {speed: 2.5}, sea, eco);
  if (ghost.alertStage >= 1) sawFreezeOrSprint = true;
  minBurrowDist = Math.min(minBurrowDist, Math.hypot(ghost.x - ghost.burrowX, ghost.z - ghost.burrowZ));
 }
 assert.ok(sawFreezeOrSprint, 'Ghost crab reacts to sand vibration stimulus with Freeze -> Home-run escape');
 assert.ok(minBurrowDist < dStart - 0.35, `Ghost crab runs toward home burrow (${dStart.toFixed(2)} -> ${minBurrowDist.toFixed(2)})`);

 // Ydenberg & Dill (1986) FID: hungry ghost crab endures mild threshold longer than satiated ghost crab
 const satiatedGhost = simB.agents.find(a => a.speciesId === 'ghost-crab' && a.emerged);
 const hungryGhost = simB.agents.filter(a => a.speciesId === 'ghost-crab' && a.emerged)[1];
 satiatedGhost.energy = 0.98; satiatedGhost.hunger = 0.02; satiatedGhost.fear = 0.40; satiatedGhost.alertStage = 0; satiatedGhost.burrowX = satiatedGhost.x; satiatedGhost.burrowZ = satiatedGhost.z;
 hungryGhost.energy = 0.05; hungryGhost.hunger = 0.95; hungryGhost.fear = 0.40; hungryGhost.alertStage = 0; hungryGhost.burrowX = hungryGhost.x; hungryGhost.burrowZ = hungryGhost.z;
 simB.step(0.02, land, {speed: 2.5}, sea, eco);
 assert.ok(satiatedGhost.alertStage >= 1 && hungryGhost.alertStage === 0, 'Hungry ghost crab tolerates mild threat where satiated crab initiates freeze');

 // Baitfish water splash triggers immediate Mauthner C-start & evasion
 const bait = simA.agents.find(a => a.speciesId === 'baitfish' && a.emerged);
 bait.panicTimer = 0; bait.cStartTimer = 0;
 simA.emitStimulus(bait.x + 0.4, bait.y, bait.z + 0.3, 'splash', 1.4, 5.0, -0.5, 0, -0.4, 0.9, 'test-splash');
 simA.step(0.03, land, {speed: 2.5}, sea, eco);
 assert.ok(bait.cStartTimer > 0 && bait.state === 'evading', 'Water splash triggers baitfish Mauthner C-start escape');

 // Fiddler colony alarm wave propagates fear to neighbor
 const fiddlers = simA.agents.filter(a => a.speciesId === 'fiddler-crab' && a.emerged);
 fiddlers[0].fear = 0.9; fiddlers[0].alertStage = 1; fiddlers[0].alertTimer = 0.01;
 fiddlers[1].x = fiddlers[0].x + 0.55; fiddlers[1].z = fiddlers[0].z + 0.25; fiddlers[1].fear = 0;
 simA.step(0.03, land, {speed: 2.5}, sea, eco);
 simA.step(0.03, land, {speed: 2.5}, sea, eco);
 assert.ok(fiddlers[1].fear > 0.2, `Fiddler alarm contagion raises neighbor fear (${fiddlers[1].fear.toFixed(3)})`);

 // Placed user ghost crab runs autonomously, computes non-zero mark swings & strictly stays camera-independent
 const lib = exampleWorlds.find(t => t.id === 'wetland').create(null, 2187);
 const tUser = transform(); tUser.position = [ghost.x + 1.5, land.height(ghost.x + 1.5, ghost.z), ghost.z]; tUser.scale = [0.24, 0.24, 0.24];
 lib.world.instances.push({id: 'user-ik-crab', assetId: 'fauna-ghost-crab', transform: tUser});
 simB.syncPlaced(lib, land);
 const simB2 = new CoastalFaunaSim(2187);
 simB2.spawn(land);
 simB2.syncPlaced(lib, land);
 simB.emitStimulus(tUser.position[0] - 0.4, tUser.position[1], tUser.position[2], 'vibration', 1.4, 4.0, 0, 0, 0, 1.0, 'user-tap');
 simB2.emitStimulus(tUser.position[0] - 0.4, tUser.position[1], tUser.position[2], 'vibration', 1.4, 4.0, 0, 0, 0, 1.0, 'user-tap');
 for (let i = 0; i < 25; i++) {
  simB.step(0.03, land, {speed: 2.5}, sea, eco);
  simB2.step(0.03, land, {speed: 2.5}, sea, eco);
  collectFaunaEllipsoids(simB, {x: 800, y: 200, z: -400}, 52, []);
  collectFaunaEllipsoids(simB2, null, 52, []);
 }
 const pl1 = simB.placedLinks[0], pl2 = simB2.placedLinks[0];
 assert.equal(pl1.x, pl2.x, 'Simulation remains strictly camera-independent across far/null cameras');
 assert.equal(pl1.y, pl2.y, 'IK body height remains strictly camera-independent');
 assert.ok(pl1.crabRig && pl1.fear > 0.25, 'Placed user crab maintains active IK rig and stimulus response');
 const swings = computePlacedMarkSwings(pl1, pl1.speed, simB.time);
 assert.ok(Object.keys(swings).some(k => k.startsWith('leg-') && Number.isFinite(swings[k])), 'computePlacedMarkSwings generates live leg swing angles');
});

test('ethology cybernetic loops, avian bipedal IK, new marine/shorebird fauna, and WASD controls work cleanly', () => {
 const land = new Wetland(2187, DEFAULT_COASTAL_CLIMATE);
 const sea = {seaLevel: DEFAULT_COASTAL_CLIMATE.seaLevelOffset, height: () => DEFAULT_COASTAL_CLIMATE.seaLevelOffset, flow: () => ({x: -0.2, y: 0, z: 0.05})};
 const eco = new CoastalEcologySim();

 // 1. Powers PCT / McFarland-Houston hysteresis / Tinbergen-Lorenz refractory cycle
 const cAgent = {energy: 0.20, fatigue: 0.05, fear: 0, patchRichness: 0.85};
 const c1 = stepCyberneticLoop(cAgent, 0.05, {threat: 0, satiation: 0.20, fatigue: 0.05}, {hysteresis: 0.14});
 assert.equal(c1.activeDrive, 'forage', 'Hungry safe agent commits to foraging');

 // Urgent safety error bypasses hysteresis immediately
 const c2 = stepCyberneticLoop(cAgent, 0.05, {threat: 0.72, satiation: 0.20, fatigue: 0.05}, {hysteresis: 0.14});
 assert.equal(c2.activeDrive, 'escape', 'Sudden safety error drives immediate escape switch');

 // Hysteresis prevents chatter when safe again and rest marginally leads explore
 const calm = {energy: 0.55, fatigue: 0.18, fear: 0, cyber: {activeDrive: 'forage', errSafe: 0, errSat: 0, errRest: 0, refracForage: 0, refracEscape: 0, refracRest: 0, commitTime: 0}};
 const stay = stepCyberneticLoop(calm, 0.05, {threat: 0, satiation: 0.62, fatigue: 0.22}, {hysteresis: 0.25});
 assert.equal(stay.activeDrive, 'forage', 'Hysteresis holds current motivational state against sub-threshold rivalry');

 // Reaching satiation and losing forage priority sets Lorenz post-consummatory refractory
 const fed = {energy: 0.90, fatigue: 0.65, fear: 0, cyber: {activeDrive: 'forage', errSafe: 0, errSat: 0, errRest: 0, refracForage: 0, refracEscape: 0, refracRest: 0, commitTime: 0}};
 const afterFed = stepCyberneticLoop(fed, 0.05, {threat: 0, satiation: 0.90, fatigue: 0.65}, {hysteresis: 0.12});
 assert.equal(afterFed.activeDrive, 'rest', 'Fatigued satiated animal transitions to rest');
 assert.ok(afterFed.refracForage > 0, 'Completing consummatory feeding initiates Lorenz post-consummatory refractory damping');

 // 2. Avian bipedal IK bone integrity, non-clipping terrain clamp, & flight tuck
 const bird = {id: 950, speciesId: 'sanderling', width: 0.055, height: 0.06, x: 2, y: land.height(2, 0) + 0.075, z: 0, yaw: 0, phase: 0, state: 'scuttling'};
 createBipedRig(bird, land);
 let minSup = 2;
 for (let i = 0; i < 40; i++) {
  bird.x += 0.015;
  bird.y = land.height(bird.x, bird.z) + bird.bipedRig.legH + 0.028;
  stepBipedIK(bird, 0.025, land, 0.60, 0, 0.60, false, false, i * 0.025);
  minSup = Math.min(minSup, bird.bipedRig.supportCount);
  for (const leg of bird.bipedRig.legs) {
   const d1 = Math.hypot(leg.kneeX - leg.hipX, leg.kneeY - leg.hipY, leg.kneeZ - leg.hipZ);
   const d2 = Math.hypot(leg.footX - leg.kneeX, leg.footY - leg.kneeY, leg.footZ - leg.kneeZ);
   assert.ok(Math.abs(d1 - leg.L1) < 1e-5 && Math.abs(d2 - leg.L2) < 1e-5, 'Avian IK preserves exact tarsus/tibiotarsus lengths');
   assert.ok(leg.footY >= land.height(leg.footX, leg.footZ) - 0.001, 'Grounded bird foot never clips below terrain');
   assert.ok(leg.kneeY >= land.height(leg.kneeX, leg.kneeZ) - 0.001, 'Grounded bird knee stays above terrain');
  }
 }
 assert.ok(minSup >= 1, `Running bird keeps >= 1 support foot grounded (min=${minSup})`);
 stepBipedIK(bird, 0.025, land, 4.0, 0, 4.0, true, false, 1.25);
 assert.equal(bird.bipedRig.supportCount, 0, 'Airborne bird enters 0-support tucked flight stance');
 assert.ok(Math.abs(bird.bipedRig.wingFlap) > 0.01, 'Airborne bird generates continuous wingbeat');

 // 3. New coastal/marine species mechanics
 const sim = new CoastalFaunaSim(2187);
 sim.spawn(land);
 const scallop = sim.agents.find(a => a.speciesId === 'bay-scallop' && a.emerged);
 scallop.fear = 0; scallop.jetCooldown = 0; scallop.fatigue = 0;
 sim.emitStimulus(scallop.x + 0.3, scallop.y, scallop.z, 'splash', 1.4, 3.0, 0, 0, 0, 0.8, 'crab-tap');
 sim.step(0.03, land, {speed: 2.5}, sea, eco);
 assert.equal(scallop.state, 'jet-swimming', 'Bay scallop initiates Cheng & DeMont valve-clap jet propulsion on threat');
 assert.ok(scallop.valveGape > 0.16, `Scallop claps valves dynamically while jetting (${scallop.valveGape.toFixed(3)})`);

 const sandpiper = sim.agents.find(a => a.speciesId === 'sanderling' && a.emerged);
 sandpiper.airborne = false; sandpiper.fear = 0;
 sim.emitStimulus(sandpiper.x + 0.3, sandpiper.y, sandpiper.z + 0.2, 'vibration', 1.8, 4.5, 0, 0, 0, 1.0, 'flush-tap');
 for (let i = 0; i < 6; i++) sim.step(0.03, land, {speed: 2.5}, sea, eco);
 assert.ok(sandpiper.airborne && sandpiper.y > land.height(sandpiper.x, sandpiper.z) + 0.15, 'Sanderling flushes airborne on strong threat');

 const stingray = sim.agents.find(a => a.speciesId === 'atlantic-stingray' && a.emerged);
 stepRayUndulation(stingray, 0.04, 0.55, land);
 assert.ok(stingray.rayRig.left.every(n => Number.isFinite(n.y) && n.y > land.height(n.x, n.z)), 'Atlantic stingray pectoral fin wave stays above seabed');

 const shark = sim.agents.find(a => a.speciesId === 'bonnethead-shark' && a.emerged);
 for (let i = 0; i < 20; i++) sim.step(0.03, land, {speed: 2.5}, sea, eco);
 assert.ok(shark.speed >= 0.45 && shark.y < sea.seaLevel - 0.12 && shark.y > land.height(shark.x, shark.z) + 0.05, `Bonnethead shark sustains obligate ram swimming underwater (spd=${shark.speed.toFixed(2)})`);

 const tern = sim.agents.find(a => a.speciesId === 'royal-tern' && a.emerged);
 tern.divePhase = 'diving';
 tern.diveTargetX = tern.x; tern.diveTargetZ = tern.z;
 tern.y = sea.seaLevel + 0.18;
 sim.stimuli.clear();
 sim.step(0.03, land, {speed: 2.5}, sea, eco);
 assert.ok(sim.stimuli.slots.some(s => s.active && s.kind === 'splash' && s.sourceId === tern.id), 'Plunge-diving Royal Tern emits water splash stimulus');

 // 4. Asset Studio WASD + Q/E + Shift flight controls & World terrain floor non-clipping
 const camA = {x: 0, y: 4, z: 10}, tgtA = {x: 0, y: 4, z: 0};
 const camB = {x: 0, y: 4, z: 10}, tgtB = {x: 0, y: 4, z: 0};
 stepWASDCamera(camA, tgtA, new Set(['KeyW']), 0.05, {mode: 'world', land});
 stepWASDCamera(camB, tgtB, new Set(['KeyW', 'ShiftLeft']), 0.05, {mode: 'world', land});
 const dNormal = 10 - camA.z;
 const dFast = 10 - camB.z;
 assert.ok(dNormal > 0.2 && Math.abs(dFast / dNormal - 2.8) < 1e-4 && tgtA.z < 0, 'W moves camera & target forward and Shift boosts 2.8x');

 const lowCam = {x: 0, y: land.height(0, 0) + 0.20, z: 0}, lowTgt = {x: 0, y: 0, z: -5};
 stepWASDCamera(lowCam, lowTgt, new Set(['KeyQ']), 0.1, {mode: 'world', land});
 assert.ok(lowCam.y >= land.height(lowCam.x, lowCam.z) + 0.159, 'WASD Q-descent clamps cleanly above terrain in World mode');
});

test('world-wide sector streaming generates habitat-accurate fauna everywhere and ethology budgets reflect resting, nesting, and hiding', () => {
 const land = new Wetland(2187, DEFAULT_COASTAL_CLIMATE);
 const sea = {seaLevel: DEFAULT_COASTAL_CLIMATE.seaLevelOffset, height: () => DEFAULT_COASTAL_CLIMATE.seaLevelOffset, flow: () => ({x: -0.25, y: 0, z: 0.05})};
 const eco = new CoastalEcologySim();
 const wind = {speed: 4.5, x: -3.2, z: -2.0};
 const upwindYaw = Math.atan2(-wind.z, -wind.x);

 // 1. Far positive & negative coastline sectors (+576 m & -720 m) and back-barrier Bay estuary
 const simPos = new CoastalFaunaSim(2187);
 simPos.land = land;
 assert.ok(simPos.spawnSector(12, land, 'gulf'), 'Sector +12 spawns deterministically');
 assert.ok(simPos.agents.length > 100, 'Distant positive coastal sector populates richly');
 for (const a of simPos.agents) {
  const gh = land.height(a.x, a.z);
  const nonBurrow = a.speciesId !== 'mole-crab' && (a.speciesId !== 'coquina-clam' || !(a.burrowDepth > 0.002)) && (a.speciesId !== 'ghost-crab' && a.speciesId !== 'fiddler-crab' || a.alertStage !== 3);
  if (nonBurrow) assert.ok(a.y >= gh + 0.004, `Sector +12 ${a.speciesId} stays above terrain`);
 }

 const simNeg = new CoastalFaunaSim(2187);
 simNeg.land = land;
 assert.ok(simNeg.spawnSector(-15, land, 'gulf'), 'Sector -15 spawns deterministically');
 assert.ok(simNeg.agents.length > 100, 'Distant negative coastal sector populates richly');

 const simBay = new CoastalFaunaSim(2187);
 simBay.land = land;
 assert.ok(simBay.spawnSector(2, land, 'bay'), 'Back-barrier St. Andrew Bay sector spawns deterministically');
 assert.ok(simBay.agents.some(a => a.band === 'bay' && land.shoreDistance(a.x, a.z) > 220), 'Bay estuary fauna populate sheltered back-barrier habitat');

 // 2. Unbounded camera-driven sector streaming + eviction preserves placedLinks & read-only rendering
 const streamSim = new CoastalFaunaSim(2187);
 streamSim.spawn(land);
 const lib = exampleWorlds.find(t => t.id === 'wetland').create(null, 2187);
 const tDrop = transform(); tDrop.position = [1, land.height(1, 0), 0]; tDrop.scale = [0.24, 0.24, 0.24];
 lib.world.instances.push({id: 'keep-me-crab', assetId: 'fauna-ghost-crab', transform: tDrop});
 streamSim.syncPlaced(lib, land);
 assert.ok(streamSim.loadedSectors.has('gulf:0') && streamSim.loadedSectors.has('gulf:-2'));

 const [farX, farZ] = worldAtShore(land, 4, 12.4 * FAUNA_SECTOR_M);
 const loadedBefore = new Set(streamSim.loadedSectors);
 collectFaunaEllipsoids(streamSim, {x: farX, y: 3, z: farZ}, 68, []);
 assert.deepEqual(streamSim.loadedSectors, loadedBefore, 'collectFaunaEllipsoids remains strictly read-only');

 assert.ok(streamSim.ensureSectorsAround(farX, farZ, land), 'Moving far along coast streams new sectors');
 assert.ok(streamSim.loadedSectors.has('gulf:12') && streamSim.loadedSectors.has('gulf:14'), 'Streamed window covers sectors [10..14]');
 assert.ok(!streamSim.loadedSectors.has('gulf:-2'), 'Distant behind sectors are cleanly evicted');
 assert.equal(streamSim.placedLinks.length, 1, 'Streaming eviction preserves user-placed animals');

 // 3. Authentic stingray cryptic resting/burial + reaction + shelter recovery
 const sEth = new CoastalFaunaSim(2187);
 sEth.spawn(land);
 for (let i = 0; i < 40; i++) sEth.step(0.03, land, wind, sea, eco);
 const rays = sEth.agents.filter(a => a.speciesId === 'atlantic-stingray');
 const buriedCount = rays.filter(r => r.state === 'buried-resting' && r.speed < 0.02).length;
 assert.ok(buriedCount >= Math.ceil(rays.length * 0.5), `Majority of calm stingrays rest cryptically motionless on sand (${buriedCount}/${rays.length})`);
 const testRay = rays.find(r => r.state === 'buried-resting') || rays[0];
 sEth.emitStimulus(testRay.x + 0.3, testRay.y, testRay.z, 'splash', 1.6, 4.0, 0, 0, 0, 1.0, 'pred-shark');
 sEth.step(0.03, land, wind, sea, eco);
 assert.equal(testRay.state, 'evading', 'Resting stingray erupts off seabed when threatened');

 // 4. Laughing Gull incubation / windward loafing when full vs leaving to forage when hungry
 const gull = sEth.agents.find(a => a.speciesId === 'laughing-gull');
 gull.emerged = true;
 gull.hasNest = true;
 gull.airborne = false;
 gull.fear = 0;
 gull.energy = 0.94;
 gull.fatigue = 0.45;
 gull.cyber.activeDrive = 'rest';
 gull.x = gull.nestX; gull.z = gull.nestZ;
 for (let i = 0; i < 20; i++) sEth.step(0.04, land, wind, sea, eco);
 assert.equal(gull.state, 'incubating', 'Satiated breeding laughing gull sits calmly incubating nest scrape');
 assert.ok(gull.tucked === true && gull.speed === 0 && gull.y > land.height(gull.x, gull.z), 'Incubating gull tucks legs above terrain');
 assert.ok(Math.cos(gull.yaw - upwindYaw) > 0.70, 'Resting gull faces into prevailing wind');

 gull.energy = 0.14; gull.hunger = 0.86; gull.tucked = false;
 gull.cyber.refracRest = 0; gull.cyber.refracForage = 0;
 for (let i = 0; i < 25; i++) sEth.step(0.04, land, wind, sea, eco);
 assert.ok(gull.state === 'scavenging' || gull.state === 'soaring' || gull.state === 'landing', `Hungry gull leaves nest to forage (state=${gull.state})`);

 // 5. Royal Tern & Sanderling windward roosting when satiated
 const rTern = sEth.agents.find(a => a.speciesId === 'royal-tern');
 rTern.emerged = true; rTern.divePhase = 'patrol'; rTern.fear = 0;
 rTern.energy = 0.94; rTern.fatigue = 0.45; rTern.cyber.activeDrive = 'rest';
 rTern.x = rTern.roostX; rTern.z = rTern.roostZ;
 for (let i = 0; i < 15; i++) sEth.step(0.04, land, wind, sea, eco);
 assert.ok(rTern.state === 'roosting' && !rTern.airborne && rTern.speed === 0, 'Full Royal Tern rests windward in dry foreshore roost');

 const sandp = sEth.agents.find(a => a.speciesId === 'sanderling');
 sandp.emerged = true; sandp.airborne = false; sandp.fear = 0;
 sandp.energy = 0.94; sandp.fatigue = 0.45; sandp.cyber.activeDrive = 'rest';
 sandp.x = sandp.roostX; sandp.z = sandp.roostZ;
 for (let i = 0; i < 15; i++) sEth.step(0.04, land, wind, sea, eco);
 assert.ok(sandp.state === 'roosting' && sandp.speed === 0, 'Full Sanderling rests cleanly on upper berm');

 // 6. Dragonlets spend majority motionless perched & scallop anaerobic fatigue limits consecutive jumps
 const drags = sEth.agents.filter(a => a.speciesId === 'dragonlet');
 const perchedCount = drags.filter(d => d.state === 'perched' && d.speed < 0.02).length;
 assert.ok(perchedCount >= Math.floor(drags.length * 0.55), `Sit-and-wait dragonlets perch motionless cleanly (${perchedCount}/${drags.length})`);

 const scal = sEth.agents.find(a => a.speciesId === 'bay-scallop' && a.emerged);
 scal.fatigue = 0.85; scal.jetTimer = 0; scal.jetCooldown = 0;
 sEth.emitStimulus(scal.x + 0.2, scal.y, scal.z, 'splash', 1.5, 3.0, 0, 0, 0, 0.8, 'crab-tap-tired');
 sEth.step(0.03, land, wind, sea, eco);
 assert.equal(scal.state, 'filter-feeding', 'Exhausted bay scallop stays shell-clamped after anaerobic bursts');

 // 7. Shadow cascade orthonormality + texel snapping + new fauna articulation/pitch/roll dynamics
 const casA = computeCascadeMatrix(3.2, 0.4, -1.7, {x: -0.6, y: 0.9, z: 0.45}, 7.5, 1024);
 assert.ok(Math.abs(Math.hypot(casA.right.x, casA.right.y, casA.right.z) - 1) < 1e-6, 'Shadow cascade right axis normalized');
 assert.ok(Math.abs(casA.right.x * casA.up.x + casA.right.y * casA.up.y + casA.right.z * casA.up.z) < 1e-6, 'Shadow cascade basis orthogonal');
 const casB = computeCascadeMatrix(
  3.2 + casA.right.x * casA.texelSize * 0.2,
  0.4 + casA.right.y * casA.texelSize * 0.2,
  -1.7 + casA.right.z * casA.texelSize * 0.2,
  {x: -0.6, y: 0.9, z: 0.45},
  7.5,
  1024
 );
 assert.ok(Math.hypot(casA.snappedCenter.x - casB.snappedCenter.x, casA.snappedCenter.z - casB.snappedCenter.z) < 1e-6, 'Shadow cascade snaps sub-texel shifts to prevent shimmer');

 const rayRig = createRayRig();
 assert.equal(rayRig.left.length, 5, 'Stingray rig uses 5 pectoral undulation stations');
 const flyGull = {id: 991, speciesId: 'laughing-gull', width: 0.14, height: 0.11, x: 0, y: 4, z: 0, yaw: 0, phase: 0.2};
 createBipedRig(flyGull, land);
 stepBipedIK(flyGull, 0.02, land, 4.0, 0, 4.0, true, false, 0.31);
 assert.ok(Number.isFinite(flyGull.bipedRig.wingOuterFlap) && Math.abs(flyGull.bipedRig.wingOuterFlap - flyGull.bipedRig.wingFlap) > 1e-3, 'Biped rig computes phase-lagged outer wing flap');

 const fidCrab = {id: 992, speciesId: 'fiddler-crab', sex: 'M', clawRight: true, state: 'waving', width: 0.024, len: 0.018, height: 0.014, x: 0, y: land.height(0, 0) + 0.012, z: 0, yaw: 0, phase: 0};
 createCrabRig(fidCrab, land);
 stepCrabIK(fidCrab, 0.02, land, 0, 0, 0, false, 0, 0.35);
 assert.ok(fidCrab.crabRig.claws.some(c => (c.open || 0) > 0.2), 'Waving fiddler crab opens major claw articulated dactyl');

 const mole = sEth.agents.find(a => a.speciesId === 'mole-crab' && a.emerged);
 mole.fear = 0.9;
 for (let i = 0; i < 12; i++) sEth.step(0.03, land, wind, sea, eco);
 assert.ok(mole.state === 'burrowing' && mole.pitch > 0.1, `Burrowing mole crab pitches tail-first (${mole.pitch?.toFixed(3)})`);

 const hop = sEth.agents.find(a => a.speciesId === 'beach-hopper' && a.emerged);
 hop.airY = 0.02; hop.vy = 1.4; hop.vx = 0.7; hop.vz = 0; hop.speed = 0.7;
 sEth.step(0.02, land, wind, sea, eco);
 assert.ok(Math.abs(hop.airPitch || 0) > 0.05, `Jumping beach hopper pitches along ballistic arc (${hop.airPitch?.toFixed(3)})`);

 const shark = sEth.agents.find(a => a.speciesId === 'bonnethead-shark' && a.emerged);
 sEth.step(0.03, land, wind, sea, eco);
 assert.ok(Number.isFinite(shark.headSweep), 'Bonnethead shark updates lateral electroreceptive headSweep');
});

test('Fauna wing/fin mirror symmetry, opaque underwater rendering, Shell Island Beach rename, gull dune clearance, SandEditPatch parity & prop/plant disturbance coupling', () => {
 // 1. World preset renamed to Shell Island Beach while preserving stable id='wetland'
 const gardenWorld = exampleWorlds.find(w => w.id === 'wetland');
 assert.ok(gardenWorld, 'Wetland preset id preserved');
 assert.equal(gardenWorld.name, 'Shell Island Beach', 'Preset renamed to Shell Island Beach');
 assert.ok(exampleWorlds.every(w => !/wind garden/i.test(w.name)), 'No world preset retains old Wind garden name');
 const lib = gardenWorld.create(null, 2187);

 // 2. Wing & pectoral fin mirror symmetry across gull, tern, sanderling, dragonlet, and stingray
 const checkWingSym = (speciesId, agentExtras = {}) => {
  const yaw = 0.63;
  const fx = Math.cos(yaw), fz = Math.sin(yaw);
  const lx = -fz, lz = fx;
  const a = {
   id: 500 + speciesId.length,
   speciesId,
   guild: 'seabirds',
   emerged: true,
   visibility: 1,
   x: 0, y: 3, z: 0, yaw,
   len: 0.42, width: 0.14, height: 0.11,
   wingSpan: 1.15,
   color: [0.58, 0.59, 0.60], accent: [0.96, 0.96, 0.94],
   airborne: true, roll: 0, pitch: 0, phase: 0.4,
   ...agentExtras,
  };
  const out = collectFaunaEllipsoids({agents: [a], time: 0.5}, null, 68, []);
  const left = [], right = [];
  const latThresh = Math.max(0.004, (a.width || 0.04) * 0.55);
  for (const e of out) {
   const lat = (e.cx - a.x) * lx + (e.cz - a.z) * lz;
   if (lat < -latThresh) left.push(e);
   else if (lat > latThresh) right.push(e);
  }
  assert.ok(left.length >= 2 && left.length === right.length, `${speciesId} emits matched left/right wing segments (${left.length} vs ${right.length})`);
  // Match pairs by forward station dot(offset, fx) and verify mirror cy & outward ay match cleanly
  left.sort((p, q) => ((p.cx - a.x) * fx + (p.cz - a.z) * fz) - ((q.cx - a.x) * fx + (q.cz - a.z) * fz));
  right.sort((p, q) => ((p.cx - a.x) * fx + (p.cz - a.z) * fz) - ((q.cx - a.x) * fx + (q.cz - a.z) * fz));
  for (let i = 0; i < left.length; i++) {
   const l = left[i], r = right[i];
   assert.ok(Math.abs(l.cy - r.cy) < 1e-5, `${speciesId} segment ${i} left/right vertical position matches (${l.cy.toFixed(4)} vs ${r.cy.toFixed(4)})`);
   // Sign of outward lateral projection * axis.y must have identical sign & magnitude on both sides!
   const lOut = l.ax * (-lx) + l.az * (-lz);
   const rOut = r.ax * lx + r.az * lz;
   const lDirY = l.ay * (lOut >= 0 ? 1 : -1);
   const rDirY = r.ay * (rOut >= 0 ? 1 : -1);
   assert.ok(Math.abs(lDirY - rDirY) < 1e-5, `${speciesId} segment ${i} outward flap tilt matches identically (${lDirY.toFixed(4)} vs ${rDirY.toFixed(4)})`);
  }
 };

 checkWingSym('laughing-gull', {bipedRig: {wingFlap: 0.48, wingOuterFlap: 0.72, neckPitch: 0, legs: []}});
 checkWingSym('royal-tern', {bipedRig: {wingFlap: -0.36, wingOuterFlap: -0.58, neckPitch: 0, legs: []}});
 checkWingSym('sanderling', {len: 0.20, width: 0.06, height: 0.055, wingSpan: 0.40, bipedRig: {wingFlap: 0.52, wingOuterFlap: 0.68, neckPitch: 0, legs: []}});
 checkWingSym('dragonlet', {len: 0.035, width: 0.008, height: 0.008, wingSpan: 0.062, wingFore: 0.42, wingHind: -0.34, state: 'hawking'});

 // Stingray pectoral undulation: left/right mirror check
 const land = new Wetland(2187, DEFAULT_COASTAL_CLIMATE);
 const ray = {
  id: 599, speciesId: 'atlantic-stingray', guild: 'rays', emerged: true, visibility: 1,
  x: 0, y: 0.2, z: 0, bedY: 0, yaw: 0.5, len: 0.36, width: 0.36, height: 0.045,
  color: [0.42, 0.34, 0.20], accent: [0.76, 0.72, 0.60], state: 'foraging', phase: 0.5,
 };
 stepRayUndulation(ray, 0.02, 0.4, null);
 ray.rayRig.left[2].y = ray.y + 0.032;
 ray.rayRig.right[2].y = ray.y + 0.032;
 const rayOut = collectFaunaEllipsoids({agents: [ray], time: 0.5}, null, 68, []);
 const rL = rayOut.filter(e => ((e.cx - ray.x) * (-Math.sin(ray.yaw)) + (e.cz - ray.z) * Math.cos(ray.yaw)) < -0.05);
 const rR = rayOut.filter(e => ((e.cx - ray.x) * (-Math.sin(ray.yaw)) + (e.cz - ray.z) * Math.cos(ray.yaw)) > 0.05);
 assert.ok(rL.length >= 5 && rL.length === rR.length, 'Atlantic stingray emits symmetric pectoral fin sheet');
 for (const [arr, s] of [[rL, -1], [rR, 1]]) {
  const lx = -Math.sin(ray.yaw) * s, lz = Math.cos(ray.yaw) * s;
  const maxDotY = Math.max(...arr.map(e => (e.ax * lx + e.az * lz > 0 ? e.ay : -e.ay)));
  assert.ok(maxDotY > 0.008, `Stingray side=${s} pectoral sheet tilts upward with fin wave (${maxDotY.toFixed(4)})`);
 }

 // 3. Zero underwater soft splats in both fauna and coastal props
 const sim = new CoastalFaunaSim(2187);
 sim.spawn(land);
 const fullEllipsoids = collectFaunaEllipsoids(sim, null, 68, []);
 const underwaterSoft = fullEllipsoids.filter(e => e.underwater > 0 && e.soft >= 0.42);
 assert.equal(underwaterSoft.length, 0, 'No underwater fauna ellipsoid enters the soft depth-write-disabled pass');
 for (let tz = -1; tz <= 1; tz++) for (let tx = -1; tx <= 1; tx++) {
  const props = coastalPropsForTile(land, tx, tz);
  const badSubProps = props.ellipsoids.filter(e => e.maxRange < 0 && e.cy < (land.climate?.seaLevelOffset ?? 0));
  assert.equal(badSubProps.length, 0, `Tile (${tx},${tz}) has zero soft props below sea level`);
 }

 // 4. Gull walking/loafing over steep dune ridge stays cleanly above surface + follows sandTerrain cuts
 const steepRidge = Object.create(land);
 steepRidge.height = (x, z) => 0.5 + 0.35 * Math.cos(x * 3.0) * Math.cos(z * 1.4);
 steepRidge.shoreDistance = () => 12;
 const gull = {
  id: 700, speciesId: 'laughing-gull', guild: 'seabirds', emerged: true, visibility: 1,
  x: 0.25, y: 1.0, z: 0.2, anchorX: 0.25, anchorZ: 0.2, yaw: 0.1, vx: 0.3, vz: 0.05, speed: 0.3,
  airborne: false,
  len: 0.40, width: 0.14, height: 0.11, color: [0.58, 0.59, 0.60], accent: [0.96, 0.96, 0.94],
  energy: 0.5, fatigue: 0.2, fear: 0, phase: 0.1, homeAlong: 0,
  cyber: {activeDrive: 'forage', timer: 1.0},
 };
 createBipedRig(gull, steepRidge);
 for (let i = 0; i < 12; i++) {
  updateAgentAI(gull, 0.03, {time: 1 + i * 0.03, land: steepRidge, sea: null, seaLevel: -0.2, windSpd: 3, stimuli: null, worldAtShoreFn: worldAtShore, waterHeightAtFn: () => -0.2}, true);
 }
 assert.ok(!gull.airborne, 'Foraging gull stays grounded for slope clearance check');
 for (const offX of [-0.20, 0, 0.20]) {
  const gx = gull.x + Math.cos(gull.yaw) * offX;
  const gz = gull.z + Math.sin(gull.yaw) * offX;
  const bodyBottom = gull.y - (gull.height * 0.48) - gull.pitch * offX;
  assert.ok(bodyBottom > steepRidge.height(gx, gz), `Gull keel/head/tail clears dune surface at offset=${offX} (${bodyBottom.toFixed(3)} > ${steepRidge.height(gx, gz).toFixed(3)})`);
 }

 // 5. buildSandPatchGeometry matches SandTerrain nodes & stays monotonic/smooth across subdivided crater cells
 const sandMat = lib.materials.find(m => m.id === 'wetland-sand') ?? lib.materials[0];
 const st = new SandTerrain(land, sandMat);
 st.extract(1.2, -0.8, 0.28, (x, z) => land.height(x, z));
 st.deposit(2.0, -0.4, 0.024);
 const patchGeo = buildSandPatchGeometry(st);
 const posAttr = patchGeo.attributes.position;
 const idxAttr = patchGeo.index;
 assert.ok(posAttr?.count > 0 && idxAttr?.count > 0, 'SandEditPatch produces non-empty geometry for edited terrain');
 let exactNodesChecked = 0;
 for (let vi = 0; vi < posAttr.count; vi++) {
  const vx = posAttr.getX(vi), vy = posAttr.getY(vi), vz = posAttr.getZ(vi);
  const u = vx / CELL, v = vz / CELL;
  const ru = Math.round(u), rv = Math.round(v);
  if (Math.abs(u - ru) < 1e-6 && Math.abs(v - rv) < 1e-6) {
   assert.ok(Math.abs(vy - st.node(ru, rv)) < 1e-6, `Patch node height matches SandTerrain.node at (${ru},${rv})`);
   exactNodesChecked++;
  } else {
   const i0 = Math.floor(u), j0 = Math.floor(v);
   let lo = Infinity, hi = -Infinity;
   for (let dj = 0; dj <= 1; dj++) for (let di = 0; di <= 1; di++) {
    const h = st.node(i0 + di, j0 + dj);
    if (h < lo) lo = h;
    if (h > hi) hi = h;
   }
   assert.ok(vy >= lo - 0.015 && vy <= hi + 0.015, `Subdivided vertex (${vy.toFixed(4)}) stays monotonic near [${lo.toFixed(4)}, ${hi.toFixed(4)}]`);
  }
 }
 assert.ok(exactNodesChecked >= 8, `Verified ${exactNodesChecked} exact SandTerrain grid nodes on patch`);
 patchGeo.dispose();

 // Verify SandEditPatch covers sub-mobile active/settled tile edits (0.0003 < |h| <= 0.0004) so groundGrid discard never leaves cutout holes
 const stThin = new SandTerrain(land, sandMat);
 stThin.change(5, -7, -0.00035);
 stThin.active.clear();
 stThin.mobile.clear();
 const thinGeo = buildSandPatchGeometry(stThin);
 const thinPos = thinGeo.attributes.position;
 assert.ok(thinPos?.count > 0 && thinGeo.index?.count > 0, 'SandEditPatch covers settled tile edits below mobile threshold');
 let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, foundEdited = false;
 for (let vi = 0; vi < thinPos.count; vi++) {
  const vx = thinPos.getX(vi), vy = thinPos.getY(vi), vz = thinPos.getZ(vi);
  minX = Math.min(minX, vx); maxX = Math.max(maxX, vx);
  minZ = Math.min(minZ, vz); maxZ = Math.max(maxZ, vz);
  if (Math.abs(vx - 5 * CELL) < 1e-6 && Math.abs(vz - (-7) * CELL) < 1e-6) {
   assert.ok(Math.abs(vy - (-0.00035)) < 1e-6, 'Sub-mobile edited node preserves exact height on patch');
   foundEdited = true;
  }
 }
 assert.ok(foundEdited, 'Edited sub-mobile node is present in patch mesh');
 assert.ok(minX <= 4 * CELL + 1e-6 && maxX >= 6 * CELL - 1e-6 && minZ <= (-8) * CELL + 1e-6 && maxZ >= (-6) * CELL - 1e-6,
  'SandEditPatch spans all 4 touching cells + collar around sub-mobile tile edit');
 thinGeo.dispose();

 // 6. CoastalPropsView & WetlandReeds respond to excavation and impulse on sandTerrain
 const mockLighting = 'uniform vec3 sunDirection,sunColor;float sampleSunShadow(vec3 p,vec3 n){return 1.;}vec3 shadeLit(vec3 b,vec3 n,vec3 p,vec4 pr,float v){return b;}vec3 shade(vec3 b,vec3 n,vec3 p,vec4 pr){return b;}vec3 env(vec3 r,float rough){return vec3(.5);}';
 const mockUniforms = {
  sunDirection: {value: new T.Vector3(-0.6, 1, 0.5).normalize()},
  sunColor: {value: new T.Color(1.1, 1.02, 0.88)},
  hazeColor: {value: new T.Color(0.38, 0.45, 0.48)},
 };
 const mockView = {uniforms: mockUniforms, oceanView: {uniforms: {}}, scene: new T.Scene()};
 const propsView = new CoastalPropsView(mockView, mockLighting);
 let tileKey = null, tile0 = null, looseProp = null;
 for (let tz = -2; tz <= 2 && !looseProp; tz++) for (let tx = -2; tx <= 2 && !looseProp; tx++) {
  const t = coastalPropsForTile(land, tx, tz);
  const g = t.groups?.find(gr => !gr.fixed && gr.itemIndices.length > 0);
  if (g) { tileKey = `${tx},${tz}`; tile0 = t; looseProp = g; }
 }
 assert.ok(looseProp, 'Beach tiles contain loose terrestrial props with groups');
 propsView.tiles.set(tileKey, tile0);
 const movedItemIdx = looseProp.itemIndices[0];
 const origItemY = movedItemIdx !== undefined ? tile0.items[movedItemIdx].y : null;
 const stProps = new SandTerrain(land, sandMat);
 stProps.extract(looseProp.x, looseProp.z, 0.24, (x, z) => land.height(x, z));
 propsView.disturb({kind: 'excavate', point: new T.Vector3(looseProp.x, land.height(looseProp.x, looseProp.z), looseProp.z), depth: 0.24, reach: 1.5}, land, stProps);
 const cam = new T.PerspectiveCamera(48, 1.6, 0.1, 1000);
 cam.position.set(looseProp.x + 2, 4, looseProp.z + 2);
 cam.lookAt(looseProp.x, 0, looseProp.z);
 for (let f = 0; f < 45; f++) propsView.update(land, cam, 0.025, stProps);
 const stDyn = [...propsView.dynamicGroups.values()].find(s => s.g === looseProp);
 assert.ok(stDyn && stDyn.dy < -0.12, `Excavated prop drops into crater (dy=${stDyn?.dy?.toFixed(3)})`);
 if (movedItemIdx !== undefined) {
  assert.ok(tile0.items[movedItemIdx].y < origItemY - 0.12, `Excavated prop item drops with crater (${tile0.items[movedItemIdx].y.toFixed(3)} < ${origItemY.toFixed(3)})`);
 }
 propsView.disturb({kind: 'impulse', point: new T.Vector3(looseProp.x - 0.3, land.height(looseProp.x, looseProp.z), looseProp.z), force: 3200, reach: 2.2}, land, stProps);
 assert.ok(stDyn && stDyn.vy > 0.3, `Sand impulse launches nearby prop upward (vy=${stDyn?.vy?.toFixed(3)})`);
 propsView.dispose();

 const reedsView = new WetlandReeds(mockView, mockLighting);
 const reedAsset = lib.assets.find(a => a.id === 'sea-oats') ?? lib.assets.find(a => a.id === 'smooth-cordgrass');
 if (reedAsset) {
  reedsView.configure([reedAsset], lib.materials, []);
  const site = {id: 'test-reed-1', variant: 0, x: looseProp.x, y: land.height(looseProp.x, looseProp.z), z: looseProp.z, yaw: 0, size: 1};
  reedsView.tiles.set('0,0', [site]);
  reedsView.visible = [site];
  reedsView.disturb({kind: 'excavate', point: new T.Vector3(site.x, site.y, site.z), depth: 0.24, reach: 1.6}, land, stProps);
  for (let f = 0; f < 30; f++) reedsView.stepDisturbed(0.025, land, stProps);
  const dSite = reedsView.disturbedSites.get(site.id);
  assert.ok(dSite && dSite.dy < -0.10, `Undercut plant drops into crater (dy=${dSite?.dy?.toFixed(3)})`);
  reedsView.disturb({kind: 'impulse', point: new T.Vector3(site.x - 0.4, site.y, site.z), force: 3200, reach: 2.4}, land, stProps);
  assert.ok(Math.hypot(dSite.vlx, dSite.vlz) > 0.5 && dSite.vy > 0.2, 'Sand impulse whips nearby coastal plant');
 }
 reedsView.dispose();

 // 7. WetlandView derivatives stay strictly before conditional discard (zero L-seam NaNs) & impact spray is irregular/chaotic
 const wvUniforms = {
  ...mockUniforms,
  grainMap: {value: null}, height0: {value: null}, height1: {value: null}, height2: {value: null},
  bandMix: {value: new T.Vector3()}, rings: {value: []}, ringCount: {value: 0},
  ringAttenuation: {value: new Float32Array(12)}, clipWaves: {value: false},
  clipHeights: {value: new T.Vector2()}, clipFloor: {value: 0}, seaLevel: {value: 0},
  coastalWater: {value: new T.Vector4()},
 };
 const wvHost = {
  uniforms: wvUniforms,
  oceanView: {uniforms: {mirrorColor: {value: null}, mirrorVP: {value: new T.Matrix4()}}},
  sandView: {texture: null},
  scene: new T.Scene(),
  groundMaterial: new T.ShaderMaterial({uniforms: {color: {value: new T.Color()}, properties: {value: new T.Vector4()}}}),
 };
 groundSurface(wvHost, mockLighting);
 const wvCheck = new WetlandView(wvHost, mockLighting);
 for (const [label, mat] of [['terrain', wvCheck.terrain], ['sandPatchTerrain', wvCheck.sandPatchTerrain]]) {
  const frag = mat.fragmentShader;
  const mainIdx = frag.indexOf('void main()');
  const patchDiscard = frag.indexOf(label === 'terrain' ? 'localEdited(p.xz,0))discard;' : 'if(!granular)discard;', mainIdx);
  const clipDiscard = frag.indexOf('belowReflector(p))discard;', mainIdx);
  const firstWetlandDiscard = Math.min(patchDiscard, clipDiscard);
  const lastDfdx = frag.lastIndexOf('dFdx(');
  const lastDfdy = frag.lastIndexOf('dFdy(');
  assert.ok(patchDiscard > mainIdx && clipDiscard > mainIdx && lastDfdx > mainIdx && lastDfdy > mainIdx, `${label} defines main() derivatives & wetland discards`);
  assert.ok(lastDfdx < firstWetlandDiscard && lastDfdy < firstWetlandDiscard, `${label} evaluates all dFdx/dFdy before wetland discards`);
 }
 wvCheck.dispose();
 wvHost.finishMap?.dispose();

 assert.ok(
  groundFinishShader.includes('if(finishProbes==0)return vec2(0.);'),
  'groundFinish early-returns only on uniform finishProbes==0'
 );
 assert.ok(
  !groundFinishShader.includes('lessThan(p,finishBounds') && !groundFinishShader.includes('greaterThan(p,finishBounds'),
  'groundFinish avoids per-fragment finishBounds early return that causes quad-divergence dot seams'
 );
 const gf = new GroundFinish();
 gf.update({
  version: 1,
  tiles: new Map([['1,-1', {i: 1, j: -1, material: {id: 'sand', phase: 'granular', fuelEnergy: 0}, finish: 0.25, fuel: 1}]])
 }, {id: 'sand'});
 assert.ok(gf.uniforms.finishProbes.value >= 1, 'GroundFinish sets finishProbes >= 1 for wet ground tile');
 assert.deepEqual(gf.uniforms.finishBounds.value.toArray(), [0, -2, 2, 0], 'GroundFinish sets finishBounds around active tile');
 const hitSlot = (Math.imul(1, 73) ^ Math.imul(-1, 151)) & 511;
 assert.deepEqual(
  Array.from(gf.data.subarray(4 * hitSlot, 4 * hitSlot + 4)),
  [1, -1, 1.25, 0],
  'GroundFinish populates hashed slot for active tile'
 );
 const missSlot = (Math.imul(-5, 73) ^ Math.imul(6, 151)) & 511;
 assert.ok(
  gf.data[4 * missSlot + 2] === 0 || gf.data[4 * missSlot] !== -5 || gf.data[4 * missSlot + 1] !== 6,
  'Out-of-bounds cell lookup misses cleanly in 512-slot table'
 );
 gf.dispose();

 const sprayA = createImpactSandSpray({origin: {x: 1, y: 0.5, z: -2}, baseSpeed: 3.4, count: 220, seed: 101, mode: 'impulse'});
 const sprayB = createImpactSandSpray({origin: {x: 1, y: 0.5, z: -2}, baseSpeed: 3.4, count: 220, seed: 202, mode: 'impulse'});
 assert.equal(sprayA.length, 220, 'Impulse spray generates 220 chaotic ballistic particles');
 let fineN = 0, coarseN = 0, dustN = 0;
 for (const gr of sprayA) {
  assert.ok(Number.isFinite(gr.x) && Number.isFinite(gr.y) && Number.isFinite(gr.z) && Number.isFinite(gr.vx) && Number.isFinite(gr.vy) && Number.isFinite(gr.vz), 'Grain state finite');
  if (gr.dust || gr.r < 0) dustN++;
  else if (gr.r >= 0.007) coarseN++;
  else fineN++;
 }
 assert.ok(fineN > 80 && coarseN >= 20 && dustN >= 4, `Uniform-color grain size mix (${fineN} fine, ${coarseN} coarse, ${dustN} dust)`);
 const deltaVel = Math.hypot(sprayA[0].vx - sprayB[0].vx, sprayA[0].vy - sprayB[0].vy, sprayA[0].vz - sprayB[0].vz);
 assert.ok(deltaVel > 0.05, 'Distinct impact seeds produce independent non-repeating trajectories');
});

test('Pillar 1: airborne sand uses uniform natural color, responds to day/night sun, and excludes Gulf & swale water', () => {
 const land = new Wetland(2187, DEFAULT_COASTAL_CLIMATE);
 const uniforms = {
  viewport: {value: new T.Vector2(800, 600)},
  sunDirection: {value: new T.Vector3(0.4, 0.7, 0.2).normalize()},
  sunColor: {value: new T.Color(1.0, 0.96, 0.88)},
  hazeColor: {value: new T.Color(0.4, 0.48, 0.52)},
 };
 const sdView = new SandDriftView(new T.Scene(), uniforms, 'uniform vec3 sunDirection,sunColor;', false, null, 320);
 sdView.setLandscape(land);
 const frag = sdView.mesh.material.fragmentShader;
 const vert = sdView.mesh.material.vertexShader;
 assert.ok(frag.includes('daySun=smoothstep(-.04,.09,sunD.y)'), 'Airborne sand attenuates cleanly below horizon at night');
 assert.ok(frag.includes('uniform vec3 color;') && !frag.includes('mineral'), 'Airborne sand renders with single uniform natural color');
 assert.ok(frag.includes('hazeColor'), 'Airborne sand blends cleanly with atmospheric haze');
 assert.ok(vert.includes('waterSurf'), 'Airborne sand shader culls grains below Gulf and swale water surfaces');
 sdView.dispose();

 // WindSand refuses to launch airborne sand from flooded Gulf or wet swale cells and retires water-entering grains
 const wind = {speed: 22, heading: 90, x: 0, z: 22};
 const matDrySand = {density: 1600, moisture: 0.01, friction: 0.65, cohesion: 0, adhesion: 0};
 const ws = new WindSand(land);
 for (let i = 0; i < 45; i++) ws.advance(0.05, wind, matDrySand);
 for (const g of ws.grains) {
  const wY = waterSurfaceHeight(land, g.x, g.z, wind.speed);
  assert.ok(g.y > wY - 1e-3 || isDrySandAt(land, g.x, g.z, wind.speed), 'Launched WindSand grains stay clear of surface water');
 }
 const [gulfX, gulfZ] = worldAtShore(land, -14, 0);
 ws.grains.push({x: gulfX, y: waterSurfaceHeight(land, gulfX, gulfZ, wind.speed) - 0.02, z: gulfZ, vx: 1, vy: -0.5, vz: 0, r: 0.004, load: 0.001, age: 0});
 ws.advance(0.05, wind, matDrySand);
 assert.ok(ws.grains.every(g => Math.hypot(g.x - gulfX, g.z - gulfZ) > 0.2 || g.y > waterSurfaceHeight(land, g.x, g.z, wind.speed)), 'Water-entering WindSand grains retire immediately');

 // MatterView.stepSandSpray suppresses underwater impact bursts and retires water-entering spray
 const mv = new MatterView({scene: new T.Scene(), garden: {land}}, '');
 const underwaterParts = new Map([[
  'impulse-uw',
  {groundTool: true, kind: 1, packets: [{position: {x: gulfX, y: land.height(gulfX, gulfZ), z: gulfZ}, body: {linvel: () => ({x: 0, y: 2, z: 0})}, radius: 0.1}]},
 ]]);
 const mockSim = {
  time: 0.1,
  wind: {speed: 4, heading: 0},
  sand: {landscape: land},
  matter: {parts: underwaterParts, groundHeight: (_s, x, z) => land.height(x, z)},
 };
 mv.stepSandSpray(mockSim);
 assert.equal(mv.sprayGrains.length, 0, 'Underwater ground impact produces zero airborne sand spray');
 mv.sprayGrains.push({x: gulfX, y: waterSurfaceHeight(land, gulfX, gulfZ, 4) + 0.002, z: gulfZ, vx: 0, vy: -2.0, vz: 0, r: 0.004, seed: 0.5, alpha: 1, drag: 1, age: 0, maxAge: 1, settleFade: 0.2, settledAge: -1, bounces: 0, dust: false});
 mockSim.time = 0.14;
 mv.stepSandSpray(mockSim);
 assert.equal(mv.sprayGrains.length, 0, 'Falling sand spray entering water retires cleanly');
});

test('Pillar 2: plant damage & wind propagate across LOD 2/Horizon and settled prop edits survive tile eviction', () => {
 const garden = exampleWorlds.find(t => t.id === 'wetland');
 const lib = garden.create(null, 2187);
 const land = new Wetland(2187, DEFAULT_COASTAL_CLIMATE);

 const stand = new ReedStand(null, lib);
 const dmgRecord = {intactFrac: 0.38, heightScale: 0.52, tiltX: 0.42, tiltZ: -0.15, dropY: -0.22};
 stand.persistentDamage.set('broken-reed-site', dmgRecord);
 assert.deepEqual(stand.crownSummary('broken-reed-site'), dmgRecord, 'ReedStand preserves persistent damaged crown summaries across tile release');
 stand.dispose();

 const mockLighting = 'uniform vec3 sunDirection,sunColor;float sampleSunShadow(vec3 p,vec3 n){return 1.;}vec3 shadeLit(vec3 b,vec3 n,vec3 p,vec4 pr,float v){return b;}vec3 shade(vec3 b,vec3 n,vec3 p,vec4 pr){return b;}vec3 env(vec3 r,float rough){return vec3(.5);}';
 const mockUniforms = {
  sunDirection: {value: new T.Vector3(-0.6, 1, 0.5).normalize()},
  sunColor: {value: new T.Color(1.1, 1.02, 0.88)},
  hazeColor: {value: new T.Color(0.38, 0.45, 0.48)},
 };
 const mockView = {uniforms: mockUniforms, oceanView: {uniforms: {}}, scene: new T.Scene()};
 const reedsView = new WetlandReeds(mockView, mockLighting);
 const reedAsset = lib.assets.find(a => a.id === 'sea-oats') ?? lib.assets.find(a => a.id === 'smooth-cordgrass');
 reedsView.configure([reedAsset], lib.materials, []);
 reedsView.transparency.init({extensions: {has: () => true}});
 assert.ok(reedsView.transparency.vertex.includes('horizonWind'), 'Horizon reed LOD 3 consumes horizonWind damage and lean uniform');
 assert.ok(reedsView.transparency.vertex.includes('#if REED_LOD == 2'), 'LOD 2 shader includes active-crown damage and lean handling');
 assert.equal(reedsView.transparency.rangeMaterials[3].defines.REED_LOD, 3, 'LOD 3 horizon range shader compiled');
 assert.equal(reedsView.transparency.layerMaterials[2].defines.REED_LOD, 2, 'LOD 2 canopy shader compiled');
 reedsView.transparency.dispose();

 // CoastalPropsView persists settled edits when a tile streams out and back in
 const propsView = new CoastalPropsView(mockView, mockLighting);
 let tileKey = null, tileObj = null, looseProp = null;
 for (let tz = -2; tz <= 2 && !looseProp; tz++) for (let tx = -2; tx <= 2 && !looseProp; tx++) {
  const t = coastalPropsForTile(land, tx, tz);
  const g = t.groups?.find(gr => !gr.fixed && gr.itemIndices.length > 0);
  if (g) { tileKey = `${tx},${tz}`; tileObj = t; looseProp = g; }
 }
 const sandMat = lib.materials.find(m => m.id === 'sand');
 const stProps = new SandTerrain(land, sandMat);
 stProps.extract(looseProp.x, looseProp.z, 0.25, (x, z) => land.height(x, z));
 propsView.tiles.set(tileKey, tileObj);
 propsView.disturb({kind: 'excavate', point: new T.Vector3(looseProp.x, land.height(looseProp.x, looseProp.z), looseProp.z), depth: 0.25, reach: 1.6}, land, stProps);
 const cam = new T.PerspectiveCamera(48, 1.6, 0.1, 1000);
 cam.position.set(looseProp.x + 2, 4, looseProp.z + 2);
 cam.lookAt(looseProp.x, 0, looseProp.z);
 for (let f = 0; f < 40; f++) propsView.update(land, cam, 0.025, stProps);
 const fullKey = `${tileKey}:${looseProp.id}`;
 const saved = propsView.settledEdits.get(fullKey);
 assert.ok(saved && saved.dy < -0.10, `Displaced prop edit recorded in settledEdits (dy=${saved?.dy?.toFixed(3)})`);

 // Evict tile & dynamic groups completely, then reload around camera
 propsView.tiles.delete(tileKey);
 propsView.dynamicGroups.clear();
 propsView.signature = undefined;
 propsView.update(land, cam, 0.016, stProps);
 const reloadedTile = propsView.tiles.get(tileKey);
 const reloadedSt = propsView.dynamicGroups.get(fullKey);
 assert.ok(reloadedTile && reloadedSt && Math.abs(reloadedSt.dy - saved.dy) < 0.02, 'Reloaded tile restores settled prop displacement cleanly');
 propsView.dispose();
});

test('Pillar 3: bonnethead shark movement is smooth and non-jittery without depth teleports', () => {
 const land = new Wetland(2187, DEFAULT_COASTAL_CLIMATE);
 const sea = {seaLevel: DEFAULT_COASTAL_CLIMATE.seaLevelOffset, height: () => DEFAULT_COASTAL_CLIMATE.seaLevelOffset};
 const eco = new CoastalEcologySim();
 const wind = {speed: 3.0, x: -2.0, z: -2.0};
 const sim = new CoastalFaunaSim(2187);
 sim.spawn(land);

 const shark = sim.agents.find(a => a.speciesId === 'bonnethead-shark');
 assert.ok(shark, 'Bonnethead shark spawned');
 const [sx, sz] = worldAtShore(land, -4.5, 0);
 shark.x = sx; shark.z = sz;
 shark.y = Math.max(land.height(sx, sz) + 0.14, sea.seaLevel - 0.18);
 shark.yaw = Math.atan2(sz, sx); // aimed gently toward shallow shoaling contour
 shark.speed = 1.1; shark.vx = Math.cos(shark.yaw) * 1.1; shark.vz = Math.sin(shark.yaw) * 1.1;

 let maxDyStep = 0, maxYawAccel = 0;
 let prevY = shark.y, prevYawRate = shark.smoothYawRate || 0;
 const phase0 = shark.fishSpine?.swimPhase || 0;
 for (let i = 0; i < 150; i++) {
  sim.step(0.03, land, wind, sea, eco);
  maxDyStep = Math.max(maxDyStep, Math.abs(shark.y - prevY));
  const curYawRate = shark.smoothYawRate ?? shark.yawRate ?? 0;
  maxYawAccel = Math.max(maxYawAccel, Math.abs(curYawRate - prevYawRate) / 0.03);
  prevY = shark.y;
  prevYawRate = curYawRate;
 }
 assert.ok(maxDyStep < 0.025, `Shark vertical tracking stays silky without depth snaps (max |dy|=${maxDyStep.toFixed(4)} m/step)`);
 assert.ok(maxYawAccel < 6.5, `Shark steering acceleration stays smoothly damped (max=${maxYawAccel.toFixed(2)} rad/s^2)`);
 assert.ok(Number.isFinite(shark.fishSpine?.swimPhase) && (shark.fishSpine?.swimPhase ?? 0) > phase0 + 1.0, 'Shark caudal swimPhase advances continuously');
 assert.ok(land.shoreDistance(shark.x, shark.z) < -2.0, 'Shark avoids running aground via smooth shallow gradient');
});

test('Pillar 4 & 5: wind physics, emergent shelter, prey-gated dives, soaring energy balance, & DEB life cycle', () => {
 const land = new Wetland(2187, DEFAULT_COASTAL_CLIMATE);
 const sea = {seaLevel: DEFAULT_COASTAL_CLIMATE.seaLevelOffset, height: () => DEFAULT_COASTAL_CLIMATE.seaLevelOffset};

 // 4a. Headwind power cost vs calm flight on Laughing Gull (zero free soaring energy)
 const ecoCalm = new CoastalEcologySim();
 const simCalm = new CoastalFaunaSim(2187); simCalm.spawn(land);
 const ecoGale = new CoastalEcologySim();
 const simGale = new CoastalFaunaSim(2187); simGale.spawn(land);

 const gullCalm = simCalm.agents.find(a => a.speciesId === 'laughing-gull');
 const gullGale = simGale.agents.find(a => a.speciesId === 'laughing-gull');
 // Clear ocean food so energy reflects true metabolic burn
 for (const s of [simCalm, simGale]) {
  s.carcasses.length = 0;
  for (const ag of s.agents) {
   if (ag.speciesId === 'baitfish' || ag.speciesId === 'killifish' || ag.speciesId === 'pinfish' || ag.speciesId === 'pompano' || ag.speciesId === 'grass-shrimp' || ag.speciesId === 'mole-crab') {
    ag.alive = false; ag.visibility = 0;
   }
  }
 }
 for (const g of [gullCalm, gullGale]) {
  const [ox, oz] = worldAtShore(land, -35, 0);
  g.x = ox; g.z = oz; g.airborne = true; g.y = sea.seaLevel + 8; g.flightAlt = 8;
  g.energy = 0.72; g.satiation = 0.0; g.stamina = 0.90;
  g.yaw = 0; // flying straight into +X / upwind of gale
 }
 for (let i = 0; i < 50; i++) {
  simCalm.step(0.04, land, {speed: 1.5, x: -1.5, z: 0}, sea, ecoCalm);
  simGale.step(0.04, land, {speed: 19.0, x: -19.0, z: 0}, sea, ecoGale);
 }
 assert.ok(gullCalm.energy < 0.72, `Soaring gull without food burns metabolic energy (${gullCalm.energy.toFixed(4)} < 0.72)`);
 assert.ok(gullGale.energy < gullCalm.energy, `Headwind gale increases gull flight power cost (${gullGale.energy.toFixed(4)} < ${gullCalm.energy.toFixed(4)})`);

 // 4b. Emergent gale sheltering on dune species + deeper baitfish under wave chop
 const simShelter = new CoastalFaunaSim(2187); simShelter.spawn(land);
 const racer = simShelter.agents.find(a => a.speciesId === 'racerunner');
 racer.fear = 0; racer.visibility = 1;
 for (let i = 0; i < 40; i++) simShelter.step(0.04, land, {speed: 19.0, x: -18, z: -6}, sea, new CoastalEcologySim());
 assert.equal(racer.state, 'wind-sheltering', 'Gale saltation triggers emergent leeward dune sheltering');

 // 5a. Royal Tern prey-gated diving: 0 empty-water dives, real plunge capture over live baitfish
 const simEmpty = new CoastalFaunaSim(2187); simEmpty.spawn(land);
 for (const ag of simEmpty.agents) {
  if (['baitfish', 'killifish', 'pinfish', 'pompano', 'grass-shrimp'].includes(ag.speciesId)) {
   ag.alive = false; ag.visibility = 0;
  }
 }
 const ternEmpty = simEmpty.agents.find(a => a.speciesId === 'royal-tern');
 ternEmpty.energy = 0.25; ternEmpty.satiation = 0.0; ternEmpty.airborne = true; ternEmpty.divePhase = 'patrol'; ternEmpty.diveCooldown = 0;
 let sawEmptyDive = false;
 for (let i = 0; i < 80; i++) {
  simEmpty.step(0.04, land, {speed: 2.0, x: -2, z: 0}, sea, new CoastalEcologySim());
  if (ternEmpty.divePhase === 'diving') sawEmptyDive = true;
 }
 assert.equal(sawEmptyDive, false, 'Royal Tern performs 0 empty-water plunge dives when no live fish exist');

 const simHunt = new CoastalFaunaSim(2187); simHunt.spawn(land);
 const ecoHunt = new CoastalEcologySim();
 const ternHunt = simHunt.agents.find(a => a.speciesId === 'royal-tern');
 const liveBait = simHunt.agents.find(a => a.speciesId === 'baitfish');
 for (const ag of simHunt.agents) {
  if (ag !== liveBait && ['baitfish', 'killifish', 'pinfish', 'pompano', 'grass-shrimp'].includes(ag.speciesId)) {
   ag.alive = false; ag.visibility = 0;
  }
 }
 const [hx, hz] = [liveBait.x, liveBait.z];
 liveBait.y = sea.seaLevel - 0.14; liveBait.alive = true; liveBait.visibility = 1;
 ternHunt.x = hx - 1.2; ternHunt.z = hz; ternHunt.yaw = 0; ternHunt.flightAlt = 3.6; ternHunt.y = sea.seaLevel + 3.6;
 ternHunt.airborne = true; ternHunt.divePhase = 'patrol'; ternHunt.diveCooldown = 0; ternHunt.activeDrive = 'forage';
 ternHunt.energy = 0.20; ternHunt.satiation = 0.05;
 for (let i = 0; i < 120 && liveBait.alive !== false; i++) {
  simHunt.step(0.03, land, {speed: 1.5, x: -1.5, z: 0}, sea, ecoHunt);
 }
 assert.ok(liveBait.alive === false && ecoHunt.energyFlow.captures >= 1, 'Royal Tern executes real plunge capture marking prey dead and logging energyFlow capture');

 // 5b. Juvenile ontogeny growth, energy-gated reproduction, & starvation carcass recycling
 const simCycle = new CoastalFaunaSim(2187); simCycle.spawn(land);
 const ecoCycle = new CoastalEcologySim();
 const juv = simCycle.agents.find(a => a.speciesId === 'racerunner');
 juv.lifeStage = 'juvenile'; juv.growth = 0.4; juv.sizeScale = 0.76; juv.age = 5;
 juv.energy = 0.94; juv.satiation = 0.85;
 const scale0 = juv.sizeScale;
 const juvLenBefore = juv.len;
 const juvEllSmall = collectFaunaEllipsoids({agents: [juv], carcasses: [], time: simCycle.time}, null, 68, []);
 const mom = simCycle.agents.find(a => a.speciesId === 'hermit-crab' && a.lifeStage === 'adult');
 mom.energy = 0.96; mom.satiation = 0.92; mom.stamina = 0.95; mom.reproEnergy = 0.985;
 const starvedCrab = simCycle.agents.find(a => a.speciesId === 'ghost-crab' && a !== mom);
 starvedCrab.energy = 0.0001; starvedCrab.satiation = 0;
 const wrackBefore = ecoCycle.resources.wrack;
 for (let i = 0; i < 20; i++) simCycle.step(0.05, land, {speed: 2.0, x: -2, z: 0}, sea, ecoCycle);
 assert.ok(juv.sizeScale > scale0, `Juvenile sizeScale grows cleanly (${scale0.toFixed(3)} -> ${juv.sizeScale.toFixed(3)})`);
 assert.equal(juv.len, juvLenBefore, 'Juvenile ontogeny preserves base adult len metric while scaling sizeScale');
 assert.ok(juvEllSmall.length >= 2, 'Juvenile racerunner renders scaled Gaussians cleanly');
 assert.ok(ecoCycle.energyFlow.births >= 1 && simCycle.agents.some(a => a !== juv && a.speciesId === 'hermit-crab' && a.lifeStage === 'juvenile'), 'High-energy adult triggers bounded biological reproduction');
 assert.ok(starvedCrab.alive === false && ecoCycle.energyFlow.deaths >= 1 && simCycle.carcasses.length >= 1, 'Starved terrestrial animal emits scavengeable carcass');
 assert.ok(ecoCycle.resources.wrack > wrackBefore, 'Terrestrial mortality recycles organic carcass nutrients into wrack');
 const carEll = collectFaunaEllipsoids({agents: [], carcasses: simCycle.carcasses, time: simCycle.time}, null, 200, []);
 assert.ok(carEll.length >= 1 && carEll.every(e => e.soft < 0.3 && e.underwater === 0), 'Carcasses render with crisp non-pancake ellipsoids');
});

test('Pillar 6: all 6 new small Shell Island species exhibit authentic ethology without clipping or soft halos', () => {
 const land = new Wetland(2187, DEFAULT_COASTAL_CLIMATE);
 const sea = {seaLevel: DEFAULT_COASTAL_CLIMATE.seaLevelOffset, height: () => DEFAULT_COASTAL_CLIMATE.seaLevelOffset};
 const eco = new CoastalEcologySim();
 const sim = new CoastalFaunaSim(2187);
 sim.spawn(land);

 // Coquina Clam burrows on exposure / fear
 const coq = sim.agents.find(a => a.speciesId === 'coquina-clam');
 const [dx, dz] = worldAtShore(land, 4.5, 0);
 coq.x = dx; coq.z = dz; coq.burrowDepth = 0; coq.fear = 0.6;
 for (let i = 0; i < 20; i++) sim.step(0.04, land, {speed: 2, x: -2, z: 0}, sea, eco);
 assert.ok(coq.burrowDepth > 0.004 && coq.state === 'burrowing', 'Exposed coquina clam burrows into foreshore sand');

 // Hermit Crab retracts into gastropod shell when threatened
 const herm = sim.agents.find(a => a.speciesId === 'hermit-crab');
 herm.fear = 0.8; herm.retracted = false;
 sim.step(0.03, land, {speed: 2, x: -2, z: 0}, sea, eco);
 assert.ok(herm.retracted === true && herm.state === 'shell-retracted' && herm.speed === 0, 'Threatened hermit crab retracts inside spiral shell');

 // Tiger Beetle stop-and-go sprint vs pause phases
 const tb = sim.agents.find(a => a.speciesId === 'tiger-beetle');
 tb.airborne = false; tb.fear = 0; tb.runPhase = 'sprint'; tb.runPauseTimer = 0.05;
 const phases = new Set();
 for (let i = 0; i < 20; i++) {
  sim.step(0.04, land, {speed: 2, x: -2, z: 0}, sea, eco);
  phases.add(tb.runPhase);
 }
 assert.ok(phases.has('sprint') && phases.has('pause'), 'Tiger beetle cycles between sprint pursuit and pause re-acquisition');

 // Six-lined Racerunner builds smooth lizardSpine & cools down at night
 const race = sim.agents.find(a => a.speciesId === 'racerunner');
 race.fear = 0;
 for (let i = 0; i < 15; i++) sim.step(0.04, land, {speed: 2, x: -2, z: 0}, sea, eco);
 assert.ok((race.lizardSpine?.nodes?.length || 0) >= 4, 'Racerunner solves continuous serpentine spine');
 const nightLand = new Wetland(2187, {...DEFAULT_COASTAL_CLIMATE, airTemperature: 18});
 sim.step(0.04, nightLand, {speed: 2, x: -2, z: 0}, sea, eco);
 assert.equal(race.state, 'basking', 'Racerunner rests sheltered under cool conditions');

 // Grass Shrimp executes caridoid tail-flip & emits zero soft underwater splats
 const shrimp = sim.agents.find(a => a.speciesId === 'grass-shrimp');
 shrimp.fear = 0.85; shrimp.tailFlipTimer = 0; shrimp.flipCooldown = 0;
 sim.step(0.03, land, {speed: 2, x: -2, z: 0}, sea, eco);
 assert.ok(shrimp.tailFlex > 0.5 && shrimp.state === 'tail-flipping', 'Threatened grass shrimp triggers caridoid tail-flip escape');
 const shrimpEll = collectFaunaEllipsoids({agents: [shrimp], time: sim.time}, null, 68, []);
 assert.ok(shrimpEll.length >= 2 && shrimpEll.every(e => e.underwater === 1 && e.soft <= 0.24), 'Grass shrimp renders with crisp underwater Gaussians (soft <= 0.24)');

 // Saltmarsh Periwinkle climbs upslope above rising tide
 const peri = sim.agents.find(a => a.speciesId === 'marsh-periwinkle');
 const highSea = {seaLevel: land.height(peri.x, peri.z) + 0.08, height: () => land.height(peri.x, peri.z) + 0.08};
 sim.step(0.04, land, {speed: 2, x: -2, z: 0}, highSea, eco);
 assert.equal(peri.state, 'climbing-shelter', 'Marsh periwinkle climbs upslope ahead of rising tide');
});
