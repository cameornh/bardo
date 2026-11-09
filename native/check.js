import {runNative} from './runtime.js';
const output='.native/check';await Deno.mkdir(output,{recursive:true});
function assert(value,message){if(!value)throw Error(message);}
const report={checks:[]};
await runNative({width:640,height:400,resolution:1,backend:'gpu',headless:Deno.args.includes('--headless'),report:output+'/runtime.json',exit:true,onReady:async({app,dom,ui,capture,shutdown,reports})=>{
 const {lab,draw,renderer,camera,controls,field}=app,$=id=>document.getElementById(id);lab.paused=true;lab.qaRunning=true;await app.waitForSceneIdle();
 const validation=JSON.parse($('verification').textContent);report.validation=validation;assert(validation.validation.pass,'Native GPU/CPU numerical check failed');
 async function frame(name){draw.render({dt:lab.timestep,adaptive:false});await renderer.flush();const t=field.target,a=new Float32Array(t.width*t.height*4);await renderer.readRenderTargetPixelsAsync(t,0,0,t.width,t.height,a);assert(a.every(Number.isFinite),'Non-finite '+name);let rgb=0;for(let i=0;i<a.length;i+=4)rgb+=a[i]+a[i+1]+a[i+2];const meanRGB=rgb/(t.width*t.height*3);if(name==='beach'||name==='underwater-day')assert(meanRGB>1e-4,'Unexpected black image '+name);report.checks.push({name,water:lab.count,objects:lab.balls.length,finite:true,meanRGB,size:[t.width,t.height]});if(name)await capture(output+'/'+name+'.png');}
 async function step(){const ctx=lab.prepareStep(lab.timestep),next=await lab.bulkFields.solveAsync(ctx);assert(lab.bulkFields.particleBackend==='connected','Unexpected CPU fallback');lab.finishStep(ctx,next);}
 await frame('beach');
 const panel=$('panel');const hidden=panel.hidden;dom.emit($('test-controls-toggle'),'click');assert(panel.hidden!==hidden,'Panel toggle');dom.emit($('test-controls-toggle'),'click');
 $('wind').value='20';dom.emit($('wind'),'input');assert(lab.wind===20,'Wind slider');$('wind').value='5';dom.emit($('wind'),'input');
 $('pov').checked=true;dom.emit($('pov'),'change');const q=camera.quaternion.clone();await $('view').requestPointerLock();dom.emit(document,'mousemove',{movementX:40,movementY:5});assert(!q.equals(camera.quaternion),'First person mouse look');document.exitPointerLock();$('pov').checked=false;dom.emit($('pov'),'change');dom.emit($('home'),'click');
 const before=camera.position.clone();dom.emit($('view'),'pointerdown',{pointerId:1,pointerType:'mouse',button:0,clientX:80,clientY:80,buttons:1});dom.emit($('view'),'pointermove',{pointerId:1,pointerType:'mouse',button:0,clientX:120,clientY:90,buttons:1});dom.emit($('view'),'pointerup',{pointerId:1,pointerType:'mouse',button:0,clientX:120,clientY:90,buttons:0});controls.update();assert(before.distanceTo(camera.position)>1e-5,'Orbit drag');dom.emit($('home'),'click');
 report.checks.push({name:'panel, wind, first-person mouse capture and orbit input',pass:true});
 for(const [i,kind] of ['glass','mirror','rock','light'].entries()){lab.objectRadius=.3;const b=lab.spawn(kind,[-2+i*1.3,3,1],[0,0,-1],i%2?'cup':'sphere');b.position=[-2+i*1.3,2.3,0];b.velocity.fill(0);}
 lab.sand.carve([0,lab.sand.height(0,3),3],.4);lab.rain.enabled=true;lab.rain.rate=80;lab.tannins=.6;lab.syncUniforms();lab.revision++;
 for(let i=0;i<8;i++){await step();draw.render({dt:lab.timestep,adaptive:false});await renderer.flush();}
 await frame('objects-rain-carving');
 dom.emit($('bulk-field-view'),'click');assert(!$('bulk-field-debug').hidden,'Field debug show');ui.build(640,400);assert(dom.canvasImage($('bulk-field-canvas')),'Native 2D field visualizer');report.checks.push({name:'field slices rendered',pass:true});
 lab.tannins=0;lab.day=14;camera.position.set(0,.55,0);camera.lookAt(0,.8,-2);camera.updateMatrixWorld();lab.syncUniforms();lab.revision++;await frame('underwater-day');
 lab.day=23;lab.syncUniforms();lab.revision++;await frame('underwater-night');
 lab.configure('ocean');lab.day=14;lab.rain.enabled=false;lab.bulkFields.particleBackend='connected';dom.emit($('home'),'click');await step();await frame('reset');
 report.pass=true;reports.checks=report.checks;await Deno.writeTextFile(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({pass:true,checks:report.checks.length}));await shutdown();Deno.exit(0);
}});
