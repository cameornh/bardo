// St. Andrews State Park / Shell Island coastal beach ecosystem assembly.
// All 20 botanical species and 13 coastal animal assets are generated procedurally
// so every flora & fauna specimen is an editable studio asset with joints & Gaussian marks.
import {Wetland} from './wetland.js';
import {randomSequence} from './family.js';
import {DEFAULT_COASTAL_CLIMATE} from './coastal-climate.js';
import {
 COASTAL_SPECIES, SPECIES_BY_ID, growCoastalSpecies,
 growCrown, installCoastalMaterials, speciesSuitability
} from './coastal-flora.js';
import {installCoastalFaunaAssets, installCoastalFaunaMaterials} from './coastal-fauna-assets.js';

export const GARDEN_SEED = 2187;
export {growCrown};

const TAU = 2 * Math.PI;
// 3 focal hero flora species (14 parts) leaving 18 free preview part slots
// inside LIMITS.previewParts (32) so users can freely drop in animals & sculpts.
const FOCAL_IDS = [
 'coastal-reed',
 'sea-oats',
 'needlerush'
];

export function populateWindGarden(library, place, seed = GARDEN_SEED, climateOverrides = null) {
 const rng = randomSequence(seed);
 const family = library.families.find(f => f.id === 'example-rushes');
 const oldIds = family.members.map(m => m.assetId);
 library.assets = library.assets.filter(a => !oldIds.includes(a.id));

 const climate = {...DEFAULT_COASTAL_CLIMATE, ...(climateOverrides || {})};
 library.world.climate = climate;
 library.world.wind = {
  speed: climate.prevailingWindSpeed,
  heading: climate.prevailingWindHeading,
  turbulence: 0.72
 };
 installCoastalMaterials(library);
 installCoastalFaunaMaterials(library);

 const landscape = new Wetland(seed, climate, library.materials.find(m => m.id === 'sand'));
 library.world.wetlandSeed = landscape.seed;

 family.name = 'Coastal dune flora';
 family.members = [];
 const generated = new Map();
 for (const spec of COASTAL_SPECIES) {
  const assetSeed = Math.floor(rng() * 4294967296);
  const a = growCoastalSpecies(spec.id, assetSeed);
  a.ecology = {
   guild: spec.guild,
   scientificName: spec.scientificName,
   maxRenderDist: spec.maxRenderDist,
   conform: spec.conform ?? 0,
   canopyTint: spec.canopyTint
  };
  library.assets.push(a);
  family.members.push({assetId: a.id, weight: 1});
  generated.set(spec.id, a);
 }
 installCoastalFaunaAssets(library, seed);

 // Place a curated 6-species focal transect near the opening swale/foredune bank
 // totaling 28 parts (<= 32 LIMITS.previewParts), while all 14 species populate
 // the unbounded surrounding barrier island.
 const placed = [];
 for (const [idx, speciesId] of FOCAL_IDS.entries()) {
  const spec = SPECIES_BY_ID.get(speciesId);
  const asset = generated.get(speciesId);
  let bestX = (idx - 3) * 1.4, bestZ = 0, bestScore = -Infinity;
  const searchRadius = speciesId === 'coastal-reed' || speciesId === 'needlerush' ? 8 : 26;
  for (let attempt = 0; attempt < 96; attempt++) {
   const angle = rng() * TAU;
   const dist = Math.sqrt(rng()) * searchRadius;
   const cx = dist * Math.cos(angle), cz = dist * Math.sin(angle);
   const clearance = placed.reduce((min, p) => Math.min(min, Math.hypot(cx - p.x, cz - p.z)), Infinity);
   if (clearance < 1.30) continue;
   const env = landscape.environment(cx, cz);
   const suit = speciesSuitability(spec, env);
   const score = suit * 4 - dist * 0.045 + Math.min(2.0, clearance) * 0.15;
   if (score > bestScore) { bestX = cx; bestZ = cz; bestScore = score; }
   if (suit > 0.78 && clearance > 2.0 && dist < 14) break;
  }
  placed.push({x: bestX, z: bestZ});
  const y = landscape.height(bestX, bestZ);
  const size = 0.86 + 0.24 * rng();
  place(speciesId, bestX, y, bestZ, rng() * 360, size, speciesId + '-' + (idx + 1));
 }
}
