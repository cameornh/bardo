// Self-balancing multi-trophic sandy-beach, wrack, nearshore, and interdunal swale
// ecology solver calibrated to St. Andrews State Park / Shell Island, Florida.
// Integrates Dugan & McLachlan allochthonous wrack subsidies & swash-zone channel
// coupling, adaptive prey switching, Culicoides 2.5 m/s flight thresholds, and
// temperature/solar/hydrology forcing using bounded RK2 midpoint sub-steps.
import {DEFAULT_COASTAL_CLIMATE, climateHydrology, solarGeometry} from './coastal-climate.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export const RESOURCE_KEYS = ['wrack', 'plankton', 'benthicAlgae', 'swaleLarvae'];
export const GUILD_KEYS = [
 'moleCrabs', 'beachHoppers', 'ghostCrabs', 'fiddlerCrabs', 'swimmingCrabs',
 'hermitCrabs', 'seagrassShrimp', 'dunePredators',
 'sandGnats', 'kelpFlies', 'dragonlets', 'baitfish', 'surfFish', 'reefSwaleFish',
 'benthicMollusks', 'shorebirds', 'seabirds', 'rays', 'coastalSharks'
];

const h2 = (res, halfSat = 1.0) => Math.max(0, res) / (halfSat + Math.max(0, res));

export class CoastalEcologySim {
 constructor() {
  this.reset();
 }

 reset(seed = 2187) {
  this.seed = seed >>> 0;
  this.ecoHours = 0;
  this.energyFlow = {captures: 0, births: 0, deaths: 0, carcassRecycle: 0};
  this.resources = {
   wrack: 1.0,
   plankton: 1.0,
   benthicAlgae: 1.0,
   swaleLarvae: 1.0
  };
  this.guilds = {
   moleCrabs: 1.0,
   beachHoppers: 1.0,
   ghostCrabs: 1.0,
   fiddlerCrabs: 1.0,
   swimmingCrabs: 1.0,
   hermitCrabs: 1.0,
   seagrassShrimp: 1.0,
   dunePredators: 1.0,
   sandGnats: 1.0,
   kelpFlies: 1.0,
   dragonlets: 1.0,
   baitfish: 1.0,
   surfFish: 1.0,
   reefSwaleFish: 1.0,
   benthicMollusks: 1.0,
   shorebirds: 1.0,
   seabirds: 1.0,
   rays: 1.0,
   coastalSharks: 1.0
  };
 }

 forcing(climate = DEFAULT_COASTAL_CLIMATE, wind = null) {
  const c = {...DEFAULT_COASTAL_CLIMATE, ...(climate || {})};
  const wSpeed = wind?.speed ?? c.prevailingWindSpeed ?? 6.8;
  const sol = solarGeometry(c);
  const hyd = climateHydrology(c);
  const daylight = clamp(sol.globalWm2 / 820, 0.08, 1.35);
  const tempFactor = clamp(Math.pow(1.55, (c.airTemperature - 27) / 10), 0.45, 1.65);
  const sea = c.seaLevelOffset ?? 0;

  return {
   windSpeed: wSpeed,
   solarHour: c.solarHour,
   cloudCover: c.cloudCover,
   tempFactor,
   daylight,
   humidity: c.relativeHumidity,
   moistureIndex: hyd.moistureIndex,
   wrackSubsidy: clamp(0.62 + 0.056 * wSpeed + Math.max(0, sea) * 0.42, 0.42, 2.2),
   planktonProd: clamp(0.45 + 0.55 * daylight + 0.015 * wSpeed, 0.35, 1.6),
   algaeProd: clamp(0.35 + 0.65 * daylight, 0.28, 1.5),
   swaleLarvaeProd: clamp(0.42 + 0.38 * (c.precipitation / 1.55) + 0.28 * c.relativeHumidity - 0.16 * Math.max(0, sea - 0.35), 0.25, 1.7)
  };
 }

