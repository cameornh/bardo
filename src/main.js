import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { World, MATERIALS } from './world.js';
import { Probe, FixedStepper } from './physics.js';
import { FieldRenderer } from './renderer.js';
import { TerrainStreamer } from './streaming.js';
import { terrainHeight } from './terrain.js';
import { Fluid, createFluidTerrain, FLUID_STEP } from './fluid.js';
import { Granular, GRAIN_STEP } from './granular.js';
import { FabricTest } from './fabric.js';
import { FiberTest,FIBER_PRESETS } from './fibers.js';
import { DEFORM_STEP } from './deformable.js';
import { OPTICAL_METRES, sampleRadii } from './optics.js';
import { DEFAULT_LIGHT_TEST } from './light-transport.js';

const $ = id => document.getElementById(id);
const canvas=$('scene'), viewport=$('viewport');
const stepper=new FixedStepper(), keys=new Set();
let world,probe,camera,controls,renderer,streamer,fluid,granular,fabrics,fibers,persistentTerrain;
let fluidAccumulator=0,grainAccumulator=0,softAccumulator=0,fluidAverageMs=0;
let selected=0,tool='orbit',paused=false,lastTime=0;
let angle=125*Math.PI/180,dragStart=null,savedLocation=null,lastStream=0,frame=0;
let frameTimes=[],statusTimeout;

