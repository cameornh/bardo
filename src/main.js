import {riverCenter,riverBottom} from './water-lab-river.js';
import './style.css';
import { Walker,sdfContact,cycleInteraction } from './first-person.js';
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
import { DEFAULT_LIGHT_TEST,SHAPE,shapeDistance,localPoint,mediumAt } from './light-transport.js';

const $ = id => document.getElementById(id);
const canvas=$('scene'), viewport=$('viewport');
const stepper=new FixedStepper(), keys=new Set();
let world,probe,camera,controls,renderer,streamer,fluid,granular,fabrics,fibers,persistentTerrain;
let fluidAccumulator=0,grainAccumulator=0,softAccumulator=0,fluidAverageMs=0;
let selected=0,tool='orbit',paused=false,lastTime=0;
let angle=125*Math.PI/180,dragStart=null,savedLocation=null,lastStream=0,frame=0;
let frameTimes=[],statusTimeout;
const walker=new Walker();let firstPerson=false,lookLocked=false,fallbackLook=false,lockClick=false,fpTool="launch",fpJump=false,lastToolScroll=-Infinity;

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
  walker.velocity.fill(0);
  if(renderer?.waterLab.enabled){controls.maxDistance=renderer.waterLab.kind==='river'?190:70;camera.position.fromArray(renderer.waterLab.spec.eye);controls.target.fromArray(renderer.waterLab.spec.target);}
  else if(renderer?.beach.enabled){camera.position.set(16,renderer.beach.sim.sample(16,13).bed+2.2,13);controls.target.set(-8,.8,-16);}
  else if(renderer?.lightTest.enabled){const preset=renderer.lightTest.config.experiment;if(['sphere','convex','concave'].includes(preset)){camera.position.set(3.8,3.6,4.8);controls.target.set(0,1.2,0);}else if(preset==='prism'){camera.position.set(4.8,5.2,5.5);controls.target.set(0,1,-1.2);}else if(preset.includes('mirror')){camera.position.set(4.3,4.6,6.2);controls.target.set(0,1.4,1.6);}else{camera.position.set(5.6,4.2,6.4);controls.target.set(0,1,0);}}
  else if(renderer?.optics.enabled){const s=renderer.optics.samples[renderer.optics.selected];if(renderer.optics.isolate){camera.position.set(s.center[0]+.1,s.center[1]+.05,3.1);controls.target.set(...s.center);}else{camera.position.set(0,2.65,10.3);controls.target.set(0,2.65,0);}}
  else if(fabrics?.enabled){camera.position.set(0,3.3,12);controls.target.set(0,2.2,0);}
  else if(fibers?.enabled){camera.position.set(0,3.6,12.5);controls.target.set(0,1.35,0);}
  else if(granular?.enabled){camera.position.set(0,6,12);controls.target.set(0,.6,0);}
  else if(world.fluidEnabled){camera.position.set(6,5,7);controls.target.set(0,-1.1,0);}
  else if(!world.showcaseEnabled){const y=terrainHeight(14,8);camera.position.set(21,y+5,18);controls.target.set(14,y+.2,8);}
  else if(world.terrainEnabled){camera.position.set(26,15,24);controls.target.set(12,0,4);}
  else {camera.position.set(9,7,12.6);controls.target.set(0,.6,.7);}
  if(renderer)renderer.previousCamera=null;controls.update();if(firstPerson)standFirstPerson();updateStream();
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
  if(value==='optics'&&firstPerson)setFirstPerson(false);
  world.fluidEnabled=value==='fluid';fluid.enabled=world.fluidEnabled;fluidAccumulator=0;granular.enabled=value==='granular';grainAccumulator=0;
  renderer.waterLab.enabled=value==='water-lab';$('water-lab-controls').hidden=!renderer.waterLab.enabled;renderer.beach.enabled=value==='beach';renderer.optics.enabled=value==='optics';renderer.lightTest.enabled=value==='light-test';const optical=renderer.optics.enabled||renderer.lightTest.enabled||renderer.beach.enabled||renderer.waterLab.enabled;
  camera.far=renderer.beach.enabled?2400:220;camera.updateProjectionMatrix();renderer.resize(viewport.clientWidth,viewport.clientHeight);controls.maxDistance=renderer.beach.enabled?300:70;controls.maxPolarAngle=renderer.beach.enabled?Math.PI:Math.PI*.49;
  $('beach-controls').hidden=!renderer.beach.enabled;if(renderer.beach.enabled)renderer.beach.activate();if(renderer.waterLab.enabled&&renderer.waterLab.verification==='Not run')renderer.waterLab.verify();
  fabrics.enabled=value==='fabric';fibers.enabled=value==='fibers';softAccumulator=0;
  world.terrain=world.fluidEnabled?fluid.terrain:granular.enabled?granular.terrain:fabrics.enabled?fabrics.terrain:fibers.enabled?fibers.terrain:persistentTerrain;streamer.terrain=world.terrain;renderer.depthValid=false;
  world.terrainEnabled=value!=='materials'&&!optical;world.showcaseEnabled=value==='materials'||value==='terrain';$('test-scene').value=value;
  probe.setMass(world.fluidEnabled?180:granular.enabled?40:(fabrics.enabled||fibers.enabled)?1.5:1);probe.active=false;probe.velocity.set(0,0,0);probe.position.set(0,.45,3);probe.sync();
  renderer.grass.enabled=value==='grass';$('grass-visible').checked=renderer.grass.enabled;
  $('grain-controls').hidden=!granular.enabled;$('fluid-controls').hidden=!world.fluidEnabled;$('grass-controls').hidden=value!=='grass';
  $('fabric-controls').hidden=!fabrics.enabled;$('fiber-controls').hidden=!fibers.enabled;
  $('optics-controls').hidden=!renderer.optics.enabled;$('optics-labels').hidden=!renderer.optics.enabled;
  $('light-test-controls').hidden=!renderer.lightTest.enabled;$('environment-light-controls').hidden=renderer.lightTest.enabled||renderer.beach.enabled||renderer.waterLab.enabled;
  $('chunk-lines').parentElement.hidden=optical;
  for(const id of ['pixel-size','splat-budget','reflections'])$(id).parentElement.hidden=renderer.waterLab.enabled;
  $('view-mode').querySelector('option[value="2"]').textContent=renderer.waterLab.enabled?'Dye / tannin / sediment':'Splat coverage';
  $('edit-label').hidden=$('edit-count').hidden=renderer.waterLab.enabled;
  const irrelevant=['soft-count','soft-cpu','soft-draw','soft-contacts','soft-strain','soft-time','fiber-speed','grain-count','grain-cpu','proxy-count','fluid-count','fluid-cpu','fluid-draw','fluid-error','fluid-contact','fluid-time','grass-count','grass-roots','grass-bent','grass-contact','resident','queued','stream-count','memory','pool-memory','selected-count','sort-time','worker-ms','contacts','dropped-time'];
  for(const id of irrelevant){$(id).hidden=optical;$(id).previousElementSibling.hidden=optical;}
  $('tool').parentElement.hidden=optical;$('physics-controls').hidden=optical;
  $('view-mode').querySelector('option[value="3"]').disabled=optical;
  if(optical){renderer.uniforms.uView.value=0;$('view-mode').value='0';angle=Math.PI/2;$('light-angle').value=90;$('light-value').value='90°';$('animate-light').checked=false;}
  $('travel-controls').hidden=(optical&&!renderer.beach.enabled)||world.fluidEnabled||granular.enabled||fabrics.enabled||fibers.enabled;$('material-controls').hidden=renderer.beach.enabled||$('travel-controls').hidden;
  for(const option of $('tool').options)if(option.value==='stir'||option.value==='heat')option.disabled=!world.fluidEnabled;
  for(const option of $('tool').options)if(option.value==='carve'||option.value==='add')option.disabled=fabrics.enabled||fibers.enabled;
  $('undo').hidden=optical||fabrics.enabled||fibers.enabled;
  $('brush').parentElement.hidden=optical||fabrics.enabled||fibers.enabled;
  $('brush').max=world.terrainEnabled?'3':'.6';$('brush').min='.25';
  $('brush').value=world.terrainEnabled?'1.25':'.4';$('brush-value').value=`${Number($('brush').value).toFixed(2)} m`;
  setTool('orbit');renderer.beach.tool='orbit';$('beach-tool').value='orbit';home();saveEdits();$('pov-controls').hidden=value==='optics';walker.velocity.fill(0);refreshFirstPersonTools();
}
function rayFromEvent(event) {
  const rect=canvas.getBoundingClientRect();
  const ndc=firstPerson?new THREE.Vector2(0,0):new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  const raycaster=new THREE.Raycaster();raycaster.setFromCamera(ndc,camera);return raycaster.ray;
}
function clickScene(event) {
  if(firstPerson){if(lockClick||(!lookLocked&&!fallbackLook)||event.button!==0)return;firstPersonInteract(event);return;}
  if(renderer.waterLab.enabled){if(event.button===0&&!['orbit','wind'].includes(renderer.waterLab.tool)){const ray=rayFromEvent(event);renderer.waterLab.interact(ray.origin.toArray(),ray.direction.toArray());}dragStart=null;return;}
  if(renderer.beach.enabled){if(event.button===0&&renderer.beach.tool!=='orbit'&&renderer.beach.tool!=='wind'){const ray=rayFromEvent(event);if(!renderer.beach.interact(ray.origin.toArray(),ray.direction.toArray()))status('No nearby surface under the cursor.');}dragStart=null;return;}
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
  $('travel').onclick=()=>{if(renderer.beach.enabled){camera.position.x+=128;controls.target.x+=128;controls.update();renderer.previousCamera=null;return;}const x=controls.target.x+128,z=controls.target.z;moveTo([x,terrainHeight(x,z),z]);status('Moved 128 m. Previous chunks are evicted.');};
  $('return').onclick=()=>{if(renderer.beach.enabled){home();return;}const p=world.terrain.lastEdit||[0,0,0];moveTo(p);status('Returned to saved edit location.');};
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
  setupSoftControls();setupOpticsControls();setupBeachControls();setupWaterLabControls();
  $('reset-water').onclick=()=>{fluid.reset('pool');fluidAccumulator=0;probe.active=false;probe.position.set(0,.8,0);probe.velocity.set(0,0,0);probe.sync();};
  $('dam-break').onclick=()=>{fluid.reset('dam');fluidAccumulator=0;paused=false;$('pause').textContent='Pause';};
  $('stir-water').onclick=()=>{fluid.disturb([-.5,-1.4,0]);};
  $('heat-water').onclick=()=>{fluid.disturb([-.5,-1.4,0],{heat:true});renderer.water.uniforms.uFluidView.value=3;$('fluid-view').value='3';};
  $('reset-grains').onclick=()=>{granular.reset();grainAccumulator=0;probe.active=false;probe.position.set(0,3,0);probe.sync();};
  $('roll-grains').onclick=()=>{probe.dropAt([-5,.55,0]);probe.velocity.set(5,0,0);probe.angularVelocity.set(0,0,-5/probe.radius);paused=false;$('pause').textContent='Pause';};
  ['gravel','sand','mud'].forEach((kind,i)=>{$(`inspect-${kind}`).onclick=()=>{const x=(i-1)*3;camera.position.set(x+.6,2.4,5);controls.target.set(x,.4,0);renderer.previousCamera=null;controls.update();};});
  $('mud-wetness').oninput=()=>{const wet=Number($('mud-wetness').value);renderer.grains.uniforms.uMudWetness.value=wet;$('mud-wetness-value').value=wet.toFixed(2);};
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
    if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight',...(firstPerson?['Space']:[])].includes(e.code)){keys.add(e.code);e.preventDefault();}
    if(firstPerson&&e.code==='Space'){if(!e.repeat&&(lookLocked||fallbackLook&&document.activeElement===canvas))fpJump=true;return;}if(firstPerson&&e.code==='Escape'&&fallbackLook){fallbackLook=false;keys.clear();refreshFirstPersonTools();}
    if((renderer.optics.enabled||renderer.lightTest.enabled)&&(e.code==='Space'||e.code==='KeyR'))return;
    if(renderer.waterLab.enabled&&(e.code==='Space'||e.code==='KeyR')){e.preventDefault();$('wl-glass').click();return;}
    if(e.code==='Space'){e.preventDefault();$(renderer.beach.enabled?'beach-spawn':'drop').click();}if(e.code==='KeyC')home();
    if(e.code==='KeyR')$(renderer.beach.enabled?'beach-spawn':fabrics.enabled?'launch-fabric':fibers.enabled?'launch-fiber':granular.enabled?'roll-grains':'roll-ball').click();
    if(e.code==='KeyP')$('controls').open=!$('controls').open;
  });
  document.addEventListener('keyup',e=>keys.delete(e.code));
  window.addEventListener('blur',()=>{keys.clear();fpJump=false;renderer.beach.windHeld=false;});
  document.addEventListener('visibilitychange',()=>{keys.clear();lastTime=0;stepper.accumulator=0;});
  setupFirstPerson();setupLightTest();select(0);const params=new URLSearchParams(location.search),initialScene=params.get('scene');sceneChange(Array.from($('test-scene').options).some(o=>o.value===initialScene)?initialScene:'beach');if(initialScene==='water-lab'&&Array.from($('wl-station').options).some(o=>o.value===params.get('station'))){$('wl-station').value=params.get('station');$('wl-station').onchange();}if(params.get('paused')==='1')renderer.waterLab.paused=true;if(params.get('pov')==='first-person'&&!renderer.optics.enabled)setFirstPerson(true);$('loading').style.display='none';$('renderer-status').textContent='WebGL 2 · GPU rendering';
  requestAnimationFrame(tick);
}

