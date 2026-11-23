// Barrier-island geomorphology, continuous coastal environmental fields and
// travel-order-independent plant recruitment calibrated to St. Andrews State Park /
// Shell Island, Florida. CPU samplers and GLSL functions share exact arithmetic.
import {randomSequence} from './family.js';
import {
 ALONG_DIR_X, ALONG_DIR_Z, INLAND_DIR_X, INLAND_DIR_Z,
 DEFAULT_COASTAL_CLIMATE, climateHydrology
} from './coastal-climate.js';
import {COASTAL_SPECIES, SPECIES_BY_ID, phenotypicPlasticity, speciesSuitability} from './coastal-flora.js';

export const REED_TILE = 18;
const BALD_CELL = 11;
const clamp = (t, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, t));
const smooth = t => { const u = clamp(t); return u * u * (3 - 2 * u); };
const smoothstep = (a, b, x) => smooth((x - a) / (b - a));

function hash(x, z) {
 let n = Math.imul(x, 1597334677) ^ Math.imul(z, 3812015801);
 n = Math.imul(n ^ (n >>> 16), 2246822519);
 return ((n ^ (n >>> 13)) >>> 8) / 16777216;
}

function noise(x, z) {
 const i = Math.floor(x), j = Math.floor(z);
 const a = smooth(x - i), b = smooth(z - j);
 return (1 - b) * ((1 - a) * hash(i, j) + a * hash(i + 1, j))
  + b * ((1 - a) * hash(i, j + 1) + a * hash(i + 1, j + 1));
}

function coastCurve(along) {
 return 13.5 * (noise(along / 128 + 3.1, 7.7) - 0.5)
  + 5.2 * (noise(along / 48 - 1.7, 19.3) - 0.5)
  + 1.6 * (noise(along / 19 + 5.4, 2.3) - 0.5);
}

function crossShore(x, z) {
 const along = ALONG_DIR_X * x + ALONG_DIR_Z * z;
 const cross = INLAND_DIR_X * x + INLAND_DIR_Z * z;
 return cross - coastCurve(along);
}

function land(x, z) {
 const along = ALONG_DIR_X * x + ALONG_DIR_Z * z;
 const cross = INLAND_DIR_X * x + INLAND_DIR_Z * z;
 const d = cross - coastCurve(along);
 const beachFactor = smoothstep(-2, 4, d);

 // Seaward shoreface (<0): gently sloping white quartz shelf + submerged longshore sandbar at d ~ -34 m
 let surf = 0;
 if (beachFactor < 1) {
  const shoreface = -3.7 * (1 - Math.exp(-Math.max(0, -d) / 52));
  const longshoreBar = 0.72 * Math.exp(-Math.pow((d + 34) / 11, 2));
  surf = shoreface + longshoreBar;
 }
 if (beachFactor <= 0) return surf;

 // Dry beach berm & gentle beach cusps (d in [0, 22])
 const berm = 0.88 * smoothstep(-2, 17, d)
  + 0.14 * Math.sin(along * 0.14) * Math.exp(-Math.pow((d - 7) / 8, 2));

 // Asymmetric wind-built primary foredune ridge (d ~ 33 m) with natural aeolian blowouts
 const foreShape = Math.exp(-Math.pow((d - 32.5) / 10.5, 2));
 let foredune = 0;
 if (foreShape > 1e-6) {
  const foreAsym = 0.65 + 0.55 * smoothstep(21, 35, d) * (1 - 0.35 * smoothstep(35, 48, d));
  const blowout = 0.42 + 0.58 * smoothstep(0.24, 0.76, noise(along / 44 + 4.2, 13.1));
  foredune = (2.15 + 1.65 * noise(along / 68, 29.7)) * foreShape * foreAsym * blowout;
 }

 // Primary interdunal swale trough (d ~ 58 m) undulating between freshwater slack ponds and damp banks
 const swaleMask = Math.exp(-Math.pow((d - 58.5) / 14.5, 2));
 let swale = 0;
 if (swaleMask > 1e-6) {
  const swaleWave = -2.15 + 1.45 * noise(along / 32 + 9.4, d / 26) + 0.50 * noise(along / 15, d / 14 + 3.1);
  swale = swaleMask * swaleWave;
 }

 // Back-barrier secondary/tertiary asymmetric ridges & interior slacks (d in [72, 235])
 const backMask = smoothstep(70, 96, d) * (1 - smoothstep(215, 265, d));
 let backDunes = 0;
 if (backMask > 0) {
  const warp = 17 * noise(along / 46, d / 26) + 7 * noise(along / 20 + 8, d / 48);
  const phase = (d + warp) * 0.195;
  const ridge = 0.5 + 0.5 * Math.sin(phase + 0.50 * Math.sin(phase - 0.48));
  const macroHills = 3.2 * (noise(along / 64, d / 50) - 0.42) + 1.6 * (noise(along / 31 + 11, d / 47) - 0.45);
  backDunes = backMask * (0.45 + macroHills + (1.1 + 2.9 * noise(along / 51, d / 33 + 17)) * ridge * ridge);
 }

 // Back-barrier estuarine bay / lagoon (d > 240 m) with scattered marsh hammocks
 const bayMask = smoothstep(230, 275, d);
 let backBay = 0;
 if (bayMask > 0) {
  const hammock = 1.55 * smoothstep(0.56, 0.84, noise(along / 38 + 21, d / 38 + 5));
  backBay = bayMask * (-1.35 + hammock + 0.45 * (noise(along / 22, d / 22) - 0.5));
 }

 const micro = 0.065 * (noise(along / 5.5, cross / 5.5) - 0.5);
 return (1 - beachFactor) * surf + beachFactor * (berm + foredune + swale + backDunes + backBay + micro);
}

