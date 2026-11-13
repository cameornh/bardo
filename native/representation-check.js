import {runNative} from './runtime.js';
import {installRepresentations,terrainCoefficients} from '../.native/generated/representation.mjs';
const lighting=Deno.args.includes('lighting'),foamOnly=Deno.args.includes('foam-only'),out=foamOnly?'.native/representation/foam-only':lighting?'.native/representation/lighting':'.native/representation';await Deno.mkdir(out,{recursive:true});
await runNative({width:640,height:400,resolution:1,backend:'safe',headless:true,exit:true,report:out+'/check-runtime.json',onReady:async({app,capture,shutdown})=>{
 const {lab,draw,renderer,camera,field}=app;lab.qaRunning=true;lab.paused=true;await app.waitForSceneIdle();draw.fixedLoadScale=.5;
 const report={checks:[],images:[],backend:'native wgpu / CPU physics',contextLost:false};
 const experiment=installRepresentations(draw,{foamLighting:lighting});Object.assign(lab.optimizations,{terrainPolynomial:true,foamGeometryCache:true});
 // Compile one changed program at a time. No simulation is submitted here.
 const jobs=[...experiment.jobs(),...[...draw.splitSurfaces.values()].flatMap(split=>split.jobs(draw.background))];
 for(const job of jobs){console.log('Preparing '+job.name);renderer.setRenderTarget(job.target);await renderer.compileAsync(job.scene,job.camera);renderer.assertHealthy();}
 async function coefficients(label){
  experiment.terrain.update();await renderer.flush();const t=experiment.terrain.target,a=new Float32Array(t.width*t.height*4);await renderer.readRenderTargetPixelsAsync(t,0,0,t.width,t.height,a);
  let max=0;const n=lab.sand.n;for(let z=0;z<n;z++)for(let x=0;x<n;x++){const ref=terrainCoefficients(lab.sand.data,n,x,z);for(let c=0;c<4;c++)for(let k=0;k<4;k++)max=Math.max(max,Math.abs(a[(z*n*4+x*4+c)*4+k]-ref[c][k]));}
  const result={label,maxError:max,pass:Number.isFinite(max)&&max<2e-6,stats:{...experiment.terrain.stats}};report.checks.push(result);if(!result.pass)throw Error('Terrain coefficients differ: '+JSON.stringify(result));
 }
 await coefficients('initial ground');lab.sand.mass[16*lab.sand.n+16]*=.7;lab.sand.update();await coefficients('local edit with cubic halo');
 lab.sand.wet.fill(.8);lab.sand.update();await coefficients('wetness-only change');
 const unchanged=experiment.terrain.stats.updates;camera.position.x+=.2;experiment.terrain.update();if(experiment.terrain.stats.updates!==unchanged)throw Error('Camera rebuilt terrain');
 lab.configure('ocean');lab.day=14;lab.wind=0;lab.tidesEnabled=false;lab.lunarCycle=false;lab.rain.enabled=false;document.getElementById('home').click();
 async function sample(terrain,foam){Object.assign(lab.optimizations,{terrainPolynomial:terrain,foamGeometryCache:foam});draw.drawKey=null;draw.render({dt:0,adaptive:false});await renderer.flush();const t=field.target,a=new Float32Array(t.width*t.height*4);await renderer.readRenderTargetPixelsAsync(t,0,0,t.width,t.height,a);renderer.assertHealthy();return a;}
 async function compare(label,terrain,foam){terrain=terrain&&!foamOnly;await sample(false,false);const a=await sample(false,false),again=await sample(false,false),b=await sample(terrain,foam);let sum=0,max=0,bad=0,changed=0,self=0;for(let i=0;i<a.length;i++){if(i%4===3)continue;const e=Math.abs(again[i]-b[i]);if(!Number.isFinite(e))bad++;sum+=e;max=Math.max(max,e);self+=Math.abs(a[i]-again[i]);if(e>.01)changed++;}
  const row={label,terrain,foam,referenceRepeatMean:self/(a.length*.75),meanAbsoluteRGB:sum/(a.length*.75),maxAbsoluteRGB:max,componentsOver001:changed,nonfinite:bad,size:[field.target.width,field.target.height]};report.images.push(row);await capture(out+'/'+label+'-cached.png');await sample(false,false);await capture(out+'/'+label+'-reference.png');console.log(JSON.stringify(row));await Deno.writeTextFile(out+'/check.json',JSON.stringify(report,null,2));if(bad)throw Error('Nonfinite rendered output');}
 await compare('beach',true,false);
 lab.sand.carve([0,lab.sand.height(0,3),3],.3);const pieces=lab.sand.extract([1,lab.sand.height(1,3),3],.25,[0,0,0],true);for(const p of pieces){p.position[1]+=.25;p.held=false;}
 for(const [i,kind] of ['glass','mirror','rock','light'].entries()){lab.objectRadius=.2;const body=lab.spawn(kind,[-1.5+i,2.3,2],[0,0,-1],i%2?'cup':'sphere');body.position=[-1.5+i,2.3,2];body.velocity.fill(0);}lab.syncUniforms();lab.revision++;
 await compare('carves-objects',true,false);
 const sea=lab.seaFoam;sea.generation(lab);sea.surface.update(lab);sea.surfaceTexture.needsUpdate=true;lab.tannins=1.2;
 for(let i=0;i<sea.size*sea.size;i++){const o=i*4,x=i%sea.size,z=Math.floor(i/sea.size),wet=sea.surface.surface[o]>sea.surface.surface[o+1];sea.reference[o+(wet?0:1)]=(Math.sin(x*.33+z*.12)>.3&&z>34)?.4:0;}
 sea.zero.image.data=sea.reference;sea.zero.needsUpdate=true;sea.u.uSeaState.value=sea.zero;sea.active=true;sea.revision++;
 await compare('foam',false,true);await compare('combined',true,true);
 // Bounded camera sweep checks freshly prepared records and terrain normals
 // at several angles, rather than only a single favorable frozen view.
 for(let i=0;i<4;i++){camera.position.set(3.8-i*.7,2.5-i*.2,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();await compare('camera-'+i,true,true);}
 camera.position.set(0,.6,0);camera.lookAt(0,1.2,-2);camera.updateMatrixWorld();await compare('underwater',true,true);
 lab.day=23;camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();lab.syncUniforms();await compare('night',true,true);
 report.contextLost=!!renderer.failure;report.pass=!report.contextLost&&report.checks.every(c=>c.pass)&&report.images.every(c=>!c.nonfinite&&c.meanAbsoluteRGB<.002);report.allocationMiB=renderer.allocationBytes/1048576;
 await Deno.writeTextFile(out+'/check.json',JSON.stringify(report,null,2));await shutdown();Deno.exit(report.pass?0:1);
}});
