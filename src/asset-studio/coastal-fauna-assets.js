// Procedural Asset Studio sculpts for all 19 St. Andrews / Shell Island coastal animal species.
// Each fauna asset uses canonical multi-stamp SDF volumes + surface-projected Gaussian marks
// so users can inspect, sculpt, paint, animate, and drop animals directly into Wind Garden.
import {Vector3} from 'three';
import {material, part, stamp, LIMITS} from './model.js';
import {randomSequence} from './family.js';
import {brushFrame, projectMount} from './gaussian-marks.js';
import {FAUNA_SPECIES} from './coastal-fauna.js';

const FAUNA_MAT_DEFS = [
 ['ghost-crab-shell', 'Ghost crab carapace', '#b89c72', {roughness: 0.40, porosity: 0.05, density: 1380, youngModulus: 2.6e9, tensileStrength: 1.1e7, yieldStress: 1.6e7, cohesion: 6e5, adhesion: 4e5}],
 ['fiddler-carapace', 'Fiddler crab shell', '#6d575f', {roughness: 0.38, porosity: 0.05, density: 1400, youngModulus: 2.6e9, tensileStrength: 1.1e7, yieldStress: 1.6e7, cohesion: 6e5, adhesion: 4e5}],
 ['fiddler-claw', 'Fiddler major claw', '#e6b286', {roughness: 0.34, porosity: 0.04, density: 1450, youngModulus: 3.1e9, tensileStrength: 1.4e7, yieldStress: 2.0e7, cohesion: 8e5, adhesion: 5e5}],
 ['blue-crab-shell', 'Blue crab carapace', '#3b5d4c', {roughness: 0.26, porosity: 0.04, density: 1440, youngModulus: 3.0e9, tensileStrength: 1.3e7, yieldStress: 1.8e7, cohesion: 7e5, adhesion: 5e5}],
 ['blue-crab-claw', 'Blue crab cheliped', '#2d78c4', {roughness: 0.24, porosity: 0.04, density: 1460, youngModulus: 3.2e9, tensileStrength: 1.5e7, yieldStress: 2.1e7, cohesion: 8e5, adhesion: 5e5}],
 ['crab-claw-red', 'Crab dactyl tip', '#be3b34', {roughness: 0.26, porosity: 0.03, density: 1480, youngModulus: 3.4e9, tensileStrength: 1.5e7, yieldStress: 2.1e7, cohesion: 8e5, adhesion: 5e5}],
 ['crab-speckle-cream', 'Speckled crab mottling', '#d9ceb4', {roughness: 0.32, porosity: 0.04, density: 1410, youngModulus: 2.7e9, tensileStrength: 1.2e7, yieldStress: 1.7e7, cohesion: 6e5, adhesion: 4e5}],
 ['mole-crab-shell', 'Mole crab dome', '#9c8f70', {roughness: 0.24, porosity: 0.04, density: 1360, youngModulus: 2.2e9, tensileStrength: 9.5e6, yieldStress: 1.4e7, cohesion: 5e5, adhesion: 3e5}],
 ['hopper-amber', 'Amphipod chitin', '#9c7646', {roughness: 0.30, porosity: 0.06, density: 1280, youngModulus: 2.0e9, tensileStrength: 8.5e6, yieldStress: 1.2e7, cohesion: 5e5, adhesion: 3e5}],
 ['dragonlet-blue', 'Dragonlet thorax', '#35749e', {roughness: 0.24, metallic: 0.26, porosity: 0.06, density: 1160, youngModulus: 2.4e9, tensileStrength: 1.0e7, yieldStress: 1.5e7, cohesion: 5e5, adhesion: 3e5}],
 ['insect-wing', 'Translucent wing', '#dce4e8', {roughness: 0.20, opacity: 0.56, porosity: 0.02, density: 1080, youngModulus: 3.0e9, tensileStrength: 1.4e7, yieldStress: 1.8e7, cohesion: 4e5, adhesion: 3e5}],
 ['fish-dorsum', 'Fish dorsal scales', '#42624c', {roughness: 0.20, metallic: 0.18, porosity: 0.03, density: 1050, youngModulus: 6.5e7, tensileStrength: 2.5e6, yieldStress: 3.5e6, cohesion: 3e5, adhesion: 2e5}],
 ['fish-silver', 'Fish silver flank', '#d4e0e6', {roughness: 0.16, metallic: 0.42, porosity: 0.03, density: 1055, youngModulus: 6.5e7, tensileStrength: 2.5e6, yieldStress: 3.5e6, cohesion: 3e5, adhesion: 2e5}],
 ['pompano-gold', 'Pompano golden fin', '#dfb446', {roughness: 0.20, metallic: 0.24, porosity: 0.03, density: 1055, youngModulus: 6.5e7, tensileStrength: 2.5e6, yieldStress: 3.5e6, cohesion: 3e5, adhesion: 2e5}],
 ['killifish-blue', 'Killifish blue nape', '#3b698a', {roughness: 0.22, metallic: 0.18, porosity: 0.03, density: 1050, youngModulus: 6.5e7, tensileStrength: 2.5e6, yieldStress: 3.5e6, cohesion: 3e5, adhesion: 2e5}],
 ['scallop-shell', 'Scallop mottled valve', '#6b5642', {roughness: 0.34, porosity: 0.04, density: 1850, youngModulus: 3.8e9, tensileStrength: 1.8e7, yieldStress: 2.5e7, cohesion: 9e5, adhesion: 6e5}],
 ['scallop-mantle', 'Scallop sapphire & mantle', '#2876d8', {roughness: 0.18, metallic: 0.24, porosity: 0.03, density: 1120, youngModulus: 1.2e8, tensileStrength: 2.5e6, yieldStress: 3.5e6, cohesion: 3e5, adhesion: 2e5}],
 ['bird-plumage', 'Coastal plumage white', '#ece8df', {roughness: 0.56, porosity: 0.08, density: 620, youngModulus: 1.2e8, tensileStrength: 5.5e6, yieldStress: 8.5e6, cohesion: 3e5, adhesion: 2e5}],
 ['bird-slate', 'Shorebird grey-brown', '#6f7378', {roughness: 0.52, porosity: 0.08, density: 640, youngModulus: 1.2e8, tensileStrength: 5.5e6, yieldStress: 8.5e6, cohesion: 3e5, adhesion: 2e5}],
 ['gull-hood-black', 'Gull hood black', '#15171b', {roughness: 0.48, porosity: 0.06, density: 640, youngModulus: 1.2e8, tensileStrength: 5.5e6, yieldStress: 8.5e6, cohesion: 3e5, adhesion: 2e5}],
 ['tern-bill-orange', 'Tern orange bill', '#e85b14', {roughness: 0.24, porosity: 0.03, density: 1200, youngModulus: 2.4e9, tensileStrength: 1.0e7, yieldStress: 1.5e7, cohesion: 5e5, adhesion: 3e5}],
 ['fauna-eye-gloss', 'Glossy animal eye', '#0d0e11', {roughness: 0.10, porosity: 0.01, density: 1100, youngModulus: 1.2e8, tensileStrength: 3.0e6, yieldStress: 4.0e6, cohesion: 3e5, adhesion: 2e5}],
 ['stingray-skin', 'Atlantic stingray disc', '#8a734a', {roughness: 0.22, porosity: 0.04, density: 1090, youngModulus: 4.5e7, tensileStrength: 2.0e6, yieldStress: 3.0e6, cohesion: 3e5, adhesion: 2e5}],
 ['shark-skin', 'Bonnethead shark skin', '#666357', {roughness: 0.20, porosity: 0.03, density: 1085, youngModulus: 5.5e7, tensileStrength: 2.6e6, yieldStress: 3.8e6, cohesion: 3e5, adhesion: 2e5}],
 ['coquina-pastel', 'Coquina shell pastel', '#d8a6be', {roughness: 0.18, porosity: 0.02, density: 2600, youngModulus: 6.0e10, tensileStrength: 5.0e7, yieldStress: 8.0e7, cohesion: 5e6, adhesion: 2e6}],
 ['hermit-shell', 'Hermit gastropod shell', '#b89f78', {roughness: 0.44, porosity: 0.08, density: 2500, youngModulus: 5.2e10, tensileStrength: 4.5e7, yieldStress: 7.5e7, cohesion: 4e6, adhesion: 2e6}],
 ['racerunner-stripe', 'Racerunner olive stripe', '#6f7339', {roughness: 0.34, porosity: 0.04, density: 1080, youngModulus: 3.5e7, tensileStrength: 2.0e6, yieldStress: 3.0e6, cohesion: 3e5, adhesion: 2e5}],
 ['shrimp-glass', 'Translucent grass shrimp', '#b8c7ad', {roughness: 0.14, porosity: 0.02, density: 1060, youngModulus: 2.8e7, tensileStrength: 1.5e6, yieldStress: 2.2e6, cohesion: 2e5, adhesion: 1e5}],
];