// Keep wetlandGLSL self-contained (requires only `uniform vec2 survey;`) so standalone
// elevation checks and sand-drift shaders compile without extra climate uniforms.
export const wetlandGLSL = `
 uniform vec2 survey;
 float landHash(ivec2 p){
  uint n=uint(p.x)*1597334677u ^ uint(p.y)*3812015801u;
  n=(n^(n>>16u))*2246822519u;
  return float((n^(n>>13u))>>8u)/16777216.;
 }
 float landNoise(vec2 p){
  ivec2 i=ivec2(floor(p));vec2 f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(landHash(i),landHash(i+ivec2(1,0)),f.x),
   mix(landHash(i+ivec2(0,1)),landHash(i+ivec2(1)),f.x),f.y);
 }
 float landCoastCurve(float along){
  return 13.5*(landNoise(vec2(along/128.+3.1,7.7))-.5)
   +5.2*(landNoise(vec2(along/48.-1.7,19.3))-.5)
   +1.6*(landNoise(vec2(along/19.+5.4,2.3))-.5);
 }
 float landShoreDist(vec2 pos){
  vec2 p=pos+survey;
  float along=dot(p,vec2(.906308,-.422618));
  float crossV=dot(p,vec2(.422618,.906308));
  return crossV-landCoastCurve(along);
 }
 float landHeight(vec2 pos){
  vec2 p=pos+survey;
  float along=dot(p,vec2(.906308,-.422618));
  float crossV=dot(p,vec2(.422618,.906308));
  float d=crossV-landCoastCurve(along);
  float beachFactor=smoothstep(-2.,4.,d);
  float surf=0.;
  if(beachFactor<1.){
   float shoreface=-3.7*(1.-exp(-max(0.,-d)/52.));
   float longshoreBar=.72*exp(-pow((d+34.)/11.,2.));
   surf=shoreface+longshoreBar;
  }
  if(beachFactor<=0.)return surf;
  float berm=.88*smoothstep(-2.,17.,d)+.14*sin(along*.14)*exp(-pow((d-7.)/8.,2.));
  float foreShape=exp(-pow((d-32.5)/10.5,2.));
  float foredune=0.;
  if(foreShape>1e-6){
   float foreAsym=.65+.55*smoothstep(21.,35.,d)*(1.-.35*smoothstep(35.,48.,d));
   float blowout=.42+.58*smoothstep(.24,.76,landNoise(vec2(along/44.+4.2,13.1)));
   foredune=(2.15+1.65*landNoise(vec2(along/68.,29.7)))*foreShape*foreAsym*blowout;
  }
  float swaleMask=exp(-pow((d-58.5)/14.5,2.));
  float swale=0.;
  if(swaleMask>1e-6){
   float swaleWave=-2.15+1.45*landNoise(vec2(along/32.+9.4,d/26.))+.50*landNoise(vec2(along/15.,d/14.+3.1));
   swale=swaleMask*swaleWave;
  }
  float backMask=smoothstep(70.,96.,d)*(1.-smoothstep(215.,265.,d));
  float backDunes=0.;
  if(backMask>0.){
   float warp=17.*landNoise(vec2(along/46.,d/26.))+7.*landNoise(vec2(along/20.+8.,d/48.));
   float phase=(d+warp)*.195;
   float ridge=.5+.5*sin(phase+.50*sin(phase-.48));
   float macroHills=3.2*(landNoise(vec2(along/64.,d/50.))-.42)+1.6*(landNoise(vec2(along/31.+11.,d/47.))-.45);
   backDunes=backMask*(.45+macroHills+(1.1+2.9*landNoise(vec2(along/51.,d/33.+17.)))*ridge*ridge);
  }
  float bayMask=smoothstep(230.,275.,d);
  float backBay=0.;
  if(bayMask>0.){
   float hammock=1.55*smoothstep(.56,.84,landNoise(vec2(along/38.+21.,d/38.+5.)));
   backBay=bayMask*(-1.35+hammock+.45*(landNoise(vec2(along/22.,d/22.))-.5));
  }
  float micro=.065*(landNoise(vec2(along/5.5,crossV/5.5))-.5);
  return (1.-beachFactor)*surf+beachFactor*(berm+foredune+swale+backDunes+backBay+micro);
 }`;

