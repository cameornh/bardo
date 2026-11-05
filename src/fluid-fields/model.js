// Isolated bulk-fluid experiment. SI units; no camera, renderer or beach state.
export const SOLID = 0, WATER = 1, AIR = 2;
export const MATERIAL = Object.freeze([
  null,
  Object.freeze({name: 'Water', density: 998, heatCapacity: 4182, conductivity: .6, viscosity: 1.004e-6}),
  Object.freeze({name: 'Air', density: 1.204, heatCapacity: 1005, conductivity: .0257, viscosity: 1.5e-5}),
]);
export const ATMOSPHERE = 101325;
export const GRAVITY = 9.81;
export const index3 = (d, x, y, z) => x + d[0] * (y + d[1] * z);
export function coordinates(d, i) {
  return [i % d[0], Math.floor(i / d[0]) % d[1], Math.floor(i / (d[0] * d[1]))];
}
// Tetens saturation pressure over liquid water (Pa), for this warm-water lab.
// Humidity is SPECIFIC humidity: kg vapour / kg moist air, not relative humidity.
export function saturationPressure(kelvin) {
  const c = kelvin - 273.15;
  return 610.8 * Math.exp(17.27 * c / (c + 237.3));
}
export function relativeHumidity(q, kelvin, pressure = ATMOSPHERE) {
  return q * pressure / (.622 + .378 * q) / saturationPressure(kelvin);
}
export function humidityAtRH(rh, kelvin, pressure = ATMOSPHERE) {
  const e = rh * saturationPressure(kelvin);
  return .622 * e / (pressure - .378 * e);
}

