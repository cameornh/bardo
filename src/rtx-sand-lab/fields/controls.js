import {FieldSliceView,VIEWS} from '../../fluid-fields/view.js';
import {MATERIAL} from '../../fluid-fields/model.js';
export function installBeachFieldControls(lab,anchor){
 const section=document.createElement('fieldset');section.id='beach-fields-controls';section.innerHTML=`<legend>Air / water fields</legend>
 <label><input id="bulk-fields-enabled" type="checkbox" checked> Hybrid field physics</label>
 <label>Field pressure backend<select id="bulk-field-backend"><option value="cpu">CPU multigrid</option><option value="gpu" disabled>GPU multigrid (verify first)</option></select></label>
 <label>Particle backend<select id="particle-backend"><option value="cpu">CPU reference / WebAssembly</option><option value="webgpu" disabled>WebGPU (verify first)</option></select></label>
 <button id="particle-verify">Verify GPU particles</button><small id="particle-check"></small>
 <button id="bulk-field-step">Step beach once</button><button id="bulk-field-verify">Verify small GPU field</button><button id="bulk-field-view">Show field slices</button>
 <pre id="bulk-field-status">Preparing fields on the first physics step.</pre>
 <div id="bulk-field-debug" hidden><label>Field<select id="bulk-field-value">${Object.entries(VIEWS).filter(([key])=>key!=='pressure').map(([key,v])=>`<option value="${key}">${v.label}</option>`).join('')}</select></label>
 <label>Phase<select id="bulk-field-phase"><option value="0">Air and water</option><option value="1">Water</option><option value="2">Air</option></select></label>
 <label>Slice plane<select id="bulk-field-axis"><option value="2">XY</option><option value="0">YZ</option><option value="1">XZ</option></select></label>
 <label>Slice position<input id="bulk-field-slice" type="range" min="0" max="1" step=".01" value=".5"></label>
 <label><input id="bulk-field-arrows" type="checkbox" checked> Velocity arrows</label>
 <canvas id="bulk-field-canvas" width="660" height="460" style="width:100%;height:auto;touch-action:none"></canvas><canvas id="bulk-field-legend" width="300" height="12" style="width:100%;height:12px"></canvas><small id="bulk-field-range"></small>
 <pre id="bulk-field-hover" style="white-space:pre-wrap"></pre>
 <label>Click probe<select id="bulk-field-probe"><option value="inspect">Inspect</option><option value="warm">Warm +2 °C</option><option value="cool">Cool −2 °C</option><option value="humid">Add 1 g/kg vapour (air)</option></select></label>
 <small>Slice axes are relative to the grid corner; hover coordinates are world metres. Probes add external heat or vapour. Rain and surface beads exchange heat; evaporation and new weather effects are not enabled.</small></div>`;
 anchor.closest('fieldset').before(section);const $=id=>section.querySelector('#'+id),fields=lab.bulkFields,canvas=$('bulk-field-canvas'),view=new FieldSliceView(canvas,$('bulk-field-legend'));
 $('bulk-fields-enabled').onchange=e=>{if(lab.asyncPending){e.target.checked=fields.enabled;return;}fields.enabled=e.target.checked;lab.air.grid=null;lab.air.key=null;};
 $('bulk-field-backend').onchange=e=>fields.backend=e.target.value;
 $('particle-backend').onchange=e=>{if(lab.asyncPending){e.target.value=fields.particleBackend;return;}fields.particleBackend=e.target.value;};
 $('particle-verify').onclick=async()=>{lab.paused=true;document.getElementById('pause').textContent='Resume';const b=$('particle-verify');b.disabled=true;$('particle-check').textContent='Checking bounded particle kernels…';
  try{if(lab.asyncPending)await lab.asyncPending;const r=await fields.verifyParticles();$('particle-backend').querySelector('[value="webgpu"]').disabled=!r.pass;$('particle-check').textContent=r.pass?`Numerical comparison and overflow fallback passed. WebGPU is available.${r.sceneWarmup?' Current beach warmed in '+r.sceneWarmup.totalMs.toFixed(0)+' ms.':''}`:JSON.stringify(r);}
  catch(e){$('particle-check').textContent=e.message;}finally{b.disabled=false;}
 };
 $('bulk-field-step').onclick=async()=>{
  const button=$('bulk-field-step'),wasQA=lab.qaRunning;button.disabled=true;lab.paused=true;lab.qaRunning=true;document.getElementById('pause').textContent='Resume';
  try{if(lab.asyncPending)await lab.asyncPending;const start=performance.now();while(lab.renderPending){if(performance.now()-start>3000)throw Error('Waiting for the current render; step not submitted');await new Promise(r=>setTimeout(r,10));}lab.qaRunning=false;if(lab.asyncSimulation&&!lab.gpu.cpu){lab.accumulator=lab.timestep;lab.paused=false;lab.startAsyncStep();lab.paused=true;lab.qaRunning=true;await lab.asyncPending;}else lab.step(lab.timestep);update();}
  catch(error){fields.verifyText=String(error.message);}finally{lab.qaRunning=wasQA;button.disabled=false;}
 };
 $('bulk-field-verify').onclick=async()=>{lab.paused=true;document.getElementById('pause').textContent='Resume';const b=$('bulk-field-verify');b.disabled=true;
  try{if(lab.asyncPending)await lab.asyncPending;const result=await fields.verify();$('bulk-field-status').textContent=JSON.stringify(result,null,2);$('bulk-field-backend').querySelector('[value="gpu"]').disabled=!result.pass;fields.verifyText=JSON.stringify(result);}
  catch(error){fields.verifyText=String(error.message);}finally{b.disabled=false;}
 };
 $('bulk-field-view').onclick=()=>{const d=$('bulk-field-debug');d.hidden=!d.hidden;$('bulk-field-view').textContent=d.hidden?'Show field slices':'Hide field slices';update();};
 for(const [id,key] of [['value','key'],['phase','phase'],['axis','axis'],['slice','slice'],['arrows','arrows']]){const input=$('bulk-field-'+id);input.oninput=e=>{const target=e?.target||input;view[key]=id==='value'?target.value:id==='arrows'?target.checked:Number(target.value);update();};}
 const readout=()=>view.readout(fields.grid,view.hover<fields.grid.count?view.hover:-1).replace('Dynamic pressure:','Gauge pressure:');
 canvas.onpointermove=e=>{if(!fields.grid)return;view.hover=view.cellFromEvent(e,fields.grid);$('bulk-field-hover').textContent=readout();};
 canvas.onclick=()=>{const g=fields.grid,i=view.hover,probe=$('bulk-field-probe').value;if(lab.asyncPending||!g||i<0||!g.phase[i])return;const m=MATERIAL[g.phase[i]],mass=m.density*g.volume;if(probe==='warm'||probe==='cool'){const dt=probe==='warm'?2:-2;g.temperature[i]+=dt;g.ledger.probeHeat+=mass*m.heatCapacity*dt;}if(probe==='humid'&&g.phase[i]===2){g.humidity[i]+=.001;g.ledger.probeVapour+=mass*.001;}update();};
 function update(){
  if(lab.gpu.cpu||!lab.asyncSimulation||lab.optimizations?.gpuBatch===false)fields.particleBackend='cpu';
  $('particle-backend').querySelector('[value="webgpu"]').disabled=!fields.particles?.validated||fields.particles.disabled||lab.gpu.cpu||!lab.asyncSimulation||lab.optimizations?.gpuBatch===false;
  if(!lab.asyncPending){$('bulk-field-backend').value=fields.backend;$('particle-backend').value=fields.particleBackend;}
  const s=fields.stats;$('bulk-field-status').textContent=`${fields.enabled?'Active':'Disabled'} · ${s.backend}\n${s.cells||0} field cells · ${s.waterCells||0} water cells\n${s.coupled||0}/${lab.count} particles coupled · ${s.particleCompute?'GPU surface/contact band':(s.surfaceParticles||0)+' in surface/contact band'}\nPressure: ${(s.milliseconds||0).toFixed(1)} ms · ${s.iterations||0} iterations · ${s.levels||0} levels\nRelative residual: ${(s.relativeResidual||0).toExponential(2)}\nDivergence: ${(s.before||0).toExponential(2)} → ${(s.divergence||0).toExponential(2)} /s\nCPU: field deposition, moving geometry, scalar transport\n${s.transportBackend||'CPU transport'}: ${(s.transportMs||0).toFixed(1)} ms · ${s.particleCompute?'one bounded physics readback':'no physics state readback'}\nSurface contacts: ${s.surfaceBackend||'preparing'} · ${s.surfaceMs==null?'included above':s.surfaceMs.toFixed(1)+' ms'}\n${s.backend?.startsWith('GPU')?'GPU: resident pressure V-cycles; one final readback':'GPU pressure available after numerical verification'}${s.particleFallback?'\nParticle fallback: '+s.particleFallback:''}${fields.verifyText?'\nGPU check: '+fields.verifyText:''}`;
  if(!$('bulk-field-debug').hidden&&fields.grid){const range=view.draw(fields.grid);$('bulk-field-range').textContent=`${range.low.toPrecision(4)} to ${range.high.toPrecision(4)} ${range.unit}`;$('bulk-field-hover').textContent=readout();}
 }
 const timer=setInterval(update,700);window.addEventListener('pagehide',()=>{clearInterval(timer);fields.dispose();},{once:true});return {view,update};
}