// Continuous coastal environmental fields matching CPU Wetland.environment(x,z).
// coastalClimateA = vec4(seaLevel, lensHeight, capillaryFringe, saltScale)
// coastalClimateB = vec4(moistureIndex, windDirX, windDirZ, sandScale)
export const coastalFieldsGLSL = `
 uniform vec4 coastalClimateA,coastalClimateB;
 struct CoastalField{
  float h,d,waterTable,moisture,salinity,windExposure,saltSpray,sandMobility,organicMatter,rosemaryInhibition;
 };
 float baldStrength(vec2 pos,float d,float h){
  float baseDatum=coastalClimateA.x,lensHeight=coastalClimateA.y,capFringe=coastalClimateA.z,saltScale=coastalClimateA.w;
  float moistIdx=coastalClimateB.x;
  float tideFactor=max(.74+.26*exp(-max(0.,d)/24.),smoothstep(225.,270.,d));
  float datum=baseDatum*tideFactor;
  float wt=datum+lensHeight*(1.-exp(-max(0.,d)/42.));
  float psi=max(0.,h-wt);
  float alphaVG=1.65/max(.15,capFringe);
  float se=psi<=0.?1.:pow(1.+pow(max(1e-6,alphaVG*psi),3.2),-.6875);
  float moist=h<=datum+.02?1.:clamp(se*.94+.06*clamp(moistIdx*.6,0.,1.),0.,1.);
  float sal=clamp(.92*exp(-max(0.,d)/18.)+smoothstep(235.,275.,d)*.72+clamp(1.-moistIdx*.45,.1,.9)*.18+max(0.,datum)*.45,0.,1.);
  float spray=h<=datum?0.:saltScale*(.14+.86*exp(-max(0.,d)/56.))*pow(14./(14.+max(0.,d)),.42)*(1.+.18*clamp(h,0.,5.));
  float e=smoothstep(1.35,2.0,h)*(1.-smoothstep(.10,.26,moist))*(1.-smoothstep(.24,.46,spray))*(1.-smoothstep(.12,.30,sal));
  return e;
 }
 float rosemaryBaldAt(vec2 pos){
  vec2 worldP=pos+survey;
  ivec2 base=ivec2(floor(worldP/${BALD_CELL}.));
  float best=0.;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
   ivec2 c=base+ivec2(i,j);
   float rx=landHash(c*ivec2(13,37)+ivec2(5,9));
   float rz=landHash(c*ivec2(29,11)+ivec2(17,3));
   float gate=landHash(c*ivec2(41,23)+ivec2(11,19));
   if(gate<.56)continue;
   vec2 fp=(vec2(c)+vec2(.15+.70*rx,.15+.70*rz))*${BALD_CELL}.-survey;
   vec2 diff=pos-fp;float d2=dot(diff,diff);
   if(d2>64.)continue;
   float fd=landShoreDist(fp),fh=landHeight(fp);
   float str=baldStrength(fp,fd,fh);
   if(str<.22)continue;
   float halo=exp(-d2/5.5225)*str;
   best=max(best,halo);
  }
  return clamp(best,0.,1.);
 }
 CoastalField sampleCoastalField(vec2 pos,float h,float slope){
  CoastalField f;
  f.h=h;
  f.d=landShoreDist(pos);
  float baseDatum=coastalClimateA.x,lensHeight=coastalClimateA.y,capFringe=coastalClimateA.z,saltScale=coastalClimateA.w;
  float moistIdx=coastalClimateB.x,sandScale=coastalClimateB.w;
  vec2 wDir=coastalClimateB.yz;
  float tideFactor=max(.74+.26*exp(-max(0.,f.d)/24.),smoothstep(225.,270.,f.d));
  float datum=baseDatum*tideFactor;
  f.waterTable=datum+lensHeight*(1.-exp(-max(0.,f.d)/42.));
  float dtw=h-f.waterTable;
  float psi=max(0.,dtw);
  float alphaVG=1.65/max(.15,capFringe);
  float se=psi<=0.?1.:pow(1.+pow(max(1e-6,alphaVG*psi),3.2),-.6875);
  f.moisture=h<=datum+.02?1.:clamp(se*.94+.06*clamp(moistIdx*.6,0.,1.),0.,1.);
  float gulfSal=.92*exp(-max(0.,f.d)/18.);
  float baySal=smoothstep(235.,275.,f.d)*.72;
  float lensDil=clamp(1.-moistIdx*.45,.08,.85)*.16*exp(-max(0.,dtw)/1.8);
  f.salinity=clamp(gulfSal+baySal+lensDil+max(0.,datum)*.45,0.,1.);
  // Jackson & Hunt (1975) / Hesp (2002) topographic speedup & upwind lee shelter
  float h6=landHeight(pos-wDir*6.),h16=landHeight(pos-wDir*16.),h34=landHeight(pos-wDir*34.),h58=landHeight(pos-wDir*58.);
  float relief=(h-h6)*.14+(h-h16)*.09+(h-h34)*.055+(h-h58)*.035;
  float shelter=max(0.,max(max(h6-h,h16-h*.95-.2),max(h34-h-.55,h58-h-1.05)));
  f.windExposure=clamp(1.+relief-clamp(shelter*.34,0.,.68),.28,1.58);
  float spDecay=(.14+.86*exp(-max(0.,f.d)/56.))*pow(14./(14.+max(0.,f.d)),.42);
  f.saltSpray=h<=datum?0.:saltScale*spDecay*f.windExposure*(1.+.18*clamp(h,0.,5.));
  f.sandMobility=h<=datum?0.:sandScale*pow(1.-f.moisture,2.2)*pow(f.windExposure,1.8)*(.30+.70*exp(-max(0.,f.d)/80.))*(1.-.45*smoothstep(.25,.6,slope));
  f.rosemaryInhibition=rosemaryBaldAt(pos);
  float swaleOrg=smoothstep(-.25,.25,f.moisture)*(1.-smoothstep(.35,.75,f.sandMobility))*smoothstep(32.,68.,f.d);
  float scrubOrg=smoothstep(.95,2.2,h)*(1.-smoothstep(.15,.45,f.sandMobility))*smoothstep(65.,115.,f.d);
  f.organicMatter=clamp((.62*swaleOrg+.34*scrubOrg)*(1.-.85*f.rosemaryInhibition),0.,1.);
  return f;
 }`;