function standFirstPerson(){
 let t=0;
 for(let i=0;i<160&&t<80;i++){
  const p=[camera.position.x,camera.position.y-walker.eyeHeight+walker.radius-t,camera.position.z];
  const d=walkSolid(p).distance-walker.radius;
  if(d<.002){camera.position.y-=t;break;}t+=Math.max(.02,d*.8);
 }
 const e=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');e.x=0;camera.quaternion.setFromEuler(e);
}
function setFirstPerson(enabled){
 firstPerson=enabled;fallbackLook=false;controls.enabled=!enabled;walker.velocity.fill(0);keys.clear();fpJump=false;$('first-person').checked=enabled;$('pov-hud').hidden=!enabled;canvas.setAttribute('aria-label',enabled?'First-person 3D view. WASD walks, mouse looks, wheel selects tool, click interacts, Space jumps or floats.':'3D test viewport. Drag to orbit; WASD to travel.');
 if(enabled)standFirstPerson();
 if(!enabled){if(document.pointerLockElement===canvas)document.exitPointerLock();const d=camera.getWorldDirection(new THREE.Vector3());controls.target.copy(camera.position).addScaledVector(d,5);controls.update();}
 refreshFirstPersonTools();
}
function firstPersonOptions(){
 if(renderer.waterLab.enabled)return Array.from($('wl-tool').options).filter(o=>o.value!=='orbit').map(o=>[o.value,o.textContent]);
 if(renderer.beach.enabled)return Array.from($('beach-tool').options).filter(o=>o.value!=='orbit').map(o=>[o.value,o.textContent]);
 if(renderer.lightTest.enabled)return [['light','Tilt light'],['color','Cycle light color'],['level-up','Raise water'],['level-down','Lower water']];
 if(fabrics.enabled)return [['launch','Throw ball'],['pull','Pull / release nearest hem'],['gust','Gust fabric']];
 if(fibers.enabled)return [['launch','Throw ball'],['gust','Gust hair']];
 if(granular.enabled)return [['nudge','Nudge grains'],['launch','Throw ball'],['carve','Carve terrain'],['add','Add terrain']];
 return [...(fluid.enabled?[['stir','Stir water'],['heat','Heat water']]:[]),['launch','Throw ball'],['carve','Subtract material'],...(world.terrainEnabled?[['add','Add terrain']]:[]),['push','Impulse probe']];
}
function refreshFirstPersonTools(){if(!renderer)return;const options=firstPersonOptions();if(!options.some(([id])=>id===fpTool))fpTool=options[0][0];$('pov-tool').textContent=options.find(([id])=>id===fpTool)?.[1]||'';$('pov-hint').textContent=lookLocked?'WASD · wheel: tool · click: interact · Space: jump / float · Esc: release mouse':fallbackLook?'WASD · right-drag: look · wheel: tool · click: interact · Space: jump / float':'Click the view to capture the mouse';if(firstPerson&&renderer.waterLab.enabled){renderer.waterLab.tool=fpTool;$('wl-tool').value=fpTool;}if(firstPerson&&renderer.beach.enabled){renderer.beach.tool=fpTool;$('beach-tool').value=fpTool;}}
function setupFirstPerson(){
 $('first-person').onchange=()=>setFirstPerson($('first-person').checked);
 canvas.addEventListener('pointerdown',event=>{if(!firstPerson||event.button!==0)return;lockClick=!lookLocked&&!fallbackLook;if(lockClick){canvas.focus();try{if(!canvas.requestPointerLock)throw new Error('Pointer lock unavailable');canvas.requestPointerLock()?.catch(()=>{fallbackLook=true;refreshFirstPersonTools();});}catch{fallbackLook=true;refreshFirstPersonTools();}}},true);
 document.addEventListener('pointerlockchange',()=>{lookLocked=document.pointerLockElement===canvas;keys.clear();if(!lookLocked)renderer.beach.windHeld=false;refreshFirstPersonTools();});
 document.addEventListener('pointerlockerror',()=>{if(firstPerson){fallbackLook=true;refreshFirstPersonTools();status('Mouse capture unavailable here. Right-drag to look; WASD walks.');}});
 document.addEventListener('mousemove',event=>{if(!firstPerson||(!lookLocked&&!(fallbackLook&&(event.buttons&2))))return;const e=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');e.y-=event.movementX*.002;e.x=THREE.MathUtils.clamp(e.x-event.movementY*.002,-Math.PI*.495,Math.PI*.495);camera.quaternion.setFromEuler(e);});
 canvas.addEventListener('wheel',event=>{if(!firstPerson)return;event.preventDefault();event.stopImmediatePropagation();if(event.deltaY===0||event.timeStamp-lastToolScroll<120)return;lastToolScroll=event.timeStamp;fpTool=cycleInteraction(firstPersonOptions().map(o=>o[0]),fpTool,event.deltaY);renderer.beach.windHeld=false;refreshFirstPersonTools();},{passive:false,capture:true});
}
function walkSolid(p){
 if(renderer.waterLab.enabled){const lab=renderer.waterLab;return sdfContact({distance:q=>lab.solid(q,false),normal:q=>{const e=.003,n=[0,1,2].map(k=>{const a=q.slice(),b=q.slice();a[k]+=e;b[k]-=e;return lab.solid(a,false)-lab.solid(b,false);}),l=Math.hypot(...n)||1;return n.map(v=>v/l);}},p);}
 if(renderer.beach.enabled)return sdfContact(renderer.beach.terrain,p);
 if(renderer.lightTest.enabled){const field={distance:q=>{let d=1e3;for(const v of renderer.lightTest.sceneData.volumes){const local=localPoint(v,q),s=v.type===SHAPE.MIRROR?Math.max(Math.abs(local[0])-v.size[0],Math.abs(local[1])-v.size[1],shapeDistance(v,local)-.02):shapeDistance(v,local);d=v.medium===1||v.medium===3?Math.min(d,s):Math.max(d,-s);}return Math.min(q[1],d);}};field.normal=q=>{const e=.002,n=[0,1,2].map(k=>{const a=q.slice(),b=q.slice();a[k]+=e;b[k]-=e;return field.distance(a)-field.distance(b);}),l=Math.hypot(...n)||1;return n.map(v=>v/l);};return sdfContact(field,p);}
 const hit=world.collisionSample(p,probe.active?-1:5);return {distance:hit.distance,normal:world.normal(hit.id,p)};
}
function walkWater(p){
 if(renderer.waterLab.enabled)return Math.min(1,renderer.waterLab.sample(p));
 if(renderer.beach.enabled){const b=renderer.beach;if(b.volume?.contains(p))return b.volume.liquidAt(p);const s=b.sim.sample(p[0],p[2],false);return s.h>.01&&p[1]>s.bed&&p[1]<s.surface?1:0;}
 if(renderer.lightTest.enabled)return mediumAt(renderer.lightTest.sceneData,p)===2?1:0;
 if(fluid.enabled){let density=0;for(let i=0;i<fluid.count;i++){const o=i*3,d=(p[0]-fluid.positions[o])**2+(p[1]-fluid.positions[o+1])**2+(p[2]-fluid.positions[o+2])**2;if(d<fluid.h2)density+=fluid.volume*fluid.poly*(fluid.h2-d)**3;}return Math.min(1,density);}
 return 0;
}
function stepFirstPerson(dt){walker.position=camera.position.toArray();const down=k=>(lookLocked||fallbackLook&&document.activeElement===canvas)&&keys.has(k);walker.step(dt,{forward:camera.getWorldDirection(new THREE.Vector3()).toArray(),move:[Number(down('KeyD'))-Number(down('KeyA')),Number(down('KeyW'))-Number(down('KeyS'))],buoyant:down('Space'),jump:fpJump,sprint:down('ShiftLeft')||down('ShiftRight')},walkSolid,walkWater);fpJump=false;camera.position.fromArray(walker.position);$('pov-state').textContent=`${walker.submerged>.05?keys.has('Space')?'Buoyant':'Sinking':walker.grounded?'Grounded':walker.velocity[1]>0?'Rising':'Falling'} · ${camera.position.toArray().map(v=>v.toFixed(2)).join(', ')} m`;controls.target.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()),5);if(renderer.beach.windHeld){const d=camera.getWorldDirection(new THREE.Vector3());renderer.beach.interact(camera.position.toArray(),d.toArray());}}
function firstPersonInteract(event){
 const ray=rayFromEvent(event),o=ray.origin.toArray(),d=ray.direction.toArray();
 if(renderer.waterLab.enabled){renderer.waterLab.tool=fpTool;renderer.waterLab.interact(o,d);return;}
 if(renderer.beach.enabled){renderer.beach.tool=fpTool;renderer.beach.interact(o,d);return;}
 if(renderer.lightTest.enabled){const t=renderer.lightTest;if(fpTool==='light')t.configure({aim:THREE.MathUtils.clamp(t.config.aim+5,-35,35)});if(fpTool==='color'){const colors=['white','red','green','blue'];t.configure({color:colors[(colors.indexOf(t.config.color)+1)%4]});}if(fpTool.startsWith('level-'))t.configure({waterHeight:THREE.MathUtils.clamp(t.config.waterHeight+(fpTool==='level-up'?.1:-.1),.6,1.85)});for(const name of ['aim','waterHeight']){$(`lt-${name}`).value=t.config[name];$(`lt-${name}-value`).value=t.config[name].toFixed(2);}$('lt-color').value=t.config.color;return;}
 if(fpTool==='launch'){probe.dropAt(o.map((v,k)=>v+d[k]*(probe.radius+.45)));probe.velocity.fromArray(d).multiplyScalar(8);paused=false;$('pause').textContent='Pause';return;}
 if(fpTool==='gust'){(fabrics.enabled?fabrics:fibers).pulse();return;}
 if(fpTool==='pull'){const target=ray.at(Math.max(.1,-o[2]/(d[2]||1e-6)),new THREE.Vector3()),patch=fabrics.patches.reduce((a,b)=>Math.abs(a.centerX-target.x)<Math.abs(b.centerX-target.x)?a:b);patch.setPull(!patch.pulling);return;}
 if(fpTool==='nudge'){const hit=world.raycast(o,d,6);if(hit)granular.disturb(hit.point);return;}
 const prior=firstPerson;firstPerson=false;const rect=canvas.getBoundingClientRect(),center={button:0,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2};tool=fpTool;dragStart=[center.clientX,center.clientY];clickScene(center);firstPerson=prior;
}

