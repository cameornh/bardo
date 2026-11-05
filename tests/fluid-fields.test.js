import test from 'node:test';
import assert from 'node:assert/strict';
import {FluidFields,createFieldFixture,AIR,WATER,SOLID,MATERIAL,GRAVITY,ATMOSPHERE,relativeHumidity,humidityAtRH,saturationPressure} from '../src/fluid-fields/model.js';
import {applyLaplacian,pressureRHS,solvePressureCPU,solveSORReference,residual,rms,stepFields} from '../src/fluid-fields/pressure.js';
import {loadScene} from '../src/scene-startup.js';
import {VIEWS,fieldValues} from '../src/fluid-fields/view.js';
const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b} within ${tolerance}`);
const relative=(a,b,tolerance=1e-10)=>close(a/b,1,tolerance);

test('hydrostatic air and water have their own density and share the interface reference pressure',()=>{
  const f=new FluidFields({dims:[4,6,4],cellSize:.5,waterLevel:1.5});
  for(let i=0;i<f.count;i++) {
    const y=f.position(i)[1],rho=MATERIAL[f.phase[i]].density;
    close(f.absolutePressure(i),ATMOSPHERE+rho*GRAVITY*(1.5-y));
  }
  assert.ok(f.absolutePressure(0)>f.absolutePressure(4));
});
test('humidity responds to temperature and absolute pressure; water does not contain an air humidity field',()=>{
  close(saturationPressure(293.15),2338.281270927446,1e-6);
  const q=humidityAtRH(.5,293.15);
  close(relativeHumidity(q,293.15),.5);
  assert.ok(relativeHumidity(q,303.15)<.3);
  close(relativeHumidity(q,293.15,ATMOSPHERE*.8),.4);
  assert.ok(relativeHumidity(.03,283.15)>1,'supersaturation must not silently delete moisture');
  const f=createFieldFixture({dims:[8,6,6]});
  for(let i=0;i<f.count;i++)if(f.phase[i]!==AIR)close(f.humidity[i],0);
});
test('MAC pressure operator is symmetric, positive semidefinite and annihilates constants',()=>{
  const f=createFieldFixture({dims:[8,6,6]}),a=Float64Array.from(f.phase,(_,i)=>Math.sin(i)),b=a.map((_,i)=>Math.cos(i*.7));
  const aa=applyLaplacian(f,a),ab=applyLaplacian(f,b);
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  close(dot(a,ab),dot(aa,b),1e-10);assert.ok(dot(a,aa)>=0);
  close(rms(applyLaplacian(f,new Float64Array(f.count).fill(1))),0);
});
test('manufactured pressure is recovered up to each disconnected region gauge',()=>{
  const f=new FluidFields({dims:[10,8,8],phaseAt:p=>p[0]>1.6&&p[0]<2?SOLID:p[1]<1.2?WATER:AIR});
  assert.equal(f.components.length,4);
  const exact=f.removeMean(Float64Array.from(f.phase,(p,i)=>p?Math.sin(i*.4)+Math.cos(i*.15):0)),rhs=applyLaplacian(f,exact);
  const solved=solvePressureCPU(f,rhs,{tolerance:1e-10});
  assert.ok(rms(solved.potential.map((v,i)=>v-exact[i]))<1e-8);
  assert.ok(solved.relativeResidual<1e-9);
});
test('projection removes divergent motion, does not create kinetic energy or wall penetration',()=>{
  const f=createFieldFixture({dims:[10,8,8]}),before=rms(f.divergence()),energy=f.totals().kinetic;
  const solve=solvePressureCPU(f,pressureRHS(f));f.applyProjection(solve.potential,.03);
  assert.ok(rms(f.divergence())<before*1e-6);assert.ok(f.totals().kinetic<=energy);
  for(const face of f.faces)for(let i=0;i<face.phase.length;i++)if(!face.phase[i])close(face.velocity[i],0);
});
test('pressure scales with density while projected velocity does not',()=>{
  const fields=[WATER,AIR].map(phase=>new FluidFields({dims:[6,6,6],phaseAt:()=>phase}));
  for(const f of fields){f.impulse([1,1,1],.7,[1,.2,.4]);f.applyProjection(solvePressureCPU(f,pressureRHS(f)).potential,.03);}
  const ratio=MATERIAL[WATER].density/MATERIAL[AIR].density;
  for(let i=0;i<fields[0].count;i++)close(fields[0].pressure[i],fields[1].pressure[i]*ratio,1e-9);
  for(let a=0;a<3;a++)for(let i=0;i<fields[0].faces[a].velocity.length;i++)close(fields[0].faces[a].velocity[i],fields[1].faces[a].velocity[i]);
});
test('SOR GPU reference converges on both sides of the fixed interface',()=>{
  const f=new FluidFields({dims:[8,6,6]});f.impulse([1,1,1],.8,[2,.3,-.4]);f.impulse([2,2,1],.6,[-1,.5,1]);
  const rhs=pressureRHS(f),x=solveSORReference(f,rhs,64);
  assert.ok(residual(f,x,rhs)/rms(rhs)<1e-6);
});
test('heat conduction conserves energy across unequal capacities and moisture cannot enter water',()=>{
  const f=new FluidFields({dims:[6,6,6],waterLevel:1.2});f.mixing=.1;
  for(let i=0;i<f.count;i++){f.temperature[i]=f.phase[i]===WATER?310:280;if(f.phase[i]===AIR)f.humidity[i]=i%2?.02:.004;}
  const before=f.totals();
  for(let i=0;i<80;i++)f.diffuseScalars(.03);
  const after=f.totals();relative(after.heat,before.heat);relative(after.vapour,before.vapour);
  for(let i=0;i<f.count;i++){assert.ok(f.temperature[i]>=280&&f.temperature[i]<=310);if(f.phase[i]===WATER)close(f.humidity[i],0);}
  assert.ok(f.temperature.some((v,i)=>f.phase[i]===AIR&&v>280));
});
test('viscosity dissipates energy and strong-viscosity settings lower the stable timestep',()=>{
  const f=new FluidFields({dims:[8,6,6],phaseAt:()=>AIR});f.impulse([1,1,1],.6,[2,1,.5]);
  const energy=f.totals().kinetic,normal=f.stableDt();f.viscosityScale=1e5;const dt=f.stableDt();
  assert.ok(dt<normal);for(let i=0;i<10;i++)f.diffuseVelocity(dt);
  assert.ok(f.totals().kinetic<energy*.9);
});
test('transport stays finite, conserves heat and water vapour, and leaves the mask fixed over sustained stepping',async()=>{
  const f=createFieldFixture({dims:[8,6,6]}),mask=f.phase.slice(),before=f.totals();
  let worst=0;
  for(let i=0;i<50;i++){const s=await stepFields(f,1/30);worst=Math.max(worst,s.after);}
  const after=f.totals();relative(after.heat,before.heat,1e-9);relative(after.vapour,before.vapour,1e-9);
  assert.deepEqual(f.phase,mask);assert.ok(worst<1e-7);
  assert.ok(f.temperature.every(v=>v>=273&&v<330));assert.ok(f.humidity.every(v=>v>=0&&v<.04));
});
test('still hydrostatic water and uniform air remain at rest',async()=>{
  const f=new FluidFields({dims:[6,6,6]});const before=f.totals();
  for(let i=0;i<4;i++)await stepFields(f,.03);
  close(f.maxSpeed(),0);close(rms(f.pressure),0);relative(f.totals().heat,before.heat);
});
test('debug fields do not change the simulation and humidity displays exclude water',()=>{
  const f=createFieldFixture({dims:[8,6,6]}),before=f.totals(),temperature=f.temperature.slice();
  for(const key of Object.keys(VIEWS)) {
    const values=fieldValues(f,key);assert.equal(values.length,f.count);
    for(let i=0;i<f.count;i++)if(f.phase[i]){
      if(['humidity','rh'].includes(key)&&f.phase[i]===WATER)assert.ok(Number.isNaN(values[i]));
      else assert.ok(Number.isFinite(values[i]));
    }
  }
  assert.deepEqual(f.totals(),before);assert.deepEqual(f.temperature,temperature);
});
test('an invalid compute result stops before scalar transport instead of contaminating fields',async()=>{
  const f=createFieldFixture({dims:[6,6,6]}),temperature=f.temperature.slice();
  const badSolver={solve:async()=>({potential:new Float64Array(f.count).fill(NaN),relativeResidual:NaN})};
  await assert.rejects(stepFields(f,.03,badSolver),/did not converge/);close(f.time,0);assert.deepEqual(f.temperature,temperature);
});
test('field route is isolated from historical scene imports',async()=>{
  const events=[],boot={mark:()=>{},fail:e=>{throw e;},watchLegacy:()=>{throw Error('snapshot import');}};
  const kind=await loadScene(new URLSearchParams('scene=fluid-fields'),boot,async k=>{events.push(k);return {startFieldApp:async()=>events.push('fields started')};});
  assert.equal(kind,'fields');assert.deepEqual(events,['fields','fields started']);
});