export function waterSurfaceHeight(land, x, z, windSpeed = 0) {
 if (!land) return 0;
 const d = land.shoreDistance(x, z);
 const seaLevel = land.climate?.seaLevelOffset ?? 0;
 const lensHeight = land.hydrology?.lensHeight ?? 0.31;
 const tideFactor = Math.max(0.74 + 0.26 * Math.exp(-Math.max(0, d) / 24), smoothstep(225, 270, d));
 const datum = seaLevel * tideFactor;
 const localWT = datum + lensHeight * (1 - Math.exp(-Math.max(0, d) / 42));
 const swashPad = 0.14 + 0.014 * Math.max(0, windSpeed - 5);
 const swash = swashPad * Math.exp(-Math.max(0, d) / 6.5);
 return Math.max(datum + swash, localWT);
}

export function isDrySandAt(land, x, z, windSpeed = 0, margin = 0.06) {
 if (!land) return true;
 return land.height(x, z) >= waterSurfaceHeight(land, x, z, windSpeed) + margin;
}

function baldSeedAt(cx, cz) {
 const rx = hash(Math.imul(cx, 13) + 5, Math.imul(cz, 37) + 9);
 const rz = hash(Math.imul(cx, 29) + 17, Math.imul(cz, 11) + 3);
 const gate = hash(Math.imul(cx, 41) + 11, Math.imul(cz, 23) + 19);
 if (gate < 0.56) return null;
 return {
  wx: (cx + 0.15 + 0.70 * rx) * BALD_CELL,
  wz: (cz + 0.15 + 0.70 * rz) * BALD_CELL
 };
}

export class Wetland {
 constructor(seed, climate = DEFAULT_COASTAL_CLIMATE, sandMaterial = null) {
  this.seed = seed >>> 0;
  this.sandMaterial = sandMaterial;
  this.setClimate(climate, sandMaterial);
  const rng = randomSequence(this.seed);
  const along0 = (rng() - 0.5) * 16000;
  const cross0 = 50;
  const baseX = ALONG_DIR_X * along0 + INLAND_DIR_X * cross0;
  const baseZ = ALONG_DIR_Z * along0 + INLAND_DIR_Z * cross0;
  let best = Infinity;
  // Survey along the interdunal foredune-toe / slack-pond corridor so (0,0) opens onto
  // a sloping pond bank overlooking both a primary foredune blowout and the open Gulf.
  for (let i = 0; i < 640; i++) {
   const alongShift = (i % 32 - 16) * 6.5 + (rng() - 0.5) * 3;
   const crossShift = (Math.floor(i / 32) - 10) * 2.2;
   const px = baseX + ALONG_DIR_X * alongShift + INLAND_DIR_X * crossShift;
   const pz = baseZ + ALONG_DIR_Z * alongShift + INLAND_DIR_Z * crossShift;
   const d = crossShore(px, pz);
   if (d < 36 || d > 66) continue;
   const h = land(px, pz);
   const slope = Math.hypot(land(px + 1, pz) - h, land(px, pz + 1) - h);
   const pond = Math.min(
    land(px + ALONG_DIR_X * 11, pz + ALONG_DIR_Z * 11),
    land(px - ALONG_DIR_X * 11, pz - ALONG_DIR_Z * 11),
    land(px + INLAND_DIR_X * 9, pz + INLAND_DIR_Z * 9)
   );
   const foredune = Math.max(
    land(px - INLAND_DIR_X * 20, pz - INLAND_DIR_Z * 20),
    land(px - INLAND_DIR_X * 25, pz - INLAND_DIR_Z * 25)
   );
   const backdune = land(px + INLAND_DIR_X * 36, pz + INLAND_DIR_Z * 36);
   const cost = Math.abs(h - 0.24) * 1.4
    + Math.abs(slope - 0.16) * 0.55
    + 1.6 * Math.max(0, pond + 0.55)
    + 0.9 * Math.max(0, 2.3 - foredune)
    + 0.45 * Math.max(0, 1.5 - backdune);
   if (cost < best) { best = cost; this.x = px; this.z = pz; }
   if (cost < 0.04) break;
  }
 }