function setupBeachControls(){
 const beach=renderer.beach,sim=beach.sim;
 $('beach-tool').onchange=()=>{beach.tool=$('beach-tool').value;if(firstPerson){fpTool=beach.tool;refreshFirstPersonTools();}if(['carve','solid'].includes(beach.tool)&&beach.radius>3){beach.radius=3;$('beach-radius').value=3;$('beach-radius-value').value='3.0 m';}controls.mouseButtons.LEFT=beach.tool==='orbit'?THREE.MOUSE.ROTATE:null;canvas.classList.toggle('editing',beach.tool!=='orbit');};
 $('beach-radius').oninput=()=>{beach.radius=Number($('beach-radius').value);$('beach-radius-value').value=beach.radius.toFixed(1)+' m';};
 $('beach-time').oninput=()=>{beach.hour=Number($('beach-time').value);updateBeachStats();};
 $('beach-cycle').onchange=()=>beach.cycle=$('beach-cycle').checked;
 $('beach-wind').oninput=()=>{sim.wind=Number($('beach-wind').value);$('beach-wind-value').value=sim.wind.toFixed(1)+' m/s';};
 $('beach-turbulence').oninput=()=>{sim.turbulence=Number($('beach-turbulence').value);$('beach-turbulence-value').value=sim.turbulence.toFixed(2);};
 $('beach-caustics').onchange=()=>{beach.caustics.enabled=$('beach-caustics').checked;beach.caustics.last=-1;};
 $('beach-jet').oninput=()=>{beach.windStrength=Number($('beach-jet').value);$('beach-jet-value').value=beach.windStrength+' m/s';};
 $('beach-direction').oninput=()=>{sim.windAngle=Number($('beach-direction').value)*Math.PI/180;$('beach-direction-value').value=$('beach-direction').value+'°';};
 $('beach-pause').onclick=()=>{beach.paused=!beach.paused;$('beach-pause').textContent=beach.paused?'Resume':'Pause';};
 $('beach-spawn').onclick=()=>{const p=controls.target;beach.spawn(p.x+(beach.balls.length%3-1)*.9,p.z);};
 $('beach-clear').onclick=()=>beach.balls.length=0;
 $('beach-nudge').onclick=()=>{sim.nudgeWater(controls.target.x,controls.target.z,beach.radius,3);beach.parcels.splash(controls.target.toArray(),[0,-3,0],.06);};
 $('beach-sediment').onclick=()=>{const p=controls.target;sim.recenter(p.x,p.z);beach.parcels.nudge([p.x,sim.sample(p.x,p.z).bed,p.z],camera.getWorldDirection(new THREE.Vector3()).toArray(),beach.radius);};
 $('beach-mound').onclick=()=>sim.nudgeSand(controls.target.x,controls.target.z,beach.radius,.8);
 $('beach-dig').onclick=()=>sim.nudgeSand(controls.target.x,controls.target.z,beach.radius,-.8);
 const focus=(p,offset)=>{controls.target.set(...p);camera.position.set(p[0]+offset[0],p[1]+offset[1],p[2]+offset[2]);controls.update();renderer.previousCamera=null;};
 $('beach-sun').onclick=()=>{beach.updateSky();controls.target.copy(camera.position).addScaledVector(beach.u.uSun.value,40);controls.update();};
 $('beach-moon').onclick=()=>{beach.updateSky();controls.target.copy(camera.position).addScaledVector(beach.u.uMoon.value,40);controls.update();};
 $('beach-sand-view').onclick=()=>focus([-2,sim.sample(-2,5).bed+.2,5],[4,1.9,-1]);
 $('beach-arch').onclick=()=>focus([-8,2,2.5],[4,1,-7]);$('beach-undo-volume').onclick=()=>{if(beach.terrain.undo()){sim.syncTerrain(beach.terrain);beach.updateTerrain();beach.volume.refreshTerrain();}};$('beach-reef').onclick=()=>focus([-18,0,-17.5],[6,2.5,3]);
 $('beach-rocks').onclick=()=>focus([-8,.5,-12],[5,4,7]);
 $('beach-inspect-ball').onclick=()=>{const b=beach.balls.at(-1);if(b)focus(b.position,[2,1.5,3]);};
 $('beach-shore').onclick=home;$('beach-pool').onclick=()=>focus([12,.2,15],[5,5,8]);$('beach-grass').onclick=()=>{const y=sim.sample(-6,16).bed;focus([-6,y+.8,16],[3,2.8,5]);};
 $('beach-backend').onchange=()=>{const cpu=$('beach-backend').value==='cpu';sim.setCPU(cpu);beach.volume.setCPU(cpu);beach.parcelField.cpu=cpu||!renderer.renderer.extensions.has('EXT_color_buffer_float');};$('beach-verify').onclick=()=>beach.verify();$('beach-volume-enabled').onchange=()=>beach.volume.enabled=$('beach-volume-enabled').checked;$('beach-volume-here').onclick=()=>{beach.volume.relocate(controls.target.toArray());beach.volume.enabled=true;$('beach-volume-enabled').checked=true;};$('beach-gust-test').onclick=()=>{beach.volume.enabled=true;$('beach-volume-enabled').checked=true;beach.gustEnd=beach.volume.time+2;beach.paused=false;$('beach-reef').click();};$('beach-wind-test').onclick=()=>{beach.volume.enabled=true;$('beach-volume-enabled').checked=true;sim.wind=32;sim.turbulence=1.5;sim.windAngle=0;$('beach-wind').value=32;$('beach-wind-value').value='32.0 m/s';$('beach-turbulence').value=1.5;$('beach-turbulence-value').value='1.50';$('beach-direction').value=0;$('beach-direction-value').value='0°';beach.paused=false;$('beach-reef').click();};
 canvas.addEventListener('pointerdown',event=>{if(beach.enabled&&beach.tool==='wind'&&event.button===0&&(!firstPerson||lookLocked||fallbackLook)){beach.windHeld=true;const ray=rayFromEvent(event);beach.interact(ray.origin.toArray(),ray.direction.toArray());}});
 window.addEventListener('pointerup',()=>beach.windHeld=false);window.addEventListener('blur',()=>beach.windHeld=false);
 let lastBrush=0;canvas.addEventListener('pointermove',event=>{if(firstPerson||!beach.enabled||beach.tool==='orbit'||beach.tool==='ball'||beach.tool==='grab'||event.buttons!==1||event.timeStamp-lastBrush<80)return;lastBrush=event.timeStamp;const ray=rayFromEvent(event);beach.interact(ray.origin.toArray(),ray.direction.toArray());});
 updateBeachStats();
}
function updateBeachStats(){if(!renderer?.beach)return;const b=renderer.beach,h=Math.floor(b.hour),m=Math.floor((b.hour-h)*60);$('beach-time-value').value=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;if(b.cycle)$('beach-time').value=b.hour;
 $('beach-state').textContent=b.sim.backend;$('beach-backend').value=b.sim.cpu?'cpu':'gpu';$('beach-pause').textContent=b.paused?'Resume':'Pause'; $('beach-draw').textContent=(b.cpuMs||0).toFixed(1)+' ms CPU submission';$('beach-validation').textContent=b.verification;$('beach-gpu-times').textContent=Object.entries(b.timers.ms).map(([k,v])=>`${k} ${v.toFixed(1)} ms`).join(' / ')||'Timer unavailable';$('beach-cells').textContent=`${b.volume.size.join(' × ')} at ${b.volume.dx} m (3D) · ${b.sim.n}² coastal + 512 m far field`;$('beach-volume-state').textContent=`${b.volume.cpu?'CPU':'GPU'} · ${b.volume.time.toFixed(1)} s · ${b.volume.metrics.overhangs} overhanging cells · ${b.volume.metrics.volume.toFixed(1)} m³`;
 $('beach-balls').textContent=`${b.balls.length} · ${b.balls.filter(v=>v.submerged>.01).length} in water`;
 $('beach-parcels').textContent=`${b.parcels.items.filter(p=>p.kind==='sand').length} / ${b.parcels.items.filter(p=>p.kind==='water').length} · contacts CPU / field ${b.parcelField.cpu?'CPU':'GPU'}`; $('beach-grass-count').textContent=(b.grassCount||0).toLocaleString();
 $('beach-held').textContent=b.parcels.held?`${b.parcels.held.kind} · ${b.parcels.held.volume.toFixed(3)} m³ · click to drop`:'None';if(firstPerson&&b.enabled&&b.parcels.held)$('pov-tool').textContent=`Drop ${b.parcels.held.kind} · ${b.parcels.held.volume.toFixed(2)} m³`;else if(firstPerson&&b.enabled)$('pov-tool').textContent=firstPersonOptions().find(([id])=>id===fpTool)?.[1]||'';
 $('beach-clock').textContent=b.sim.time.toFixed(1)+' s';$('beach-edits').textContent=b.sim.savedBed.size.toLocaleString()+' cells';
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
 for(const name of ['experiment','source','color','photons'])$(`lt-${name}`).onchange=()=>{test.configure({[name]:name==='photons'?Number($(`lt-${name}`).value):$(`lt-${name}`).value,...(name==='experiment'&&$('lt-experiment').value==='prism'?{dispersion:true}:{})});sync();updateLightTestStats();if(name==='experiment')home();};
 $('lt-backend').onchange=()=>{test.backend=$('lt-backend').value;test.gpuFailure=null;test.configure({});};
 $('lt-verify').onclick=async()=>{const comparison=test.verifyGPU();updateLightTestStats();await comparison;updateLightTestStats();};
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
 $('lt-gpu-ms').textContent=r?.gpuMs!=null?r.gpuMs.toFixed(2)+' ms':r?.backend==='CPU worker'?'CPU reference':'Timer unavailable';
 $('lt-backend-status').textContent=test.backendStatus;
 $('lt-device').textContent=test.gpu?.device||'Detecting';
 $('lt-verification').textContent=test.verification;
 $('lt-verify').disabled=test.busy||test.verifying||!test.gpu||!!test.gpu.unavailable;
 $('lt-energy').textContent=l?[l.receiver,l.absorbed,l.escaped].map(v=>(100*v/l.emitted).toFixed(1)+'%').join(' / '):'—';
 $('lt-remainder').textContent=l?(100*l.truncated/l.emitted).toFixed(3)+'%':'—';$('lt-tir').textContent=l?l.tir.toLocaleString():'—';
 $('lt-floats').textContent=test.sceneData.floats.map(f=>`${f.mass.toFixed(1)} kg · ${f.floating?'floating':'on bottom'}`).join(' / ');
}