export class FluidFields {
  constructor({dims = [24, 18, 16], cellSize = .4, waterLevel, phaseAt} = {}) {
    if (dims.length !== 3 || dims.some(n => !Number.isInteger(n) || n < 2 || n > 48) || dims.reduce((a,b)=>a*b,1) > 32768 || !(cellSize > 0)) throw Error('Field grid must fit the bounded 32,768-cell experiment.');
    this.dims = [...dims]; this.h = cellSize; this.count = dims.reduce((a,b)=>a*b,1);
    this.waterLevel = waterLevel ?? Math.floor(dims[1] / 3) * cellSize;
    this.phase = new Uint8Array(this.count);
    this.temperature = new Float64Array(this.count).fill(293.15);
    this.humidity = new Float64Array(this.count);
    this.pressure = new Float64Array(this.count); // perturbation pressure, Pa
    this.time = 0; this.mixing = .025; this.viscosityScale = 1;
    this.neighbors = new Int32Array(this.count * 6).fill(-1);
    this.degree = new Uint8Array(this.count);
    this.thermalEdges = [];
    for (let i = 0; i < this.count; i++) {
      const p = this.position(i);
      this.phase[i] = phaseAt ? phaseAt(p, i) : (p[1] < this.waterLevel ? WATER : AIR);
      if (![SOLID, WATER, AIR].includes(this.phase[i])) throw Error('Invalid phase');
      if (this.phase[i] === AIR) this.humidity[i] = humidityAtRH(.45, this.temperature[i]);
    }
    // A true MAC lattice: each velocity component lives on its cell face.
    this.faces = [0,1,2].map(axis => {
      const fd = [...dims]; fd[axis]++;
      const count = fd.reduce((a,b)=>a*b,1), a = new Int32Array(count).fill(-1), b = a.slice(), phase = new Uint8Array(count);
      for (let f = 0; f < count; f++) {
        const xyz = coordinates(fd, f), lo = [...xyz]; lo[axis]--;
        if (lo[axis] < 0 || xyz[axis] >= dims[axis]) continue;
        const ia = index3(dims, ...lo), ib = index3(dims, ...xyz);
        if (this.phase[ia] && this.phase[ib]) this.thermalEdges.push([ia, ib]);
        // Fixed-interface validation fixture: neither phase can cross the lid.
        // Tangential free slip, insulated solids, impermeable domain walls.
        if (!this.phase[ia] || this.phase[ia] !== this.phase[ib]) continue;
        a[f] = ia; b[f] = ib; phase[f] = this.phase[ia];
        this.neighbors[ia*6+axis*2+1] = ib; this.neighbors[ib*6+axis*2] = ia;
        this.degree[ia]++; this.degree[ib]++;
      }
      const pairs = [];
      for (let f = 0; f < count; f++) if (phase[f]) {
        const xyz = coordinates(fd, f);
        for (let k = 0; k < 3; k++) if (xyz[k] + 1 < fd[k]) {
          const q = [...xyz]; q[k]++; const j = index3(fd, ...q);
          if (phase[j] === phase[f]) pairs.push([f, j]);
        }
      }
      const positions=new Float64Array(count*3);
      for(let i=0;i<count;i++){const c=coordinates(fd,i);for(let k=0;k<3;k++)positions[3*i+k]=(c[k]+(k===axis?0:.5))*this.h;}
      return {axis, dims: fd, a, b, phase, pairs, positions, velocity: new Float64Array(count)};
    });
    // Independent pressure gauges for all connected fluid regions, including
    // cavities split by obstacles. Do not pin just one cell for the entire box.
    this.components = []; const seen = new Uint8Array(this.count);
    for (let i = 0; i < this.count; i++) if (this.phase[i] && !seen[i]) {
      const cells = [i]; seen[i] = 1;
      for (let k = 0; k < cells.length; k++) for (let n = 0; n < 6; n++) {
        const j = this.neighbors[cells[k]*6+n];
        if (j >= 0 && !seen[j]) {seen[j] = 1; cells.push(j);}
      }
      this.components.push(cells);
    }
  }
  position(i) {return coordinates(this.dims, i).map(v => (v + .5) * this.h);}
  facePosition(face, i) {return coordinates(face.dims, i).map((v,k) => (v + (k === face.axis ? 0 : .5)) * this.h);}
  cellAt(p) {
    const x=Math.floor(p[0]/this.h),y=Math.floor(p[1]/this.h),z=Math.floor(p[2]/this.h),d=this.dims;
    return x<0||y<0||z<0||x>=d[0]||y>=d[1]||z>=d[2]?-1:x+d[0]*(y+d[1]*z);
  }
  absolutePressure(i) {
    const m = MATERIAL[this.phase[i]];
    return m ? ATMOSPHERE + m.density * GRAVITY * (this.waterLevel - this.position(i)[1]) + this.pressure[i] : NaN;
  }
  removeMean(v) {
    for (const cells of this.components) {
      let sum = 0; for (const i of cells) sum += v[i];
      const mean = sum / cells.length; for (const i of cells) v[i] -= mean;
    }
    return v;
  }
  divergence() {
    const result = new Float64Array(this.count);
    for (const f of this.faces) for (let k = 0; k < f.velocity.length; k++) if (f.phase[k]) {
      const flux = f.velocity[k] / this.h; result[f.a[k]] += flux; result[f.b[k]] -= flux;
    }
    return result;
  }
  centerVelocity(i) {
    const c = coordinates(this.dims, i);
    return this.faces.map((f, axis) => {
      const hi = [...c]; hi[axis]++;
      return .5 * (f.velocity[index3(f.dims, ...c)] + f.velocity[index3(f.dims, ...hi)]);
    });
  }
  sampleComponent(p, phase, f, values) {
    const axis=f.axis, x=p[0]/this.h-(axis===0?0:.5), y=p[1]/this.h-(axis===1?0:.5), z=p[2]/this.h-(axis===2?0:.5);
    const bx=Math.floor(x), by=Math.floor(y), bz=Math.floor(z), fx=x-bx, fy=y-by, fz=z-bz, [nx,ny,nz]=f.dims;
    let sum=0, weight=0;
    for(let n=0;n<8;n++) {
      const dx=n&1, dy=(n>>1)&1, dz=(n>>2)&1, ix=bx+dx, iy=by+dy, iz=bz+dz;
      if(ix<0||iy<0||iz<0||ix>=nx||iy>=ny||iz>=nz)continue;
      const i=ix+nx*(iy+ny*iz); if(f.phase[i]!==phase)continue;
      const w=(dx?fx:1-fx)*(dy?fy:1-fy)*(dz?fz:1-fz); weight+=w;sum+=w*values[i];
    }
    return weight>1e-12?sum/weight:0;
  }
  sampleVelocity(p, phase, values = this.faces.map(f=>f.velocity)) {
    return this.faces.map((f,axis)=>this.sampleComponent(p,phase,f,values[axis]));
  }
  maxSpeed() {
    return Math.hypot(...this.faces.map(f => f.velocity.reduce((a,b)=>Math.max(a,Math.abs(b)),0)));
  }
  stableDt(requested = 1/30) {
    const sum = this.faces.reduce((s,f)=>s+f.velocity.reduce((a,b)=>Math.max(a,Math.abs(b)),0),0);
    const viscosity = MATERIAL[AIR].viscosity * this.viscosityScale;
    // CFL for conservative upwind transport; explicit diffusion in 3D.
    return Math.min(requested, .45*this.h/Math.max(sum, 1e-9), .14*this.h**2/Math.max(this.mixing+2.5e-5,viscosity,1e-9));
  }
  advectVelocity(dt) {
    const old = this.faces.map(f => f.velocity.slice()), p=[0,0,0], q=[0,0,0], trial=[0,0,0], v=[0,0,0];
    for (const f of this.faces) for (let i = 0; i < f.velocity.length; i++) if (f.phase[i]) {
      for(let k=0;k<3;k++)p[k]=q[k]=f.positions[3*i+k];
      for(let k=0;k<3;k++)v[k]=this.sampleComponent(p,f.phase[i],this.faces[k],old[k]);
      // Stop backtraces at phase/solid walls, rather than interpolating through
      // an obstacle. With the CFL bound this trace is shorter than one cell.
      for (let n = 1; n <= 4; n++) {
        for(let k=0;k<3;k++)trial[k]=p[k]-dt*v[k]*n/4;
        const cell=this.cellAt(trial);
        if (cell < 0 || this.phase[cell] !== f.phase[i]) break;
        for(let k=0;k<3;k++)q[k]=trial[k];
      }
      f.velocity[i] = this.sampleComponent(q, f.phase[i], f, old[f.axis]);
    }
  }
  diffuseVelocity(dt) {
    for (const f of this.faces) {
      const delta = new Float64Array(f.velocity.length);
      for (const [a,b] of f.pairs) {
        const k = dt * MATERIAL[f.phase[a]].viscosity * this.viscosityScale / this.h**2;
        const transfer = k * (f.velocity[b] - f.velocity[a]); delta[a] += transfer; delta[b] -= transfer;
      }
      for (let i = 0; i < delta.length; i++) f.velocity[i] += delta[i];
    }
  }
  advectScalars(dt) {
    const heat = new Float64Array(this.count), vapour = new Float64Array(this.count);
    for (const f of this.faces) for (let i = 0; i < f.velocity.length; i++) if (f.phase[i]) {
      const a = f.a[i], b = f.b[i], u = f.velocity[i], donor = u >= 0 ? a : b;
      const c = dt*u/this.h, t = c * (this.temperature[donor]-273.15);
      heat[a] -= t; heat[b] += t;
      if (f.phase[i] === AIR) {const q = c*this.humidity[donor]; vapour[a] -= q; vapour[b] += q;}
    }
    for (let i = 0; i < this.count; i++) if (this.phase[i]) {
      this.temperature[i] += heat[i]; this.humidity[i] += vapour[i];
    }
  }
  diffuseScalars(dt) {
    const heat = new Float64Array(this.count), vapour = new Float64Array(this.count);
    for (const [a,b] of this.thermalEdges) {
      const ma = MATERIAL[this.phase[a]], mb = MATERIAL[this.phase[b]], ca = ma.density*ma.heatCapacity, cb = mb.density*mb.heatCapacity;
      const same = this.phase[a] === this.phase[b];
      // Heat, not temperature, is exchanged across the water/air interface.
      // Eddy mixing is confined to its phase; physical conduction crosses it.
      const conductivity = 2*ma.conductivity*mb.conductivity/(ma.conductivity+mb.conductivity) + (same ? this.mixing*ca : 0);
      const energy = dt*conductivity*(this.temperature[b]-this.temperature[a])/this.h**2;
      heat[a] += energy/ca; heat[b] -= energy/cb;
      if (this.phase[a] === AIR && this.phase[b] === AIR) {
        const q = dt*(this.mixing+2.5e-5)*(this.humidity[b]-this.humidity[a])/this.h**2;
        vapour[a] += q; vapour[b] -= q;
      }
    }
    for (let i = 0; i < this.count; i++) if (this.phase[i]) {this.temperature[i] += heat[i]; this.humidity[i] += vapour[i];}
  }
  applyProjection(potential, dt) {
    // Solve for phi = dt * p_dynamic / rho. Each fixed phase has constant rho;
    // this normalization removes the 830:1 conditioning penalty from the solve.
    this.removeMean(potential);
    for (const f of this.faces) for (let i = 0; i < f.velocity.length; i++) if (f.phase[i]) {
      f.velocity[i] -= (potential[f.b[i]] - potential[f.a[i]]) / this.h;
    }
    for (let i = 0; i < this.count; i++) this.pressure[i] = this.phase[i] ? MATERIAL[this.phase[i]].density * potential[i] / dt : 0;
  }
  impulse(center, radius = 1.2, velocity = [2,0,0]) {
    for (const f of this.faces) for (let i = 0; i < f.velocity.length; i++) if (f.phase[i]) {
      const p = this.facePosition(f, i), d2 = p.reduce((s,v,k)=>s+(v-center[k])**2,0);
      f.velocity[i] += velocity[f.axis] * Math.exp(-d2/(radius*radius));
    }
  }
  totals() {
    let heat = 0, vapour = 0, kinetic = 0;
    for (let i = 0; i < this.count; i++) if (this.phase[i]) {
      const m = MATERIAL[this.phase[i]]; heat += m.density*m.heatCapacity*this.temperature[i]*this.h**3;
      if (this.phase[i] === AIR) vapour += m.density*this.humidity[i]*this.h**3;
    }
    for (const f of this.faces) for (let i = 0; i < f.velocity.length; i++) if (f.phase[i]) kinetic += .5*MATERIAL[f.phase[i]].density*f.velocity[i]**2*this.h**3;
    return {heat, vapour, kinetic};
  }
}