export const FAUNA_DROP_PROFILE = Object.freeze({
 'ghost-crab': {defaultScale: 0.08, sculptScale: 3.0, medium: 'beach', hoverHeight: 0.0},
 'fiddler-crab': {defaultScale: 0.06, sculptScale: 3.0, medium: 'swale', hoverHeight: 0.0},
 'blue-crab': {defaultScale: 0.16, sculptScale: 2.6, medium: 'submerged', hoverHeight: 0.03},
 'speckled-crab': {defaultScale: 0.14, sculptScale: 2.6, medium: 'submerged', hoverHeight: 0.03},
 'bay-scallop': {defaultScale: 0.093, sculptScale: 3.0, medium: 'submerged', hoverHeight: 0.02},
 'mole-crab': {defaultScale: 0.06, sculptScale: 3.0, medium: 'swash', hoverHeight: 0.0},
 'beach-hopper': {defaultScale: 0.047, sculptScale: 3.0, medium: 'wrack', hoverHeight: 0.0},
 'sand-gnat': {defaultScale: 0.04, sculptScale: 3.0, medium: 'air', hoverHeight: 0.55},
 'kelp-fly': {defaultScale: 0.04, sculptScale: 3.0, medium: 'air', hoverHeight: 0.22},
 'dragonlet': {defaultScale: 0.073, sculptScale: 3.0, medium: 'air', hoverHeight: 0.65},
 'sanderling': {defaultScale: 0.12, sculptScale: 3.0, medium: 'beach', hoverHeight: 0.0},
 'laughing-gull': {defaultScale: 0.20, sculptScale: 2.6, medium: 'beach', hoverHeight: 0.0},
 'royal-tern': {defaultScale: 0.22, sculptScale: 2.6, medium: 'air', hoverHeight: 2.4},
 'baitfish': {defaultScale: 0.08, sculptScale: 3.0, medium: 'submerged', hoverHeight: 0.24},
 'pompano': {defaultScale: 0.18, sculptScale: 2.6, medium: 'submerged', hoverHeight: 0.22},
 'pinfish': {defaultScale: 0.15, sculptScale: 2.6, medium: 'submerged', hoverHeight: 0.26},
 'killifish': {defaultScale: 0.073, sculptScale: 3.0, medium: 'swale-water', hoverHeight: 0.05},
 'atlantic-stingray': {defaultScale: 0.30, sculptScale: 1.8, medium: 'submerged', hoverHeight: 0.08},
 'bonnethead-shark': {defaultScale: 0.40, sculptScale: 1.8, medium: 'submerged', hoverHeight: 0.22},
 'coquina-clam': {defaultScale: 0.08, sculptScale: 2.2, medium: 'surf', hoverHeight: 0.008},
 'hermit-crab': {defaultScale: 0.12, sculptScale: 2.0, medium: 'shore', hoverHeight: 0.018},
 'tiger-beetle': {defaultScale: 0.08, sculptScale: 2.2, medium: 'dry', hoverHeight: 0.014},
 'racerunner': {defaultScale: 0.24, sculptScale: 1.6, medium: 'dry', hoverHeight: 0.022},
 'grass-shrimp': {defaultScale: 0.10, sculptScale: 2.1, medium: 'submerged', hoverHeight: 0.06},
 'marsh-periwinkle': {defaultScale: 0.09, sculptScale: 2.2, medium: 'marsh', hoverHeight: 0.014},
});

export function installCoastalFaunaMaterials(library) {
 const existing = new Set(library.materials.map(m => m.id));
 for (const [id, name, color, opts] of FAUNA_MAT_DEFS) {
  const idx = library.materials.findIndex(m => m.id === id);
  if (idx >= 0) {
   Object.assign(library.materials[idx], {color, ...opts});
  } else if (library.materials.length < LIMITS.materials) {
   library.materials.push(material(id, name, color, {waterContent: 0.35, ...opts}));
   existing.add(id);
  }
 }
}

const UP = new Vector3(0, 1, 0);

