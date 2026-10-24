// These dependencies describe execution paths, not mutually exclusive quality levels.
export const OPTIMIZATION_DEPENDENCIES={nativeSandContacts:['batchedContacts'],batchedContacts:['nativeContacts','terrainCache'],adaptivePressure:['batchedContacts'],distantOptics:['distanceDetail'],windBatch:['windGeometry'],nativeNeighbors:['packedNeighbors','neighborBounds'],emitterProbes:['gpuBatch'],neighborBounds:['packedNeighbors']};
const labels={gpuPressure:'GPU pressure when measured faster',nativeSandContacts:'Compiled carved-sand water contacts',viewPassCulling:"Skip unused underwater view",batchedContacts:'Batch water contact arithmetic',adaptivePressure:'Focus pressure work on unsettled water',distantOptics:'Stronger gradual distant water detail',nativeContacts:'Compiled CPU water contacts',interiorCompression:'Compress quiet water interiors',distanceDetail:'Gradual distant drawing detail',surfaceLightReuse:'Reuse surface illumination',packedGpuNeighbors:'Packed GPU neighbor reads',windBatch:'Batch moving-sand wind queries',nativeNeighbors:'Compiled CPU neighbor search',
 mergeWindDeposits:'Merge small wind deposits',settlingIndex:'Local settling queries',patchFloor:'Limit sub-resolution subdivision',
 predictBudget:'Predict physics step cost',fastHeight:'Fast terrain height sampling',windGeometry:'Reuse wind geometry queries',
 fastEmission:'Fast spray emission',terrainCache:'Cache terrain heights',sandPrograms:'Specialize shaders',stressPruning:'Skip redundant stress queries',
 fastPredict:'Fast water prediction',emitterProbes:'GPU spray probes',packedFlow:'Packed flow fields',packedFields:'Packed water fields',
 neighborBounds:'Neighbor-cell filtering',boundaryReuse:'Reuse boundary gradients',fastSampling:'Fast water sampling',sandQueryBounds:'Bound sand queries',
 compactSand:'Compact visible sand',blobDepth:'Skip hidden water blobs',gpuBatch:'Batched GPU readback',packedNeighbors:'Packed neighbor lists',
 broadphase:'Local collision queries',sandCache:'Cache sand geometry',emptySpace:'Skip empty space',splatBounds:'Tight Gaussian bounds',lightingTiles:'Tiled lighting'
};
const previous=new Set(['gpuBatch','packedNeighbors','broadphase','sandCache','emptySpace','splatBounds','lightingTiles']);
export function optimizationPreset(defaults,mode){return Object.fromEntries(Object.keys(defaults).map(k=>[k,mode==='all'?defaults[k]:mode==='baseline'&&previous.has(k)]));}
export function effectiveOptimizations(selected){
 const flags={...selected};let changed;
 do{changed=false;for(const [key,deps] of Object.entries(OPTIMIZATION_DEPENDENCIES))if(flags[key]&&!deps.every(k=>flags[k])){flags[key]=false;changed=true;}}while(changed);
 return flags;
}
export function optimizationMode(flags,defaults){for(const mode of ['all','baseline','reference']){const preset=optimizationPreset(defaults,mode);if(Object.keys(defaults).every(k=>flags[k]===preset[k]))return mode;}return 'custom';}
export const optimizationModeLabel=mode=>({all:'All optimizations',baseline:'Before this performance pass',reference:'Reference paths',custom:'Custom optimizations'})[mode];

// Changing a query representation must also invalidate live CPU indices, even
// while paused: picking, hovering and player contacts can sample them immediately.
export function applyOptimizationFlags(lab,draw,flags){
 Object.assign(lab.optimizations,effectiveOptimizations(flags));
 lab.gpu.neighborOrigin=null;lab.fluidIndex=null;lab.emitterSamples=null;lab.sandWind=null;lab.stepCostEstimate=0;
 lab.sandRevision=-1;draw.densityRevision=-1;draw.drawKey=null;draw.detailRenderer.pathsKey=null;
 draw.mediumShadows.key=null;draw.mediumShadows.tiles.key=null;lab.revision++;
}

export function installOptimizationControls(panel,defaults,onChange){
 const group=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Optimizations';group.append(legend);group.id='optimization-controls';panel.append(group);
 let selected={...defaults};const rows=new Map();
 const masterLabel=document.createElement('label'),master=document.createElement('input');master.type='checkbox';masterLabel.append(master,' All optimizations');group.append(masterLabel);
 const count=document.createElement('small');count.setAttribute('aria-live','polite');group.append(count);
 for(const key of Object.keys(defaults)){
  const row=document.createElement('div'),label=document.createElement('label'),input=document.createElement('input'),reason=document.createElement('small');
  input.type='checkbox';input.id=`optimization-${key}`;label.title=key;label.append(input,` ${labels[key]||key}`);
  reason.id=`optimization-${key}-reason`;input.setAttribute('aria-describedby',reason.id);reason.hidden=true;row.append(label,reason);group.append(row);rows.set(key,{row,input,reason});
  input.onchange=()=>{selected[key]=input.checked;sync();onChange(effectiveOptimizations(selected));};
 }
 function sync(){
  const flags=effectiveOptimizations(selected),n=Object.values(flags).filter(Boolean).length,total=Object.keys(defaults).length;
  master.checked=n===total;master.indeterminate=n>0&&n<total;count.textContent=`${n} of ${total} enabled`;
  for(const [key,{row,input,reason}] of rows){const missing=(OPTIMIZATION_DEPENDENCIES[key]||[]).filter(k=>!flags[k]);input.checked=flags[key];input.disabled=!!missing.length;row.classList.toggle('unavailable',!!missing.length);reason.hidden=!missing.length;reason.textContent=missing.length?`Requires ${missing.map(k=>labels[k]||k).join(' and ')}.`:'';}
 }
 master.onchange=()=>{selected=optimizationPreset(defaults,master.checked?'all':'reference');sync();onChange(effectiveOptimizations(selected));};
 const baseline=document.createElement('button');baseline.textContent='Before performance pass';baseline.onclick=()=>{selected=optimizationPreset(defaults,'baseline');sync();onChange(effectiveOptimizations(selected));};group.append(baseline);
 sync();return {get selection(){return {...selected};},get flags(){return effectiveOptimizations(selected);},setSelection(flags){selected={...flags};sync();},setBusy(busy){group.disabled=busy;}};
}