export function createFieldFixture(options = {}) {
  const dims = options.dims || [24,18,16], h = options.cellSize || .4, level = Math.floor(dims[1]/3)*h;
  const size = dims.map(n=>n*h), center = [size[0]*.59, level*.6, size[2]*.5], radius = Math.min(...size)*.17;
  const fields = new FluidFields({...options, dims, cellSize:h, waterLevel:level, phaseAt: p => {
    if (Math.hypot(...p.map((v,k)=>v-center[k])) < radius) return SOLID;
    return p[1] < level ? WATER : AIR;
  }});
  for (let i = 0; i < fields.count; i++) if (fields.phase[i]) {
    const p = fields.position(i), air = fields.phase[i] === AIR;
    const patch = Math.exp(-((p[0]-size[0]*.28)**2+(p[1]-(air?level+1.5:level*.5))**2+(p[2]-size[2]*.5)**2)/1.8);
    fields.temperature[i] = 273.15+(air?20:14)+12*patch;
    fields.humidity[i] = air ? humidityAtRH(.35,293.15)+.011*patch : 0;
  }
  fields.impulse([size[0]*.28,level*.5,size[2]*.5],1.4,[1.5,.5,.3]);
  fields.impulse([size[0]*.35,level+1.8,size[2]*.5],1.8,[2.5,.4,-.2]);
  return fields;
}
