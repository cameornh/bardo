import {createFieldFixture,AIR,WATER} from './model.js';
import {stepFields,rms,pressureRHS,solvePressureCPU} from './pressure.js';
import {FieldPressureGPU,validateFieldGPU} from './gpu-pressure.js';
import {FieldSliceView,VIEWS} from './view.js';
import './style.css';

export async function startFieldApp(boot) {
  document.title='Bulk fluid fields';
  document.body.innerHTML=`<main id="field-lab">
  <section class="field-display"><canvas id="field-view" width="960" height="680" aria-label="Fluid field cross section"></canvas><div class="field-legend"><span id="field-low"></span><canvas id="field-legend" width="256" height="14" aria-label="Color scale"></canvas><span id="field-high"></span></div><pre id="field-hover" aria-live="polite"></pre><p id="field-rate"></p></section>
  <aside class="field-controls"><h1>Bulk fluid fields</h1><p>3D grid experiment · fixed waterline and solid obstacle. The beach solver and saved terrain are unchanged.</p><a href="/?scene=sand-lab&paused=1">Return to sand lab</a>
  <div class="row"><button id="field-play">Play</button><button id="field-step">Step</button><button id="field-reset">Reset</button></div>
  <label>Field<select id="field-select">${Object.entries(VIEWS).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label>
  <label>Region<select id="field-phase"><option value="0">Air and water</option><option value="2">Air</option><option value="1">Water</option></select></label>
  <label>Slice plane<select id="field-plane"><option value="2">XY · front</option><option value="0">YZ · side</option><option value="1">XZ · top</option></select></label>
  <label>Slice position <output id="field-slice-value"></output><input id="field-slice" type="range" min="0" max="1" step=".01" value=".5"></label>
  <label class="check"><input id="field-arrows" type="checkbox" checked> Velocity arrows</label>
  <fieldset><legend>Probes</legend><label>Click a cell<select id="field-tool"><option value="inspect">Inspect</option><option value="push">Push +X</option><option value="warm">Warm +5 °C</option><option value="cool">Cool −5 °C</option><option value="moisture">Add airborne moisture</option></select></label><div class="row"><button id="field-water-push">Push water</button><button id="field-air-push">Push air</button></div><small>Probes affect a small volume around the selected cell. Moisture is added only to air.</small></fieldset>
  <fieldset><legend>Transport</legend><label>Mixing diffusivity <output id="field-mixing-value">0.025 m²/s</output><input id="field-mixing" type="range" min="0" max=".2" step=".005" value=".025"></label><label>Viscosity multiplier <output id="field-viscosity-value">1×</output><input id="field-viscosity" type="range" min="0" max="5" step=".1" value="0"></label><small>1× uses molecular viscosity. Larger values exaggerate viscous damping for inspection. Heat conducts across the interface; moisture does not.</small></fieldset>
  <fieldset><legend>Execution</legend><label>Pressure solver<select id="field-backend"><option value="auto">Automatic · measured on this device</option><option value="gpu">GPU + CPU convergence correction</option><option value="cpu">CPU reference</option></select></label><label>Grid (resets experiment)<select id="field-grid"><option value="small">16 × 12 × 12 · 2,304 cells</option><option value="medium">24 × 18 × 18 · 7,776 cells</option></select></label><button id="field-validate">Validate GPU against CPU</button><p id="field-backend-status">Checking bounded GPU stencil…</p><small>Advection, viscosity, scalar transport and boundary setup run on the CPU. No compute depends on the debug view. Presentation is capped at 60 fps.</small></fieldset>
  <details open><summary>Diagnostics</summary><pre id="field-diagnostics"></pre></details><details><summary>GPU validation</summary><pre id="field-validation"></pre></details>
  <p class="field-note">Pressure is a low-speed incompressibility constraint plus hydrostatic pressure. This is not an acoustic/compressible-air solver. Waterline movement, surface blobs, evaporation, condensation and temperature-driven forces are not coupled yet. Relative humidity can exceed 100%.</p>
  </aside></main>`;
  const $=id=>document.getElementById(id), params=new URLSearchParams(location.search);
  let grid=createFieldFixture({dims:[16,12,12],cellSize:.5}), baseline=grid.totals(), gpu=null, validation=null, autoBackend='cpu';
  let paused=true,busy=false,dirty=true,last=performance.now(),accumulator=0,stats=null,frames=0,rateStart=last,simStart=0,disposed=false;
  const view=new FieldSliceView($('field-view'),$('field-legend'));
  function controlsBusy(value) {for(const id of ['field-step','field-reset','field-grid','field-backend','field-validate'])$(id).disabled=value;}
  function render() {
    const range=view.draw(grid), fmt=n=>Math.abs(n)<.001&&n!==0?n.toExponential(2):n.toFixed(2);
    $('field-low').textContent=fmt(range.low);$('field-high').textContent=fmt(range.high)+' '+range.unit;
    $('field-slice-value').textContent=((range.slice+.5)*grid.h).toFixed(2)+' m';
    $('field-hover').textContent=view.readout(grid,view.hover);
    const totals=grid.totals();
    $('field-diagnostics').textContent=`${grid.count.toLocaleString()} cells · ${grid.h.toFixed(3)} m spacing\nTime: ${grid.time.toFixed(3)} s\nPressure: ${stats?.backend||'not stepped'}\nStep: ${(stats?.milliseconds||0).toFixed(1)} ms · dt ${(stats?.dt||0).toFixed(4)} s\nDivergence RMS: ${(stats?.before??rms(grid.divergence())).toExponential(2)} → ${(stats?.after??rms(grid.divergence())).toExponential(2)} /s\nPressure relative residual: ${(stats?.relativeResidual||0).toExponential(2)}\nHeat drift since last probe: ${((totals.heat/baseline.heat-1)*100).toExponential(2)}%\nVapour drift since last probe: ${((totals.vapour/baseline.vapour-1)*100).toExponential(2)}%\n${grid.components.length} connected fluid regions\nClosed walls · fixed waterline · free slip\nNo surface or sand material changes`;
    dirty=false;
  }
  async function verify() {
    busy=true;controlsBusy(true);
    try {
      if(!gpu)gpu=new FieldPressureGPU();
      validation=await validateFieldGPU(gpu);if(!validation.pass)throw Error('Numerical GPU comparison failed');
      // Compare complete pressure work, including the required residual fix.
      // This is a bounded calibration on the current grid, not a stress test.
      const rhs=pressureRHS(grid), timings=[];
      for(let i=0;i<3;i++){const start=performance.now();solvePressureCPU(grid,rhs);timings.push(performance.now()-start);}
      const start=performance.now(), result=await gpu.solve(grid,rhs);
      if(result.relativeResidual>2e-5)solvePressureCPU(grid,rhs,{initial:result.potential});
      const gpuMs=performance.now()-start, cpuMs=timings.sort((a,b)=>a-b)[1];autoBackend=gpuMs<cpuMs*.9?'gpu':'cpu';
      validation.calibration={cells:grid.count,cpuMs,gpuMs,selected:autoBackend};
      $('field-validation').textContent=JSON.stringify(validation,null,2);
      $('field-backend-status').textContent=`Automatic: ${autoBackend.toUpperCase()} · pressure ${cpuMs.toFixed(1)} ms CPU / ${gpuMs.toFixed(1)} ms GPU (includes correction). GPU validated · ${gpu.device}`;
      $('field-backend').options[1].disabled=false;
    }catch(error){
      autoBackend='cpu';$('field-backend').value='cpu';$('field-backend').options[1].disabled=true;
      $('field-backend-status').textContent='CPU reference · '+error.message;
      $('field-validation').textContent=JSON.stringify(validation||{pass:false,error:error.message},null,2);
      gpu?.dispose();gpu=null;
    }finally{busy=false;controlsBusy(false);dirty=true;}
  }
  async function step() {
    if(busy||disposed)return;busy=true;controlsBusy(true);
    try {
      const selected=$('field-backend').value, useGPU=selected==='gpu'||selected==='auto'&&autoBackend==='gpu';
      stats=await stepFields(grid,1/30,useGPU?gpu:null);dirty=true;
    }catch(error){
      paused=true;$('field-play').textContent='Play';autoBackend='cpu';$('field-backend').value='cpu';$('field-backend').options[1].disabled=true;
      $('field-backend-status').textContent='Stopped · '+error.message+' · CPU reference available';
      gpu?.dispose();gpu=null;
    }finally{busy=false;controlsBusy(false);}
  }
  $('field-play').onclick=()=>{paused=!paused;accumulator=0;$('field-play').textContent=paused?'Play':'Pause';};
  $('field-step').onclick=step;
  async function reset() {
    if(busy)return;
    const medium=$('field-grid').value==='medium';grid=createFieldFixture({dims:medium?[24,18,18]:[16,12,12],cellSize:medium?1/3:.5});
    grid.mixing=Number($('field-mixing').value);grid.viscosityScale=10**Number($('field-viscosity').value);
    baseline=grid.totals();stats=null;accumulator=0;simStart=0;rateStart=performance.now();dirty=true;
    if(gpu&&$('field-backend').value==='auto')await verify();
  }
  $('field-reset').onclick=reset;$('field-grid').onchange=reset;
  $('field-validate').onclick=verify;
  $('field-backend').onchange=()=>{dirty=true;};
  for(const [id,property,convert] of [['field-select','key',String],['field-phase','phase',Number],['field-plane','axis',Number],['field-slice','slice',Number]])$(id).oninput=()=>{view[property]=convert($(id).value);view.hover=-1;dirty=true;};
  $('field-arrows').onchange=()=>{view.arrows=$('field-arrows').checked;dirty=true;};
  $('field-mixing').oninput=()=>{grid.mixing=Number($('field-mixing').value);$('field-mixing-value').value=grid.mixing.toFixed(3)+' m²/s';};
  $('field-viscosity').oninput=()=>{grid.viscosityScale=10**Number($('field-viscosity').value);$('field-viscosity-value').value=grid.viscosityScale.toFixed(1)+'×';};
  function probe(point,tool) {
    if(busy)return;
    if(tool==='push')grid.impulse(point,1,[2,0,0]);
    else for(let i=0;i<grid.count;i++)if(grid.phase[i]) {
      const p=grid.position(i), weight=Math.exp(-p.reduce((s,v,k)=>s+(v-point[k])**2,0)/.8);
      if(tool==='warm'||tool==='cool')grid.temperature[i]=Math.max(278.15,Math.min(323.15,grid.temperature[i]+weight*(tool==='warm'?5:-5)));
      if(tool==='moisture'&&grid.phase[i]===AIR)grid.humidity[i]=Math.min(.04,grid.humidity[i]+.004*weight);
    }
    baseline=grid.totals();dirty=true;
  }
  $('field-water-push').onclick=()=>probe([grid.dims[0]*grid.h*.3,grid.waterLevel*.5,grid.dims[2]*grid.h*.5],'push');
  $('field-air-push').onclick=()=>probe([grid.dims[0]*grid.h*.3,grid.waterLevel+1.5,grid.dims[2]*grid.h*.5],'push');
  $('field-view').onpointermove=e=>{view.hover=view.cellFromEvent(e,grid);dirty=true;};
  $('field-view').onpointerleave=()=>{view.hover=-1;dirty=true;};
  $('field-view').onclick=e=>{const i=view.cellFromEvent(e,grid);if(i>=0&&grid.phase[i]&&$('field-tool').value!=='inspect')probe(grid.position(i),$('field-tool').value);};
  // One asynchronous step at a time, never catch up a long stall or hidden tab.
  function tick(time) {
    if(disposed)return;requestAnimationFrame(tick);
    if(time-last<1000/60-.5)return;
    const elapsed=Math.min(.1,(time-last)/1000);last=time;
    if(document.hidden){accumulator=0;return;}
    if(!paused){accumulator=Math.min(1/15,accumulator+elapsed);const dt=grid.stableDt(1/30);if(!busy&&accumulator>=dt){accumulator-=dt;void step();}}
    if(dirty)render();frames++;
    if(time-rateStart>750){$('field-rate').textContent=`${(frames*1000/(time-rateStart)).toFixed(1)} fps · ${Math.min(1,(grid.time-simStart)*1000/(time-rateStart)).toFixed(2)}× realtime${paused?' · paused':''}`;frames=0;rateStart=time;simStart=grid.time;}
  }
  window.addEventListener('pagehide',()=>{disposed=true;gpu?.dispose();},{once:true});
  render();boot?.finish();requestAnimationFrame(tick);
  if(params.get('backend')==='cpu'){$('field-backend').value='cpu';$('field-backend-status').textContent='CPU reference selected';}
  else await verify();
  if(params.get('backend')==='gpu'&&gpu)$('field-backend').value='gpu';
  // Present a projected initial condition, then wait for the user to play.
  await step();if(params.get('paused')==='0'){paused=false;$('field-play').textContent='Pause';}
}
