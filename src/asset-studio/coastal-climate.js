// Coastal climate forcing, solar geometry, atmospheric optics and barrier-island
// hydrology calibrated to St. Andrews State Park / Shell Island, Florida (30.13°N, 85.73°W).
// References: Spencer (1971), Kasten & Young (1989), Priestley & Taylor (1972),
// Ghyben-Herzberg freshwater lens theory, Simpson (1994) sea breeze dynamics.
import * as THREE from 'three';
import {projectSH} from '../sh.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// World cross-shore inland unit vector is (0.422618, 0.906308), i.e. heading +65°
// (blowing from SSW Gulf toward NNE inland dunes; 0° -> +X, +90° -> +Z).
export const INLAND_DIR_X = 0.422618;
export const INLAND_DIR_Z = 0.906308;
export const ALONG_DIR_X = 0.906308;
export const ALONG_DIR_Z = -0.422618;

export const DEFAULT_COASTAL_CLIMATE = Object.freeze({
 latitude: 30.13,
 dayOfYear: 155,
 solarHour: 9.8,
 airTemperature: 27,
 relativeHumidity: 0.72,
 precipitation: 1.55,
 seaLevelOffset: 0.0,
 cloudCover: 0.15,
 prevailingWindSpeed: 6.8,
 prevailingWindHeading: 65
});

const CLIMATE_RANGES = [
 ['latitude', -89, 89],
 ['dayOfYear', 1, 366],
 ['solarHour', 0, 24],
 ['airTemperature', -30, 55],
 ['relativeHumidity', 0.02, 1],
 ['precipitation', 0.05, 5],
 ['seaLevelOffset', -1.5, 2.5],
 ['cloudCover', 0, 1],
 ['prevailingWindSpeed', 0, 100],
 ['prevailingWindHeading', -180, 180]
];

export function validateClimate(climate) {
 if (climate === undefined) return;
 if (!climate || typeof climate !== 'object' || Array.isArray(climate)) {
  throw Error('Library: invalid climate object');
 }
 for (const [key, lo, hi] of CLIMATE_RANGES) {
  const v = climate[key];
  if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi)) {
   throw Error('Library: invalid climate ' + key);
  }
 }
}

export function normalizeClimate(climate) {
 return {...DEFAULT_COASTAL_CLIMATE, ...(climate || {})};
}