 setClimate(climate = DEFAULT_COASTAL_CLIMATE, sandMaterial = this.sandMaterial ?? null) {
  this.sandMaterial = sandMaterial;
  this.climate = {...DEFAULT_COASTAL_CLIMATE, ...(climate || {})};
  this.hydrology = climateHydrology(this.climate, sandMaterial);
  const rad = this.climate.prevailingWindHeading * Math.PI / 180;
  this.windDirX = Math.cos(rad);
  this.windDirZ = Math.sin(rad);
 }

 height(x, z) {
  return land(x + this.x, z + this.z);
 }

 shoreDistance(x, z) {
  return crossShore(x + this.x, z + this.z);
 }

 slope(x, z, h = this.height(x, z)) {
  const dx = this.height(x + 0.4, z) - h;
  const dz = this.height(x, z + 0.4) - h;
  return Math.hypot(dx, dz) / 0.4;
 }

 windExposure(x, z, h = this.height(x, z)) {
  const wx = this.windDirX, wz = this.windDirZ;
  const h6 = this.height(x - wx * 6, z - wz * 6);
  const h16 = this.height(x - wx * 16, z - wz * 16);
  const h34 = this.height(x - wx * 34, z - wz * 34);
  const h58 = this.height(x - wx * 58, z - wz * 58);
  const relief = (h - h6) * 0.14 + (h - h16) * 0.09 + (h - h34) * 0.055 + (h - h58) * 0.035;
  const shelter = Math.max(0, h6 - h, h16 - h * 0.95 - 0.2, h34 - h - 0.55, h58 - h - 1.05);
  return clamp(1 + relief - clamp(shelter * 0.34, 0, 0.68), 0.28, 1.58);
 }

 rosemaryBaldStrength(px, pz) {
  const d = this.shoreDistance(px, pz), h = this.height(px, pz);
  const {seaLevelOffset} = this.climate;
  const {lensHeight, capillaryFringe, moistureIndex, saltScale} = this.hydrology;
  const tideFactor = Math.max(0.74 + 0.26 * Math.exp(-Math.max(0, d) / 24), smoothstep(225, 270, d));
  const datum = seaLevelOffset * tideFactor;
  const wt = datum + lensHeight * (1 - Math.exp(-Math.max(0, d) / 42));
  const psi = Math.max(0, h - wt);
  const alphaVG = 1.65 / Math.max(0.15, capillaryFringe);
  const se = psi <= 0 ? 1 : Math.pow(1 + Math.pow(Math.max(1e-6, alphaVG * psi), 3.2), -0.6875);
  const moist = h <= datum + 0.02 ? 1 : clamp(se * 0.94 + 0.06 * clamp(moistureIndex * 0.6, 0, 1), 0, 1);
  const sal = clamp(0.92 * Math.exp(-Math.max(0, d) / 18) + smoothstep(235, 275, d) * 0.72 + clamp(1 - moistureIndex * 0.45, 0.1, 0.9) * 0.18 + Math.max(0, datum) * 0.45, 0, 1);
  const spray = h <= datum ? 0 : saltScale * (0.14 + 0.86 * Math.exp(-Math.max(0, d) / 56)) * Math.pow(14 / (14 + Math.max(0, d)), 0.42) * (1 + 0.18 * clamp(h, 0, 5));
  return smoothstep(1.35, 2.0, h) * (1 - smoothstep(0.10, 0.26, moist)) * (1 - smoothstep(0.24, 0.46, spray)) * (1 - smoothstep(0.12, 0.30, sal));
 }