function tick(time) {
  try {
    const elapsed=lastTime?(time-lastTime)/1000:1/60;lastTime=time;
    if(document.hidden){requestAnimationFrame(tick);return;}
    if(firstPerson)stepFirstPerson(Math.min(elapsed,.1)*(renderer.waterLab.enabled?renderer.waterLab.simulationSpeed:1));else{travel(Math.min(elapsed,.05));controls.update(Math.min(elapsed,.1));}
    if(renderer.beach.enabled&&!firstPerson){const p=camera.position.toArray();renderer.beach.terrain.projectSphere(p,.35);camera.position.fromArray(p);}
    if(time-lastStream>150){updateStream();lastStream=time;}
    if(streamer.error)throw new Error(streamer.error);
    renderer.beach.advance(elapsed,renderer.beach.paused,camera);renderer.waterLab.setPlayer(firstPerson?walker.position:null,walker.velocity,walker.radius,walker.eyeHeight);renderer.waterLab.advance(elapsed,camera);
    if(!paused&&!renderer.optics.enabled&&!renderer.lightTest.enabled&&!renderer.beach.enabled&&!renderer.waterLab.enabled)stepper.advance(elapsed,dt=>{
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
      $('splat-count').textContent=(renderer.visibleSplats+renderer.grass.count+renderer.water.count+renderer.grains.count+renderer.soft.count+renderer.optics.count+renderer.lightTest.count+renderer.beach.count+(renderer.waterLabRenderer.count||0)).toLocaleString();$('detail').textContent=renderer.effectivePixelTarget.toFixed(1)+' px';
      updateLightTestStats();updateBeachStats();updateWaterLabStats();
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

function setupWaterLabControls(){
 const lab=renderer.waterLab;
 const sync=()=>{$('wl-waterfall-controls').hidden=lab.kind!=='waterfall';$('wl-waterfall-height').value=lab.waterfallHeight;$('wl-waterfall-height-value').value=(lab.waterfallHeight*lab.spec.scale).toFixed(1)+' m';$('wl-orientation').value=0;$('wl-orientation-value').value='0°';$('wl-resolution').value=lab.quality;$('wl-budget').value=lab.particleBudget;$('wl-scale').value=Math.log10(lab.scaleMultipliers[lab.kind]);$('wl-scale-value').value=lab.scaleMultipliers[lab.kind].toFixed(2)+'×';$('wl-detail').checked=lab.detail.enabled;$('wl-detail-density').value=lab.detail.density;$('wl-detail-density-value').value=lab.detail.density.toFixed(1)+'×';$('wl-rain').checked=lab.rain.enabled;$('wl-rain-rate').value=lab.rain.rate;$('wl-rain-rate-value').value=lab.rain.rate+' mm/min';$('wl-pane-splash').hidden=lab.kind!=='pane';$('wl-container-controls').hidden=!['tank','glass','pane'].includes(lab.kind);$('wl-river-controls').hidden=lab.kind!=='river';$('wl-slope').value=lab.riverSlope;$('wl-slope-value').value=(lab.riverSlope*100).toFixed(1)+'%';$('wl-source-speed').value=lab.sourceSpeed;$('wl-source-speed-value').value=lab.sourceSpeed.toFixed(1)+' m/s';$('wl-dye').textContent=lab.kind==='river'?'Release dye at source':'Add dye at center';$('wl-station').value=lab.kind;for(const id of ['wl-jets','wl-lights'])$(id).parentElement.hidden=lab.kind!=='pool';$('wl-flow').parentElement.hidden=!['pipe','waterfall','river'].includes(lab.kind);for(const k of ['simulationSpeed','radius','turbulence','flow','jets','lights','ambient','sunlight','wind','windTurbulence','windStrength','tannins']){$('wl-'+k).value=lab[k];$('wl-'+k).oninput();}for(const k of ['x','y','z','tilt','pitch','spin']){$('wl-'+k).value=k==='y'?2:0;$('wl-'+k).oninput();}};
 for(const k of ['simulationSpeed','radius','turbulence','flow','jets','lights','ambient','sunlight','wind','windTurbulence','windStrength','tannins'])$('wl-'+k).oninput=()=>{lab[k]=Number($('wl-'+k).value);$('wl-'+k+'-value').value=k==='simulationSpeed'?lab[k].toFixed(2)+'×':k==='radius'?(lab[k]*lab.spec.scale).toFixed(3)+' m':k==='wind'||k==='windStrength'?lab[k]+' m/s':lab[k].toFixed(2);};
 $('wl-slope').oninput=()=>{$('wl-slope-value').value=(Number($('wl-slope').value)*100).toFixed(1)+'%';};
 $('wl-slope').onchange=()=>{lab.riverSlope=Number($('wl-slope').value);lab.configure('river');sync();};
 $('wl-waterfall-height').oninput=()=>{$('wl-waterfall-height-value').value=(Number($('wl-waterfall-height').value)*lab.spec.scale).toFixed(1)+' m';};
 $('wl-waterfall-height').onchange=()=>{lab.waterfallHeight=Number($('wl-waterfall-height').value);lab.configure('waterfall');sync();};
 $('wl-source-speed').oninput=()=>{lab.sourceSpeed=Number($('wl-source-speed').value);$('wl-source-speed-value').value=lab.sourceSpeed.toFixed(1)+' m/s';};
 $('wl-source-view').onclick=()=>{const z=-51,x=riverCenter(z),y=riverBottom(z,lab.riverSlope);camera.position.set(x+6,y+6,z+6);controls.target.set(x,y+.5,z);controls.update();};
 $('wl-pond-view').onclick=()=>{camera.position.set(8,7,48);controls.target.set(0,.8,42);controls.update();};
 $('wl-river-view').onclick=()=>home();
 $('wl-resolution').onchange=()=>{lab.resolutions[lab.kind]=Number($('wl-resolution').value);lab.configure(lab.kind);sync();updateWaterLabStats();};
 $('wl-budget').onchange=()=>{lab.particleBudget=Number($('wl-budget').value);lab.configure(lab.kind);sync();updateWaterLabStats();};
 $('wl-scale').onchange=()=>{lab.configure(lab.kind,10**Number($('wl-scale').value));sync();updateWaterLabStats();};
 $('wl-scale').oninput=()=>{$('wl-scale-value').value=(10**Number($('wl-scale').value)).toFixed(2)+'×';};
 $('wl-camera-wet').onchange=()=>lab.wetting.cameraEnabled=$('wl-camera-wet').checked;
 $('wl-wipe').onclick=()=>{lab.wetting.lens=[];};
 $('wl-mist').onchange=()=>lab.detail.mistEnabled=$('wl-mist').checked;
 $('wl-mist-density').oninput=()=>{lab.detail.mistDensity=Number($('wl-mist-density').value);$('wl-mist-density-value').value=lab.detail.mistDensity.toFixed(1)+'×';};
 $('wl-orientation').oninput=()=>{lab.motion.spin=Number($('wl-orientation').value)*Math.PI/180;$('wl-orientation-value').value=$('wl-orientation').value+'°';};
 $('wl-adaptive-resolution').onchange=()=>renderer.waterLabRenderer.adaptiveResolution=$('wl-adaptive-resolution').checked;
 $('wl-detail').onchange=()=>lab.detail.enabled=$('wl-detail').checked;
 $('wl-detail-density').oninput=()=>{lab.detail.density=Number($('wl-detail-density').value);$('wl-detail-density-value').value=lab.detail.density.toFixed(1)+'×';};
 $('wl-rain').onchange=()=>lab.rain.enabled=$('wl-rain').checked;
 $('wl-rain-rate').oninput=()=>{lab.rain.rate=Number($('wl-rain-rate').value);$('wl-rain-rate-value').value=lab.rain.rate+' mm/min';};
 $('wl-station').onchange=()=>{lab.configure($('wl-station').value);sync();home();};$('wl-reset').onclick=()=>{lab.configure(lab.kind);sync();home();};
 $('wl-tool').onchange=()=>{lab.tool=$('wl-tool').value;lab.windHeld=false;controls.mouseButtons.LEFT=lab.tool==='orbit'?THREE.MOUSE.ROTATE:null;if(firstPerson){fpTool=lab.tool;refreshFirstPersonTools();}};
 $('wl-x').oninput=()=>{lab.motion.target[0]=Number($('wl-x').value);$('wl-x-value').value=(lab.motion.target[0]*lab.spec.scale).toFixed(3)+' m';};
 $('wl-z').oninput=()=>{lab.motion.target[2]=Number($('wl-z').value);$('wl-z-value').value=(lab.motion.target[2]*lab.spec.scale).toFixed(3)+' m';};
 $('wl-y').oninput=()=>{lab.motion.target[1]=Number($('wl-y').value);$('wl-y-value').value=(lab.motion.target[1]*lab.spec.scale).toFixed(3)+' m';};
 $('wl-pitch').oninput=()=>{lab.motion.targetPitch=Number($('wl-pitch').value)*Math.PI/180;$('wl-pitch-value').value=$('wl-pitch').value+'°';};
 $('wl-tilt').oninput=()=>{lab.motion.targetTilt=Number($('wl-tilt').value)*Math.PI/180;$('wl-tilt-value').value=$('wl-tilt').value+'°';};
 $('wl-spin').oninput=()=>{lab.motion.targetSpin=Number($('wl-spin').value)*Math.PI/30;$('wl-spin-value').value=$('wl-spin').value+' rpm';};
 $('wl-pane-splash').onclick=()=>lab.rain.douse();
 $('wl-accelerate').onclick=()=>{lab.motion.velocity[0]+=5;lab.paused=false;};
 for(const kind of ['glass','mirror','rock'])$('wl-'+kind).onclick=()=>{lab.spawn(kind,camera.position.toArray(),camera.getWorldDirection(new THREE.Vector3()).toArray());};
 $('wl-dye').onclick=()=>{const point=lab.kind==='river'?[riverCenter(-52.5),riverBottom(-52.5,lab.riverSlope)+.55,-52.5]:controls.target.toArray();lab.addSoluteNear('dye',point);};
 $('wl-pause').onclick=()=>{lab.paused=!lab.paused;$('wl-pause').textContent=lab.paused?'Resume':'Pause';};$('wl-clear').onclick=()=>lab.balls.length=0;$('wl-backend').onchange=()=>lab.gpu.cpu=$('wl-backend').value==='cpu';$('wl-verify').onclick=()=>{lab.verify();updateWaterLabStats();};
 canvas.addEventListener('pointerdown',e=>{if(!lab.enabled||lab.tool!=='wind'||e.button!==0||firstPerson&&!lookLocked&&!fallbackLook)return;const ray=rayFromEvent(e);lab.windHeld=true;lab.windRay={origin:ray.origin.toArray(),direction:ray.direction.toArray()};});
 canvas.addEventListener('pointermove',e=>{if(!lab.enabled||!lab.windHeld)return;const ray=rayFromEvent(e);lab.windRay={origin:ray.origin.toArray(),direction:ray.direction.toArray()};});
 window.addEventListener('pointerup',()=>lab.windHeld=false);window.addEventListener('blur',()=>lab.windHeld=false);document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement)lab.windHeld=false;});sync();
}
function updateWaterLabStats(){const lab=renderer.waterLab;if(!lab.enabled)return;$('wl-dimensions').textContent=(lab.kind==='river'?`${(12*lab.spec.scale).toFixed(0)} × ${(120*lab.spec.scale).toFixed(0)} m basin · `:(lab.kind==='glass'?2.4:lab.kind==='tank'?4.4:lab.kind==='pane'?4.8:11)*lab.spec.scale+' m wide · ')+lab.spec.scale.toFixed(4)+' m/unit';$('wl-resolution-state').textContent=`${lab.resolution.toFixed(2)}× relative detail · ${(lab.spacing*lab.spec.scale).toFixed(4)} m spacing (target ${lab.resolutionInfo.targetSpacing.toFixed(4)} m) · ${lab.resolutionInfo.limited?'BUDGET / ATLAS LIMIT':'within budget'}`;$('wl-detail-state').textContent='≤ '+lab.detail.count.toLocaleString()+' / '+lab.detail.capacity.toLocaleString()+' · '+lab.detail.mistEmitted.toLocaleString()+' mist emitted · '+(lab.detail.cpu?'CPU reference':'GPU wind / lifetime')+' · '+lab.detail.overwritten+' recycled early · '+renderer.waterLabRenderer.blobRenderer.geometry.instanceCount+' / 384 liquid families';$('wl-state').textContent=`${lab.gpu.cpu?'CPU reference':'GPU constraints (async) / density / fine particles'} · CPU neighbors / bodies / solutes / rain / wetting · ${renderer.waterLabRenderer.mediumShadows.cpu?'CPU':'GPU'} medium light transport`;$('wl-volume').textContent=`${(lab.volume+lab.rain.unresolvedVolume*lab.spec.scale**3).toFixed(6)} m³ · ${lab.count} parcels · drift ${(lab.volume+lab.rain.unresolvedVolume*lab.spec.scale**3-lab.initialVolume-lab.rain.emitted*lab.spec.scale**3).toExponential(1)}`;$('wl-rain-volume').textContent=`${(lab.rain.emitted*lab.spec.scale**3).toFixed(6)} / ${(lab.rain.airborneVolume*lab.spec.scale**3).toFixed(6)} m³ · ${lab.rain.hits} impacts${lab.rain.capacityLimited?' · rain input paused at water budget':''}`;$('wl-held').textContent=lab.held?`${(lab.held.ids.length*lab.spacing**3*lab.spec.scale**3).toFixed(6)} m³ · click to drop`:'None';const bed=lab.bedStock.reduce((a,b)=>a+b,0);$('wl-sediment').textContent=lab.kind==='river'?`${(lab.eroded*lab.spec.scale**3).toFixed(3)} m³ eroded · ${(lab.deposited*lab.spec.scale**3).toFixed(3)} m³ deposited · ${(lab.suspendedSediment*lab.spec.scale**3).toFixed(3)} m³ suspended · balance ${(bed+lab.suspendedSediment-lab.initialBed).toExponential(2)}`:'—';$('wl-bodies').textContent=lab.balls.map(b=>`${b.kind} ${(b.submerged*100).toFixed(0)}% wet`).join(' / ')||'None';$('wl-clock').textContent=`${lab.time.toFixed(2)} s · ${(lab.simRate||0).toFixed(2)}× actual / ${lab.simulationSpeed.toFixed(2)}× requested · ${lab.accumulator.toFixed(2)} s pending · ${(lab.spacing*lab.spec.scale).toFixed(4)} m spacing · ${lab.gpu.overflow||0} neighbor overflows · hash ${(lab.gpu.neighborMs||0).toFixed(1)} ms · ${Object.entries(lab.timings||{}).map(([k,v])=>k+' '+v.toFixed(1)+' ms').join(' / ')}`;$('wl-times').textContent=(renderer.waterLabRenderer.loadScale*100).toFixed(0)+'% GPU image scale · '+Object.entries(renderer.waterLabRenderer.timers.ms).map(([k,v])=>`${k} ${v.toFixed(1)} ms`).join(' / ');$('wl-validation').textContent=lab.verification;$('wl-backend').value=lab.gpu.cpu?'cpu':'gpu';$('wl-pause').textContent=lab.paused?'Resume':'Pause';if(firstPerson&&lab.held)$('pov-tool').textContent=`Drop water · ${(lab.held.ids.length*lab.spacing**3*lab.spec.scale**3).toFixed(5)} m³`;}