function mountMark(body, id, seedPt, dir, upHint, length, width, curl, materialId, kind = 'ribbon', bias = 1, taper = 0.7) {
 const s = body._sculptScale || 1;
 const scaledSeed = s === 1 ? seedPt : [seedPt[0] * s, seedPt[1] * s, seedPt[2] * s];
 const mounted = projectMount(body, scaledSeed, 0.28 * s);
 if (!mounted) return false;
 const safeLen = Math.max(0.036, Math.min(3.8, length * s));
 const safeWid = Math.max(0.045, Math.min(0.88, width));
 const d = new Vector3(...dir);
 const u = new Vector3(...upHint);
 body.marks.push({
  id,
  kind,
  materialId,
  root: mounted.root,
  ...brushFrame(d, u),
  length: safeLen,
  width: safeWid,
  curl: Math.max(-0.98, Math.min(0.98, curl)),
  flex: kind === 'dab' ? 0.18 : 0.72,
  bias,
  taper,
 });
 return true;
}

export function growCoastalFaunaAsset(speciesId, seed = 2187) {
 const meta = FAUNA_SPECIES.find(s => s.id === speciesId);
 if (!meta) throw Error(`Unknown coastal fauna species: ${speciesId}`);
 const rng = randomSequence(seed);
 const drop = FAUNA_DROP_PROFILE[speciesId] || {defaultScale: 0.24, sculptScale: 1, medium: meta.medium, hoverHeight: 0.05};
 const S = drop.sculptScale || 1;
 const body = part(meta.commonName, []);
 body.id = 'body';
 body.marks = [];
 body._sculptScale = S;

 const addStamp = (shape, mode, pos, size, matId, blend = 0.03) => {
  body.stamps.push(stamp(
   shape, mode,
   pos.map(v => v * S),
   size.map(v => Math.max(0.028, v * S)),
   matId, blend * S
  ));
 };

 if (speciesId === 'ghost-crab' || speciesId === 'fiddler-crab') {
  const isFiddler = speciesId === 'fiddler-crab';
  const shellMat = isFiddler ? 'fiddler-carapace' : 'ghost-crab-shell';
  const clawMat = isFiddler ? 'fiddler-claw' : 'ghost-crab-shell';
  const rx = 0.125 + 0.014 * rng(), ry = 0.056 + 0.008 * rng(), rz = 0.104 + 0.012 * rng();
  const y0 = ry + 0.038;
  // Trapezoidal carapace: broad frontal brow tapering to narrower rear waist + gastric saddle
  addStamp('sphere', 'add', [0, y0, rz * 0.16], [rx * 0.98, ry * 0.96, rz * 0.80], shellMat, 0.032);
  addStamp('sphere', 'add', [0, y0 - 0.005, -rz * 0.24], [rx * 0.78, ry * 0.82, rz * 0.68], shellMat, 0.035);
  addStamp('box', 'add', [0, y0 + 0.006, rz * 0.12], [rx * 0.72, ry * 0.70, rz * 0.56], shellMat, 0.035);
  if (isFiddler) {
   // Hypertrophied major fiddle claw (palm + pollex) + hinged upper dactyl pincer + small spoon feeding claw
   addStamp('sphere', 'add', [rx * 1.18, y0 + 0.024, rz * 0.88], [0.092, 0.044, 0.042], clawMat, 0.025);
   addStamp('sphere', 'add', [-rx * 0.86, y0 - 0.01, rz * 0.82], [0.038, 0.028, 0.032], shellMat, 0.022);
   mountMark(body, 'dactyl-r', [rx * 1.05, y0 + 0.052, rz * 0.96], [0.92, 0.28, 0.26], UP, 0.115, 0.22, -0.32, 'crab-speckle-cream', 'ribbon', 0.9, 0.75);
   mountMark(body, 'dactyl-l', [-rx * 0.88, y0 - 0.008, rz * 0.96], [-0.45, -0.18, 0.88], UP, 0.058, 0.16, 0.22, shellMat, 'ribbon', 0.85, 0.72);
  } else {
   for (const s of [-1, 1]) {
    addStamp('sphere', 'add', [s * rx * 0.96, y0, rz * 0.90], [0.050, 0.032, 0.042], clawMat, 0.022);
    mountMark(body, `dactyl-${s > 0 ? 'r' : 'l'}`, [s * rx * 0.92, y0 + 0.016, rz * 1.06], [s * 0.35, 0.12, 0.92], UP, 0.068, 0.18, -0.26, 'crab-speckle-cream', 'ribbon', 0.9, 0.75);
   }
  }
  // Tall upright eyestalks & dark gastric H-groove
  mountMark(body, 'groove', [0, y0 + ry * 0.88, -rz * 0.05], [0, 0.05, -0.99], UP, 0.095, 0.56, 0.05, 'fiddler-carapace', 'dab', 1.0, 0.5);
  for (const s of [-1, 1]) {
   mountMark(body, `eye-${s > 0 ? 'r' : 'l'}`, [s * rx * 0.36, y0 + ry * 0.86, rz * 0.72],
    [s * 0.12, 0.96, 0.24], [0, 0, -1], 0.052, 0.38, 0.04, 'fauna-eye-gloss', 'dab');
   for (let l = 0; l < 4; l++) {
    const zOff = (0.55 - l * 0.38) * rz;
    const sweep = (0.35 - l * 0.24);
    mountMark(
     body, `leg-${s > 0 ? 'r' : 'l'}-${l}`,
     [s * rx * 0.90, y0 - ry * 0.15, zOff],
     [s * 0.92, -0.22, sweep], UP,
     0.128 + 0.02 * (l === 1 || l === 2 ? 1 : 0), 0.15, -0.48, shellMat, 'ribbon', 0.9, 0.75
    );
   }
  }
 } else if (speciesId === 'blue-crab' || speciesId === 'speckled-crab') {
  const isBlue = speciesId === 'blue-crab';
  const shellMat = isBlue ? 'blue-crab-shell' : 'ghost-crab-shell';
  const clawMat = isBlue ? 'blue-crab-claw' : 'fiddler-claw';
  const tipMat = isBlue ? 'crab-claw-red' : 'crab-speckle-cream';
  const rx = 0.165, ry = 0.044, rz = 0.096, y0 = ry + 0.028;
  addStamp('sphere', 'add', [0, y0, 0], [rx, ry, rz], shellMat, 0.03);
  addStamp('sphere', 'add', [0, y0 + 0.006, rz * 0.16], [rx * 0.65, ry * 1.14, rz * 0.78], shellMat, 0.032);
  if (isBlue) {
   // Callinectes signature lateral epibranchial spines
   for (const s of [-1, 1]) {
    addStamp('sphere', 'add', [s * rx * 1.12, y0 + 0.002, 0.008], [0.048, 0.028, 0.028], 'crab-speckle-cream', 0.02);
   }
  } else {
   // Arenaeus cream ocellated dorsal carapace dapples
   for (const [k, [ox, oz]] of [[-0.45, 0.22], [0.45, 0.22], [0, -0.18], [-0.28, -0.34], [0.28, -0.34]].entries()) {
    mountMark(body, `speckle-${k}`, [ox * rx, y0 + ry * 0.88, oz * rz], [ox * 0.2, 0.1, 0.95], UP, 0.042, 0.65, 0.04, 'crab-speckle-cream', 'dab', 1.0, 0.45);
   }
  }
  for (const s of [-1, 1]) {
   addStamp('sphere', 'add', [s * rx * 0.86, y0, rz * 0.84], [0.066, 0.028, 0.034], clawMat, 0.024);
   addStamp('sphere', 'add', [s * rx * 0.66, y0 + 0.004, rz * 1.30], [0.035, 0.028, 0.048], tipMat, 0.022);
   mountMark(body, `eye-${s > 0 ? 'r' : 'l'}`, [s * rx * 0.26, y0 + ry * 0.80, rz * 0.86], [s * 0.15, 0.72, 0.68], [0, 0, -1], 0.038, 0.42, 0.02, 'fauna-eye-gloss', 'dab');
   mountMark(body, `dactyl-${s > 0 ? 'r' : 'l'}`, [s * rx * 0.62, y0 + 0.016, rz * 1.48], [s * -0.18, 0.18, 0.96], UP, 0.062, 0.18, -0.18, tipMat, 'ribbon', 0.9, 0.78);
   mountMark(body, `paddle-${s > 0 ? 'r' : 'l'}`, [s * rx * 0.78, y0, -rz * 0.68],
    [s * 0.82, 0.05, -0.58], UP, 0.118, 0.36, 0.12, clawMat, 'ribbon', 1.2, 0.24);
   for (let l = 0; l < 3; l++) {
    mountMark(body, `leg-${s > 0 ? 'r' : 'l'}-${l}`, [s * rx * 0.88, y0 - 0.01, (0.35 - l * 0.34) * rz],
     [s * 0.94, -0.18, 0.22 - l * 0.28], UP, 0.108, 0.16, -0.35, clawMat, 'ribbon', 1.0, 0.72);
   }
  }
 } else if (speciesId === 'mole-crab') {
  const rx = 0.075, ry = 0.058, rz = 0.116, y0 = ry + 0.012;
  addStamp('sphere', 'add', [0, y0, 0], [rx, ry, rz], 'mole-crab-shell', 0.035);
  addStamp('sphere', 'add', [0, y0 + 0.014, rz * 0.56], [rx * 0.68, ry * 0.72, 0.052], 'crab-speckle-cream', 0.024);
  addStamp('sphere', 'add', [0, y0 - 0.014, -rz * 0.76], [rx * 0.62, ry * 0.55, 0.052], 'crab-chitin', 0.025);
  for (const s of [-1, 1]) {
   mountMark(body, `eye-${s > 0 ? 'r' : 'l'}`, [s * 0.022, y0 + ry * 0.78, rz * 0.76], [s * 0.18, 0.72, 0.66], [0, 0, -1], 0.038, 0.32, 0.02, 'fauna-eye-gloss', 'dab');
   mountMark(body, `antenna-${s > 0 ? 'r' : 'l'}`, [s * 0.026, y0 + 0.014, rz * 0.88],
    [s * 0.48, 0.36, 0.80], UP, 0.095, 0.28, 0.32, 'crab-speckle-cream', 'ribbon', 0.85, 0.65);
   mountMark(body, `leg-${s > 0 ? 'r' : 'l'}`, [s * rx * 0.88, y0 - 0.018, -rz * 0.32],
    [s * 0.72, -0.38, -0.58], UP, 0.068, 0.24, -0.22, 'crab-chitin', 'ribbon', 0.9, 0.45);
  }
 } else if (speciesId === 'beach-hopper') {
  addStamp('sphere', 'add', [0, 0.062, 0.078], [0.034, 0.044, 0.056], 'hopper-amber', 0.028);
  addStamp('sphere', 'add', [0, 0.072, 0.015], [0.034, 0.044, 0.062], 'hopper-amber', 0.028);
  addStamp('sphere', 'add', [0, 0.056, -0.052], [0.030, 0.038, 0.056], 'crab-chitin', 0.026);
  addStamp('sphere', 'add', [0, 0.036, -0.095], [0.028, 0.028, 0.044], 'insect-chitin', 0.022);
  for (const s of [-1, 1]) {
   mountMark(body, `eye-${s > 0 ? 'r' : 'l'}`, [s * 0.024, 0.078, 0.118], [s * 0.6, 0.3, 0.7], [0, 0, -1], 0.036, 0.36, 0.02, 'fauna-eye-gloss', 'dab');
   mountMark(body, `ant-${s > 0 ? 'r' : 'l'}`, [s * 0.014, 0.068, 0.125],
    [s * 0.34, 0.46, 0.82], UP, 0.12, 0.14, -0.35, 'crab-claw-red', 'ribbon', 0.75, 0.85);
   mountMark(body, `leg-${s > 0 ? 'r' : 'l'}`, [s * 0.028, 0.042, 0.025],
    [s * 0.55, -0.78, 0.22], UP, 0.056, 0.14, -0.25, 'hopper-amber', 'ribbon', 0.9, 0.78);
   mountMark(body, `uro-${s > 0 ? 'r' : 'l'}`, [s * 0.012, 0.032, -0.115],
    [s * 0.28, -0.20, -0.94], UP, 0.074, 0.18, 0.24, 'hopper-amber', 'ribbon', 0.9, 0.75);
  }
 } else if (speciesId === 'dragonlet') {
  // 4-segment smoothly tapering horizontal metallic abdomen along -Z + deep thorax + glossy compound eye dome
  addStamp('sphere', 'add', [0, 0.074, 0.022], [0.022, 0.022, 0.045], 'dragonlet-blue', 0.018);
  addStamp('sphere', 'add', [0, 0.072, -0.040], [0.017, 0.017, 0.048], 'dragonlet-blue', 0.018);
  addStamp('sphere', 'add', [0, 0.069, -0.105], [0.014, 0.014, 0.048], 'dragonlet-blue', 0.016);
  addStamp('sphere', 'add', [0, 0.066, -0.165], [0.011, 0.011, 0.038], 'killifish-blue', 0.014);
  addStamp('sphere', 'add', [0, 0.082, 0.082], [0.038, 0.040, 0.048], 'dragonlet-blue', 0.022);
  addStamp('sphere', 'add', [0, 0.088, 0.130], [0.042, 0.034, 0.032], 'fauna-eye-gloss', 0.018);
  for (const s of [-1, 1]) {
   mountMark(body, `wing-f-${s > 0 ? 'r' : 'l'}`, [s * 0.032, 0.114, 0.095],
    [s * 0.96, 0.14, 0.18], UP, 0.24, 0.14, -0.04, 'insect-wing', 'ribbon', 1.15, 0.28);
   mountMark(body, `wing-h-${s > 0 ? 'r' : 'l'}`, [s * 0.032, 0.106, 0.052],
    [s * 0.94, 0.10, -0.22], UP, 0.22, 0.17, -0.04, 'insect-wing', 'ribbon', 1.15, 0.30);
   mountMark(body, `leg-${s > 0 ? 'r' : 'l'}`, [s * 0.024, 0.052, 0.078],
    [s * 0.45, -0.78, 0.42], UP, 0.056, 0.12, -0.3, 'fauna-eye-gloss', 'ribbon', 0.85, 0.85);
  }
 } else if (speciesId === 'sand-gnat' || speciesId === 'kelp-fly') {
  const isFly = speciesId === 'kelp-fly';
  const bodyMat = isFly ? 'fish-dorsum' : 'insect-chitin';
  addStamp('sphere', 'add', [0, 0.062, 0.045], [0.032, 0.032, 0.046], bodyMat, 0.02);
  addStamp('sphere', 'add', [0, 0.056, -0.045], [0.028, 0.028, 0.056], isFly ? 'hopper-amber' : 'insect-chitin', 0.022);
  if (isFly) {
   addStamp('sphere', 'add', [0, 0.068, 0.088], [0.032, 0.028, 0.028], 'crab-claw-red', 0.018);
  }
  for (const s of [-1, 1]) {
   mountMark(body, `wing-${s > 0 ? 'r' : 'l'}`, [s * 0.028, 0.086, 0.032],
    [s * 0.84, 0.28, -0.45], UP, isFly ? 0.145 : 0.135, 0.26, -0.08, 'insect-wing', 'ribbon', 1.1, 0.28);
   mountMark(body, `leg-${s > 0 ? 'r' : 'l'}`, [s * 0.024, 0.038, 0.02],
    [s * 0.62, -0.76, 0.08], UP, 0.064, 0.12, -0.22, 'insect-chitin', 'ribbon', 0.9, 0.82);
  }
 } else if (speciesId === 'bay-scallop') {
  addStamp('sphere', 'add', [0, 0.032, 0.008], [0.132, 0.028, 0.126], 'bird-plumage', 0.024);
  addStamp('sphere', 'add', [0, 0.060, 0.014], [0.126, 0.028, 0.122], 'scallop-shell', 0.024);
  addStamp('sphere', 'add', [0, 0.045, -0.108], [0.095, 0.028, 0.034], 'scallop-shell', 0.02);
  mountMark(body, 'valve-top', [0, 0.082, 0.015], [0, 0.20, 0.98], UP, 0.14, 0.62, 0.08, 'scallop-shell', 'dab', 1.0, 0.45);
  for (const [k, sx] of [-0.75, -0.35, 0, 0.35, 0.75].entries()) {
   mountMark(body, `rib-${k}`, [sx * 0.095, 0.076, 0.005], [sx * 0.52, 0.14, 0.84], UP, 0.115, 0.18, -0.06, 'crab-speckle-cream', 'ribbon', 0.9, 0.60);
  }
  for (const s of [-1, 0, 1]) {
   mountMark(body, `eye-${s === 0 ? 'c' : s > 0 ? 'r' : 'l'}`, [s * 0.056, 0.044, 0.115], [s * 0.28, 0.15, 0.94], UP, 0.022, 0.26, 0.02, 'scallop-mantle', 'dab');
  }
 } else if (speciesId === 'sanderling' || speciesId === 'laughing-gull' || speciesId === 'royal-tern') {
  const isSander = speciesId === 'sanderling';
  const isGull = speciesId === 'laughing-gull';
  const isTern = speciesId === 'royal-tern';
  const cy = isSander ? 0.14 : isGull ? 0.185 : 0.15;
  const bodyLen = isTern ? 0.185 : isGull ? 0.165 : 0.132;
  const bodyWid = isSander ? 0.056 : 0.066;
  const bodyHt = isSander ? 0.052 : 0.060;
  // Smooth white underbody + clean neck taper + lifted slate dorsal saddle + species hood/crest
  addStamp('sphere', 'add', [0, cy - bodyHt * 0.16, 0], [bodyWid, bodyHt * 0.84, bodyLen], 'bird-plumage', 0.028);
  addStamp('sphere', 'add', [0, cy + bodyHt * 0.30, -0.018], [bodyWid * 0.86, bodyHt * 0.52, bodyLen * 0.82], isSander ? 'ghost-crab-shell' : 'bird-slate', 0.024);
  addStamp('sphere', 'add', [0, cy + bodyHt * 0.44, bodyLen * 0.54], [bodyWid * 0.56, bodyHt * 0.56, bodyWid * 0.62], 'bird-plumage', 0.024);
  addStamp('sphere', 'add', [0, cy + bodyHt * 0.68, bodyLen * 0.72], [bodyWid * 0.56, bodyWid * 0.56, bodyWid * 0.66], isGull ? 'gull-hood-black' : 'bird-plumage', 0.020);
  if (isTern) addStamp('sphere', 'add', [0, cy + bodyHt * 1.05, bodyLen * 0.58], [0.032, 0.028, 0.058], 'gull-hood-black', 0.018);
  if (isSander) addStamp('sphere', 'add', [0, cy + bodyHt * 0.98, bodyLen * 0.70], [0.030, 0.028, 0.038], 'bird-slate', 0.018);
  const billMat = isTern ? 'tern-bill-orange' : isGull ? 'crab-claw-red' : 'fauna-eye-gloss';
  mountMark(body, 'bill', [0, cy + bodyHt * 0.64, bodyLen * 1.02], [0, -0.14, 0.99], UP, isTern ? 0.135 : 0.095, 0.15, 0.04, billMat, 'ribbon', 0.8, 0.88);
  if (isTern) {
   for (const s of [-1, 1]) {
    mountMark(body, `tail-${s > 0 ? 'r' : 'l'}`, [s * bodyWid * 0.25, cy + 0.012, -bodyLen * 0.92], [s * 0.26, 0.10, -0.96], UP, 0.18, 0.22, -0.04, 'bird-plumage', 'ribbon', 1.0, 0.65);
   }
  } else {
   mountMark(body, 'tail', [0, cy + 0.012, -bodyLen * 0.94], [0, 0.10, -0.99], UP, 0.115, 0.34, -0.04, 'bird-plumage', 'ribbon', 1.0, 0.45);
  }
  for (const s of [-1, 1]) {
   mountMark(body, `eye-${s > 0 ? 'r' : 'l'}`, [s * bodyWid * 0.50, cy + bodyHt * 0.76, bodyLen * 0.82], [s * 0.7, 0.2, 0.68], [0, 0, -1], 0.020, 0.24, 0.02, 'fauna-eye-gloss', 'dab');
   if (isGull) {
    mountMark(body, `arc-${s > 0 ? 'r' : 'l'}`, [s * bodyWid * 0.52, cy + bodyHt * 0.72, bodyLen * 0.72], [s * 0.4, 0.2, 0.88], UP, 0.022, 0.16, 0.04, 'bird-plumage', 'dab');
   }
   mountMark(body, `wing-${s > 0 ? 'r' : 'l'}`, [s * bodyWid * 0.84, cy + bodyHt * 0.26, 0.01],
    [s * (isTern || isGull ? 0.96 : 0.48), 0.12, -0.45], UP, isTern ? 0.38 : isGull ? 0.33 : 0.16, isTern || isGull ? 0.30 : 0.36, -0.08, 'bird-slate', 'ribbon', 1.1, 0.45);
   if (isGull || isTern) {
    mountMark(body, `wing-tip-${s > 0 ? 'r' : 'l'}`, [s * bodyWid * 0.78, cy + bodyHt * 0.22, -0.06],
     [s * 0.88, 0.08, -0.46], UP, 0.20, 0.22, -0.08, 'gull-hood-black', 'ribbon', 1.0, 0.65);
   }
   mountMark(body, `leg-${s > 0 ? 'r' : 'l'}`, [s * bodyWid * 0.36, cy - bodyHt * 0.85, -0.005],
    [0, -0.99, 0.08], [0, 0, 1], Math.max(0.055, cy - 0.02), 0.15, -0.05, isGull ? 'crab-claw-red' : 'fauna-eye-gloss', 'ribbon', 0.9, 0.88);
  }
 } else if (speciesId === 'atlantic-stingray') {
  addStamp('sphere', 'add', [0, 0.048, 0.015], [0.225, 0.030, 0.205], 'stingray-skin', 0.035);
  addStamp('sphere', 'add', [0, 0.052, 0.125], [0.110, 0.028, 0.125], 'stingray-skin', 0.03);
  addStamp('sphere', 'add', [0, 0.066, 0.065], [0.086, 0.030, 0.120], 'stingray-skin', 0.03);
  addStamp('sphere', 'add', [0, 0.032, 0.010], [0.195, 0.028, 0.185], 'bird-plumage', 0.03);
  mountMark(body, 'spine', [0, 0.064, -0.185], [0, 0.28, -0.96], UP, 0.095, 0.12, 0.10, 'crab-speckle-cream', 'ribbon', 0.85, 0.85);
  for (const s of [-1, 1]) {
   mountMark(body, `eye-${s > 0 ? 'r' : 'l'}`, [s * 0.042, 0.088, 0.105], [s * 0.2, 0.92, 0.32], [0, 0, -1], 0.038, 0.34, 0.02, 'fauna-eye-gloss', 'dab');
   mountMark(body, `wing-${s > 0 ? 'r' : 'l'}`, [s * 0.14, 0.048, 0.015],
    [s * 0.96, 0.04, -0.22], UP, 0.23, 0.74, 0.08, 'stingray-skin', 'ribbon', 1.0, 0.42);
  }
  mountMark(body, 'tail', [0, 0.042, -0.20], [0, 0.02, -0.99], UP, 0.34, 0.13, 0.06, 'stingray-skin', 'ribbon', 0.9, 0.88);
 } else if (speciesId === 'bonnethead-shark') {
  const cy = 0.098;
  addStamp('sphere', 'add', [0, cy + 0.010, 0.02], [0.044, 0.052, 0.245], 'shark-skin', 0.03);
  addStamp('sphere', 'add', [0, cy - 0.022, 0.02], [0.040, 0.036, 0.215], 'bird-plumage', 0.03);
  addStamp('sphere', 'add', [0, cy + 0.008, 0.245], [0.118, 0.028, 0.050], 'shark-skin', 0.025);
  addStamp('sphere', 'add', [0, cy, -0.225], [0.028, 0.032, 0.072], 'shark-skin', 0.025);
  mountMark(body, 'dorsal-fin', [0, cy + 0.056, 0.02], [0, 0.82, -0.56], [0, 0, -1], 0.125, 0.42, -0.14, 'shark-skin', 'ribbon', 0.95, 0.58);
  mountMark(body, 'dorsal-2', [0, cy + 0.030, -0.155], [0, 0.75, -0.66], [0, 0, -1], 0.058, 0.32, -0.10, 'shark-skin', 'ribbon', 0.9, 0.58);
  mountMark(body, 'tail-up', [0, cy + 0.016, -0.265], [0, 0.56, -0.82], UP, 0.16, 0.28, -0.06, 'shark-skin', 'ribbon', 1.1, 0.48);
  mountMark(body, 'tail-dn', [0, cy - 0.015, -0.255], [0, -0.45, -0.89], UP, 0.095, 0.24, 0.05, 'bird-plumage', 'ribbon', 1.0, 0.48);
  for (const s of [-1, 1]) {
   mountMark(body, `eye-${s > 0 ? 'r' : 'l'}`, [s * 0.108, cy + 0.014, 0.245], [s * 0.92, 0.15, 0.35], UP, 0.036, 0.32, 0.02, 'fauna-eye-gloss', 'dab');
   mountMark(body, `pec-${s > 0 ? 'r' : 'l'}`, [s * 0.040, cy - 0.02, 0.07],
    [s * 0.85, -0.16, -0.48], UP, 0.115, 0.36, 0.08, 'shark-skin', 'ribbon', 1.0, 0.45);
  }
 } else if (speciesId === 'coquina-clam') {
  const cy = 0.075;
  addStamp('sphere', 'add', [0, cy, 0.015], [0.056, 0.044, 0.092], 'coquina-pastel', 0.025);
  addStamp('sphere', 'add', [0, cy + 0.014, -0.045], [0.046, 0.038, 0.058], 'ghost-crab-shell', 0.022);
  mountMark(body, 'foot', [0, cy - 0.025, 0.095], [0, -0.45, 0.89], UP, 0.068, 0.34, 0.08, 'ghost-crab-shell', 'ribbon', 0.9, 0.45);
  mountMark(body, 'siphon', [0, cy + 0.020, -0.095], [0, 0.62, -0.78], [0, 0, -1], 0.052, 0.24, -0.06, 'shrimp-glass', 'ribbon', 0.85, 0.50);
  mountMark(body, 'siphon-r', [0.012, cy + 0.018, -0.092], [0.12, 0.60, -0.79], [0, 0, -1], 0.048, 0.22, 0.05, 'shrimp-glass', 'ribbon', 0.85, 0.50);
 } else if (speciesId === 'hermit-crab') {
  const cy = 0.095;
  addStamp('sphere', 'add', [-0.01, cy + 0.015, -0.015], [0.082, 0.072, 0.092], 'hermit-shell', 0.028);
  addStamp('sphere', 'add', [0.038, cy + 0.055, -0.095], [0.052, 0.048, 0.064], 'ghost-crab-shell', 0.024);
  addStamp('sphere', 'add', [0, cy - 0.018, 0.065], [0.048, 0.036, 0.046], 'fiddler-claw', 0.022);
  for (const s of [-1, 1]) {
   const side = s > 0 ? 'r' : 'l';
   mountMark(body, `eye-${side}`, [s * 0.026, cy + 0.010, 0.102], [s * 0.24, 0.45, 0.86], UP, 0.040, 0.28, 0.02, 'fauna-eye-gloss', 'dab');
   mountMark(body, `dactyl-${side}`, [s * 0.044, cy - 0.022, 0.095], [s * 0.35, -0.25, 0.90], UP, 0.085 * (s > 0 ? 1.15 : 0.95), 0.34, s * 0.14, 'fiddler-claw', 'ribbon', 0.95, 0.42);
   mountMark(body, `leg-${side}-0`, [s * 0.048, cy - 0.026, 0.060], [s * 0.88, -0.42, 0.20], UP, 0.105, 0.24, -0.25, 'racerunner-stripe', 'ribbon', 0.9, 0.55);
   mountMark(body, `leg-${side}-1`, [s * 0.052, cy - 0.026, 0.032], [s * 0.90, -0.40, -0.18], UP, 0.100, 0.24, -0.25, 'racerunner-stripe', 'ribbon', 0.9, 0.55);
  }
 } else if (speciesId === 'tiger-beetle') {
  const cy = 0.072;
  addStamp('sphere', 'add', [0, cy + 0.008, -0.020], [0.062, 0.046, 0.095], 'ghost-crab-shell', 0.022);
  addStamp('sphere', 'add', [0, cy + 0.010, 0.068], [0.042, 0.036, 0.048], 'racerunner-stripe', 0.020);
  addStamp('sphere', 'add', [0, cy + 0.012, 0.106], [0.046, 0.034, 0.038], 'racerunner-stripe', 0.018);
  for (const s of [-1, 1]) {
   const side = s > 0 ? 'r' : 'l';
   mountMark(body, `eye-${side}`, [s * 0.042, cy + 0.022, 0.114], [s * 0.72, 0.32, 0.62], UP, 0.036, 0.34, 0.02, 'fauna-eye-gloss', 'dab');
   mountMark(body, `wing-${side}`, [s * 0.034, cy + 0.048, 0.015], [s * 0.18, 0.14, -0.97], UP, 0.135, 0.52, -0.08, 'ghost-crab-shell', 'ribbon', 0.95, 0.35);
   mountMark(body, `leg-${side}-0`, [s * 0.042, cy - 0.024, 0.055], [s * 0.86, -0.46, 0.22], UP, 0.115, 0.20, -0.22, 'racerunner-stripe', 'ribbon', 0.88, 0.60);
   mountMark(body, `leg-${side}-1`, [s * 0.052, cy - 0.024, -0.015], [s * 0.88, -0.44, -0.20], UP, 0.125, 0.20, -0.22, 'racerunner-stripe', 'ribbon', 0.88, 0.60);
  }
 } else if (speciesId === 'racerunner') {
  const cy = 0.068;
  addStamp('sphere', 'add', [0, cy + 0.008, 0.125], [0.036, 0.032, 0.065], 'racerunner-stripe', 0.022);
  addStamp('sphere', 'add', [0, cy + 0.004, 0.015], [0.046, 0.038, 0.110], 'gull-hood-black', 0.026);
  addStamp('sphere', 'add', [0, cy - 0.002, -0.095], [0.034, 0.030, 0.072], 'racerunner-stripe', 0.022);
  mountMark(body, 'tail-mid', [0, cy - 0.004, -0.155], [0, -0.04, -0.99], UP, 0.175, 0.42, 0.05, 'racerunner-stripe', 'ribbon', 1.0, 0.35);
  mountMark(body, 'tail-tip', [0, cy - 0.006, -0.165], [0, -0.02, -0.99], UP, 0.195, 0.24, -0.04, 'killifish-blue', 'ribbon', 1.0, 0.65);
  for (const s of [-1, 1]) {
   const side = s > 0 ? 'r' : 'l';
   mountMark(body, `eye-${side}`, [s * 0.032, cy + 0.018, 0.132], [s * 0.78, 0.24, 0.58], UP, 0.036, 0.32, 0.02, 'fauna-eye-gloss', 'dab');
   mountMark(body, `stripe-${side}`, [s * 0.028, cy + 0.034, 0.080], [0, 0.04, -0.99], UP, 0.195, 0.18, 0.02, 'pompano-gold', 'ribbon', 0.95, 0.18);
   mountMark(body, `leg-f${side}`, [s * 0.040, cy - 0.016, 0.075], [s * 0.88, -0.40, 0.25], UP, 0.092, 0.26, -0.18, 'racerunner-stripe', 'ribbon', 0.9, 0.48);
   mountMark(body, `leg-b${side}`, [s * 0.042, cy - 0.016, -0.045], [s * 0.88, -0.38, -0.26], UP, 0.115, 0.30, -0.20, 'racerunner-stripe', 'ribbon', 0.9, 0.48);
  }
 } else if (speciesId === 'grass-shrimp') {
  const cy = 0.072;
  addStamp('sphere', 'add', [0, cy + 0.012, 0.038], [0.036, 0.040, 0.088], 'shrimp-glass', 0.024);
  addStamp('sphere', 'add', [0, cy + 0.004, -0.060], [0.030, 0.034, 0.076], 'shrimp-glass', 0.024);
  mountMark(body, 'abdomen', [0, cy + 0.010, -0.065], [0, -0.22, -0.97], UP, 0.125, 0.44, -0.18, 'shrimp-glass', 'ribbon', 0.95, 0.38);
  mountMark(body, 'tail-fan', [0, cy - 0.018, -0.130], [0, -0.15, -0.98], UP, 0.072, 0.64, 0.05, 'pompano-gold', 'ribbon', 0.95, 0.20);
  for (const s of [-1, 1]) {
   const side = s > 0 ? 'r' : 'l';
   mountMark(body, `eye-${side}`, [s * 0.026, cy + 0.026, 0.110], [s * 0.56, 0.36, 0.74], UP, 0.036, 0.30, 0.02, 'fauna-eye-gloss', 'dab');
   mountMark(body, `ant-${side}`, [s * 0.022, cy + 0.014, 0.118], [s * 0.62, 0.22, -0.75], UP, 0.165, 0.16, 0.14, 'shrimp-glass', 'ribbon', 0.85, 0.72);
  }
 } else if (speciesId === 'marsh-periwinkle') {
  const cy = 0.075;
  addStamp('sphere', 'add', [0, cy - 0.008, 0.005], [0.068, 0.058, 0.070], 'fish-silver', 0.026);
  addStamp('sphere', 'add', [0, cy + 0.048, -0.022], [0.046, 0.052, 0.048], 'hermit-shell', 0.022);
  mountMark(body, 'foot', [0, cy - 0.052, 0.025], [0, -0.15, 0.98], UP, 0.095, 0.58, 0.04, 'ghost-crab-shell', 'ribbon', 0.9, 0.28);
  for (const s of [-1, 1]) {
   const side = s > 0 ? 'r' : 'l';
   mountMark(body, `tentacle-${side}`, [s * 0.028, cy - 0.028, 0.068], [s * 0.48, 0.32, 0.82], UP, 0.064, 0.20, 0.10, 'racerunner-stripe', 'ribbon', 0.88, 0.60);
  }
 } else {
  // Fish morphotypes: baitfish, pompano, pinfish, killifish
  const isPompano = speciesId === 'pompano';
  const isKillifish = speciesId === 'killifish';
  const isPinfish = speciesId === 'pinfish';
  const bodyLen = isPompano ? 0.165 : isPinfish ? 0.155 : isKillifish ? 0.142 : 0.172;
  const bodyHt = isPompano ? 0.086 : isPinfish ? 0.068 : isKillifish ? 0.050 : 0.036;
  const bodyWid = isKillifish ? 0.036 : isPompano ? 0.032 : 0.030;
  const topMat = isKillifish ? 'killifish-blue' : 'fish-dorsum';
  const bellyMat = isPompano ? 'pompano-gold' : 'fish-silver';
  const cy = bodyHt + 0.026;
  addStamp('sphere', 'add', [0, cy + bodyHt * 0.16, 0.015], [bodyWid, bodyHt * 0.86, bodyLen], topMat, 0.03);
  addStamp('sphere', 'add', [0, cy - bodyHt * 0.20, 0.010], [bodyWid * 0.94, bodyHt * 0.72, bodyLen * 0.90], bellyMat, 0.03);
  addStamp('sphere', 'add', [0, cy, -bodyLen * 0.76], [0.028, Math.max(0.028, bodyHt * 0.42), 0.056], bellyMat, 0.024);
  const tailMat = isPompano || isPinfish ? 'pompano-gold' : bellyMat;
  if (isKillifish) {
   mountMark(body, 'tail-mid', [0, cy, -bodyLen * 1.02], [0, 0.0, -1.0], UP, 0.095, 0.68, 0.02, tailMat, 'ribbon', 1.05, 0.12);
  } else {
   mountMark(body, 'tail-up', [0, cy + 0.015, -bodyLen * 1.05], [0, 0.46, -0.88], UP, 0.108, 0.34, -0.05, tailMat, 'ribbon', 1.1, 0.26);
   mountMark(body, 'tail-dn', [0, cy - 0.015, -bodyLen * 1.05], [0, -0.46, -0.88], UP, 0.108, 0.34, 0.05, tailMat, 'ribbon', 1.1, 0.26);
  }
  mountMark(body, 'dorsal-fin', [0, cy + bodyHt * 0.92, isKillifish ? -0.045 : -0.01], [0, 0.74, -0.67], [0, 0, -1], isPompano ? 0.105 : 0.078, 0.56, -0.15, topMat, 'ribbon', 0.95, 0.45);
  if (isPompano) {
   mountMark(body, 'anal-fin', [0, cy - bodyHt * 0.78, -0.03], [0, -0.72, -0.69], [0, 0, -1], 0.092, 0.42, 0.14, 'pompano-gold', 'ribbon', 0.95, 0.48);
  }
  for (const s of [-1, 1]) {
   mountMark(body, `eye-${s > 0 ? 'r' : 'l'}`, [s * bodyWid * 0.84, cy + bodyHt * 0.18, bodyLen * 0.68], [s * 0.75, 0.15, 0.64], [0, 0, -1], 0.036, 0.34, 0.02, 'fauna-eye-gloss', 'dab');
   if (isPinfish) {
    mountMark(body, `spot-${s > 0 ? 'r' : 'l'}`, [s * bodyWid * 0.96, cy + bodyHt * 0.24, bodyLen * 0.24], [s * 0.9, 0.1, 0.42], UP, 0.042, 0.56, 0.04, 'gull-hood-black', 'dab', 1.0, 0.4);
   }
   mountMark(body, `pec-${s > 0 ? 'r' : 'l'}`, [s * bodyWid * 0.88, cy - bodyHt * 0.22, 0.045],
    [s * 0.78, -0.15, -0.60], UP, 0.068, 0.38, 0.08, tailMat, 'ribbon', 1.0, 0.35);
  }
 }

 delete body._sculptScale;
 return {
  id: 'fauna-' + speciesId,
  name: `Animal · ${meta.commonName}`,
  spacing: 0.05,
  duration: 3,
  variation: {distribution: 'centered', size: 0.12, twist: 25, width: 0, curl: 0},
  fauna: {
   speciesId,
   guild: meta.guild,
   defaultScale: drop.defaultScale,
   sculptScale: S,
   medium: drop.medium,
   hoverHeight: drop.hoverHeight,
  },
  parts: [body],
 };
}

export function installCoastalFaunaAssets(library, seed = 2187) {
 const rng = randomSequence((seed ^ 0x9e3779b9) >>> 0);
 library.families ??= [];
 let fam = library.families.find(f => f.id === 'example-coastal-fauna');
 if (!fam) {
  fam = {id: 'example-coastal-fauna', name: 'Coastal fauna', members: []};
  library.families.push(fam);
 }
 fam.members = [];
 for (const spec of FAUNA_SPECIES) {
  const assetId = 'fauna-' + spec.id;
  library.assets = library.assets.filter(a => a.id !== assetId);
  const aSeed = Math.floor(rng() * 4294967296);
  const a = growCoastalFaunaAsset(spec.id, aSeed);
  library.assets.push(a);
  fam.members.push({assetId: a.id, weight: 1});
 }
}
