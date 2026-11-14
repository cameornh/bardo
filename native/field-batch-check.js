import {runNative} from './runtime.js';
import {installFieldBatch,setBatchKernel} from '../.native/generated/field-batch.mjs';
// Full native renderer, one pending frame, 24 fixed physics steps. Every
// deposition is checked against a separate, unmodified JavaScript grid.
const dir='.native/field-batch';await Deno.mkdir(dir,{recursive:true});
await runNative({width:640,height:400,resolution:1.4,backend:'safe',headless:true,frames:0,exit:true,report:dir+'/parity-runtime.json',onReady:async({app,reports,capture,shutdown})=>{
 const {lab,draw,renderer,field}=app;lab.paused=true;lab.qaRunning=true;await app.waitForSceneIdle();
 await setBatchKernel(await Deno.readFile('src/rtx-sand-lab/fields/batch/grid.wasm'));installFieldBatch(lab);
 draw.fixedLoadScale=.5;lab.wind=12;lab.tidesEnabled=false;lab.lunarCycle=false;lab.rain.enabled=true;lab.rain.rate=120;lab.day=14;lab.tannins=.8;
 lab.objectRadius=.2;lab.spawn('glass',[0,2.5,2],[0,0,-1],'sphere');lab.spawn('rock',[1,2.5,2],[0,0,-1],'cup');lab.sand.carve([0,lab.sand.height(0,3),3],.3);lab.syncUniforms();draw.drawKey=null;
 const result={pass:false,steps:0,comparisons:0,maximumStateError:0,frozenImageError:null};
 const equal=(a,b,label)=>{if(a.length!==b.length)throw Error(label+' length');for(let i=0;i<a.length;i++)if(a[i]!==b[i])throw Error(`${label}[${i}]: ${a[i]} != ${b[i]}`);};
 const fields=lab.bulkFields,prepare=fields.prepare.bind(fields);
 fields.prepare=context=>{
  fields.ensure();const g=fields.grid,reference=new g.constructor({dims:g.dims,h:g.h,origin:g.origin,extent:[11,6,9.8].map(v=>v*lab.spec.scale)});
  reference.setPhase(g.phase);reference.temperature.set(g.temperature);reference.humidity.set(g.humidity);reference.ledger={...g.ledger};for(let k=0;k<3;k++)reference.faces[k].velocity.set(g.faces[k].velocity);
  const rhs=prepare(context),environment=fields.environment(),expected=reference.deposit(context.old,context.predicted,context.dt,lab.spec.scale,lab.spacing,environment.solid,environment.wind,environment.wall);
  equal(rhs,expected,'rhs');equal(g.phase,reference.phase,'phase');equal(g.temperature,reference.temperature,'temperature');equal(g.humidity,reference.humidity,'humidity');
  for(let k=0;k<3;k++)for(const key of ['velocity','before','coefficient'])equal(g.faces[k][key],reference.faces[k][key],key);result.comparisons++;return rhs;
 };
 const sample=async()=>{draw.render({dt:0,adaptive:false});await renderer.flush();renderer.assertHealthy();const t=field.target,pixels=new Float32Array(t.width*t.height*4);await renderer.readRenderTargetPixelsAsync(t,0,0,t.width,t.height,pixels);return pixels;};
 try{
  await sample();lab.optimizations.fieldBatch=false;const before=await sample();lab.optimizations.fieldBatch=true;const after=await sample();equal(after,before,'frozen image');result.frozenImageError=0;await capture(dir+'/frozen.png');
  for(let i=0;i<24;i++){lab.step(lab.timestep);await sample();result.steps++;}await capture(dir+'/playback.png');result.pass=true;result.backend=lab.bulkFields.stats.backend;result.batchBytes=fields.grid.faceBatch.bytes;
 }catch(error){result.error=String(error.stack||error);}
 await Deno.writeTextFile(dir+'/parity.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await shutdown();Deno.exit(result.pass?0:1);
}});