 rosemaryInhibition(x, z) {
  const wx = x + this.x, wz = z + this.z;
  const bx = Math.floor(wx / BALD_CELL), bz = Math.floor(wz / BALD_CELL);
  let best = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
   const seed = baldSeedAt(bx + i, bz + j);
   if (!seed) continue;
   const fx = seed.wx - this.x, fz = seed.wz - this.z;
   const dx = x - fx, dz = z - fz, d2 = dx * dx + dz * dz;
   if (d2 > 64) continue;
   const str = this.rosemaryBaldStrength(fx, fz);
   if (str < 0.22) continue;
   const halo = Math.exp(-d2 / 5.5225) * str;
   if (halo > best) best = halo;
  }
  return clamp(best, 0, 1);
 }

 environment(x, z, h = this.height(x, z)) {
  const d = this.shoreDistance(x, z);
  const slope = this.slope(x, z, h);
  const {seaLevelOffset} = this.climate;
  const {lensHeight, capillaryFringe, moistureIndex, saltScale, sandScale} = this.hydrology;
  const tideFactor = Math.max(0.74 + 0.26 * Math.exp(-Math.max(0, d) / 24), smoothstep(225, 270, d));
  const datum = seaLevelOffset * tideFactor;
  const waterTable = datum + lensHeight * (1 - Math.exp(-Math.max(0, d) / 42));
  const depthToWater = h - waterTable;
  const psi = Math.max(0, depthToWater);
  const alphaVG = 1.65 / Math.max(0.15, capillaryFringe);
  const se = psi <= 0 ? 1 : Math.pow(1 + Math.pow(Math.max(1e-6, alphaVG * psi), 3.2), -0.6875);
  const moisture = h <= datum + 0.02 ? 1
   : clamp(se * 0.94 + 0.06 * clamp(moistureIndex * 0.6, 0, 1), 0, 1);
  const gulfSal = 0.92 * Math.exp(-Math.max(0, d) / 18);
  const baySal = smoothstep(235, 275, d) * 0.72;
  const lensDil = clamp(1 - moistureIndex * 0.45, 0.08, 0.85) * 0.16 * Math.exp(-Math.max(0, depthToWater) / 1.8);
  const salinity = clamp(gulfSal + baySal + lensDil + Math.max(0, datum) * 0.45, 0, 1);
  const windExposure = this.windExposure(x, z, h);
  const spDecay = (0.14 + 0.86 * Math.exp(-Math.max(0, d) / 56)) * Math.pow(14 / (14 + Math.max(0, d)), 0.42);
  const saltSpray = h <= datum ? 0 : saltScale * spDecay * windExposure * (1 + 0.18 * clamp(h, 0, 5));
  const sandMobility = h <= datum ? 0
   : sandScale * Math.pow(1 - moisture, 2.2) * Math.pow(windExposure, 1.8) * (0.30 + 0.70 * Math.exp(-Math.max(0, d) / 80)) * (1 - 0.45 * smoothstep(0.25, 0.6, slope));
  const rosemaryInhibition = this.rosemaryInhibition(x, z);
  const swaleOrg = smoothstep(-0.25, 0.25, moisture) * (1 - smoothstep(0.35, 0.75, sandMobility)) * smoothstep(32, 68, d);
  const scrubOrg = smoothstep(0.95, 2.2, h) * (1 - smoothstep(0.15, 0.45, sandMobility)) * smoothstep(65, 115, d);
  const organicMatter = clamp((0.62 * swaleOrg + 0.34 * scrubOrg) * (1 - 0.85 * rosemaryInhibition), 0, 1);
  return {
   elevation: h, shoreDistance: d, slope, waterTable, depthToWater,
   moisture, salinity, windExposure, saltSpray, sandMobility,
   organicMatter, rosemaryInhibition, windDirX: this.windDirX, windDirZ: this.windDirZ
  };
 }

 suitability(x, z, h = this.height(x, z)) {
  const env = this.environment(x, z, h);
  const reed = SPECIES_BY_ID.get('coastal-reed');
  const s = speciesSuitability(reed, env);
  if (s <= 0) return 0;
  return s * (0.15 + 0.85 * smoothstep(0.20, 0.75, noise((x + this.x) / 9, (z + this.z) / 9)));
 }

 // Wind-aligned biogeomorphic nebkha hummock vs blowout corridor patch field (Stallins 2005).
 nebkhaPatch(x, z) {
  const wx = x + this.x, wz = z + this.z;
  const alongW = wx * this.windDirX + wz * this.windDirZ;
  const crossW = -wx * this.windDirZ + wz * this.windDirX;
  const macro = noise(alongW / 24 + 3.7, crossW / 18 - 5.1);
  const meso = noise(alongW / 8.5 - 7.3, crossW / 6.5 + 11.4);
  return smoothstep(0.16, 0.80, 0.62 * macro + 0.38 * meso);
 }

 // Deterministic, travel-order-independent clonal recruitment across all active coastal species.
 crowns(tx, tz, assetsOrCount = COASTAL_SPECIES.length) {
  const speciesPool = [];
  if (Array.isArray(assetsOrCount)) {
   for (const [variant, a] of assetsOrCount.entries()) {
    const spec = SPECIES_BY_ID.get(a?.speciesId) ?? COASTAL_SPECIES.find(s => a?.id === 'example-' + s.id || a?.name === s.name) ?? COASTAL_SPECIES[0];
    speciesPool.push({variant, spec});
   }
  } else {
   const count = Math.max(1, Number(assetsOrCount) || 1);
   if (count === 1) speciesPool.push({variant: 0, spec: COASTAL_SPECIES[0]});
   else for (let v = 0; v < Math.min(count, COASTAL_SPECIES.length); v++) speciesPool.push({variant: v, spec: COASTAL_SPECIES[v]});
  }
  if (!speciesPool.length) return [];

  const salt = (Math.floor(hash(tx, tz) * 4294967296) ^ this.seed) >>> 0;
  const r = randomSequence(salt);
  const out = [];
  const nearSame = (x, z, clearance) => out.some(p => Math.hypot(p.x - x, p.z - z) < clearance);

  const emitColony = (entry, cx, cz, founderIdx, patchVal = 0.5) => {
   const {variant, spec} = entry;
   const [rMin, rMax] = spec.ramets;
   const denseHummock = patchVal > 0.46 && (spec.guild === 'foredune' || spec.guild === 'wetland' || spec.id === 'beach-elder');
   const maxRamets = denseHummock ? rMax + 1 : rMax;
   const count = rMin + Math.floor(r() * (maxRamets - rMin + 1));
   const orientation = r() * Math.PI * 2;
   const colonyScale = (denseHummock ? 0.84 : 0.78) + 0.34 * r();
   const clearScale = denseHummock ? 0.56 : 0.72;
   for (let j = 0; j < count; j++) {
    const angle = orientation + j * 2.39996 + 0.45 * r();
    const reach = j ? Math.sqrt(r()) * spec.spreadRadius : 0;
    const x = cx + reach * Math.cos(angle), z = cz + reach * Math.sin(angle);
    const y = this.height(x, z);
    const env = this.environment(x, z, y);
    const suit = speciesSuitability(spec, env);
    if (suit < 0.07) continue;
    if (nearSame(x, z, spec.minClearance * clearScale)) continue;
    const plast = phenotypicPlasticity(spec, env, r);
    const size = Math.max(0.45, Math.min(1.45, colonyScale * plast.sizeScale));
    const slopeX = (this.height(x + 0.4, z) - y) / 0.4;
    const slopeZ = (this.height(x, z + 0.4) - y) / 0.4;
    out.push({
     id: 'stand/' + tx + '/' + tz + '/' + founderIdx + '/' + j,
     x, y, z, yaw: r() * Math.PI * 2, size, variant, speciesId: spec.id,
     subVariant: r() < 0.5 ? 0 : 1,
     vitality: plast.vitality, leanX: plast.leanX, leanZ: plast.leanZ,
     slopeX, slopeZ,
     hueShift: (r() - 0.5) * 0.16
    });
   }
  };

  // Pass 1: Deterministic Florida Rosemary founders synchronized with allelopathic balds
  const rosemaryEntry = speciesPool.find(e => e.spec.id === 'rosemary');
  if (rosemaryEntry) {
   const x0 = tx * REED_TILE, x1 = (tx + 1) * REED_TILE;
   const z0 = tz * REED_TILE, z1 = (tz + 1) * REED_TILE;
   const cx0 = Math.floor((x0 + this.x) / BALD_CELL), cx1 = Math.floor((x1 + this.x) / BALD_CELL);
   const cz0 = Math.floor((z0 + this.z) / BALD_CELL), cz1 = Math.floor((z1 + this.z) / BALD_CELL);
   let bIdx = 0;
   for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
    const seed = baldSeedAt(cx, cz);
    if (!seed) continue;
    const fx = seed.wx - this.x, fz = seed.wz - this.z;
    if (fx < x0 || fx >= x1 || fz < z0 || fz >= z1) continue;
    const str = this.rosemaryBaldStrength(fx, fz);
    if (str >= 0.22) emitColony(rosemaryEntry, fx, fz, 'bald-' + bIdx++, 0.6);
   }
  }

  // Pass 2: Stochastic ecological lottery across the 18x18 m tile driven by
  // Stallins nebkha/blowout spatial clustering and Gibson & Looney zonation.
  const attempts = speciesPool.length === 1 ? 48 : 38;
  for (let i = 0; i < attempts; i++) {
   const cx = (tx + r()) * REED_TILE, cz = (tz + r()) * REED_TILE;
   const y = this.height(cx, cz);
   const env = this.environment(cx, cz, y);
   if (y < this.climate.seaLevelOffset - 0.62) continue;

   const patch = this.nebkhaPatch(cx, cz);
   const weights = [];
   let total = 0;
   for (const entry of speciesPool) {
    const sid = entry.spec.id;
    let w = speciesSuitability(entry.spec, env);
    if (sid === 'sea-oats' || sid === 'bitter-panic' || sid === 'beach-elder' || sid === 'gulf-bluestem') {
     w *= 0.22 + 1.35 * patch;
    } else if (sid === 'railroad-vine' || sid === 'goldenaster' || sid === 'prickly-pear' || sid === 'sea-rocket' || sid === 'dune-sunflower' || sid === 'sea-purslane') {
     // Edge / blowout colonists skirt hummocks and advance across open quartz sand
     w *= 0.35 + 0.65 * (1 - 0.55 * patch);
    } else if (sid === 'rosemary') {
     w *= 0.28;
    } else if (entry.spec.guild === 'wetland') {
     w *= 0.55 + 0.75 * patch;
    } else if (sid === 'slash-pine' || sid === 'sand-pine' || sid === 'sand-live-oak' || sid === 'cabbage-palm') {
     w *= 0.85 + 1.65 * patch;
    } else {
     w *= 0.35 + 0.85 * patch;
    }
    weights.push(w);
    total += w;
   }
   const maxSuit = Math.max(...weights);
   if (total <= 1e-4 || r() >= Math.min(0.95, maxSuit * 1.15)) continue;

   let pick = r() * total, chosen = speciesPool[0];
   for (let k = 0; k < speciesPool.length; k++) {
    pick -= weights[k];
    if (pick <= 0) { chosen = speciesPool[k]; break; }
   }
   emitColony(chosen, cx, cz, i, patch);
  }
  return out;
 }

 // Deterministic coastal transect camera viewpoints grounded in actual survey topography.
 transectViewpoints() {
  const sampleAt = dTarget => {
   const along0 = 0;
   let bestX = 0, bestZ = 0, bestErr = Infinity;
   for (let step = -90; step <= 110; step += 2) {
    const px = INLAND_DIR_X * step + ALONG_DIR_X * along0;
    const pz = INLAND_DIR_Z * step + ALONG_DIR_Z * along0;
    const err = Math.abs(this.shoreDistance(px, pz) - dTarget);
    if (err < bestErr) { bestErr = err; bestX = px; bestZ = pz; }
   }
   return {x: bestX, z: bestZ, y: this.height(bestX, bestZ)};
  };
  const swale = sampleAt(54);
  const foredune = sampleAt(30);
  const beach = sampleAt(11);
  const alongW0 = ALONG_DIR_X * this.x + ALONG_DIR_Z * this.z;
  const wrackD = 9.8 + (this.climate?.seaLevelOffset ?? 0) * 5.0 + 2.2 * Math.sin(alongW0 * 0.14) + 1.8 * Math.sin(alongW0 * 0.053 + 1.4);
  const wrackEdge = sampleAt(wrackD);
  const reef = sampleAt(-11);
  const scrub = sampleAt(96);

  // Find nearest open freshwater swale pond basin (h < -0.22 within d in [42, 74]).
  let pond = null, fallbackPond = null;
  for (let along = -54; along <= 54; along += 3) {
   for (let cross = -20; cross <= 32; cross += 2) {
    const px = ALONG_DIR_X * along + INLAND_DIR_X * cross;
    const pz = ALONG_DIR_Z * along + INLAND_DIR_Z * cross;
    const d = this.shoreDistance(px, pz);
    if (d < 42 || d > 74) continue;
    const h = this.height(px, pz);
    const score = h + 0.008 * Math.hypot(px, pz);
    if (h < -0.22 && (!pond || score < pond.score)) pond = {x: px, z: pz, y: h, score};
    if (!fallbackPond || score < fallbackPond.score) fallbackPond = {x: px, z: pz, y: h, score};
   }
  }
  pond ??= fallbackPond ?? swale;
  const bankX = pond.x + ALONG_DIR_X * 6 + INLAND_DIR_X * 3.5;
  const bankZ = pond.z + ALONG_DIR_Z * 6 + INLAND_DIR_Z * 3.5;
  const bankY = Math.max(this.height(bankX, bankZ), 0.35) + 1.65;

  return {
   overview: {
    label: 'Coastal transect overview',
    target: [foredune.x, Math.max(0.8, foredune.y * 0.55), foredune.z],
    position: [swale.x + INLAND_DIR_X * 22 - ALONG_DIR_X * 14, Math.max(swale.y, 1.5) + 8.6, swale.z + INLAND_DIR_Z * 22 - ALONG_DIR_Z * 14]
   },
   beach: {
    label: 'Gulf beach, wrack & pioneers',
    target: [beach.x + INLAND_DIR_X * 4 + ALONG_DIR_X * 5, Math.max(0.25, beach.y + 0.25), beach.z + INLAND_DIR_Z * 4 + ALONG_DIR_Z * 5],
    position: [beach.x - INLAND_DIR_X * 5 - ALONG_DIR_X * 8, Math.max(0.6, beach.y) + 1.85, beach.z - INLAND_DIR_Z * 5 - ALONG_DIR_Z * 8]
   },
   wildlife: {
    label: 'Swash, crabs & wrack wildlife',
    target: [wrackEdge.x - INLAND_DIR_X * 2.4 + ALONG_DIR_X * 1.6, Math.max(0.06, wrackEdge.y - 0.18), wrackEdge.z - INLAND_DIR_Z * 2.4 + ALONG_DIR_Z * 1.6],
    position: [wrackEdge.x + INLAND_DIR_X * 1.4 - ALONG_DIR_X * 2.2, Math.max(0.45, wrackEdge.y + 0.72), wrackEdge.z + INLAND_DIR_Z * 1.4 - ALONG_DIR_Z * 2.2]
   },
   nearshore: {
    label: 'Nearshore reef & seafloor',
    target: [reef.x - INLAND_DIR_X * 1.0 + ALONG_DIR_X * 1.2, -0.55, reef.z - INLAND_DIR_Z * 1.0 + ALONG_DIR_Z * 1.2],
    position: [reef.x + INLAND_DIR_X * 2.4 - ALONG_DIR_X * 1.4, 2.75, reef.z + INLAND_DIR_Z * 2.4 - ALONG_DIR_Z * 1.4]
   },
   foredune: {
    label: 'Foredune hummocks & sea oats',
    target: [foredune.x, foredune.y + 0.7, foredune.z],
    position: [foredune.x - INLAND_DIR_X * 8 + ALONG_DIR_X * 10, foredune.y + 2.7, foredune.z - INLAND_DIR_Z * 8 + ALONG_DIR_Z * 10]
   },
   swale: {
    label: 'Interdunal swale pond & reeds',
    target: [pond.x, 0.15, pond.z],
    position: [bankX, bankY, bankZ]
   },
   scrub: {
    label: 'Backdune pines, oaks & rosemary balds',
    target: [scrub.x + INLAND_DIR_X * 8, Math.max(1.8, scrub.y + 2.2), scrub.z + INLAND_DIR_Z * 8],
    position: [scrub.x - INLAND_DIR_X * 18 + ALONG_DIR_X * 10, Math.max(2.0, scrub.y) + 4.4, scrub.z - INLAND_DIR_Z * 18 + ALONG_DIR_Z * 10]
   }
  };
 }
}