 activity(guild, climate = DEFAULT_COASTAL_CLIMATE, wind = null) {
  const c = {...DEFAULT_COASTAL_CLIMATE, ...(climate || {})};
  const wSpeed = wind?.speed ?? c.prevailingWindSpeed ?? 6.8;
  const hour = c.solarHour ?? 9.8;
  const cloud = c.cloudCover ?? 0.15;
  const sol = solarGeometry(c);
  const dawn = Math.exp(-0.5 * ((hour - 6.3) / 1.8) ** 2);
  const dusk = Math.exp(-0.5 * ((hour - 18.8) / 1.9) ** 2);
  const crepuscular = clamp(0.28 + 0.85 * Math.max(dawn, dusk) + 0.22 * cloud, 0.22, 1.0);
  const middayPeak = Math.exp(-0.5 * ((hour - 12.2) / 4.2) ** 2);
  const nightCool = clamp(1.0 - 0.66 * Math.exp(-0.5 * ((hour - 13.0) / 3.3) ** 2) + 0.22 * cloud, 0.24, 1.0);

  switch (guild) {
   case 'sandGnats': {
    // Culicoides spp. ~2.5 m/s active flight threshold, amplified behind foredune lee shelter (~0.38x open wind)
    const shelteredWind = wSpeed * 0.38;
    const windGate = 1 / (1 + Math.pow(shelteredWind / 2.5, 3.0));
    const rhGate = clamp(0.45 + 0.70 * (c.relativeHumidity ?? 0.72), 0.35, 1.1);
    return clamp(crepuscular * windGate * rhGate, 0.08, 1.0);
   }
   case 'kelpFlies': {
    const boundaryGate = 1 / (1 + Math.pow(wSpeed / 9.2, 2.4));
    return clamp((0.35 + 0.65 * clamp(sol.elevationDeg / 35 + 0.35, 0.2, 1.0)) * boundaryGate, 0.15, 1.0);
   }
   case 'dragonlets': {
    const warmAir = clamp(sol.globalWm2 / 550, 0.18, 1.0);
    const windGate = 1 / (1 + Math.pow(wSpeed / 10.5, 2.2));
    return clamp(warmAir * windGate, 0.14, 1.0);
   }
   case 'ghostCrabs':
    return nightCool;
   case 'beachHoppers':
    return clamp(0.22 + 0.78 * nightCool, 0.20, 1.0);
   case 'fiddlerCrabs':
    return clamp(0.22 + 0.78 * middayPeak, 0.22, 1.0);
   case 'hermitCrabs':
    return clamp(0.40 + 0.60 * clamp(sol.elevationDeg / 28 + 0.45, 0.2, 1.0) / (1 + Math.pow(wSpeed / 13, 2.2)), 0.28, 1.0);
   case 'dunePredators': {
    const warmSun = clamp(sol.globalWm2 / 520, 0.08, 1.0) * clamp((c.airTemperature - 13) / 15, 0.14, 1.15);
    const windGate = 1 / (1 + Math.pow(wSpeed / 12.5, 2.4));
    return clamp(warmSun * windGate, 0.08, 1.0);
   }
   case 'seagrassShrimp':
    return clamp((0.60 + 0.40 * nightCool) * clamp((c.airTemperature - 12) / 18, 0.35, 1.0), 0.38, 1.0);
   case 'moleCrabs':
    return clamp(0.72 + 0.28 * clamp(wSpeed / 9, 0, 1), 0.65, 1.0);
   case 'swimmingCrabs':
   case 'baitfish':
   case 'surfFish':
   case 'reefSwaleFish':
   case 'benthicMollusks':
   case 'rays':
   case 'coastalSharks':
    return clamp(0.65 + 0.35 * clamp((c.airTemperature - 14) / 16, 0, 1), 0.45, 1.0);
   case 'shorebirds':
   case 'seabirds': {
    const day = clamp(sol.elevationDeg / 25 + 0.35, 0.2, 1.0);
    const gale = 1 / (1 + Math.pow(wSpeed / 14.5, 2.2));
    return clamp((0.28 + 0.72 * day) * gale, 0.22, 1.0);
   }
   default:
    return 1.0;
  }
 }

