import {installDOM} from './dom.js';
import {NativeUI} from './ui.js';
import {NativeCompiler} from './compiler.js';
import {openWindow} from './window.js';
import {nativeSurfaceContext} from './surface.js';
import {deferredQueueCompletion} from './completion.js';

// Run the shared application unchanged against native wgpu. No Chromium canvas,
// scene-command IPC, or CPU pixel readback is used for normal presentation.
export async function runNative(options={}){
 const width=Math.max(160,Math.min(1920,options.width||960)),height=Math.max(100,Math.min(1080,options.height||600)),root=new URL('../',import.meta.url),started=performance.now();
 let app,win,surface,context,ui,dom,stopped=false,suspended=false,nativeBusy=false,pendingSize,ready=false,frames=0,buttons=0,lastFrame=0,lastProgress=0;
 const reports={runtime:Deno.version,completion:options.completion==='immediate'?'immediate':'deferred',frames:[],events:[],started:new Date().toISOString()};
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{const url=String(input?.url||input);if(url.startsWith('/')||url.startsWith('file:')){const file=url.startsWith('file:')?new URL(url):new URL(url.startsWith('/vendor/')?'public'+url:url.slice(1),root);const bytes=await Deno.readFile(file);return new Response(bytes,{headers:{'content-type':url.endsWith('.wasm')?'application/wasm':'application/octet-stream'}});}return originalFetch(input,init);};
 const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw Error('No native wgpu adapter. No scene was submitted.');
 reports.adapter=Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,adapter.info[k]]));
 if(!options.headless){win=openWindow({width,height});surface=win.surface;context=nativeSurfaceContext(surface,()=>console.log('Native window reconfigure',win.status()));for(let i=0;i<5;i++){win.poll(()=>{});await new Promise(r=>setTimeout(r,20));}}
 let outputTexture;
 const nativeContext=options.headless?{configure(config){this.device=config.device;this.format=config.format;},getCurrentTexture(){if(!outputTexture||outputTexture.width!==innerWidth||outputTexture.height!==innerHeight){outputTexture?.destroy();outputTexture=this.device.createTexture({size:[innerWidth,innerHeight],format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});}return outputTexture;}}:context;
 dom=installDOM({width,height,getContext:()=>nativeContext,lock:v=>win?.lock(v),navigate:url=>{ui.error='Historical browser snapshots remain at localhost:5173/'+url;ui.dirty=true;}});
 location.search=`?scene=sand-lab&renderer=webgpu&backend=${options.backend||(/RTX/i.test(adapter.info.description||'')?'gpu':'safe')}&paused=1`;
 ui=new NativeUI(dom);const compiler=new NativeCompiler();
 let rafSerial=0;const rafs=new Map();globalThis.requestAnimationFrame=callback=>{const id=++rafSerial;const invoke=()=>{if(stopped){rafs.delete(id);return;}if(suspended){rafs.set(id,setTimeout(invoke,50));return;}if(pendingSize&&!nativeBusy){const [w,h]=pendingSize;pendingSize=null;surface.width=w;surface.height=h;dom.resize(w,h);ui.dirty=true;}rafs.delete(id);callback(performance.now());};rafs.set(id,setTimeout(invoke,Math.max(1,16.667-(performance.now()-lastFrame))));return id;};globalThis.cancelAnimationFrame=id=>{clearTimeout(rafs.get(id));rafs.delete(id);};
 const shutdown=async()=>{if(stopped)return;stopped=true;clearInterval(pump);for(const t of rafs.values())clearTimeout(t);rafs.clear();reports.diagnostics=document.getElementById('diagnostics')?.textContent;reports.validation=document.getElementById('verification')?.textContent;reports.field=app?.lab.bulkFields?.stats;reports.render=app?.renderer.frameTimes;reports.contextLost=!!app?.renderer.failure;dom.emit(dom.events,'pagehide');ui.dispose();compiler.stop();outputTexture?.destroy();win?.close();reports.finished=new Date().toISOString();if(options.report)await Deno.writeTextFile(options.report,JSON.stringify(reports,null,2));};
 function fail(error){reports.error=String(error.stack||error);ui.error=String(error.message||error);ui.status='Stopped';console.error(reports.error);shutdown().then(()=>{if(options.exit)Deno.exit(1);});}
 globalThis.addEventListener('unhandledrejection',e=>{e.preventDefault();fail(e.reason);});
 const keyInfo=(n,mac)=>{let key=n===27?'Escape':n===13?'Enter':n===8||n===127?'Backspace':n===16?'Shift':n===32?' ':String.fromCharCode(n);const letter=/^[a-z]$/i.test(key)?key.toUpperCase():null;return {key,code:letter?'Key'+letter:key===' '?'Space':key==='Shift'?'ShiftLeft':key};};
 const pump=setInterval(()=>{if(stopped)return;win?.poll(e=>{
  const [kind,x,y,dx,dy,button,key,mods]=e,canvas=dom.document.getElementById('view');if(!canvas)return;
  if(kind===9){shutdown().then(()=>Deno.exit(0));return;}if(kind===8){document.exitPointerLock();buttons=0;dom.emit(dom.events,'blur');return;}
  if(kind===7){if(x>0&&y>0&&x<=1920&&y<=1080)pendingSize=[x,y];return;}
  if(kind===5||kind===6){const k=keyInfo(key,win.mac);if(kind===5&&ui.key(k.key))return;if(k.key==='Escape')document.exitPointerLock();dom.emit(dom.events,kind===5?'keydown':'keyup',{...k,repeat:!!button,shiftKey:!!(mods&1),ctrlKey:!!(mods&2),altKey:!!(mods&4),metaKey:!!(mods&8)});return;}
  if(kind<1||kind>4)return;if(kind===2)buttons|=button===0?1:button===2?2:4;if(kind===3)buttons&=~(button===0?1:button===2?2:4);
  const props={clientX:x,clientY:y,pageX:x,pageY:y,movementX:dx,movementY:dy,button,buttons,pointerId:1,pointerType:'mouse',isPrimary:true,deltaX:dx,deltaY:dy,deltaMode:0,shiftKey:!!(mods&1),ctrlKey:!!(mods&2),altKey:!!(mods&4),metaKey:!!(mods&8)};
  if(!document.pointerLockElement&&ui.pointer(['','move','down','up','wheel'][kind],x,y,dy,props))return;
  if(document.pointerLockElement&&kind===1)dom.emit(document,'mousemove',props);else dom.emit(canvas,['','pointermove','pointerdown','pointerup','wheel'][kind],props);
 });if(win&&!stopped){const status=win.status(),hidden=!status[0]||!(win.mac?status[1]&2:status[1]);if(hidden!==suspended){suspended=hidden;document.hidden=hidden;document.visibilityState=hidden?'hidden':'visible';dom.emit(document,'visibilitychange');}}},8);
 const boot={rendererOptions:{compiler,timestamps:true,splitWideTargets:true,queueCompletion:options.completion==='immediate'?undefined:deferredQueueCompletion},
  configureLab(lab,renderer){lab.resolutions.ocean=options.resolution||1.4;lab.configure('ocean');document.getElementById('quality').value=lab.resolutions.ocean;
   if(surface){surface.width=width;surface.height=height;}
   ui.ready=ui.init(renderer.device,renderer.format);
  },
  attach(value){app=value;reports.samples=app.lab.count;reports.backend='native wgpu';
   const flush=app.renderer.flush.bind(app.renderer);app.renderer.flush=async args=>{const display=app.renderer.commands.some(c=>c.type==='draw'&&!c.state),start=performance.now();nativeBusy=true;try{await flush(args);if(display&&!stopped){if(ui.pipeline&&!suspended)await ui.draw(nativeContext,innerWidth,innerHeight);context?.present();lastFrame=performance.now();frames++;if(ready){reports.totalFrames=(reports.totalFrames||0)+1;reports.frames.push({wall:lastFrame,simulation:app.lab.time,frameMs:lastFrame-start,renderMs:app.renderer.frameTimes?.total,physics:app.lab.prepareTimes,field:app.lab.bulkFields?.stats?.backend});if(reports.frames.length>2048)reports.frames.splice(0,256);}if(options.frames&&ready&&reports.totalFrames>=options.frames){app.lab.paused=true;await capture();await shutdown();if(options.exit)Deno.exit(0);}}}finally{nativeBusy=false;}};
  },
  async step(stage){console.log(stage);ui.status=stage;ui.dirty=true;if(ui.ready&&surface&&!suspended&&performance.now()-lastProgress>250){lastProgress=performance.now();await ui.ready;await ui.draw(nativeContext,innerWidth,innerHeight);context.present();}await new Promise(r=>setTimeout(r,1));},mark(stage){ui.status=stage;ui.dirty=true;},pass(){},hold(stage){ui.status=stage;},fail,
  finish(){ready=true;reports.readySeconds=(performance.now()-started)/1000;console.log('Native scene ready');ui.status=(Deno.build.os==='darwin'?'Metal':'DX12 / Vulkan')+' · 60 FPS cap';ui.dirty=true;if(options.play){app.lab.paused=false;document.getElementById('pause').textContent='Pause';}Promise.resolve(options.onReady?.({app,dom,ui,reports,capture,shutdown})).catch(fail);}
 };
 async function capture(path=options.screenshot){if(!path)return;const {renderer,field}=app,target=field.target,pixels=new Float32Array(target.width*target.height*4);await renderer.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,pixels);const {createCanvas,ImageData}=await import('@napi-rs/canvas'),image=createCanvas(target.width,target.height),bytes=new Uint8ClampedArray(pixels.length);for(let i=0;i<pixels.length;i+=4){for(let k=0;k<3;k++){const v=Math.max(0,pixels[i+k]);bytes[((target.height-1-Math.floor(i/4/target.width))*target.width+(i/4)%target.width)*4+k]=Math.round(255*Math.pow(v/(.7+v),1/2.2));}bytes[i+3]=255;}image.getContext('2d').putImageData(new ImageData(bytes,target.width,target.height),0,0);await Deno.writeFile(path,image.toBuffer('image/png'));}
 try{const {startRTXApp}=await import('../.native/generated/scene.mjs');await startRTXApp(boot);}catch(e){fail(e);}
 return {get app(){return app;},dom,ui,reports,capture,shutdown};
}
