import {runNative} from './runtime.js';
import {installEmptySpace} from '../.native/generated/empty-space.mjs';
const mode=Deno.args[0]||'reject';if(!['reject','advance','secondary'].includes(mode))throw Error('Unknown empty-space check');
const advance=mode!=='reject',out='.native/empty-space/'+mode;await Deno.mkdir(out,{recursive:true});
await runNative({width:640,height:400,resolution:1,backend:'safe',headless:true,exit:true,report:out+'/check-runtime.json',onReady:async({app,capture,shutdown})=>{
 const {lab,draw,renderer,camera,field}=app;lab.qaRunning=true;lab.paused=true;await app.waitForSceneIdle();draw.fixedLoadScale=.5;
 const report={images:[],backend:'native wgpu / CPU physics',contextLost:false};
 const experiment=await installEmptySpace(draw,{advance,primary:mode!=='secondary',quick:mode==='secondary'});
 for(const job of experiment.jobs()){console.log('Preparing '+job.name);renderer.setRenderTarget(job.target);await renderer.compileAsync(job.scene,job.camera);renderer.assertHealthy();}
 lab.configure('ocean');lab.day=14;lab.wind=0;lab.tidesEnabled=false;lab.lunarCycle=false;lab.rain.enabled=false;document.getElementById('home').click();
 async function sample(enabled){experiment.enabled=enabled;draw.drawKey=null;draw.render({dt:0,adaptive:false});await renderer.flush();const t=field.target,a=new Float32Array(t.width*t.height*4);await renderer.readRenderTargetPixelsAsync(t,0,0,t.width,t.height,a);renderer.assertHealthy();return a;}
 async function compare(label){
 if(lab.detail.count){const detail=lab.detail;camera.updateMatrixWorld();const m=camera.matrixWorld.elements;for(let i=0;i<4096;i+=11){const o=i*4;detail.fallback[0].image.data.set([camera.position.x-m[8]*1.2+m[0]*((i%17)-8)*.03,camera.position.y-m[9]*1.2+m[5]*((i%13)-6)*.03,camera.position.z-m[10]*1.2+m[2]*((i%17)-8)*.03,.3],o);}detail.fallback[0].needsUpdate=true;draw.detailRenderer.pathsKey=null;}
 await sample(false);const a=await sample(false),again=await sample(false),b=await sample(true);let sum=0,max=0,bad=0,changed=0,self=0;for(let i=0;i<a.length;i++){if(i%4===3)continue;const e=Math.abs(again[i]-b[i]);if(!Number.isFinite(e))bad++;sum+=e;max=Math.max(max,e);self+=Math.abs(a[i]-again[i]);if(e>.01)changed++;}
  const row={label,boundsUpdates:experiment.updates,detail:{enabled:lab.detail.enabled,count:lab.detail.count,span:lab.detail.activeSpan,source:Array.from(draw.detailRenderer.material.uniforms.uDetailP.value.image?.data?.slice(0,4)||[]),velocity:Array.from(draw.detailRenderer.material.uniforms.uDetailV.value.image?.data?.slice(0,4)||[])},referenceRepeatMean:self/(a.length*.75),meanAbsoluteRGB:sum/(a.length*.75),maxAbsoluteRGB:max,componentsOver001:changed,nonfinite:bad,size:[field.target.width,field.target.height]};report.images.push(row);await capture(out+'/'+label+'-bounded.png');await sample(false);await capture(out+'/'+label+'-reference.png');console.log(JSON.stringify(row));await Deno.writeTextFile(out+'/check.json',JSON.stringify(report,null,2));if(bad)throw Error('Nonfinite rendered output');}
 await compare('beach');
 lab.sand.carve([0,lab.sand.height(0,3),3],.3);const pieces=lab.sand.extract([1,lab.sand.height(1,3),3],.25,[0,0,0],true);for(const p of pieces){p.position[1]+=.25;p.held=false;}
 for(const [i,kind] of ['glass','mirror','rock','light'].entries()){lab.objectRadius=.2;const body=lab.spawn(kind,[-1.5+i,2.3,2],[0,0,-1],i%2?'cup':'sphere');body.position=[-1.5+i,2.3,2];body.velocity.fill(0);}lab.syncUniforms();lab.revision++;
 await compare('carves-objects');
 const sea=lab.seaFoam;sea.generation(lab);sea.surface.update(lab);sea.surfaceTexture.needsUpdate=true;lab.tannins=1.2;
 for(let i=0;i<sea.size*sea.size;i++){const o=i*4,x=i%sea.size,z=Math.floor(i/sea.size),wet=sea.surface.surface[o]>sea.surface.surface[o+1];sea.reference[o+(wet?0:1)]=(Math.sin(x*.33+z*.12)>.3&&z>34)?.4:0;}
 sea.zero.image.data=sea.reference;sea.zero.needsUpdate=true;sea.u.uSeaState.value=sea.zero;sea.active=true;sea.revision++;
 // Keep small particles visible while comparing their underlying surfaces.
 const grains=draw.sandGrains;grains.emitted=200;grains.until=100;
 for(let i=0;i<grains.capacity;i++){const o=i*4;if(i%37===0){grains.p.set([-2+(i%80)*.05,3.0+(i%7)*.1,1.8+(i%31)*.02,.7],o);grains.v.set([.1,.2,0,1],o);grains.info.set([.1,1,.1,2650],o);}}
 grains.inputP.needsUpdate=grains.inputV.needsUpdate=grains.infoTexture.needsUpdate=true;grains.u.uGrainP.value=grains.inputP;grains.u.uGrainV.value=grains.inputV;
 const detail=lab.detail;detail.count=512;detail.activeSpan=4096;detail.emitted=512;
 for(let i=0;i<4096;i++){const o=i*4;if(i%11===0){detail.fallback[0].image.data.set([-2+(i%80)*.05,3.0+(i%7)*.1,1.8+(i%31)*.02,.3],o);detail.fallback[1].image.data.set([0,.2,0,1],o);detail.fallback[2].image.data.set([.015,1,.25,0],o);}}
 for(const t of detail.fallback)t.needsUpdate=true;detail.bind(detail.fallback);draw.detailRenderer.pathsKey=null;
 await compare('foam-grains');await compare('combined');
 // Bounded camera sweep checks freshly prepared records and terrain normals
 // at several angles, rather than only a single favorable frozen view.
 for(let i=0;i<4;i++){camera.position.set(3.8-i*.7,2.5-i*.2,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();await compare('camera-'+i);}
 camera.position.set(0,.6,0);camera.lookAt(0,1.2,-2);camera.updateMatrixWorld();await compare('underwater');
 lab.day=23;camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();lab.syncUniforms();await compare('night');
 camera.position.set(0,4,0);camera.lookAt(0,5,-1);camera.updateMatrixWorld();await compare('sky');
 lab.scaleMultipliers.ocean=1.5;lab.configure('ocean',1.5);lab.day=14;lab.syncUniforms();camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();await compare('larger-reset');
 report.contextLost=!!renderer.failure;report.pass=!report.contextLost&&report.images.every(c=>!c.nonfinite&&c.meanAbsoluteRGB<.002);report.allocationMiB=renderer.allocationBytes/1048576;
 await Deno.writeTextFile(out+'/check.json',JSON.stringify(report,null,2));await shutdown();Deno.exit(report.pass?0:1);
}});
