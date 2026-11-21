import {bindFieldTools,fieldControls} from './material-field-controls.js';
import {MarkBrush,strokePattern,bindBrushControls,brushControls,sculptToolbar,showBrushControls,toolOptions} from './paint-brush.js';
import {brushCopies,strokePoints} from './gaussian-marks.js';
import {studioTests,workbenchStore} from './workbenches.js';
import {assemblyControls,bindAssemblyControls} from './assembly-controls.js';
import {insertSelection} from './assembly.js';
import {familySampler} from './family.js';
import {familyControls,bindFamilyControls} from './family-controls.js';
import {exportAsset,importAsset,importFamily,familyKind} from './asset-package.js';
import {anchorRetention} from './attachment-material.js';
import {structureBody} from './fracture.js';
import {liftGround,moveChunk,releaseChunk,strikeGround} from './ground-interaction.js';
import {AuthoredWaveContacts} from './authored-wave-contacts.js';
import {looseKind} from './loose-matter.js';
import {windAt} from './wind.js';
import {WindSand} from './wind-sand.js';
import {WindSea} from './ocean.js';
import {implicitStamp} from './implicit-surface.js';
import {asset,part,stamp,material,clone,uid,addStudioPresets,validateLibrary,History,recordKey,sampleTrack,MATERIAL_FIELDS,LIMITS,MAX_LIBRARY_BYTES,MAX_WIND_SPEED,worldPartCount} from './model.js';
import {StudioPhysics} from './physics.js';
import {jointDefaults,recordForceKey,sampleForces} from './physics-data.js';
import {LibraryStore} from './storage.js';
import {Baker} from './baker.js';
import {StudioView,partMatrix} from './view.js';
import * as THREE from 'three';
import './style.css';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const poseInputs=()=>['position','rotation','scale'].map((key)=>`<label>${key==='rotation'?'Rotation (°)':key==='position'?'Position (m)':'Scale'}<span class="studio-vector">${['X','Y','Z'].map((axis,i)=>`<input aria-label="${key} ${axis}" data-pose="${key}" data-axis="${i}" type="number" step="${key==='rotation'?1:.05}" ${key==='scale'?'min=".01" max="100"':''}>`).join('')}</span></label>`).join('');
export async function startStudioApp(boot={mark(){},finish(){},fail:console.error},{store,cpuOnly=false,testId=new URLSearchParams(location.search).get('test')}={}){
 const test=studioTests.find(t=>t.id===testId)||studioTests[0];
 store??=test.create?workbenchStore(test,new URLSearchParams(location.search).get('ground')):new LibraryStore();
 document.title='Asset / material studio';document.body.innerHTML=`<main id="asset-studio">
 <header><label class="studio-test-label">Studio test<select id="studio-test">${studioTests.map(t=>'<option value="'+t.id+'">'+t.name+'</option>').join('')}</select></label><select id="studio-mode" aria-label="Workspace"><option value="world">World · place assets</option><option value="asset">Asset · sculpt / paint / animate</option></select><button id="studio-controls" aria-expanded="true">Hide controls</button><button id="studio-undo">Undo</button><button id="studio-redo">Redo</button><button id="studio-save">Save locally</button><button id="studio-export">Export library</button><button id="studio-import">Import library</button><input id="studio-file" type="file" accept="application/json,.json" hidden></header>
 <section class="studio-viewport"><canvas id="studio-canvas" aria-label="Asset studio 3D viewport" tabindex="0"></canvas><div id="studio-hint">Left: active tool · right drag: orbit · middle drag: pan · wheel: zoom · F: frame placements</div>${sculptToolbar}<div class="studio-readouts"><div id="studio-notice" role="status" aria-live="polite"></div><div id="studio-rates"></div></div></section>
 <aside>
 <fieldset><legend>Asset library</legend><label>Asset<select id="studio-assets"></select></label><div class="studio-row"><button id="studio-new">New</button><button id="studio-copy-asset">Duplicate</button><button id="studio-edit">Edit asset</button></div><label id="studio-view-preset-row" hidden>Frame from<select id="studio-view-preset"><option value="">Current angle</option><option value="threeQuarter">Three-quarter</option><option value="front">Front</option><option value="side">Side</option><option value="top">Top</option></select></label><label>Name<input id="studio-asset-name" maxlength="100"></label><div class="studio-row"><button id="studio-place">Place selected asset</button><button id="studio-frame">Frame placements</button></div><div class="studio-row"><button id="studio-export-asset">Export asset</button><button id="studio-import-asset">Add from file</button><input id="studio-asset-file" type="file" accept="application/json,.json" hidden></div>${familyControls}<small id="studio-library-note">Edits update all placements of an asset. Duplicate it for an independent version.</small></fieldset>
 ${assemblyControls}
 <fieldset id="studio-world-controls"><legend>World</legend><label>Ground material<select id="studio-ground"></select></label><label>Wind speed (m/s)<output id="studio-wind-speed-label"></output><input id="studio-wind-speed" type="range" min="0" max="${MAX_WIND_SPEED}" step=".5"></label><label>Wind heading (°)<output id="studio-wind-heading-label"></output><input id="studio-wind-heading" type="range" min="-180" max="180" step="1"></label><label>Wind turbulence<output id="studio-wind-turbulence-label"></output><input id="studio-wind-turbulence" type="range" min="0" max="1" step=".05"></label><button data-world-tool="splash" id="studio-splash">Ground impulse</button><button data-world-tool="lift" id="studio-lift">Lift / drop ground</button><label>Ground impulse force (N)<output id="studio-impact-label">5000</output><input id="studio-impact" type="range" min="100" max="50000" step="100" value="5000"></label><label>Placed object<select id="studio-instances"></select></label><div class="studio-row"><button id="studio-copy-instance">Duplicate placement</button><button id="studio-delete-instance">Remove</button></div><small>Wind drives waves and loose sand. Press Play to apply wind and water forces to parts and joints. Heading 0° blows toward +X, 90° toward +Z.</small></fieldset>
 <fieldset id="studio-asset-controls" hidden><legend>Sculpt / paint</legend><label>Part<select id="studio-parts"></select></label><div class="studio-row"><button id="studio-add-part">Add part</button><button id="studio-delete-part">Remove part</button></div><label>Part name<input id="studio-part-name" maxlength="100"></label><label>Tool<select id="studio-tool"><option value="camera">Camera</option><option value="select" selected>Select</option><option value="nudge">Nudge with force</option><option value="field">Material interaction</option><option value="add">Add volume</option><option value="subtract">Carve</option><option value="paint">Paint material</option>${toolOptions}<option value="insert">Place library selection</option><option value="translate">Move</option><option value="rotate">Rotate</option><option value="scale">Scale</option></select></label><label>Brush shape<select id="studio-shape"><option value="sphere">Sphere / ellipsoid</option><option value="box">Box</option><option value="capsule">Capsule</option></select></label><label>Brush radius (m)<output id="studio-radius-label">0.35</output><input id="studio-radius" type="range" min=".05" max="2" step=".01" value=".35"></label><label>Soft blend (m)<input id="studio-blend" type="range" min="0" max=".6" step=".01" value=".12"></label>${brushControls}<label>Surface spacing (m)<input id="studio-spacing" type="number" min=".05" max=".5" step=".01"></label><label class="studio-check"><input id="studio-gpu" type="checkbox" checked> GPU sculpt sampling, when validated</label><small>Brushes use the selected part’s local axes. Hold Shift to swap Add and Carve. Use [ and ] to resize the brush.</small></fieldset>
 <fieldset><legend id="studio-pose-title">Placement transform</legend><div id="studio-world-tools" class="studio-row"><button data-world-tool="camera">Camera</button><button data-world-tool="translate">Move</button><button data-world-tool="rotate">Rotate</button><button data-world-tool="scale">Scale</button><button data-world-tool="select">Select</button><button data-world-tool="nudge">Nudge</button></div>${poseInputs()}<div id="studio-pivot-controls" hidden><label>Part pivot (m)<span class="studio-vector">${['X','Y','Z'].map((axis,i)=>`<input type="number" step=".05" aria-label="Pivot ${axis}" data-pivot="${i}">`).join('')}</span></label><small>Pivot is in the asset's local coordinates. Part animation rotates and scales around it.</small></div></fieldset>
 ${fieldControls}
 <fieldset><legend>Physics preview</legend><div class="studio-row"><button id="studio-physics-reset">Reset physics</button><button id="studio-nudge">Nudge tool</button></div><label>Gravity (m/s²)<input id="studio-gravity" type="number" min="0" max="30" step=".1" value="9.81"></label><label>Drag strength (N per metre)<input id="studio-force-strength" type="number" min="1" max="100000" step="100" value="5000"></label><label>Force continues after release (s)<input id="studio-force-duration" type="number" min="0" max="5" step=".05" value=".25"></label><label class="studio-check"><input id="studio-motors" type="checkbox" checked> Apply joint animation forces</label><small>Press Play physics, then drag a surface to apply force there. Longer drags apply more force, up to 100,000 N. Holding sustains it; off-centre forces also turn the part. Reset returns to the authored arrangement.</small><pre id="studio-physics-status">Physics is stopped. Authoring poses are preserved.</pre></fieldset>
 <fieldset><legend>Selected part · body / joint</legend><label>Part<select id="studio-physics-part"></select></label><label class="studio-check"><input id="studio-fixed" type="checkbox"> Anchor this part in the world</label><label>Connect to<select id="studio-joint-parent"></select></label><label>Joint type<select id="studio-joint-type"><option value="ball">Ball joint</option><option value="hinge">Hinge</option><option value="spring">Stretchable spring</option><option value="fixed">Fixed connection</option></select></label><label>Anchor in asset coordinates (m)<span class="studio-vector"><input data-anchor="0" type="number" step=".05" aria-label="Joint anchor X"><input data-anchor="1" type="number" step=".05" aria-label="Joint anchor Y"><input data-anchor="2" type="number" step=".05" aria-label="Joint anchor Z"></span></label><button id="studio-anchor-pivot">Use part pivot</button><label>Hinge axis<span class="studio-vector"><input data-joint-axis="0" type="number" min="-1" max="1" step=".1" aria-label="Hinge axis X"><input data-joint-axis="1" type="number" min="-1" max="1" step=".1" aria-label="Hinge axis Y"><input data-joint-axis="2" type="number" min="-1" max="1" step=".1" aria-label="Hinge axis Z"></span></label><label>Angular looseness (°)<input id="studio-joint-looseness" type="number" min="0" max="180" step="1"></label><label>Angular elasticity (N·m/rad)<input id="studio-joint-stiffness" type="number" min="0" max="100000" step="10"></label><label>Angular damping (N·m·s/rad)<input id="studio-joint-damping" type="number" min="0" max="10000" step="1"></label><label>Spring extension stiffness (N/m)<input id="studio-joint-extensionStiffness" type="number" min="1" max="1000000" step="100"></label><label>Joint breaking load (N)<input id="studio-joint-breakForce" type="number" min="1" max="1000000000" step="100"></label><small id="studio-joint-note"></small></fieldset>
 <fieldset><legend>Joint force animation</legend><label>Force (N), parent-local axes<span class="studio-vector"><input data-drive="force" data-drive-axis="0" type="number" min="-100000" max="100000" step="10" value="0" aria-label="Animation force X"><input data-drive="force" data-drive-axis="1" type="number" min="-100000" max="100000" step="10" value="0" aria-label="Animation force Y"><input data-drive="force" data-drive-axis="2" type="number" min="-100000" max="100000" step="10" value="0" aria-label="Animation force Z"></span></label><label>Torque (N·m), parent-local axes<span class="studio-vector"><input data-drive="torque" data-drive-axis="0" type="number" min="-100000" max="100000" step="10" value="0" aria-label="Animation torque X"><input data-drive="torque" data-drive-axis="1" type="number" min="-100000" max="100000" step="10" value="0" aria-label="Animation torque Y"><input data-drive="torque" data-drive-axis="2" type="number" min="-100000" max="100000" step="10" value="0" aria-label="Animation torque Z"></span></label><small>Record force keys at times on the timeline. Values interpolate and loop; they never chase a target pose. Forces act equally and oppositely on connected parts. A fixed connection has no movable joint axes. Previously saved pose keys remain in the library as authoring data.</small></fieldset>
 <fieldset><legend>Material library / paint material</legend><label>Material<select id="studio-materials"></select></label><div class="studio-row"><button id="studio-new-material">New material</button><button id="studio-copy-material">Duplicate</button></div><label>Name<input id="studio-material-name" maxlength="100"></label><label>Base color<input id="studio-color" type="color"></label><label>Phase<select id="studio-phase"><option value="solid">Solid</option><option value="granular">Granular</option><option value="liquid">Liquid</option><option value="gas">Gas</option></select></label><label>Surface rendering<select id="studio-surface-mode"><option value="auto">Automatic</option><option value="gaussian">Gaussian surface</option></select></label><div id="studio-material-fields"></div><small>Color and appearance update immediately. Density, friction and rebound affect contacts. Loose sand settles into piles and liquid spreads into pools. Liquidity weakens joint support.</small></fieldset>
 <details><summary>Diagnostics / local files</summary><label class="studio-check"><input id="studio-cpu-shortcuts" type="checkbox" checked> Faster exact CPU sculpting / picking</label><label class="studio-check"><input id="studio-incremental" type="checkbox" checked> Reuse unchanged CPU sculpt regions</label><pre id="studio-diagnostics"></pre><p>With the local server, saves also go to <code>.local/asset-studio/library.json</code> with a previous-file backup. Export JSON to keep a portable copy or commit selected libraries later. No automatic upload.</p><button id="studio-validate">Check GPU against CPU</button><pre id="studio-validation"></pre></details>
 </aside>
 <footer><button id="studio-play">Play physics</button><button id="studio-key">Record force key</button><button id="studio-delete-key">Delete key</button><label>Time <output id="studio-time-label">0.00 s</output><input id="studio-time" type="range" min="0" max="3" step=".01" value="0"></label><label>Duration (s)<input id="studio-duration" type="number" min=".1" max="120" step=".1" value="3"></label><select id="studio-keys" aria-label="Part keyframes"><option value="">No part keys</option></select></footer>
 </main>`;
 const $=id=>document.getElementById('studio-'+id),loaded=await store.load();let library=loaded.library,mode='world',selectedAsset=library.assets[0].id,selectedPart=library.assets[0].parts[0].id,selectedMaterial=library.materials[0].id,selectedInstance=library.world.instances[0]?.id,worldTool='select',time=0,playTime=0,playing=false,previewPose=false,stroke=false,lastStroke=null,history=new History(),saveTimer,saveChain=Promise.resolve(),disposed=false,frame=0,dirty=new Set(),baking=false,validating=false,bakeMs=0,stop=false,physics=null,physicsBuilding=false,physicsEpoch=0,forceDrag=null,simulationTotal=0;
 const notice=(s)=>{$('notice').textContent=s;},backend=s=>{$('diagnostics').textContent=s;},currentAsset=()=>library.assets.find(a=>a.id===selectedAsset)||library.assets[0],currentPart=()=>currentAsset().parts.find(p=>p.id===selectedPart)||currentAsset().parts[0],currentMaterial=()=>library.materials.find(m=>m.id===selectedMaterial)||library.materials[0],currentInstance=()=>library.world.instances.find(i=>i.id===selectedInstance),currentPose=()=>mode==='asset'?currentPart().transform:currentInstance()?.transform;
 if(library.world.instances.length){selectedAsset=library.world.instances[0].assetId;selectedPart=currentAsset().parts[0].id;}
 const begin=()=>{resetPhysics();history.push(library);};
 const view=new StudioView($('canvas'),(object,transient)=>{if(!object)return;const pose=currentPose();if(!pose)return;if(mode==='asset'){const pivot=new THREE.Vector3(...currentPart().pivot),p=pivot.clone().multiply(object.scale).applyQuaternion(object.quaternion);pose.position=object.position.clone().sub(pivot).add(p).toArray();}else pose.position=object.position.toArray();pose.rotation=[object.rotation.x,object.rotation.y,object.rotation.z].map(x=>x*180/Math.PI);pose.scale=object.scale.toArray().map(x=>Math.max(.01,Math.min(100,x)));if(mode==='asset')object.matrix.copy(partMatrix(pose,currentPart().pivot));syncPose();if(!transient)changed(false);},begin,{liveStudio:true}),baker=new Baker(backend,{incremental:true});
 const fields=bindFieldTools($,{
  physics:async()=>{if(!physics)await startPhysics();return physics;},current:()=>physics,notice,
  choose:()=>{if(mode==='world')worldTool='field';else $('tool').value='field';attach();},
  display:mode=>{view.fieldDisplay=mode;},
  selectedKey:()=>(mode==='asset'?'editor':selectedInstance)+':'+selectedPart
 });
 const markBrush=new MarkBrush($,view,notice);
 bindBrushControls($);
 const families=bindFamilyControls($,{library:()=>library,asset:currentAsset,options,begin,changed,download:downloadJSON,notice});
 const assembly=bindAssemblyControls($,{
  library:()=>library,asset:currentAsset,options,notice,setTool:tool=>setBrush(tool),
  setVariation(recipe){begin();currentAsset().variation=recipe;changed(false);},
  insert(selection,hit){
   const p=currentPart();
   const point=hit?.point.toArray()||p.pivot.map((x,i)=>x+p.transform.position[i]);
   const result=insertSelection(library,{...selection,destinationId:selectedAsset,hostId:hit?.partId||selectedPart,
    point,normal:hit?.normal.toArray(),localPoint:hit&&view.localPoint(hit.point,hit.partId)});
   begin();library=result.library;selectedPart=result.partId;markBrush.selected=result.markId||null;
   if(!hit)$('tool').value='translate';
   changed();ensureVisible();
   notice(result.markId?'Attached one detail.':('Inserted '+result.count+(result.count===1?' part.':' parts.')));
  }
 });
 const sea=new WindSea(),sand=new WindSand(),authoredWater=new AuthoredWaveContacts();
 let sandTime=0;
 const wind=()=>library.world.wind||{speed:0,heading:0};
 function updateWind(){
  const w=wind();sea.setWind(w.speed,w.heading,w.turbulence);if(physics)physics.wind=w;
  for(const k of ['speed','heading','turbulence']){$('wind-'+k).value=w[k]??0;$('wind-'+k+'-label').value=w[k]??0;}
 }
 for(const k of ['speed','heading','turbulence']){
  const input=$('wind-'+k);
  input.oninput=()=>{if(!input.dataset.editing){history.push(library);input.dataset.editing='yes';$('undo').disabled=false;$('redo').disabled=true;}
   library.world.wind={...wind(),[k]:Number(input.value)};updateWind();
   clearTimeout(saveTimer);saveTimer=setTimeout(()=>save().catch(()=>{}),400);};
  input.onchange=()=>delete input.dataset.editing;
 }
 view.fastPicking=true;$('cpu-shortcuts').onchange=()=>{view.fastPicking=$('cpu-shortcuts').checked;$('incremental').disabled=!$('cpu-shortcuts').checked;enqueue();};$('incremental').onchange=()=>enqueue();
 function selectionValid(){selectedAsset=currentAsset().id;selectedPart=currentPart().id;if(!library.materials.some(m=>m.id===selectedMaterial))selectedMaterial=library.materials[0].id;if(currentInstance()?.assetId!==selectedAsset)selectedInstance=library.world.instances.find(i=>i.assetId===selectedAsset)?.id;}
 function options(id,items,value){$(id).innerHTML=items.map(o=>`<option value="${escape(o.id)}">${escape(o.name)}</option>`).join('');$(id).value=value??'';}
 function syncPose(){const pose=mode==='asset'&&previewPose?sampleTrack(currentPart(),time):currentPose();document.querySelectorAll('[data-pose]').forEach(e=>{e.disabled=!pose;e.value=pose?Number(pose[e.dataset.pose][Number(e.dataset.axis)].toFixed(3)):'';});document.querySelectorAll('[data-pivot]').forEach(e=>e.value=currentPart().pivot[Number(e.dataset.pivot)]);}
 function syncMaterial(){const m=currentMaterial();options('brush-material',library.materials,selectedMaterial);$('surface-mode').value=m.surfaceMode||'auto';$('material-name').value=m.name;$('color').value=m.color;$('phase').value=m.phase;for(const [key] of MATERIAL_FIELDS)$('mat-'+key).value=key==='scattering'?m[key].toFixed(3):m[key];}
 function syncTimeline(){const a=currentAsset(),p=currentPart();$('time').max=a.duration;$('duration').value=a.duration;$('time').value=Math.min(time,a.duration);$('time-label').textContent=time.toFixed(2)+' s';$('keys').innerHTML='<option value="">Select part key</option>'+(p.forceKeys||[]).map(k=>`<option value="${k.time}">${k.time.toFixed(2)} s</option>`).join('');$('key').disabled=mode!=='asset'||!p.joint;$('delete-key').disabled=mode!=='asset';}
 function sync(){selectionValid();families.sync();assembly.sync(mode==='asset');markBrush.sync(currentPart());$('view-preset-row').hidden=mode!=='asset';options('assets',library.assets,selectedAsset);options('materials',library.materials,selectedMaterial);options('ground',library.materials,library.world.groundMaterialId);options('parts',currentAsset().parts,selectedPart);options('instances',library.world.instances.map((i,n)=>({id:i.id,name:(library.assets.find(a=>a.id===i.assetId)?.name||'Object')+' · '+(n+1)})),selectedInstance);$('asset-name').value=currentAsset().name;$('part-name').value=currentPart().name;$('spacing').value=currentAsset().spacing;$('mode').value=mode;$('world-controls').hidden=mode==='asset';$('asset-controls').hidden=mode!=='asset';$('world-tools').hidden=mode==='asset';$('pivot-controls').hidden=mode!=='asset';$('pose-title').textContent=mode==='asset'?'Part transform':'Placement transform';$('copy-instance').disabled=$('delete-instance').disabled=!currentInstance();$('undo').disabled=!history.past.length;$('redo').disabled=!history.future.length;$('frame').textContent=mode==='asset'?'Frame authored asset':'Frame placements';syncPose();syncMaterial();syncTimeline();syncPhysics();attach();}
 function attach(){const tool=mode==='world'?worldTool:$('tool').value;
 document.querySelectorAll('[data-world-tool]').forEach(e=>e.setAttribute('aria-pressed',String(mode==='world'&&tool===e.dataset.worldTool)));
 $('nudge').setAttribute('aria-pressed',String(tool==='nudge'));
 const gesture={field:'Click the material to probe or apply the selected action',camera:'Drag to orbit · pinch to zoom',select:'Click a part to select',translate:'Drag an arrow to move',rotate:'Drag a ring to rotate',scale:'Drag a handle to scale',nudge:'Play physics, then drag a body to apply force',lift:'Drag to lift material, release to drop',splash:'Click or drag to strike the ground',add:'Drag to add material',subtract:'Drag to carve',paint:'Drag to paint'};
 Object.assign(gesture,{insert:'Click a surface to insert the library selection · Esc to select',gaussian:'Drag from the surface toward the tip · click to grow outward',detail:'Click a painted detail to edit its shape and joint',sample:'Click a surface or painted detail to sample its material'});
 showBrushControls($,mode==='asset',tool);
 view.paintView.select(selectedPart,mode==='asset'&&tool==='detail'&&!physics?markBrush.selected:null);
 $('hint').textContent=(gesture[tool]||'')+' · right drag: orbit · Shift + right drag: pan · wheel: zoom · F: '+(mode==='asset'?'frame asset':'frame placements');
 if(physics){view.gizmo.detach();return;}view.attach(selectedInstance,selectedPart,mode==='asset'?$('tool').value:worldTool);}
 function refresh(){const active=new Set(mode==='asset'?[selectedAsset]:library.world.instances.map(i=>i.assetId));for(const [key,g]of view.cache)if(!active.has(key.split(':')[0])){g.dispose();view.cache.delete(key);view.surfaces.delete(key);}view.rebuild(library,mode,selectedAsset);
 const groundKind=mode==='world'?looseKind(view.groundSurface):0;
 view.sand=groundKind===1?sand:null;view.sea=groundKind===2?sea:null;
 if(view.sea){sea.organicLoad=view.groundSurface.organicLoad||0;authoredWater.rebuild(view);}
 $('splash').disabled=$('lift').disabled=mode!=='world';updateWind();attach();}
 async function save(){clearTimeout(saveTimer);saveTimer=null;const snapshot=clone(library);saveChain=saveChain.catch(()=>{}).then(()=>store.save(snapshot));try{notice(await saveChain);}catch(e){notice('Save warning: '+e.message);}return saveChain;}
 function changed(rebuild=true){previewPose=false;playing=false;$('play').textContent='Play physics';if(rebuild)refresh();sync();clearTimeout(saveTimer);saveTimer=setTimeout(()=>save().catch(()=>{}),400);}
 function enqueue(a=currentAsset()){for(const p of a.parts)dirty.add(a.id+':'+p.id);pump();}
 async function pump(){if(baking||validating||disposed)return;baking=true;try{while(dirty.size&&!disposed){const key=dirty.values().next().value;dirty.delete(key);const [aid,pid]=key.split(':'),a=library.assets.find(a=>a.id===aid),p=a?.parts.find(p=>p.id===pid);if(!p)continue;if(implicitStamp(p,library.materials)){view.cache.get(key)?.dispose();view.cache.delete(key);view.surfaces.delete(key);if(!view.dragging)refresh();continue;}const stampSnapshot=clone(p.stamps),spacing=a.spacing,signature=JSON.stringify(stampSnapshot),start=performance.now();const s=await baker.bake(stampSnapshot,spacing,$('gpu').checked,$('cpu-shortcuts').checked,{key,incremental:$('incremental').checked});bakeMs=performance.now()-start;if(disposed)break;if(library.assets.find(x=>x.id===aid)?.parts.find(x=>x.id===pid)!==p)continue;if(a.spacing!==spacing||JSON.stringify(p.stamps)!==signature){dirty.add(key);continue;}view.setSurface(key,s,library.materials,stampSnapshot);if(!view.dragging)refresh();if(s.truncated)notice('Surface sample budget reached. Increase spacing or split this sculpt into parts.');$('diagnostics').textContent=`${baker.gpu&&!baker.gpu.failed&&$('gpu').checked?baker.backend:($('cpu-shortcuts').checked?'CPU worker · exact allocation-light path':'CPU worker reference')}\nWebGL 2 Gaussian rendering · 60 FPS cap\nLast bake: ${bakeMs.toFixed(1)} ms · ${s.positions.length/3} splats\nSpacing: ${s.spacing.toFixed(3)} m\nSurface update: ${baker.lastStats?.mode||'full'}${baker.lastStats?.totalBricks?' · '+baker.lastStats.rebuiltBricks+'/'+baker.lastStats.totalBricks+' blocks rebuilt':''}\nPhysics: CPU Rapier WASM (on Play).\nSculpt grid: selected backend. Collision proxies: CPU, camera-independent.`;}}catch(e){notice('Sculpt stopped: '+e.message);}finally{baking=false;}}
 function ensureVisible(){const ids=mode==='asset'?[selectedAsset]:[...new Set(library.world.instances.map(i=>i.assetId))];for(const id of ids){const a=library.assets.find(a=>a.id===id);if(a)for(const p of a.parts){const key=a.id+':'+p.id;if(!view.cache.has(key)&&!implicitStamp(p,library.materials))dirty.add(key);}}pump();}
 let worldCamera=null;
 function switchMode(next){
  if(markBrush.pending)markBrush.finish(false);
  if(mode==='world'&&next==='asset')worldCamera={position:view.camera.position.clone(),target:view.controls.target.clone()};
  if(mode==='asset'&&next==='world'&&worldCamera){
   view.camera.position.copy(worldCamera.position);view.controls.target.copy(worldCamera.target);view.controls.update();worldCamera=null;
  }
  resetPhysics();mode=next;if(mode==='world'&&currentInstance()){selectedAsset=currentInstance().assetId;selectedPart=currentAsset().parts[0].id;}playing=false;previewPose=false;view.showBrush(null,1);view.controls.enabled=true;refresh();sync();ensureVisible();if(mode==='asset')view.frameAuthoredAsset(currentAsset());}
 function removeUnused(){const keys=new Set(library.assets.flatMap(a=>a.parts.map(p=>a.id+':'+p.id)));for(const [key,g]of view.cache)if(!keys.has(key)){g.dispose();view.cache.delete(key);view.surfaces.delete(key);}}
 function restore(next){resetPhysics();sea.reset();sand.reset();library=next;selectionValid();dirty.clear();for(const g of view.cache.values())g.dispose();view.cache.clear();view.surfaces.clear();refresh();sync();ensureVisible();if($('tool').value==='detail'&&markBrush.selected)chooseMark(markBrush.selected);changed(false);}
 const groups=[...new Set(MATERIAL_FIELDS.map(f=>f[2]))];$('material-fields').innerHTML=groups.map(group=>`<details ${group==='Appearance'?'open':''}><summary>${group}</summary>${MATERIAL_FIELDS.filter(f=>f[2]===group).map(([key,label,,min,max,step])=>`<label>${label}<input id="studio-mat-${key}" type="number" min="${min}" max="${max}" step="${step}" data-material="${key}"></label>`).join('')}</details>`).join('');
 $('controls').onclick=()=>{const hidden=document.getElementById('asset-studio').classList.toggle('hide-controls');$('controls').textContent=hidden?'Show controls':'Hide controls';$('controls').setAttribute('aria-expanded',String(!hidden));};
 $('mode').onchange=()=>switchMode($('mode').value);$('edit').onclick=()=>switchMode('asset');$('assets').onchange=()=>{resetPhysics();selectedAsset=$('assets').value;if(mode==='world')selectedInstance=library.world.instances.find(i=>i.assetId===selectedAsset)?.id;selectedPart=currentAsset().parts[0].id;time=0;refresh();sync();ensureVisible();if(mode==='asset')view.frameAuthoredAsset(currentAsset());};$('parts').onchange=()=>{selectedPart=$('parts').value;sync();};$('materials').onchange=()=>{selectedMaterial=$('materials').value;syncMaterial();};$('instances').onchange=()=>{selectedInstance=$('instances').value;selectedAsset=currentInstance()?.assetId||selectedAsset;selectedPart=currentAsset().parts[0].id;sync();};$('ground').onchange=()=>{begin();sea.reset();sand.reset();library.world.groundMaterialId=$('ground').value;changed();};
 $('test').value=test.id;
 $('test').onchange=async()=>{
  const choice=$('test').value;
  $('test').disabled=true;
  try{
   if(!test.create){if(saveTimer!=null)await save();else await saveChain;}
   const url=new URL(location.href);
   url.pathname='/';url.search='';url.hash='';
   url.searchParams.set('scene','asset-studio');
   if(choice!=='library')url.searchParams.set('test',choice);
   location.assign(url.href);
  }catch(e){notice('Could not switch tests: '+e.message);$('test').disabled=false;$('test').value=test.id;}
 };
 if(test.create){
  $('save').hidden=true;
  $('library-note').textContent='Test edits last for this visit. Export an asset to keep a copy.';
  if(test.guide){
   const guide=document.createElement('small');guide.className='studio-guide';guide.textContent=test.guide;
   $('test').closest('header').append(guide);
  }
  if(test.display){$('field-display').value=test.display;view.fieldDisplay=test.display;}
 }
 $('brush-material').onchange=()=>{selectedMaterial=$('brush-material').value;sync();};
 function changedMarks(){view.paintView.rebuild(view);changed(false);}
 function chooseMark(id){const m=markBrush.choose(currentPart(),id);if(m)selectedMaterial=m.materialId;sync();}
 $('mark-list').onchange=()=>chooseMark($('mark-list').value);
 for(const [id,remove] of [['apply-mark',false],['erase-mark',true]])$(id).onclick=()=>{
  if(markBrush.modify(currentPart(),currentMaterial(),remove,begin))changedMarks();
 };
 const setBrush=tool=>{if(mode!=='asset')return;$('tool').value=tool;$('tool').onchange();};
 for(const b of $('brush-bar').children)b.onclick=()=>setBrush(b.dataset.brush);
 $('new').onclick=()=>{if(library.assets.length>=LIMITS.assets)return notice('Asset limit reached; export a library to start a separate collection.');begin();const a=asset('Untitled sculpt');library.assets.push(a);selectedAsset=a.id;selectedPart=a.parts[0].id;switchMode('asset');changed();};
 $('copy-asset').onclick=()=>{if(library.assets.length>=LIMITS.assets)return;begin();const a=clone(currentAsset());a.id=uid();a.name=a.name.slice(0,95)+' copy';const idMap=new Map(a.parts.map(p=>[p.id,uid()]));a.parts.forEach(p=>{if(p.joint&&p.joint.parentId!=='ground')p.joint.parentId=idMap.get(p.joint.parentId);p.id=idMap.get(p.id);});library.assets.push(a);selectedAsset=a.id;selectedPart=a.parts[0].id;selectedInstance=undefined;switchMode('asset');changed(false);};
 $('asset-name').onchange=()=>{const name=$('asset-name').value.trim();if(!name)return sync();begin();currentAsset().name=name;changed();};
 $('add-part').onclick=()=>{if(currentAsset().parts.length>=LIMITS.parts)return notice('Part limit reached.');if(worldPartCount(library)+library.world.instances.filter(i=>i.assetId===selectedAsset).length>LIMITS.previewParts)return notice('World preview limit reached. Remove a placement before adding a part.');begin();const p=part('Part '+(currentAsset().parts.length+1));currentAsset().parts.push(p);selectedPart=p.id;changed();};
 $('delete-part').onclick=()=>{if(currentAsset().parts.length===1)return notice('Keep at least one part; carve or undo to change it.');begin();currentAsset().parts=currentAsset().parts.filter(p=>p.id!==selectedPart);for(const p of currentAsset().parts)if(p.joint?.parentId===selectedPart)p.joint=null;selectedPart=currentAsset().parts[0].id;removeUnused();changed();};$('part-name').onchange=()=>{const name=$('part-name').value.trim();if(!name)return sync();begin();currentPart().name=name;changed();};
 $('place').onclick=()=>{if(library.world.instances.length>=LIMITS.instances||worldPartCount(library)+currentAsset().parts.length>LIMITS.previewParts)return notice('World preview limit reached (32 placed parts). Additional assets stay in the library.');let n;try{n=assembly.seed();}catch(e){return notice(e.message);}const variant=familySampler(currentAsset().variation,n);begin();const p=(mode==='asset'&&worldCamera?worldCamera.target:view.controls.target).clone();p.y=0;const i={id:uid(),assetId:selectedAsset,transform:{position:p.toArray(),rotation:[0,variant.twist,0],scale:[variant.size,variant.size,variant.size]}};assembly.advance(n);library.world.instances.push(i);selectedInstance=i.id;worldTool='translate';switchMode('world');changed();notice('Placed at the orbit target. Drag the arrows to move it.');};
 $('copy-instance').onclick=()=>{const i=currentInstance();if(!i)return;if(worldPartCount(library)+library.assets.find(a=>a.id===i.assetId).parts.length>LIMITS.previewParts)return notice('World preview limit reached (32 placed parts).');begin();const copy=clone(i);copy.id=uid();copy.transform.position[0]+=2;library.world.instances.push(copy);selectedInstance=copy.id;changed();};$('delete-instance').onclick=()=>{if(!currentInstance())return;begin();library.world.instances=library.world.instances.filter(i=>i.id!==selectedInstance);changed();};
 $('tool').onchange=()=>{if(previewPose&&['translate','rotate','scale'].includes($('tool').value)){begin();currentPart().transform=sampleTrack(currentPart(),time);previewPose=false;playing=false;refresh();syncPose();}view.controls.enabled=true;attach();view.showBrush(null,1);};document.querySelectorAll('[data-world-tool]').forEach(e=>e.onclick=()=>{worldTool=e.dataset.worldTool;attach();});$('radius').oninput=()=>{$('radius-label').textContent=Number($('radius').value).toFixed(2);};
 $('spacing').onchange=()=>{const v=Number($('spacing').value);if(!Number.isFinite(v)||v<.05||v>.5)return sync();begin();currentAsset().spacing=v;enqueue();changed(false);};$('gpu').onchange=()=>{enqueue();};
 document.querySelectorAll('[data-pose]').forEach(e=>e.onchange=()=>{let p=currentPose();const v=Number(e.value),field=e.dataset.pose;if(!p||!Number.isFinite(v)||Math.abs(v)>10000||(field==='scale'&&(v<.01||v>100)))return syncPose();begin();if(mode==='asset'&&previewPose){currentPart().transform=sampleTrack(currentPart(),time);p=currentPart().transform;}p[field][Number(e.dataset.axis)]=v;changed();});document.querySelectorAll('[data-pivot]').forEach(e=>e.onchange=()=>{const v=Number(e.value);if(!Number.isFinite(v)||Math.abs(v)>1e4)return syncPose();begin();currentPart().pivot[Number(e.dataset.pivot)]=v;changed();});
 $('new-material').onclick=()=>{if(library.materials.length>=LIMITS.materials)return;begin();const m=material(uid(),'New material','#aab7bd');library.materials.push(m);selectedMaterial=m.id;changed();};$('copy-material').onclick=()=>{if(library.materials.length>=LIMITS.materials)return;begin();const m=clone(currentMaterial());m.id=uid();m.name=m.name.slice(0,95)+' copy';library.materials.push(m);selectedMaterial=m.id;changed();};
 function materialChange(key,value){const m=currentMaterial(),candidate={...m,[key]:value,...(key==='phase'?{liquidity:['liquid','gas'].includes(value)?1:0}:{})},probe={...library,materials:library.materials.map(x=>x.id===m.id?candidate:x)};try{validateLibrary(probe);}catch(e){notice(e.message);syncMaterial();return;}begin();Object.assign(m,candidate);view.recolor(library.materials,m,key);changed();ensureVisible();}
 $('surface-mode').onchange=()=>materialChange('surfaceMode',$('surface-mode').value);
 $('material-name').onchange=()=>materialChange('name',$('material-name').value.trim());$('color').onchange=()=>materialChange('color',$('color').value);$('phase').onchange=()=>materialChange('phase',$('phase').value);document.querySelectorAll('[data-material]').forEach(e=>e.onchange=()=>materialChange(e.dataset.material,Number(e.value)));
 $('undo').onclick=()=>restore(history.undo(library));$('redo').onclick=()=>restore(history.redo(library));$('save').onclick=()=>save().catch(()=>{});function downloadJSON(value,filename){
  let blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'});
  if(blob.size>MAX_LIBRARY_BYTES)blob=new Blob([JSON.stringify(value)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 $('export').onclick=()=>{downloadJSON(library,'bardo-studio-library.json');notice('Exported editable assets, materials, animation and placements.');};
 $('export-asset').onclick=()=>{
  const file=exportAsset(library,selectedAsset);
  const stem=file.asset.name.replace(/[^\p{L}\p{N}_-]+/gu,'-').replace(/^-+|-+$/g,'')||'sculpt';
  downloadJSON(file,'bardo-'+stem+'.asset.json');notice('Exported '+file.asset.name+' with its materials.');
 };
 $('import-asset').onclick=()=>$('asset-file').click();
 $('asset-file').onchange=async()=>{
  try{
   const file=$('asset-file').files[0];if(!file)return;
   if(file.size>MAX_LIBRARY_BYTES)throw Error('Maximum asset size is 8 MiB.');
   const data=JSON.parse(await file.text());
   if(data.kind===familyKind){
    const result=importFamily(library,data);begin();library=result.library;
    families.select(result.family.id);changed(false);
    if(mode==='asset'){$('source').value='family:'+result.family.id;$('source').onchange();}
    notice('Added family '+result.family.name+' with '+result.family.members.length+' member assets.');return;
   }
   const result=importAsset(library,data);
   begin();library=result.library;
   if(mode==='asset'){
    changed(false);$('source').value=result.asset.id;$('source').onchange();
    notice('Added '+result.asset.name+' as the source for this assembly.');return;
   }
   selectedAsset=result.asset.id;selectedPart=result.asset.parts[0].id;selectedInstance=undefined;
   const firstStamp=result.asset.parts.find(p=>p.stamps.length)?.stamps[0];if(firstStamp)selectedMaterial=firstStamp.materialId;
   switchMode('asset');changed(false);notice('Added '+result.asset.name+'. Use Place selected asset to put it in the world.');
  }catch(e){notice('Asset import rejected: '+e.message);}finally{$('asset-file').value='';}
 };
 $('import').onclick=()=>$('file').click();$('file').onchange=async()=>{try{const file=$('file').files[0];if(!file)return;if(file.size>MAX_LIBRARY_BYTES)throw Error('Maximum library size is 8 MiB');const data=JSON.parse(await file.text());if(data?.kind==='bardo-studio-asset'||data?.kind===familyKind)throw Error('Use Add from file for an asset or family.');const next=validateLibrary(data);addStudioPresets(next.materials);if(!confirm('Replace this studio library? Undo restores the current library.'))return;begin();restore(next);notice('Imported library; previous version is available with Undo.');}catch(e){notice('Import rejected: '+e.message);}finally{$('file').value='';}};
 $('view-preset').onchange=()=>{view.frameAuthoredAsset(currentAsset(),$('view-preset').value);$('view-preset').value='';};
 $('frame').onclick=()=>mode==='asset'?view.frameAuthoredAsset(currentAsset()):view.frameWorld(library);
 async function startPhysics(){
  if(physicsBuilding)return;
  const generation=++physicsEpoch;physicsBuilding=true;notice('Preparing collision shapes…');
  try{
   const next=await StudioPhysics.create(clone(library),mode,selectedAsset,Number($('gravity').value),view.sea,view.sand);
   if(generation!==physicsEpoch||disposed){next.dispose();return;}
   physics=next;fields.settings(physics);physics.wind=wind();if(mode==='world')test.start?.(physics);playing=true;previewPose=false;
   view.gizmo.detach();$('play').textContent='Pause physics';
   notice(next.skipped.length?next.skipped.join(' · '):'Physics running. Reset restores the authored poses and ground.');
   if(pendingGround){const run=pendingGround;pendingGround=null;run();}
  }catch(e){
   if(generation===physicsEpoch){pendingGround=null;notice('Physics did not start: '+e.message);}
  }finally{
   physicsBuilding=false;
   if(!disposed&&!physics&&pendingGround&&generation!==physicsEpoch)void startPhysics();
  }
 }
 function resetPhysics(){pendingGround=null;liftPlane=null;sea.release();physicsEpoch++;playing=false;forceDrag=null;view?.controls&&(view.controls.enabled=true);physics?.dispose();physics=null;fields.read(null);time=0;previewPose=false;$('play').textContent='Play physics';$('physics-status').textContent='Physics is stopped. Authoring poses are preserved.';view?.showForce(null,null);view?.animate(0,false);}
 $('play').onclick=()=>{if(!physics)return startPhysics();playing=!playing;$('play').textContent=playing?'Pause physics':'Resume physics';};
 $('physics-reset').onclick=()=>{resetPhysics();sea.reset();sand.reset();refresh();sync();};$('nudge').onclick=()=>{if(mode==='asset')$('tool').value='nudge';else worldTool='nudge';attach();notice('Drag on an object while physics runs. Drag direction and length set the applied force.');};
 $('time').oninput=()=>{if(physics){playing=false;$('play').textContent='Play physics';}time=Number($('time').value);$('time-label').textContent=time.toFixed(2)+' s';syncDrive();};
 $('key').onclick=()=>{if(mode!=='asset'||!currentPart().joint)return notice('Attach this part to a joint first.');const t=time,drive=readDrive();begin();recordForceKey(currentPart(),t,drive.force,drive.torque);time=t;changed(false);notice('Recorded force / torque key at '+t.toFixed(2)+' s.');};
 $('delete-key').onclick=()=>{const t=time;begin();currentPart().forceKeys=(currentPart().forceKeys||[]).filter(k=>Math.abs(k.time-t)>.015);time=t;changed(false);};
 $('keys').onchange=()=>{if($('keys').value==='')return;time=Number($('keys').value);playing=false;$('play').textContent='Play physics';syncTimeline();syncDrive();};
 $('duration').onchange=()=>{const value=Number($('duration').value);if(!Number.isFinite(value)||value<.1||value>120)return syncTimeline();if(currentAsset().parts.some(p=>[...p.keys,...(p.forceKeys||[])].some(k=>k.time>value))){notice('Remove later pose / force keys before shortening the duration.');return syncTimeline();}begin();currentAsset().duration=value;changed(false);};
 function readDrive(){const d={force:[],torque:[]};document.querySelectorAll('[data-drive]').forEach(e=>d[e.dataset.drive][Number(e.dataset.driveAxis)]=Math.max(-100000,Math.min(100000,Number(e.value)||0)));return d;}
 function syncDrive(){const d=sampleForces(currentPart().forceKeys,time,currentAsset().duration);document.querySelectorAll('[data-drive]').forEach(e=>e.value=Number(d[e.dataset.drive][Number(e.dataset.driveAxis)].toFixed(2)));}
 function mountRetention(p,anchor){
  const local=new THREE.Vector3(...anchor).applyMatrix4(partMatrix(p.transform,p.pivot).invert());
  return anchorRetention(p,library.materials,local.toArray());
 }
 function syncPhysics(){const p=currentPart(),j=p.joint||jointDefaults();options('physics-part',currentAsset().parts,selectedPart);$('fixed').checked=!!p.physics?.fixed;options('joint-parent',[{id:'none',name:'No joint'},{id:'ground',name:'World anchor'},...currentAsset().parts.filter(x=>x.id!==p.id)],p.joint?.parentId||'none');$('joint-type').value=j.type;for(const k of ['looseness','stiffness','damping','extensionStiffness','breakForce'])$('joint-'+k).value=j[k]??jointDefaults()[k];document.querySelectorAll('[data-anchor]').forEach(e=>e.value=j.anchor[Number(e.dataset.anchor)]);document.querySelectorAll('[data-joint-axis]').forEach(e=>e.value=j.axis[Number(e.dataset.jointAxis)]);const support=mountRetention(p,j.anchor);$('joint-parent').disabled=support<1e-4&&!p.joint;$('joint-note').textContent=support<1e-4?'This material cannot hold a joint at this anchor.':`Joint retention: ${(support*100).toFixed(1)}%. Elasticity is a passive rest spring; looseness is its free angular range. Shape contacts use a bounded approximation for carved parts.`;syncDrive();}
 $('physics-part').onchange=()=>{selectedPart=$('physics-part').value;sync();};$('fixed').onchange=()=>{begin();currentPart().physics={fixed:$('fixed').checked};changed(false);};
 function editJoint(change){const p=currentPart(),anchor=change.anchor||p.joint?.anchor||jointDefaults().anchor;if(mountRetention(p,anchor)<1e-4){notice('This material cannot hold a joint.');return syncPhysics();}const target=change.parentId||p.joint?.parentId;if(target&&target!=='ground'&&mountRetention(currentAsset().parts.find(x=>x.id===target),anchor)<1e-4){notice('The other part cannot hold a joint with its current material.');return syncPhysics();}const old=p.joint,next={...(p.joint||jointDefaults()),...change};p.joint=next;try{validateLibrary(library);}catch(e){p.joint=old;notice(e.message);syncPhysics();return;}p.joint=old;begin();p.joint=next;changed(false);}
 $('joint-parent').onchange=()=>{if($('joint-parent').value==='none'){begin();currentPart().joint=null;changed(false);}else editJoint({parentId:$('joint-parent').value,anchor:currentPart().joint?.anchor||[...currentPart().pivot]});};
 $('joint-type').onchange=()=>editJoint({type:$('joint-type').value});for(const k of ['looseness','stiffness','damping','extensionStiffness','breakForce'])$('joint-'+k).onchange=()=>editJoint({[k]:Number($('joint-'+k).value)});
 document.querySelectorAll('[data-anchor]').forEach(e=>e.onchange=()=>{const anchor=[...(currentPart().joint?.anchor||[0,0,0])];anchor[Number(e.dataset.anchor)]=Number(e.value);editJoint({anchor});});
 document.querySelectorAll('[data-joint-axis]').forEach(e=>e.onchange=()=>{const axis=[...(currentPart().joint?.axis||[0,0,1])];axis[Number(e.dataset.jointAxis)]=Number(e.value);editJoint({axis});});$('anchor-pivot').onclick=()=>editJoint({anchor:[...currentPart().pivot]});
 $('gravity').onchange=()=>{const g=Number($('gravity').value);if(!Number.isFinite(g)||g<0||g>30){$('gravity').value=9.81;return;}if(physics)physics.world.gravity={x:0,y:-g,z:0};};

 let strokeEdited=false,strokeSide=null;
 function applyBrush(hit,invert){
  let tool=$('tool').value;
  if(invert&&['add','subtract'].includes(tool))tool=tool==='add'?'subtract':'add';
  const a=currentAsset(),p=currentPart(),r=Number($('radius').value);
  if(!hit||(tool!=='add'&&hit.partId!==p.id)){lastStroke=null;return;}
  const source=hit.partId||'ground';if(source!==strokeSide)lastStroke=null;strokeSide=source;
  const point=hit.point.clone(),height=Number($('aspect').value);
  if(tool==='add')point.addScaledVector(hit.normal,(hit.ground?.9:.15)*r*Math.min(1,height));
  const local=view.localPoint(point,p.id);
  if(local.some(v=>!Number.isFinite(v)||Math.abs(v)>500))return;
  const repeat=strokePattern($),size=[r,Math.max(.025,r*height),r];
  for(const pos of strokePoints(lastStroke,local,r,Number($('stroke-spacing').value))){
   const copies=brushCopies(pos,repeat);
   if(p.stamps.length+copies.length>LIMITS.stamps){notice('Stamp limit reached on this part.');break;}
   if(!strokeEdited){begin();strokeEdited=true;view.controls.enabled=false;}
   for(const c of copies)p.stamps.push(stamp($('shape').value,tool,c.point,size,selectedMaterial,Number($('blend').value)));
   lastStroke=pos;dirty.add(a.id+':'+p.id);
  }
  if(strokeEdited&&!baking)pump();
 }
  const cameraPointers=new Set();
 const canvas=$('canvas');$('impact').oninput=()=>{$('impact-label').value=$('impact').value;};let owner=null,activePointer=null,lastSplash=null,liftPlane=null,pendingGround=null;
 const activeTool=()=>mode==='asset'?$('tool').value:worldTool;
 canvas.addEventListener('pointerdown',e=>{
  if(activePointer!==null){
   if(owner==='camera'&&e.pointerType==='touch'){cameraPointers.add(e.pointerId);return;}
   e.stopImmediatePropagation();return;
  }
  activePointer=e.pointerId;
  owner=(e.button===1||e.button===2||activeTool()==='camera')?'camera':'tool';
  if(owner==='camera')cameraPointers.add(e.pointerId);
  view.controls.mouseButtons.LEFT=owner==='camera'?THREE.MOUSE.ROTATE:null;
  view.controls.enabled=owner==='camera';
  view.gizmo.enabled=owner==='tool'&&!!view.gizmo.object;
  if(owner==='tool'&&!view.gizmo.enabled)canvas.setPointerCapture(e.pointerId);
 },true);
 function groundAction(tool,e){
  const hit=tool==='lift'?view.pick(e):null;
  const point=hit?.point??view.waterHit(view.ray(e));if(!point||tool==='lift'&&hit&&!hit.ground&&!hit.chunk&&hit.bedMaterial!==view.groundSurface.id)return;
  if(tool==='splash'&&lastSplash?.distanceToSquared(point)<.09)return;
  lastSplash=point;
  const force=Number($('impact').value),plane=new THREE.Plane().setFromNormalAndCoplanarPoint(view.camera.getWorldDirection(new THREE.Vector3()),point);
  if(tool==='lift')liftPlane=plane;
  const state={released:false,target:null};groundGesture=state;
  const run=()=>{
   if(mode!=='world'||worldTool!==tool)return;
   const limitNotice=physics?.sandTerrain?'Let airborne sand settle before using the ground tool again.':'Ground preview limit reached. Reset physics to clear it.';
   if(tool==='splash'){
    if(!strikeGround(physics,point,force))notice(limitNotice);
   }else if(view.sea){sea.lift(point.x,point.z);}
   else{
    if(physics.heldChunk?.releaseAt!==undefined&&physics.heldChunk!==hit?.chunk)releaseChunk(physics);
    if(hit?.chunk){physics.heldChunk=hit.chunk;delete hit.chunk.releaseAt;hit.chunk.target.copy(hit.chunk.body.translation());hit.chunk.offset.copy(hit.chunk.target).sub(point);}
    else if(!liftGround(physics,point)){liftPlane=null;notice(limitNotice);return;}
    if(state.target)moveChunk(physics,state.target);
    if(state.released)releaseChunk(physics,true);
   }
  };
  if(physics||view.sea&&tool==='lift'){if(physics&&!playing){playing=true;$('play').textContent='Pause physics';}run();return;}
  pendingGround=run;if(!physicsBuilding)startPhysics();
 }
 let groundGesture=null;
 canvas.addEventListener('pointerdown',e=>{if(owner==='camera'||e.button!==0||view.dragging)return;const tool=activeTool();
 if(tool==='field'){const hit=view.pick(e);if(hit){e.stopImmediatePropagation();void fields.use(hit);}return;}
 if(mode==='world'&&(tool==='lift'||tool==='splash')){e.stopImmediatePropagation();lastSplash=null;groundAction(tool,e);return;}
 if(tool==='nudge'){const hit=view.pick(e);if(!hit||hit.ground)return;if(!physics||!playing){notice('Press Play physics before nudging.');return;}let r=hit.chunk||physics.bodies.get(hit.bodyKey)||physics.get(hit.instanceId,hit.partId);if(r?.structure&&!hit.bodyKey)r=structureBody(r,physics.localPoint(r,hit.point));if(!r&&!hit.loose)return notice('No movable material at this point.');e.stopImmediatePropagation();view.controls.enabled=false;canvas.setPointerCapture(e.pointerId);const normal=view.camera.getWorldDirection(new THREE.Vector3());forceDrag={key:hit.chunk?.key||hit.looseKey||r?.key||hit.instanceId+':'+hit.partId,loose:!!hit.loose,localPoint:hit.loose?hit.point.clone():physics.localPoint(r,hit.point),origin:hit.point.clone(),plane:new THREE.Plane().setFromNormalAndCoplanarPoint(normal,hit.point),force:new THREE.Vector3()};if(hit.mark)forceDrag.hinge=physics.paintedHinges.grab(hit.instanceId+':'+hit.partId,hit.mark.id,hit.point);if(hit.assetId){selectedPart=hit.partId;if(mode==='world'){selectedInstance=hit.instanceId;selectedAsset=hit.assetId;}sync();}return;}if(physics){if(mode==='asset'&&['insert','gaussian','detail','add','subtract','paint'].includes(tool))notice('Reset physics to resume sculpting.');return;}
 if(mode==='asset'&&tool==='insert'){
  e.stopImmediatePropagation();const hit=view.pick(e,{marks:false});
  if(hit&&!hit.ground)assembly.place(hit);else notice('Click the surface of a sculpted part.');
  return;
 }
 if(mode==='asset'&&tool==='gaussian'){
  e.stopImmediatePropagation();view.showBrush(null,1);
  markBrush.start(e,view.pick(e,{marks:false}),currentPart(),library.materials,currentMaterial(),currentAsset().spacing);return;
 }
 if(mode==='asset'&&['sample','detail'].includes(tool)){
  e.stopImmediatePropagation();const hit=view.pick(e);
  if(tool==='sample'){const id=hit?.materialId;if(id){selectedMaterial=id;sync();notice('Sampled '+currentMaterial().name+'.');}return;}
  if(hit?.mark){selectedPart=hit.partId;chooseMark(hit.mark.id);}return;
 }
 if(mode==='asset'&&['add','subtract','paint'].includes(tool)){e.stopImmediatePropagation();view.controls.enabled=false;canvas.setPointerCapture(e.pointerId);stroke=true;strokeEdited=false;strokeSide=null;lastStroke=null;applyBrush(view.pick(e,{marks:false}),e.shiftKey);}else if(['select','translate','rotate','scale'].includes(tool)){
 if(tool!=='select'&&view.gizmo.object){
  view.ray(e);view.gizmo.pointerHover({x:view.pointer.x,y:view.pointer.y,button:e.button});
  if(view.gizmo.axis)return;
 }
 e.stopImmediatePropagation();const hit=view.pick(e);if(hit&&!hit.ground){if(mode==='world'){selectedInstance=hit.instanceId;selectedAsset=hit.assetId;}selectedPart=hit.partId;sync();}}},true);
 canvas.addEventListener('pointermove',e=>{if(owner==='camera'||(activePointer!==null&&e.pointerId!==activePointer))return;
 if(markBrush.pending){markBrush.move(e);return;}
 if(liftPlane){const p=view.ray(e).intersectPlane(liftPlane,new THREE.Vector3());if(p){if(view.sea)sea.moveLift(p,physics?.collideDrop??authoredWater.collideDrop);else{groundGesture.target=p;if(physics)moveChunk(physics,p);}}return;}
 if(owner==='tool'&&activeTool()==='splash'&&mode==='world'){groundAction('splash',e);return;}if(forceDrag&&physics){const point=view.ray(e).intersectPlane(forceDrag.plane,new THREE.Vector3());if(point){forceDrag.force.copy(point).sub(forceDrag.origin).multiplyScalar(Math.max(1,Math.min(100000,Number($('force-strength').value)||1))).clampLength(0,100000);if(forceDrag.hinge)forceDrag.hinge.cursorForce.copy(forceDrag.force);else physics.setDrag(physics.drag?.key??forceDrag.key,forceDrag.localPoint,forceDrag.force,forceDrag.loose);view.showForce(forceDrag.origin,point);notice('Applied force: '+forceDrag.force.length().toFixed(0)+' N');}return;}if(physics)return;const tool=$('tool').value;if(mode==='asset'&&['add','subtract','paint'].includes(tool)){const hit=view.pick(e,{marks:false});view.showBrush(hit,Number($('radius').value));if(stroke)applyBrush(hit,e.shiftKey);}else view.showBrush(null,1);});
 const endStroke=e=>{if(owner==='camera'){
  if(e.type==='blur')cameraPointers.clear();else cameraPointers.delete(e.pointerId);
  if(cameraPointers.size){activePointer=cameraPointers.values().next().value;return;}
  activePointer=e.pointerId??activePointer;
 }
 if(activePointer===null||(e.pointerId!=null&&e.pointerId!==activePointer))return;
 activePointer=null;lastSplash=null;owner=null;if(e.type!=='pointerup'&&view.gizmo.dragging)view.gizmo.pointerUp(null);if(liftPlane){if(groundGesture)groundGesture.released=true;if(view.sea)sea.release();else if(physics)releaseChunk(physics,true);liftPlane=null;}
 queueMicrotask(()=>{if(activePointer===null){view.controls.enabled=true;view.gizmo.enabled=true;}});
 if(markBrush.pending){
  if(e.type==='pointerup')markBrush.move(e);
  if(markBrush.finish(e.type==='pointerup',begin)){changedMarks();view.showBrush(null,1);}
  return;
 }
 if(forceDrag){if(forceDrag.hinge&&physics)forceDrag.hinge.until=physics.time+(e.type==='pointerup'?Math.max(0,Math.min(5,Number($('force-duration').value)||0)):0);else if(physics&&e.type==='pointerup')physics.addPulse(physics.drag?.key??forceDrag.key,forceDrag.localPoint,forceDrag.force,Number($('force-duration').value)||0,forceDrag.loose);physics?.clearDrag();view.showForce(null,null);forceDrag=null;view.controls.enabled=true;}if(!stroke)return;stroke=false;lastStroke=null;view.controls.enabled=true;if(strokeEdited){pump();changed(false);}strokeEdited=false;};canvas.addEventListener('pointerup',endStroke);canvas.addEventListener('pointercancel',endStroke);canvas.addEventListener('lostpointercapture',endStroke);window.addEventListener('blur',endStroke);canvas.addEventListener('pointerleave',()=>{if(!stroke)view.showBrush(null,1);});
 window.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName))return;if(mode==='asset'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
   if(e.key==='Escape'&&$('tool').value==='insert'){setBrush('select');return;}
   if(e.key==='Escape'&&markBrush.pending){markBrush.finish(false);return;}
   if(activePointer===null&&/^[1-6]$/.test(e.key)){setBrush($('brush-bar').children[Number(e.key)-1].dataset.brush);return;}
   if(e.key==='['||e.key===']'){
    const input=$($('tool').value==='gaussian'?'mark-length':'radius');
    input.value=Math.min(Number(input.max),Math.max(Number(input.min),Number(input.value)*(e.key===']'?1.2:1/1.2)));input.oninput();return;
   }
  }
  if(e.key.toLowerCase()==='f')$('frame').click();if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();e.shiftKey?$('redo').click():$('undo').click();}});
 $('validate').onclick=async()=>{if(baking)return notice('Wait for the current sculpt bake to finish.');$('validate').disabled=true;validating=true;try{if(!baker.gpu)await baker.init();else baker.validation=await baker.gpu.validate();$('validation').textContent=JSON.stringify(baker.validation,null,2);}catch(e){notice(e.message);}finally{$('validate').disabled=false;validating=false;pump();}};
 refresh();sync();view.frameWorld(library);notice(loaded.message);boot.mark('Preparing isolated studio sculpt backend');if(cpuOnly){$('gpu').checked=false;$('gpu').disabled=true;}else await baker.init();$('validation').textContent=JSON.stringify(baker.validation,null,2);ensureVisible();
 let last=performance.now(),lastDraw=0,rateAt=last,frames=0;
 function tick(now){if(disposed||stop)return;frame=requestAnimationFrame(tick);if(now-lastDraw<1000/60-.3)return;lastDraw=now;const dt=Math.min(.1,(now-last)/1000);last=now;if(physics){physics.motorEnabled=$('motors').checked;try{if(playing){const elapsed=physics.advance(dt);simulationTotal+=elapsed;}view.applyPhysics(physics);}catch(e){playing=false;notice(e.message);}$('physics-status').textContent=`CPU · Rapier WASM · ${physics.bodies.size} bodies / ${physics.matter.count} loose parcels / ${physics.joints.length} body joints (${physics.broken} broken) / ${physics.structures.reduce((n,s)=>n+s.brokenBonds,0)} broken bonds / ${physics.structures.reduce((n,s)=>n+Math.max(0,s.bodies.size-1),0)} separated pieces / ${physics.colliderCount} colliders · ${physics.paintedHinges.count} painted hinges${physics.matter.meltedMass?' · '+physics.matter.meltedMass.toFixed(2)+' kg melted':''}\n${physics.time.toFixed(2)} s simulated · ${physics.lastStepMs.toFixed(2)} ms last step\nCarved proxy spacing ≤ ${physics.maxProxySpacing.toFixed(3)} m`;if(playing){time=physics.time%currentAsset().duration;$('time').value=time;$('time-label').textContent=time.toFixed(2)+' s';}}else {view.animate(0,false);if(view.sea){authoredWater.advance(sea);sea.advance(dt,authoredWater.collideDrop);}if(view.sand){sandTime+=dt;view.sand.advance(dt,windAt(wind(),sandTime),view.groundSurface)};}try{view.draw();}catch(e){stop=true;cancelAnimationFrame(frame);notice(e.message);return;}frames++;if(now-rateAt>1000){fields.read(physics);$('rates').textContent=`${(frames*1000/(now-rateAt)).toFixed(1)} FPS · ${mode==='asset'?'Asset editor':'World preview'} · ${Math.min(1,simulationTotal*1000/(now-rateAt)).toFixed(2)}× physics · ${view.gaussianCount} surface splats · ${view.paintView.batches.reduce((n,b)=>n+b.rows.length,0)} painted details · ${view.implicitCount} implicit parts${baking?' · rebuilding surface':''}`;frames=0;simulationTotal=0;rateAt=now;}}
 frame=requestAnimationFrame(tick);boot.finish();
 // Diagnostics are read-only; numerical oracle is also available from the UI.
 window.__assetStudio={get diagnostics(){return {test:test.id,mode,assets:library.assets.length,materials:library.materials.length,placements:library.world.instances.length,implicit:view.implicitCount,water:!!view.sea,waterTime:view.sea?.time,drops:view.sea?.drops.length,wind:wind(),camera:view.camera.position.toArray(),baking,backend:baker.backend,validation:baker.validation,graphicsLost:!!view.failed,splats:[...view.surfaces.values()].reduce((n,s)=>n+s.positions.length/3,0),bakeMs,physics:physics?.diagnostics()||null,physicsBuilding};}};
 window.addEventListener('pagehide',()=>{disposed=true;cancelAnimationFrame(frame);clearTimeout(saveTimer);physics?.dispose();baker.dispose();view.dispose();},{once:true});
}