// Spencer (1971) solar declination + Kasten & Young (1989) optical air mass.
// Geographic compass alignment: inland cross-shore (0.422618, 0.906308) points NNE
// (~25° E of true North), so the open Gulf lies SSW.
export function solarGeometry(climate = DEFAULT_COASTAL_CLIMATE) {
 const c = normalizeClimate(climate);
 const lat = c.latitude * DEG;
 const gamma = TAU * (c.dayOfYear - 1) / 365;
 const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
  - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
  - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
 const hourAngle = 15 * (c.solarHour - 12) * DEG;
 const sinEl = clamp(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle), -1, 1);
 const el = Math.asin(sinEl);
 const cosEl = Math.max(1e-5, Math.cos(el));
 const cosAz = clamp((Math.sin(decl) - Math.sin(lat) * sinEl) / (Math.cos(lat) * cosEl), -1, 1);
 let az = Math.acos(cosAz);
 if (Math.sin(hourAngle) > 0) az = TAU - az;

 // True geographic East = +X rotated so North aligns with NNW (-25° from +Z? Wait:
 // inland vector = (sin 25°, cos 25°) = NNE = +25° E of North -> True North is
 // (-sin 25°, cos 25°) rotated? Check: cross(North, East) -> in world XZ:
 // NNE = (0.422618, 0.906308). Rotating 25° CCW from NNE gives True North:
 // North = (0, 0, 1) rotated +25°? Wait: cos(25)*0 + sin(25)*1 = 0.4226 is NNE (+25° E of N).
 // So True North = (0, 0, 1) -> True East = (1, 0, 0)? Wait:
 // If +Z is North (0) and +X is East (90°), then azimuth +25° is (sin 25°, cos 25°) = (0.422618, 0.906308)!
 // Yes! Wait: in Three.js, +X is East, -Z is North OR +Z is North? Either way, what matters is:
 // When azimuth az = 0 (North), dir = (-sin 0, cos 0) or (+X=East, +Z=North?):
 // If inland NNE (+25° E of N) = (0.422618, 0.906308) = (sin 25°, cos 25°), then True North = (0, 1), True East = (1, 0),
 // and azimuth az clockwise from North gives horizontal direction (sin(az), cos(az))!
 // Wait: at az = 180° (South, Gulf side!), (sin 180°, cos 180°) = (0, -1), pointing toward -Z (Gulf side)!
 // At az = 90° (morning East!), (sin 90°, cos 90°) = (+1, 0) (Eastern alongshore sun catching foredune flanks!).
 // At az = 270° (afternoon West!), (sin 270°, cos 270°) = (-1, 0) (Western sun glowing over the Gulf!).
 const horiz = Math.cos(Math.max(-0.18, el));
 const sunY = Math.max(-0.18, sinEl);
 const rawDir = [horiz * Math.sin(az), sunY, horiz * Math.cos(az)];
 const norm = Math.hypot(...rawDir) || 1;
 const sunDirection = rawDir.map(v => v / norm);

 const elDeg = el / DEG;
 const azDeg = az / DEG;
 let airMass = 38;
 let directWm2 = 0;
 let diffuseWm2 = 0;
 if (elDeg > 0.2) {
  airMass = 1 / (sinEl + 0.50572 * Math.pow(Math.max(0.1, elDeg + 6.07995), -1.6364));
  const ecc = 1 + 0.033 * Math.cos(TAU * c.dayOfYear / 365);
  const i0 = 1361 * ecc;
  // Marine subtropical clear-sky broadband attenuation (Linke turbidity ~3.2)
  const clearBeam = i0 * Math.exp(-0.105 * 3.2 * Math.pow(airMass, 0.85));
  const cloudTrans = 1 - 0.72 * Math.pow(c.cloudCover, 1.35);
  directWm2 = Math.max(0, clearBeam * sinEl * cloudTrans);
  const clearDiff = i0 * sinEl * (0.09 + 0.06 * (1 - Math.exp(-0.18 * airMass)));
  diffuseWm2 = Math.max(0, clearDiff * (1 + 0.45 * c.cloudCover) * (1 - 0.48 * Math.pow(c.cloudCover, 2)));
 } else if (elDeg > -8) {
  diffuseWm2 = Math.max(0, 18 * (elDeg + 8) / 8.2 * (1 - 0.4 * c.cloudCover));
 }
 return {
  sunDirection,
  elevationDeg: elDeg,
  azimuthDeg: azDeg,
  airMass,
  directWm2,
  diffuseWm2,
  globalWm2: directWm2 + diffuseWm2
 };
}

// Priestley-Taylor (1972) equilibrium PET + Ghyben-Herzberg freshwater lens head +
// porous beach sand capillary fringe (Nielsen 1990; van Genuchten 1980).
export function climateHydrology(climate = DEFAULT_COASTAL_CLIMATE, sandMaterial = null) {
 const c = normalizeClimate(climate);
 const T = c.airTemperature;
 const esKpa = 0.6108 * Math.exp(17.27 * T / (T + 237.3));
 const vpdKpa = esKpa * (1 - c.relativeHumidity);
 const delta = 4098 * esKpa / Math.pow(T + 237.3, 2);
 const gamma = 0.0665;
 // Mean daily net radiation proxy modulated by cloudiness and solar temperature regime.
 const dayFactor = clamp(0.62 + 0.38 * Math.cos(TAU * (c.dayOfYear - 172) / 365), 0.35, 1.1);
 const rnMJ = (16.5 * dayFactor * (1 - 0.52 * c.cloudCover)) * (0.72 + 0.28 * clamp((T + 5) / 35, 0.1, 1.4));
 const petMmDay = clamp(1.26 * (delta / (delta + gamma)) * (rnMJ / 2.45) * (0.78 + 0.22 * clamp(vpdKpa / 1.1, 0.2, 2.2)), 0.5, 12);
 const petMPerYr = petMmDay * 0.36525;
 const moistureIndex = clamp(c.precipitation / Math.max(0.35, petMPerYr), 0.15, 2.6);
 // Ghyben-Herzberg lens head above sea level datum in barrier interior (40:1 density ratio)
 const lensHeight = clamp(0.08 + 0.29 * Math.pow(moistureIndex, 0.85), 0.06, 0.90);
 const porosity = sandMaterial?.porosity ?? 0.40;
 const permeability = sandMaterial?.permeability ?? 2e-10;
 const capillaryFringe = clamp(
  0.24 + 0.14 * (0.42 / Math.max(0.15, porosity)) * Math.pow(2e-10 / Math.max(1e-12, permeability), 0.14)
   + 0.08 * clamp(moistureIndex - 0.8, -0.5, 0.7),
  0.18, 0.58
 );
 const waveDecayLen = clamp(
  10.5 * Math.pow(Math.max(1e-12, permeability) / 2e-10, 0.22) / Math.max(0.25, porosity / 0.40),
  5.0, 22.0
 );
 const vanGenuchtenAlpha = 1.65 / capillaryFringe;
 const windNorm = c.prevailingWindSpeed / 6.8;
 const saltScale = clamp(0.28 + 0.72 * Math.pow(Math.max(0.05, windNorm), 0.82), 0.18, 2.2);
 const sandScale = clamp(Math.pow(Math.max(0, windNorm), 1.4) * clamp(1.15 - 0.18 * (moistureIndex - 1), 0.55, 1.45), 0.1, 3.0);
 return {
  esKpa, vpdKpa, petMPerYr, moistureIndex, lensHeight,
  capillaryFringe, waveDecayLen, vanGenuchtenAlpha, porosity, permeability,
  saltScale, sandScale
 };
}