 _derivatives(R, N, f) {
  const tf = f.tempFactor;
  // Adaptive ghost crab prey-switching across beachHoppers, moleCrabs, and wrack (Dugan/McLachlan)
  const wHop = 0.45 * N.beachHoppers + 1e-4;
  const wMole = 0.38 * N.moleCrabs + 1e-4;
  const wWrk = 0.17 * R.wrack + 1e-4;
  const wSum = wHop + wMole + wWrk;
  const ghostToHop = wHop / wSum;
  const ghostToMole = wMole / wSum;
  const ghostToWrk = wWrk / wSum;

  // Generalized resource dynamics (normalized equilibrium near ~1.0 under baseline forcing)
  const dR = {
   wrack:
    0.66 * f.wrackSubsidy + 0.32 * R.wrack * (1 - R.wrack / 1.8)
    - R.wrack / (0.9 + R.wrack) * (0.50 * N.beachHoppers + 0.38 * N.kelpFlies + 0.26 * N.fiddlerCrabs + 0.22 * N.hermitCrabs + 0.32 * ghostToWrk * N.ghostCrabs),
   plankton:
    0.62 * f.planktonProd + 0.65 * R.plankton * (1 - R.plankton / 1.7)
    - R.plankton / (0.85 + R.plankton) * (0.72 * N.moleCrabs + 0.74 * N.baitfish + 0.20 * N.benthicMollusks + 0.22 * N.seagrassShrimp),
   benthicAlgae:
    0.52 * f.algaeProd + 0.56 * R.benthicAlgae * (1 - R.benthicAlgae / 1.7)
    - R.benthicAlgae / (0.90 + R.benthicAlgae) * (0.44 * N.fiddlerCrabs + 0.40 * N.swimmingCrabs + 0.38 * N.reefSwaleFish + 0.24 * N.hermitCrabs + 0.30 * N.seagrassShrimp),
   swaleLarvae:
    0.48 * f.swaleLarvaeProd + 0.50 * R.swaleLarvae * (1 - R.swaleLarvae / 1.7)
    - R.swaleLarvae / (0.90 + R.swaleLarvae) * (0.64 * N.sandGnats + 0.62 * N.reefSwaleFish)
  };

  // Generalized trophic guild equations with Holling Type II + quadratic top-predator damping + migration refuge
  const stepGuild = (val, growth, loss, quad = 0.24, mig = 0.018) =>
   val * (growth - loss - quad * val) + (val < 0.45 ? mig * (0.45 - val) : 0);

  const dN = {
   moleCrabs: stepGuild(
    N.moleCrabs,
    0.84 * tf * h2(R.plankton, 0.85),
    0.10 + 0.14 * tf * (ghostToMole * 1.45 * N.ghostCrabs + N.surfFish * 1.05 + N.swimmingCrabs * 0.70 + N.shorebirds * 0.45) / (0.85 + N.moleCrabs),
    0.16
   ),
   beachHoppers: stepGuild(
    N.beachHoppers,
    0.94 * tf * h2(R.wrack, 0.85),
    0.12 + 0.22 * tf * (ghostToHop * 1.45 * N.ghostCrabs + N.shorebirds * 0.30 + N.dunePredators * 0.32) / (0.80 + N.beachHoppers),
    0.18
   ),
   ghostCrabs: stepGuild(
    N.ghostCrabs,
    0.66 * tf * (ghostToHop * h2(N.beachHoppers, 0.75) + ghostToMole * h2(N.moleCrabs, 0.75) + ghostToWrk * h2(R.wrack, 0.85)),
    0.15 + 0.03 * N.seabirds / (1.0 + N.ghostCrabs),
    0.20
   ),
   fiddlerCrabs: stepGuild(
    N.fiddlerCrabs,
    0.76 * tf * (0.55 * h2(R.benthicAlgae, 0.85) + 0.45 * h2(R.wrack, 0.90)),
    0.14 + 0.08 * (N.swimmingCrabs + N.reefSwaleFish) / (1.0 + N.fiddlerCrabs),
    0.18
   ),
   hermitCrabs: stepGuild(
    N.hermitCrabs,
    0.76 * tf * (0.52 * h2(R.wrack, 0.85) + 0.48 * h2(R.benthicAlgae, 0.85)),
    0.14 + 0.06 * (N.swimmingCrabs + N.seabirds + N.rays * 0.5) / (1.0 + N.hermitCrabs),
    0.18
   ),
   seagrassShrimp: stepGuild(
    N.seagrassShrimp,
    0.86 * tf * (0.60 * h2(R.benthicAlgae, 0.82) + 0.40 * h2(R.plankton, 0.85)),
    0.13 + 0.14 * tf * (N.baitfish * 0.65 + N.reefSwaleFish * 0.60 + N.swimmingCrabs * 0.55) / (0.95 + N.seagrassShrimp),
    0.18
   ),
   dunePredators: stepGuild(
    N.dunePredators,
    0.74 * tf * (0.45 * h2(N.beachHoppers, 0.80) + 0.35 * h2(N.kelpFlies, 0.85) + 0.20 * h2(N.sandGnats, 0.85)),
    0.17 + 0.05 * N.ghostCrabs / (1.0 + N.dunePredators),
    0.20
   ),
   swimmingCrabs: stepGuild(
    N.swimmingCrabs,
    0.68 * tf * (0.30 * h2(N.moleCrabs, 0.85) + 0.22 * h2(R.benthicAlgae, 0.85) + 0.18 * h2(N.fiddlerCrabs, 0.90) + 0.16 * h2(N.benthicMollusks, 0.85) + 0.14 * h2(N.seagrassShrimp, 0.85)),
    0.16 + 0.08 * (N.surfFish + N.rays * 0.45 + N.coastalSharks * 0.45) / (1.1 + N.swimmingCrabs),
    0.18
   ),
   sandGnats: stepGuild(
    N.sandGnats,
    0.95 * tf * h2(R.swaleLarvae, 0.80),
    0.16 + 0.20 * tf * (N.dragonlets + N.dunePredators * 0.2) / (0.85 + N.sandGnats) + 0.06 * Math.max(0, f.windSpeed - 8) * 0.08,
    0.22
   ),
   kelpFlies: stepGuild(
    N.kelpFlies,
    0.90 * tf * h2(R.wrack, 0.80),
    0.16 + 0.18 * tf * (N.dragonlets + N.dunePredators * 0.2) / (0.85 + N.kelpFlies),
    0.20
   ),
   dragonlets: stepGuild(
    N.dragonlets,
    0.72 * tf * (0.60 * h2(N.sandGnats, 0.80) + 0.40 * h2(N.kelpFlies, 0.85)),
    0.18,
    0.22
   ),
   baitfish: stepGuild(
    N.baitfish,
    0.86 * tf * h2(R.plankton, 0.80),
    0.12 + 0.19 * tf * (N.surfFish * 1.1 + N.swimmingCrabs * 0.45 + N.seabirds * 0.25 + N.coastalSharks * 0.18) / (0.9 + N.baitfish),
    0.18,
    0.024
   ),
   surfFish: stepGuild(
    N.surfFish,
    0.70 * tf * (0.55 * h2(N.baitfish, 0.80) + 0.45 * h2(N.moleCrabs, 0.85)),
    0.16,
    0.20
   ),
   reefSwaleFish: stepGuild(
    N.reefSwaleFish,
    0.74 * tf * (0.50 * h2(R.benthicAlgae, 0.85) + 0.50 * h2(R.swaleLarvae, 0.85)),
    0.16,
    0.20
   ),
   benthicMollusks: stepGuild(
    N.benthicMollusks,
    0.84 * tf * h2(R.plankton, 0.85),
    0.11 + 0.10 * tf * (N.swimmingCrabs * 0.65 + N.rays * 0.80 + N.coastalSharks * 0.35) / (0.9 + N.benthicMollusks),
    0.18
   ),
   shorebirds: stepGuild(
    N.shorebirds,
    0.68 * tf * (0.55 * h2(N.moleCrabs, 0.80) + 0.45 * h2(N.beachHoppers, 0.80)),
    0.16,
    0.20
   ),
   seabirds: stepGuild(
    N.seabirds,
    0.66 * tf * (0.60 * h2(N.baitfish, 0.80) + 0.25 * h2(N.ghostCrabs, 0.85) + 0.15 * h2(R.wrack, 0.90)),
    0.16,
    0.20
   ),
   rays: stepGuild(
    N.rays,
    0.68 * tf * (0.45 * h2(N.benthicMollusks, 0.85) + 0.30 * h2(N.swimmingCrabs, 0.85) + 0.25 * h2(N.moleCrabs, 0.85)),
    0.16 + 0.04 * N.coastalSharks / (1.0 + N.rays),
    0.20
   ),
   coastalSharks: stepGuild(
    N.coastalSharks,
    0.64 * tf * (0.45 * h2(N.swimmingCrabs, 0.85) + 0.35 * h2(N.baitfish, 0.85) + 0.20 * h2(N.benthicMollusks, 0.90)),
    0.17,
    0.22
   )
  };

  return {dR, dN};
 }