function status(text, duration=3500) {
  $('status').textContent=text;clearTimeout(statusTimeout);
  if(duration)statusTimeout=setTimeout(()=>$('status').textContent='',duration);
}
function fail(error) {
  console.error(error);$('loading').style.display='flex';$('loading').textContent=String(error.message||error);
  $('renderer-status').textContent='Error';
}
function select(id) {
  selected=id;$('material').value=String(id);
  $('roughness').value=MATERIALS[id].roughness;
  $('roughness-value').value=MATERIALS[id].roughness.toFixed(2);
}
function materialRoughness(value) {
  MATERIALS[selected].roughness=value;$('roughness').value=value;
  $('roughness-value').value=value.toFixed(2);renderer.setMaterial(selected);
}
function setTool(value) {
  tool=value;$('tool').value=value;canvas.classList.toggle('editing',tool!=='orbit');
  controls.mouseButtons.LEFT=tool==='orbit'?THREE.MOUSE.ROTATE:null;
  controls.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;
}
function moveTo(target) {
  const delta=new THREE.Vector3(...target).sub(controls.target);
  controls.target.add(delta);camera.position.add(delta);controls.update();updateStream();
}
function home() {
  if(renderer?.lightTest.enabled){const preset=renderer.lightTest.config.experiment;if(['sphere','convex','concave'].includes(preset)){camera.position.set(3.8,3.6,4.8);controls.target.set(0,1.2,0);}else if(preset==='prism'){camera.position.set(4.8,5.2,5.5);controls.target.set(0,1,-1.2);}else if(preset.includes('mirror')){camera.position.set(4.3,4.6,6.2);controls.target.set(0,1.4,1.6);}else{camera.position.set(5.6,4.2,6.4);controls.target.set(0,1,0);}}
  else if(renderer?.optics.enabled){const s=renderer.optics.samples[renderer.optics.selected];if(renderer.optics.isolate){camera.position.set(s.center[0]+.1,s.center[1]+.05,3.1);controls.target.set(...s.center);}else{camera.position.set(0,2.65,10.3);controls.target.set(0,2.65,0);}}
  else if(fabrics?.enabled){camera.position.set(0,3.3,12);controls.target.set(0,2.2,0);}
  else if(fibers?.enabled){camera.position.set(0,3.6,12.5);controls.target.set(0,1.35,0);}
  else if(granular?.enabled){camera.position.set(0,6,12);controls.target.set(0,.6,0);}
  else if(world.fluidEnabled){camera.position.set(6,5,7);controls.target.set(0,-1.1,0);}
  else if(!world.showcaseEnabled){const y=terrainHeight(14,8);camera.position.set(21,y+5,18);controls.target.set(14,y+.2,8);}
  else if(world.terrainEnabled){camera.position.set(26,15,24);controls.target.set(12,0,4);}
  else {camera.position.set(9,7,12.6);controls.target.set(0,.6,.7);}
  controls.update();updateStream();
}
function updateStream() {
  if(!streamer)return;
  streamer.radius=(world.fluidEnabled||granular?.enabled||fabrics?.enabled||fibers?.enabled)?1:3;streamer.vegetation=renderer.grass.enabled;
  streamer.update(camera.position.x,camera.position.z,world.terrainEnabled);
  renderer.proxies.update(camera.position.x,camera.position.z,world.terrain,world.terrainEnabled);
}
function saveEdits() {
  try {
    localStorage.setItem('bardo-field-v1',JSON.stringify(world.edits));
    if(world.terrain===persistentTerrain)localStorage.setItem('bardo-terrain-v1',world.terrain.serialize());
  } catch {status('Browser storage unavailable; edits remain in memory.',0);}
  $('undo').disabled=!(world.terrainEnabled?world.terrain.edits.length:world.edits.length);
  $('edit-count').textContent=world.terrainEnabled?`${world.terrain.edits.length} / 64`:`${world.edits.length} / 12`;
  $('edit-label').textContent=world.terrain!==persistentTerrain?'Test terrain (session)':'Edits (saved)';
}
function sceneChange(value) {
  world.fluidEnabled=value==='fluid';fluid.enabled=world.fluidEnabled;fluidAccumulator=0;granular.enabled=value==='granular';grainAccumulator=0;
  renderer.optics.enabled=value==='optics';renderer.lightTest.enabled=value==='light-test';const optical=renderer.optics.enabled||renderer.lightTest.enabled;
  fabrics.enabled=value==='fabric';fibers.enabled=value==='fibers';softAccumulator=0;
  world.terrain=world.fluidEnabled?fluid.terrain:granular.enabled?granular.terrain:fabrics.enabled?fabrics.terrain:fibers.enabled?fibers.terrain:persistentTerrain;streamer.terrain=world.terrain;renderer.depthValid=false;
  world.terrainEnabled=value!=='materials'&&!optical;world.showcaseEnabled=value==='materials'||value==='terrain';$('test-scene').value=value;
  probe.setMass(world.fluidEnabled?180:granular.enabled?40:(fabrics.enabled||fibers.enabled)?1.5:1);probe.active=false;probe.velocity.set(0,0,0);probe.position.set(0,.45,3);probe.sync();
  renderer.grass.enabled=value==='grass';$('grass-visible').checked=renderer.grass.enabled;
  $('grain-controls').hidden=!granular.enabled;$('fluid-controls').hidden=!world.fluidEnabled;$('grass-controls').hidden=value!=='grass';
  $('fabric-controls').hidden=!fabrics.enabled;$('fiber-controls').hidden=!fibers.enabled;
  $('optics-controls').hidden=!renderer.optics.enabled;$('optics-labels').hidden=!renderer.optics.enabled;
  $('light-test-controls').hidden=!renderer.lightTest.enabled;$('environment-light-controls').hidden=renderer.lightTest.enabled;
  $('chunk-lines').parentElement.hidden=optical;
  const irrelevant=['soft-count','soft-cpu','soft-draw','soft-contacts','soft-strain','soft-time','fiber-speed','grain-count','grain-cpu','proxy-count','fluid-count','fluid-cpu','fluid-draw','fluid-error','fluid-contact','fluid-time','grass-count','grass-roots','grass-bent','grass-contact','resident','queued','stream-count','memory','pool-memory','selected-count','sort-time','worker-ms','contacts','dropped-time'];
  for(const id of irrelevant){$(id).hidden=optical;$(id).previousElementSibling.hidden=optical;}
  $('tool').parentElement.hidden=optical;$('physics-controls').hidden=optical;
  $('view-mode').querySelector('option[value="3"]').disabled=optical;
  if(optical){renderer.uniforms.uView.value=0;$('view-mode').value='0';angle=Math.PI/2;$('light-angle').value=90;$('light-value').value='90°';$('animate-light').checked=false;}
  $('travel-controls').hidden=optical||world.fluidEnabled||granular.enabled||fabrics.enabled||fibers.enabled;$('material-controls').hidden=$('travel-controls').hidden;
  for(const option of $('tool').options)if(option.value==='stir'||option.value==='heat')option.disabled=!world.fluidEnabled;
  for(const option of $('tool').options)if(option.value==='carve'||option.value==='add')option.disabled=fabrics.enabled||fibers.enabled;
  $('undo').hidden=optical||fabrics.enabled||fibers.enabled;
  $('brush').parentElement.hidden=optical||fabrics.enabled||fibers.enabled;
  $('brush').max=world.terrainEnabled?'3':'.6';$('brush').min='.25';
  $('brush').value=world.terrainEnabled?'1.25':'.4';$('brush-value').value=`${Number($('brush').value).toFixed(2)} m`;
  setTool('orbit');home();saveEdits();
}
function rayFromEvent(event) {
  const rect=canvas.getBoundingClientRect();
  const ndc=new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  const raycaster=new THREE.Raycaster();raycaster.setFromCamera(ndc,camera);return raycaster.ray;
}
function clickScene(event) {
  if(renderer.optics.enabled||renderer.lightTest.enabled)return;
  if(event.button!==0||!dragStart)return;
  const moved=Math.hypot(event.clientX-dragStart[0],event.clientY-dragStart[1]);dragStart=null;
  if(moved>5)return;
  const ray=rayFromEvent(event),origin=ray.origin.toArray(),direction=ray.direction.toArray();
  if(tool==='stir'||tool==='heat'){
    if(!fluid.enabled)return;const point=fluid.pick(origin,direction);
    if(point){fluid.disturb(point,{heat:tool==='heat'});if(tool==='heat'){renderer.water.uniforms.uFluidView.value=3;$('fluid-view').value='3';}}
    else status('No water under cursor.');
  } else if(tool==='carve'||tool==='add') {
    if(fabrics.enabled||fibers.enabled)return;
    const id=world.terrainEnabled?6:0;
    const hit=world.raycast(origin,direction,id);
    if(!hit){status('No editable surface under cursor.');return;}
    const radius=Number($('brush').value);
    if(world.terrainEnabled) {
      if(!world.terrain.edit(hit.point,radius,tool==='add'?'add':'subtract')){status('Edit limit or vertical range reached (64 edits; y −11 to 11 m).');return;}
      updateStream();status((world.fluidEnabled||granular.enabled)?'Terrain updated for this session.':'Terrain edit saved; affected chunks queued.');
    } else {
      if(tool==='add'){status('Add material is available in the terrain test.');return;}
      if(!world.carve(hit.point,radius)){status('12-cut limit reached; undo a cut.');return;}
      renderer.rebuild(0);
    }
    saveEdits();
  } else if(tool==='push') {
    const hit=world.raycast(origin,direction,5);
    if(!hit){status('Click the probe, or drop it at this location.');return;}
    probe.impulse(ray.direction.clone().multiplyScalar(3.4).add(new THREE.Vector3(0,1.2,0)).multiplyScalar(probe.mass),new THREE.Vector3(...hit.point).sub(probe.position));
    paused=false;$('pause').textContent='Pause';status('Impulse applied.');
  } else {
    const hit=world.raycast(origin,direction);if(hit)select(hit.id);
  }
}
function travel(dt) {
  if(!keys.size)return;
  const forward=new THREE.Vector3();camera.getWorldDirection(forward);forward.y=0;forward.normalize();
  const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0));
  const delta=new THREE.Vector3();
  if(keys.has('KeyW'))delta.add(forward);if(keys.has('KeyS'))delta.sub(forward);
  if(keys.has('KeyD'))delta.add(right);if(keys.has('KeyA'))delta.sub(right);
  if(keys.has('KeyE'))delta.y++;if(keys.has('KeyQ'))delta.y--;
  if(delta.lengthSq()===0)return;
  delta.normalize().multiplyScalar(dt*(keys.has('ShiftLeft')||keys.has('ShiftRight')?35:9));
  camera.position.add(delta);controls.target.add(delta);controls.update();
}
function setupSoftControls(){
  const resume=()=>{paused=false;$('pause').textContent='Pause';};
  const hideBall=()=>{probe.active=false;probe.velocity.set(0,0,0);probe.position.set(0,.45,3);probe.sync();};
  const fabricIndex=()=>Number($('fabric-sample').value),fiberIndex=()=>Number($('fiber-sample').value);
  const fabricFields=['stretch','bend','damping','density','anisotropy','tear'],fiberFields=['length','stiffness','damping','curl','width','roughness'];
  function syncFabric(){const p=fabrics.patches[fabricIndex()];for(const name of fabricFields){$(`fabric-${name}`).value=p.parameters[name];$(`fabric-${name}-value`).value=name==='tear'?`${Math.round(p.parameters[name]*100)}%`:p.parameters[name];}$('pull-fabric').textContent=p.pulling?'Release hem':'Pull hem';}
  function syncFiber(){const p=fibers.grooms[fiberIndex()].parameters;for(const name of fiberFields){$(`fiber-${name}`).value=p[name];$(`fiber-${name}-value`).value=p[name];}}
  $('fabric-sample').onchange=syncFabric;$('fiber-sample').onchange=syncFiber;
  $('focus-fabric').onclick=()=>{const x=fabrics.patches[fabricIndex()].centerX;camera.position.set(x+1.1,2.9,4.5);controls.target.set(x,2.15,0);controls.update();updateStream();};
  $('focus-fiber').onclick=()=>{const x=fibers.grooms[fiberIndex()].center[0];camera.position.set(x+.8,2.4,3.5);controls.target.set(x,1.35,0);controls.update();updateStream();};
  for(const name of fabricFields)$(`fabric-${name}`).oninput=()=>{fabrics.patches[fabricIndex()].configure({[name]:Number($(`fabric-${name}`).value)});syncFabric();};
  for(const name of fiberFields)$(`fiber-${name}`).oninput=()=>{const parameters={[name]:Number($(`fiber-${name}`).value)};if(name==='length'||name==='curl')fibers.rebuild(fiberIndex(),parameters);else fibers.grooms[fiberIndex()].configure(parameters);syncFiber();};
  $('fabric-tearing').onchange=()=>fabrics.tearing=$('fabric-tearing').checked;
  $('fabric-strain').onchange=()=>renderer.soft.uniforms.uStrainView.value=$('fabric-strain').checked;
  $('fiber-followers').oninput=()=>{fibers.followers=Number($('fiber-followers').value);$('fiber-followers-value').value=fibers.followers;};
  $('reset-fabrics').onclick=()=>{fabrics.reset();softAccumulator=0;hideBall();syncFabric();};
  $('restore-fabric').onclick=()=>{fabrics.resetPatch(fabricIndex(),true);syncFabric();};
  $('gust-fabrics').onclick=()=>{fabrics.pulse();resume();};
  $('pull-fabric').onclick=()=>{const p=fabrics.patches[fabricIndex()];p.setPull(!p.pulling);syncFabric();resume();};
  $('release-fabric').onclick=()=>{fabrics.patches[fabricIndex()].releasePins();syncFabric();resume();};
  $('reset-fibers').onclick=()=>{fibers.reset();softAccumulator=0;hideBall();syncFiber();};
  $('restore-fiber').onclick=()=>{fibers.rebuild(fiberIndex(),FIBER_PRESETS[fiberIndex()]);syncFiber();};
  $('gust-fibers').onclick=()=>{fibers.pulse();resume();};
  $('brush-fiber').onclick=()=>{fibers.grooms[fiberIndex()].brush();resume();};
  $('launch-fabric').onclick=()=>{probe.dropAt([fabrics.patches[fabricIndex()].centerX,2.05,1.1]);probe.velocity.set(0,1.2,-4);resume();};
  $('launch-fiber').onclick=()=>{const groom=fibers.grooms[fiberIndex()];probe.dropAt([groom.center[0],2.1,1.05]);probe.velocity.set(0,.4,-3);resume();};
  syncFabric();syncFiber();
}
function setupOpticsControls(){
  const optics=renderer.optics,fields=['thickness','scatterScale','absorptionScale','turbidity','roughness'];
  for(const sample of optics.samples){
    const option=document.createElement('option');option.value=sample.id;option.textContent=sample.name;$('optics-sample').append(option);
    const label=document.createElement('button');label.textContent=sample.name;label.dataset.sample=sample.id;label.onclick=()=>{$('optics-sample').value=sample.id;optics.selected=sample.id;sync();focus();};$('optics-labels').append(label);
  }
  function sync(){const s=optics.samples[optics.selected];for(const name of fields){$(`optics-${name}`).value=s[name];$(`optics-${name}-value`).value=s[name].toFixed(2)+(name==='thickness'||name.endsWith('Scale')?'×':'');}
    $('optics-mm').textContent=(sampleRadii(s)[2]*2*OPTICAL_METRES*1000).toFixed(2)+' mm';$('optics-ior').textContent=s.ior;
  }
  function focus(){const s=optics.samples[optics.selected];camera.position.set(s.center[0]+.1,s.center[1]+.05,3.1);controls.target.set(...s.center);controls.update();updateStream();}
  $('optics-sample').onchange=()=>{optics.selected=Number($('optics-sample').value);sync();if(optics.isolate)focus();};
  $('focus-optics').onclick=focus;$('optics-isolate').onchange=()=>{optics.isolate=$('optics-isolate').checked;if(optics.isolate)focus();else home();};
  $('optics-lineup').onchange=()=>{optics.lineup=$('optics-lineup').checked;optics.layout();home();};
  $('reset-optics').onclick=()=>{optics.reset(optics.selected);sync();};
  for(const name of fields)$(`optics-${name}`).oninput=()=>{optics.configure(optics.selected,{[name]:Number($(`optics-${name}`).value)});sync();};
  $('optics-front').onclick=()=>{$('light-angle').value=90;$('light-angle').oninput();};
  $('optics-back').onclick=()=>{$('light-angle').value=270;$('light-angle').oninput();};
  $('optics-split').onchange=()=>optics.split=$('optics-split').checked;
  $('optics-transport').onchange=()=>optics.transport=$('optics-transport').checked;
  $('optics-view').onchange=()=>optics.view=Number($('optics-view').value);sync();
}
const labelPosition=new THREE.Vector3();
function updateOpticsLabels(){
  const optics=renderer.optics;
  for(const label of $('optics-labels').children){const s=optics.samples[Number(label.dataset.sample)];labelPosition.set(s.center[0],s.center[1]+(optics.lineup&&s.id<3?s.radii[1]+.2:-s.radii[1]-.15),s.center[2]).project(camera);
    label.hidden=(optics.isolate&&optics.selected!==s.id)||Math.abs(labelPosition.x)>1||Math.abs(labelPosition.y)>1||Math.abs(labelPosition.z)>1;
    label.style.left=((labelPosition.x*.5+.5)*viewport.clientWidth)+'px';label.style.top=((-labelPosition.y*.5+.5)*viewport.clientHeight)+'px';
  }
}
function setup() {
  world=new World();world.terrainEnabled=true;world.showcaseEnabled=false;world.fluidEnabled=true;
  try {
    const edits=JSON.parse(localStorage.getItem('bardo-field-v1')||'[]');
    if(Array.isArray(edits)&&edits.length<=12&&edits.every(e=>Array.isArray(e)&&e.length===4&&e.every(Number.isFinite)&&e[3]>=.18&&e[3]<=.6))world.edits=edits;
    const terrain=localStorage.getItem('bardo-terrain-v1');if(terrain)world.terrain.restore(terrain);
  } catch {}
  granular=new Granular();fabrics=new FabricTest();fibers=new FiberTest();persistentTerrain=world.terrain;fluid=new Fluid(createFluidTerrain());world.terrain=fluid.terrain;
  probe=new Probe(world);probe.setMass(180);probe.position.set(0,.8,0);probe.sync();camera=new THREE.PerspectiveCamera(43,1,.1,220);
  controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.075;
  controls.minDistance=2;controls.maxDistance=70;controls.maxPolarAngle=Math.PI*.49;
  renderer=new FieldRenderer(canvas,world,camera);
  renderer.fluid=fluid;renderer.granular=granular;renderer.fabrics=fabrics;renderer.fibers=fibers;renderer.grass.enabled=false;
  streamer=new TerrainStreamer(world.terrain,renderer);
  const resize=()=>renderer.resize(viewport.clientWidth,viewport.clientHeight);
  new ResizeObserver(resize).observe(viewport);resize();home();
  $('test-scene').onchange=()=>sceneChange($('test-scene').value);
  $('tool').onchange=()=>setTool($('tool').value);
  $('material').onchange=()=>select(Number($('material').value));
  $('roughness').oninput=()=>materialRoughness(Number($('roughness').value));
  $('clear-glass').onclick=()=>{select(3);materialRoughness(.04);};
  $('frosted-glass').onclick=()=>{select(3);materialRoughness(.85);};
  $('brush').oninput=()=>$('brush-value').value=`${Number($('brush').value).toFixed(2)} m`;
  $('light-angle').oninput=()=>{angle=Number($('light-angle').value)*Math.PI/180;$('light-value').value=`${$('light-angle').value}°`;$('animate-light').checked=false;};
  $('reflections').onchange=()=>renderer.uniforms.uReflections.value=$('reflections').checked;
  $('chunk-lines').onchange=()=>renderer.uniforms.uShowChunks.value=$('chunk-lines').checked;
  $('view-mode').onchange=()=>renderer.uniforms.uView.value=Number($('view-mode').value);
  $('render-scale').onchange=()=>{renderer.scale=Number($('render-scale').value);resize();};
  $('pixel-size').oninput=()=>{renderer.minPixelSigma=Number($('pixel-size').value);$('pixel-size-value').value=renderer.minPixelSigma.toFixed(1)+' px';};
  $('splat-budget').oninput=()=>{renderer.budget=Number($('splat-budget').value);$('budget-value').value=renderer.budget.toLocaleString();};
  $('sh-degree').onchange=()=>renderer.uniforms.uSHDegree.value=Number($('sh-degree').value);
  $('orbit-test').onchange=()=>{controls.autoRotate=$('orbit-test').checked;controls.autoRotateSpeed=2;};
  $('home').onclick=home;
  $('travel').onclick=()=>{const x=controls.target.x+128,z=controls.target.z;moveTo([x,terrainHeight(x,z),z]);status('Moved 128 m. Previous chunks are evicted.');};
  $('return').onclick=()=>{const p=world.terrain.lastEdit||[0,0,0];moveTo(p);status('Returned to saved edit location.');};
  $('save-location').onclick=()=>{savedLocation=controls.target.toArray();status('Location stored for this session.');};
  $('saved-location').onclick=()=>{if(savedLocation)moveTo(savedLocation);else status('Save a location first.');};
  $('undo').onclick=()=>{
    if(world.terrainEnabled){if(world.terrain.undo())updateStream();}
    else if(world.undo())renderer.rebuild(0);
    saveEdits();
  };
  $('drop').onclick=()=>{
    const target=world.terrainEnabled?controls.target.toArray():[0,0,1.7];
    const hit=world.raycast([target[0],20,target[2]],[0,-1,0],6);
    probe.dropAt([target[0],(hit?.point[1]||0)+4,target[2]]);paused=false;$('pause').textContent='Pause';select(5);
  };
  $('pause').onclick=()=>{paused=!paused;$('pause').textContent=paused?'Resume':'Pause';};
  setupSoftControls();setupOpticsControls();
  $('reset-water').onclick=()=>{fluid.reset('pool');fluidAccumulator=0;probe.active=false;probe.position.set(0,.8,0);probe.velocity.set(0,0,0);probe.sync();};
  $('dam-break').onclick=()=>{fluid.reset('dam');fluidAccumulator=0;paused=false;$('pause').textContent='Pause';};
  $('stir-water').onclick=()=>{fluid.disturb([-.5,-1.4,0]);};
  $('heat-water').onclick=()=>{fluid.disturb([-.5,-1.4,0],{heat:true});renderer.water.uniforms.uFluidView.value=3;$('fluid-view').value='3';};
  $('reset-grains').onclick=()=>{granular.reset();grainAccumulator=0;probe.active=false;probe.position.set(0,3,0);probe.sync();};
  $('roll-grains').onclick=()=>{probe.dropAt([-5,.55,0]);probe.velocity.set(5,0,0);probe.angularVelocity.set(0,0,-5/probe.radius);paused=false;$('pause').textContent='Pause';};
  $('stir-grains').onclick=()=>{for(const x of [-3,0,3])granular.disturb([x,0,0]);};
  $('water-roughness').oninput=()=>{renderer.water.uniforms.uWaterRoughness.value=Number($('water-roughness').value);$('water-roughness-value').value=$('water-roughness').value;};
  $('water-turbidity').oninput=()=>{renderer.water.uniforms.uTurbidity.value=Number($('water-turbidity').value);$('water-turbidity-value').value=$('water-turbidity').value;};
  $('fluid-view').onchange=()=>renderer.water.uniforms.uFluidView.value=Number($('fluid-view').value);
  $('fluid-viscosity').oninput=()=>{fluid.viscosity=Number($('fluid-viscosity').value);$('fluid-viscosity-value').value=fluid.viscosity.toFixed(2);};
  $('fluid-iterations').onchange=()=>fluid.iterations=Number($('fluid-iterations').value);
  $('roll-ball').onclick=()=>{
    if(!world.terrainEnabled){sceneChange('grass');}
    const x=controls.target.x-4,z=controls.target.z;
    const hit=world.raycast([x,20,z],[0,-1,0],6);if(!hit){status('No terrain below the roll start.');return;}
    probe.dropAt([x,hit.point[1]+probe.radius+.015,z]);probe.velocity.set(3.5,0,0);probe.angularVelocity.set(0,0,-3.5/probe.radius);
    paused=false;$('pause').textContent='Pause';select(5);status('Ball rolling. R repeats the test.');
  };
  $('reset-grass').onclick=()=>renderer.grass.dynamics.clear();
  $('grass-visible').onchange=()=>{renderer.grass.enabled=$('grass-visible').checked&&world.terrainEnabled;};
  $('grass-bend-view').onchange=()=>renderer.grass.uniforms.uBendView.value=$('grass-bend-view').checked;
  $('grass-recovery').oninput=()=>{renderer.grass.dynamics.recovery=Number($('grass-recovery').value);$('grass-recovery-value').value=$('grass-recovery').value+' s';};
  $('grass-budget').oninput=()=>{renderer.grass.budget=Number($('grass-budget').value);$('grass-budget-value').value=renderer.grass.budget.toLocaleString();};
  canvas.addEventListener('pointerdown',e=>{if(e.button===0)dragStart=[e.clientX,e.clientY];});
  canvas.addEventListener('pointerup',clickScene);canvas.addEventListener('pointercancel',()=>dragStart=null);
  document.addEventListener('keydown',e=>{
    if(['INPUT','SELECT','BUTTON','SUMMARY'].includes(document.activeElement.tagName))return;
    if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(e.code)){keys.add(e.code);e.preventDefault();}
    if((renderer.optics.enabled||renderer.lightTest.enabled)&&(e.code==='Space'||e.code==='KeyR'))return;
    if(e.code==='Space'){e.preventDefault();$('drop').click();}if(e.code==='KeyC')home();
    if(e.code==='KeyR')$(fabrics.enabled?'launch-fabric':fibers.enabled?'launch-fiber':granular.enabled?'roll-grains':'roll-ball').click();
    if(e.code==='KeyP')$('controls').open=!$('controls').open;
  });
  document.addEventListener('keyup',e=>keys.delete(e.code));
  window.addEventListener('blur',()=>keys.clear());
  document.addEventListener('visibilitychange',()=>{keys.clear();lastTime=0;stepper.accumulator=0;});
  setupLightTest();select(0);sceneChange('light-test');$('loading').style.display='none';$('renderer-status').textContent='WebGL 2';
  requestAnimationFrame(tick);
}
function setupLightTest(){
 const test=renderer.lightTest,fields=['power','spread','aim','curvature','prismAngle','focal','wave','phase','waterHeight','shell','gather'];
 function sync(){
  const c=test.config;for(const name of fields){$(`lt-${name}`).value=c[name];$(`lt-${name}-value`).value=Number(c[name]).toFixed(name==='shell'||name==='gather'?3:2);}
  for(const name of ['experiment','source','color','photons'])$(`lt-${name}`).value=c[name];$('lt-color').disabled=c.source==='rgb';$('lt-dispersion').checked=c.dispersion;
  document.querySelectorAll('[data-lt]').forEach(el=>{const k=el.dataset.lt;el.hidden=k==='tank'?c.experiment!=='tank':k==='water'?!['tank','water'].includes(c.experiment):k==='mirror'?c.experiment!=='concave-mirror':k==='prism'?c.experiment!=='prism':!['convex','concave'].includes(c.experiment);});
  $('lt-note').hidden=!['tank','water'].includes(c.experiment);
 }
 for(const name of fields)$(`lt-${name}`).oninput=()=>{test.configure({[name]:Number($(`lt-${name}`).value)});sync();};
 for(const name of ['experiment','source','color','photons'])$(`lt-${name}`).onchange=()=>{test.configure({[name]:name==='photons'?Number($(`lt-${name}`).value):$(`lt-${name}`).value,...(name==='experiment'&&$('lt-experiment').value==='prism'?{dispersion:true}:{})});sync();if(name==='experiment')home();};
 $('lt-dispersion').onchange=()=>test.configure({dispersion:$('lt-dispersion').checked});
 $('lt-paths').onchange=()=>test.showPaths=$('lt-paths').checked;
 $('lt-view').onchange=()=>test.view=Number($('lt-view').value);
 $('lt-reset').onclick=()=>{test.configure({...DEFAULT_LIGHT_TEST,photons:16384,experiment:test.config.experiment});sync();};
 $('lt-receiver').onclick=()=>{const mirror=test.config.experiment.includes('mirror'),prism=test.config.experiment==='prism';camera.position.set(.1,8,mirror?7:prism?-.4:4);controls.target.set(0,0,mirror?3:prism?-3.8:0);controls.update();};sync();
}
function updateLightTestStats(){
 const test=renderer.lightTest,r=test.result,l=r?.ledger;
 $('lt-state').textContent=test.error?`Error: ${test.error}`:test.busy?(r?.id===test.revision?`${r.count.toLocaleString()} preview · refining…`:'Building · previous solution shown'):r?`${r.count.toLocaleString()} ready`:'Starting';
 $('lt-ms').textContent=r?(r.ms/1000).toFixed(2)+' s':'—';
 $('lt-energy').textContent=l?[l.receiver,l.absorbed,l.escaped].map(v=>(100*v/l.emitted).toFixed(1)+'%').join(' / '):'—';
 $('lt-remainder').textContent=l?(100*l.truncated/l.emitted).toFixed(3)+'%':'—';$('lt-tir').textContent=l?l.tir.toLocaleString():'—';
 $('lt-floats').textContent=test.sceneData.floats.map(f=>`${f.mass.toFixed(1)} kg · ${f.floating?'floating':'on bottom'}`).join(' / ');
}

