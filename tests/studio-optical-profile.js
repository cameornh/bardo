// Fixed pose, identical camera and render size. Report the time to submit work,
// separately from completed-frame wall time (which includes browser scheduling).
export async function opticalProfile(view,submit,drain,next){
 const r=view.renderer,original=r.render,shadows=view.lampShadows,update=shadows.update;
 const rows=[];
 let skip='',counts={},cpu={};
 r.render=function(scene,camera){
  const group=this.getRenderTarget()===shadows.atlas?'lamp shadows':camera.layers.mask===2?'optical surfaces':
   scene===view.oceanView.capture.copyScene?'copy':scene===view.scene?'ground and world':'other';
  counts[group]=(counts[group]??0)+1;
  if(group!==skip&&skip!=='draws'){
   const t=performance.now();original.call(this,scene,camera);cpu[group]=(cpu[group]??0)+performance.now()-t;
  }
 };
 shadows.update=function(...args){if(skip!=='whole shadow pass')return update.apply(this,args);};
 try{
  for(const label of ['none','whole shadow pass','draws','idle']){
   skip=label;counts={};cpu={};
   const start=performance.now();let cpuFrame=0;
   for(let i=0;i<8;i++){
    await next();view.shadowRevision++;
    if(label!=='idle')cpuFrame+=await submit();
   }
   await drain();
   rows.push({omit:label,wallMs:+((performance.now()-start)/8).toFixed(1),submitMs:+(cpuFrame/8).toFixed(1),calls:counts,drawMs:Object.fromEntries(Object.entries(cpu).map(([k,v])=>[k,+(v/8).toFixed(1)]))});
  }
 }finally{r.render=original;shadows.update=update;}
 return rows;
}