 step(dtHours, climate = DEFAULT_COASTAL_CLIMATE, wind = null) {
  if (!(dtHours > 0)) return;
  const f = this.forcing(climate, wind);
  let remaining = Math.min(200, dtHours);
  while (remaining > 1e-6) {
   const h = Math.min(0.25, remaining);
   const k1 = this._derivatives(this.resources, this.guilds, f);
   const midR = {};
   const midN = {};
   for (const k of RESOURCE_KEYS) midR[k] = clamp(this.resources[k] + 0.5 * h * k1.dR[k], 0.02, 5.0);
   for (const k of GUILD_KEYS) midN[k] = clamp(this.guilds[k] + 0.5 * h * k1.dN[k], 0.02, 5.0);
   const k2 = this._derivatives(midR, midN, f);
   for (const k of RESOURCE_KEYS) this.resources[k] = clamp(this.resources[k] + h * k2.dR[k], 0.02, 5.0);
   for (const k of GUILD_KEYS) this.guilds[k] = clamp(this.guilds[k] + h * k2.dN[k], 0.02, 5.0);
   this.ecoHours += h;
   remaining -= h;
  }
 }

 advanceRealSeconds(dtSec, climate = DEFAULT_COASTAL_CLIMATE, wind = null) {
  if (!(dtSec > 0)) return;
  this.step(Math.min(0.15, dtSec) * 0.08, climate, wind);
 }