function tick(time) {
  try {
    const elapsed=lastTime?(time-lastTime)/1000:1/60;lastTime=time;
    if(document.hidden){requestAnimationFrame(tick);return;}
    travel(Math.min(elapsed,.05));controls.update(Math.min(elapsed,.1));
    if(time-lastStream>150){updateStream();lastStream=time;}
    if(streamer.error)throw new Error(streamer.error);
    if(!paused&&!renderer.optics.enabled&&!renderer.lightTest.enabled)stepper.advance(elapsed,dt=>{
      const previous=probe.position.toArray();probe.step(dt);
      if(fluid.enabled){fluidAccumulator+=dt;if(fluidAccumulator>=FLUID_STEP-1e-9){fluid.step(FLUID_STEP,probe);fluidAccumulator-=FLUID_STEP;fluidAverageMs=fluidAverageMs*.9+fluid.simMs*.1;}}
      if(granular.enabled){grainAccumulator+=dt;if(grainAccumulator>=GRAIN_STEP-1e-9){granular.step(GRAIN_STEP,probe);grainAccumulator-=GRAIN_STEP;}}
      if(fabrics.enabled||fibers.enabled){softAccumulator+=dt;if(softAccumulator>=DEFORM_STEP-1e-9){(fabrics.enabled?fabrics:fibers).step(DEFORM_STEP,probe);softAccumulator-=DEFORM_STEP;}}
      if(renderer.grass.enabled)renderer.grass.dynamics.step(dt,previous,probe.position.toArray(),probe.radius);
    });else stepper.accumulator=0;
    if($('animate-light').checked){angle=(angle+Math.min(elapsed,.1)*.18)%(Math.PI*2);$('light-angle').value=Math.round(angle*180/Math.PI);$('light-value').value=`${$('light-angle').value}°`;}
    if(!renderer.render({lightAngle:angle,probe,dt:elapsed,adaptive:$('adaptive-detail').checked,focusDistance:camera.position.distanceTo(controls.target)}))throw new Error(renderer.error);
    if(renderer.optics.enabled)updateOpticsLabels();
    frameTimes.push(elapsed*1000);if(frameTimes.length>120)frameTimes.shift();
    if(frame++%15===0){
      const average=frameTimes.reduce((a,b)=>a+b,0)/frameTimes.length;
      $('fps').textContent=Math.round(1000/average);$('frame-ms').textContent=average.toFixed(1);
      $('splat-count').textContent=(renderer.visibleSplats+renderer.grass.count+renderer.water.count+renderer.grains.count+renderer.soft.count+renderer.optics.count+renderer.lightTest.count).toLocaleString();$('detail').textContent=renderer.effectivePixelTarget.toFixed(1)+' px';
      updateLightTestStats();
      $('optics-count').textContent=renderer.optics.count.toLocaleString();$('optics-ms').textContent=renderer.optics.cacheMs.toFixed(0)+' ms';
      $('optics-cache').textContent=renderer.optics.busy?'Updating…':`Ready · ${renderer.optics.cacheCount}`;
      const soft=fabrics.enabled?fabrics:fibers.enabled?fibers:null,subjects=soft?.patches||soft?.grooms||[];
      $('soft-count').textContent=soft?`${subjects.reduce((sum,s)=>sum+s.count,0)} / ${renderer.soft.count}`:'off';
      $('soft-cpu').textContent=soft?`${(soft.simMs||0).toFixed(1)} ms`:'—';$('soft-draw').textContent=soft?`${renderer.soft.cpuMs.toFixed(1)} ms`:'—';
      $('soft-contacts').textContent=soft?.totalContacts||0;$('soft-time').textContent=soft?soft.time.toFixed(1)+' s':'—';
      const groom=fibers.enabled?fibers.grooms[Number($('fiber-sample').value)]:null;
      $('fiber-speed').textContent=groom?Math.sqrt(groom.velocities.reduce((s,v)=>s+v*v,0)/groom.count).toFixed(4)+' m/s':'—';
      $('soft-strain').textContent=fabrics.enabled?`${fabrics.broken} / ${(100*Math.max(...fabrics.patches.map(p=>p.maxStrain||0))).toFixed(0)}%`:'—';
      $('grain-count').textContent=granular.enabled?`${granular.counts.join(' / ')} · ${renderer.grains.count} splats`:'off';$('grain-cpu').textContent=granular.enabled?granular.simMs.toFixed(1)+' ms / step':'—';$('proxy-count').textContent=renderer.proxies.entries.size;
      $('fluid-count').textContent=fluid.enabled?`${fluid.count} / ${renderer.water.count}`:'off';
      $('fluid-cpu').textContent=fluid.enabled?`${fluidAverageMs.toFixed(1)} ms / step`:'—';$('fluid-draw').textContent=fluid.enabled?`${renderer.water.cpuMs.toFixed(1)} ms`:'—';
      $('fluid-error').textContent=`${(fluid.maxCompression*100).toFixed(1)}%`;$('fluid-contact').textContent=fluid.contacts;
      $('fluid-time').textContent=fluid.time.toFixed(1)+' s';
      $('grass-count').textContent=renderer.grass.count.toLocaleString();$('grass-roots').textContent=renderer.grass.residentBlades.toLocaleString();
      $('grass-bent').textContent=renderer.grass.dynamics.bent.toLocaleString();$('grass-contact').textContent=renderer.grass.dynamics.contacts.toLocaleString();
      $('motion-speed').textContent=renderer.motion.speed.toFixed(0)+' px/s';$('motion-scale').textContent=renderer.motion.factor.toFixed(2)+'×';
      $('selected-count').textContent=renderer.byMaterial[selected].toLocaleString();$('sort-time').textContent=renderer.sortMs.toFixed(2)+' ms';
      $('pool-memory').textContent=(renderer.pool.data.byteLength/1048576).toFixed(1)+' MiB';
      $('position').textContent=`${controls.target.toArray().map(v=>v.toFixed(1)).join(', ')} m`;
      $('resident').textContent=`${streamer.resident.size} / ${(2*streamer.radius+1)**2}`;$('queued').textContent=streamer.busy;
      $('stream-count').textContent=`${streamer.generated} / ${streamer.evicted}`;$('memory').textContent=`${(streamer.bytes/1048576).toFixed(2)} MiB`;
      $('worker-ms').textContent=`${streamer.lastBuildMs.toFixed(1)} ms`;$('contacts').textContent=probe.contacts;
      $('p95').textContent=`${[...frameTimes].sort((a,b)=>a-b)[Math.floor((frameTimes.length-1)*.95)].toFixed(1)} ms`;
      $('dropped-time').textContent=`${Math.round(stepper.droppedTime*1000)} ms`;
    }
    requestAnimationFrame(tick);
  } catch(error) {fail(error);}
}
requestAnimationFrame(()=>setTimeout(()=>{try{setup();}catch(error){fail(error);}},20));
