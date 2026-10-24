// Compare the live settled scene at the same camera and drawing resolution.
// Ignore pixels where the new object actually occludes the distant terrain.
export function installHorizonAudit({lab,draw,renderer,camera,panel,output}){
 const button=document.createElement('button');button.textContent='Check object horizon';panel.append(button);
 button.onclick=async()=>{
  lab.paused=true;const balls=lab.balls.slice(),position=camera.position.toArray(),direction=camera.getWorldDirection(camera.position.clone()).toArray(),adaptive=draw.adaptiveResolution,fixed=draw.fixedLoadScale;
  draw.fixedLoadScale=draw.loadScale;draw.adaptiveResolution=false;
  const read=()=>{const t=draw.background,p=new Float32Array(t.width*t.height*4);renderer.readRenderTargetPixels(t,0,0,t.width,t.height,p);return p;};
  try{
   output.textContent='Comparing the horizon before and after spawning each material…';await draw.objectProgramsReady;
   lab.balls=[];lab.revision++;draw.render({dt:0,adaptive:false});const before=read(),records={};
   for(const kind of ['glass','mirror','rock','light']){
    lab.balls=[];lab.spawn(kind,position,direction);lab.revision++;draw.render({dt:0,adaptive:false});const after=read();let max=0,changed=0,n=0;
    for(let i=0;i<after.length;i+=4)if(before[i+3]>15&&before[i+3]<9999&&Math.abs(after[i+3]-before[i+3])<.01){const delta=Math.max(...[0,1,2].map(k=>Math.abs(before[i+k]-after[i+k])));max=Math.max(max,delta);if(delta>.002)changed++;n++;}
    records[kind]={max,changed,pixels:n};await new Promise(resolve=>setTimeout(resolve,0));
   }
   output.textContent=JSON.stringify({resolution:[draw.background.width,draw.background.height],records,pass:['glass','mirror','rock'].every(k=>records[k].pixels>0&&records[k].max<.002)},null,2);
  }catch(e){output.textContent=e.stack;}finally{lab.balls=balls;lab.revision++;draw.adaptiveResolution=adaptive;draw.fixedLoadScale=fixed;}
 };
}