 targetCount(guild, baseCount, climate = DEFAULT_COASTAL_CLIMATE, wind = null) {
  const biomass = this.guilds[guild] ?? 1.0;
  const act = this.activity(guild, climate, wind);
  const raw = Math.round(baseCount * clamp(0.35 + 0.65 * biomass, 0.25, 1.5) * clamp(0.25 + 0.75 * act, 0.20, 1.0));
  return Math.max(1, Math.min(baseCount * 2, raw));
 }

 recordPredation(predGuild, preyGuild, flux = 0.02) {
  this.energyFlow.captures++;
  if (predGuild && this.guilds[predGuild] !== undefined) {
   this.guilds[predGuild] = clamp(this.guilds[predGuild] + flux * 0.025, 0.08, 3.5);
  }
  if (preyGuild && this.guilds[preyGuild] !== undefined) {
   this.guilds[preyGuild] = clamp(this.guilds[preyGuild] - flux * 0.018, 0.08, 3.5);
  }
 }

 recordBirth(guild) {
  this.energyFlow.births++;
  if (guild && this.guilds[guild] !== undefined) {
   this.guilds[guild] = clamp(this.guilds[guild] + 0.006, 0.08, 3.5);
  }
 }

 recordDeath(guild, _cause = 'starvation', terrestrial = false) {
  this.energyFlow.deaths++;
  if (guild && this.guilds[guild] !== undefined) {
   this.guilds[guild] = clamp(this.guilds[guild] - 0.008, 0.08, 3.5);
  }
  if (terrestrial) {
   this.energyFlow.carcassRecycle++;
   this.resources.wrack = clamp(this.resources.wrack + 0.008, 0.05, 3.5);
  }
 }

 recordCarcassScavenge(flux = 0.006) {
  this.energyFlow.carcassRecycle++;
  this.resources.wrack = clamp(this.resources.wrack - flux * 0.2, 0.05, 3.5);
 }

 snapshot() {
  return {
   ecoHours: this.ecoHours,
   energyFlow: {...this.energyFlow},
   resources: {...this.resources},
   guilds: {...this.guilds}
  };
 }

 formatSummary(fauna = null) {
  const activeTxt = fauna ? ` · ${fauna.activeAgentCount ?? fauna.agents?.length ?? 0} fauna` : '';
  const birds = 0.5 * ((this.guilds.shorebirds ?? 1) + (this.guilds.seabirds ?? 1));
  return `Trophic (${this.ecoHours.toFixed(1)} h) · Wrack ${this.resources.wrack.toFixed(2)} · Mole/Bait ${this.guilds.moleCrabs.toFixed(2)}/${this.guilds.baitfish.toFixed(2)} · Birds ${birds.toFixed(2)} · Cap ${this.energyFlow.captures} / Birth ${this.energyFlow.births}${activeTxt}`;
 }
}