// Thermal sea breeze tendency (Simpson 1994): peaks mid-afternoon on warm clear days.
export function seaBreezeTendency(climate = DEFAULT_COASTAL_CLIMATE) {
 const c = normalizeClimate(climate);
 const thermal = clamp((c.airTemperature - 14) / 18, -0.3, 1.2);
 const solar = Math.sin(clamp((c.solarHour - 7.5) / 11.5, 0, 1) * Math.PI);
 const clear = 1 - 0.65 * c.cloudCover;
 const onshoreMs = clamp(4.6 * thermal * solar * clear - 0.6 * (1 - solar), -1.5, 6.5);
 const label = onshoreMs > 2.2 ? 'Strong Gulf sea breeze' : onshoreMs > 0.6 ? 'Gentle sea breeze' : onshoreMs < -0.2 ? 'Weak land breeze' : 'Neutral coastal flow';
 return {onshoreMs, label};
}

function rgbMix(a, b, t) {
 const u = clamp(t, 0, 1);
 return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

// Compute physically coherent Rayleigh/Mie atmosphere, sun color, aerial haze and 9-band SH.
export function climateAtmosphere(climate = DEFAULT_COASTAL_CLIMATE, sandMaterial = null) {
 const c = normalizeClimate(climate);
 const solar = solarGeometry(c);
 const hydrology = climateHydrology(c, sandMaterial);
 const sunDir = solar.sunDirection;
 const el = solar.elevationDeg;
 const day = clamp((el + 4) / 26, 0, 1);
 const high = clamp(el / 55, 0, 1);
 const twilight = Math.exp(-Math.pow((el - 1.5) / 6.2, 2));
 const humid = clamp((c.relativeHumidity - 0.35) / 0.65, 0, 1);
 const cloud = c.cloudCover;

 // Gulf subtropical sky palette in linear RGB: cerulean zenith, bright humid
 // aquamarine-blue horizon, amber-peach twilight glow near low sun elevations.
 let skyZenith = rgbMix([0.008, 0.015, 0.042], [0.032, 0.175, 0.56], Math.pow(day, 0.85));
 skyZenith = rgbMix(skyZenith, [0.22, 0.27, 0.33], cloud * 0.65);

 let skyHorizon = rgbMix([0.025, 0.032, 0.062], [0.22, 0.46, 0.63], day);
 skyHorizon = rgbMix(skyHorizon, [0.68, 0.24, 0.06], twilight * 0.65 * (1 - cloud * 0.4));
 skyHorizon = rgbMix(skyHorizon, [0.38, 0.44, 0.49], cloud * 0.58 + humid * 0.08);

 const hazeColor = rgbMix(skyHorizon, [0.30, 0.48, 0.58], 0.18 * day * (1 - twilight * 0.5));

 // Direct sun radiance warms gently at low solar elevations via Rayleigh scattering.
 const sunIntensity = clamp(solar.directWm2 / 780, 0, 1.32);
 let sunTint = rgbMix([1.0, 0.30, 0.08], [1.04, 0.97, 0.86], clamp((el - 2) / 28, 0, 1));
 sunTint = rgbMix(sunTint, [0.85, 0.88, 0.92], cloud * 0.55);
 const sunColor = sunTint.map(v => v * (0.03 + 1.12 * sunIntensity));

 // Ground bounce from bright Panhandle quartz sand + emerald shallows.
 const groundAlbedo = [0.34 * day + 0.01, 0.31 * day + 0.01, 0.24 * day + 0.015];
 const sh = projectSH(dir => {
  const up = clamp(dir[1], -1, 1);
  if (up < 0) {
   const g = Math.pow(clamp(-up, 0, 1), 0.5);
   return rgbMix(skyHorizon, groundAlbedo, 0.5 + 0.5 * g);
  }
  const skyT = Math.pow(up, 0.56);
  let col = rgbMix(skyHorizon, skyZenith, skyT);
  const mu = clamp(dir[0] * sunDir[0] + dir[1] * sunDir[1] + dir[2] * sunDir[2], 0, 1);
  const mie = Math.pow(mu, 8) * 0.35 * (0.4 + 0.6 * day) * (1 - 0.6 * cloud);
  return [col[0] + sunColor[0] * mie, col[1] + sunColor[1] * mie, col[2] + sunColor[2] * mie];
 });
 const environment = Array.from({length: 9}, (_, i) => new THREE.Vector3(sh[i * 3], sh[i * 3 + 1], sh[i * 3 + 2]));

 return {
  climate: c,
  solar,
  hydrology,
  seaBreeze: seaBreezeTendency(c),
  sunDirection: sunDir,
  sunColor,
  skyZenith,
  skyHorizon,
  hazeColor,
  environment,
  highSun: high
 };
}

export function coastalSkyMaterial(uniforms) {
 return new THREE.ShaderMaterial({
  uniforms,
  side: THREE.BackSide,
  depthWrite: false,
  depthTest: false,
  vertexShader: `
   varying vec3 worldDir;
   void main(){
    worldDir=position;
    vec4 clip=projectionMatrix*vec4(mat3(viewMatrix)*(normalize(position)*500.),1.);
    gl_Position=vec4(clip.xy,min(clip.z,clip.w*.999999),clip.w);
   }`,
  fragmentShader: `
   uniform vec3 sunDirection,sunColor,skyZenith,skyHorizon,hazeColor;
   uniform float cloudCover;
   varying vec3 worldDir;
   float skyHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
   float skyNoise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(skyHash(i),skyHash(i+vec2(1,0)),f.x),mix(skyHash(i+vec2(0,1)),skyHash(i+vec2(1,1)),f.x),f.y);
   }
   float fbm(vec2 p){
    float v=0.,a=.5;
    for(int i=0;i<4;i++){v+=a*skyNoise(p);p=p*2.03+vec2(7.3,11.1);a*=.5;}
    return v;
   }
   void main(){
    vec3 d=normalize(worldDir);
    float up=clamp(d.y,0.,1.);
    vec3 col=mix(skyHorizon,skyZenith,pow(up,.48));
    vec3 sunD=normalize(sunDirection);
    float mu=max(0.,dot(d,sunD));
    float horizonWarm=pow(1.-up,4.)*pow(mu,2.2)*(1.-.5*cloudCover);
    col+=sunColor*(.28*horizonWarm+.24*pow(mu,12.)*(1.-.65*cloudCover)+.95*pow(mu,140.)*(1.-cloudCover));
    float disk=smoothstep(.99968,.99990,mu)*smoothstep(-.04,.06,d.y)*(1.-.88*cloudCover);
    col+=sunColor*disk*5.5;
    if(d.y>.02&&cloudCover>.01){
     vec2 uv=d.xz/max(.08,d.y+.12)*1.35;
     float n=fbm(uv);
     float thresh=mix(.78,.28,cloudCover);
     float puff=smoothstep(thresh,thresh+.24,n)*smoothstep(.02,.18,d.y);
     vec3 cloudCol=mix(skyHorizon*.78,vec3(.96,.97,.99)*(.55+.45*length(sunColor)/1.5),clamp(.45+.55*mu,0.,1.));
     col=mix(col,cloudCol,puff*(.45+.45*cloudCover));
    }
    if(d.y<0.)col=mix(hazeColor,skyHorizon*.55,clamp(-d.y*3.,0.,1.));
    gl_FragColor=vec4(col,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`
 });
}
