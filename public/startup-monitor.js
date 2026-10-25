/* Runs before the module graph. Module download/parse failures must be visible. */
(function () {
 'use strict';
 var key='bardo-startup-v3',revision='startup-v3',started=Date.now(),previous=null,storage=null,reportMode=/[?&]startup=report(?:&|$)/.test(location.search);
 try {storage=localStorage;} catch (_) {try {storage=sessionStorage;} catch (_) {}}
 try {previous=JSON.parse(storage.getItem(key)||'null');} catch (_) {}
 var state={revision:revision,url:location.href,browser:navigator.userAgent,started:new Date(started).toISOString(),status:'starting',stage:'Loading scene dispatcher',history:[]};
 var panel,timer,last=started;
 function save(){if(reportMode)return;try {storage.setItem(key,JSON.stringify(state));} catch (_) {}}
 function ensurePanel(){
  if(panel&&panel.isConnected)return panel;
  panel=document.createElement('section');panel.id='startup-diagnostics';panel.setAttribute('role','status');
  panel.style.cssText='position:fixed;left:12px;top:12px;z-index:2147483647;max-width:min(650px,90vw);max-height:85vh;overflow:auto;padding:12px;background:#172127;color:#eef4f7;border:1px solid #81949e;font:14px/1.4 system-ui;white-space:normal';
  var title=document.createElement('strong');title.textContent='Startup diagnostics · '+revision;panel.appendChild(title);
  var line=document.createElement('pre');line.id='startup-stage';line.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';panel.appendChild(line);
  var copy=document.createElement('button');copy.textContent='Copy startup report';copy.onclick=function(){
   var text=JSON.stringify({current:state,previous:previous},null,2);
   if(navigator.clipboard)navigator.clipboard.writeText(text).then(function(){copy.textContent='Copied';},function(){line.textContent=text;});else line.textContent=text;
  };panel.appendChild(copy);
  var health=document.createElement('a');health.href='/graphics-health.html';health.textContent='Graphics-only check';health.style.cssText='color:#c7eaff;margin-left:12px';panel.appendChild(health);
  document.body.appendChild(panel);return panel;
 }
 function display(text){ensurePanel().querySelector('#startup-stage').textContent=text;var old=document.getElementById('loading');if(old)old.textContent=state.stage;}
 function mark(label,detail){
  if(state.status==='failed'||state.status==='ready'||state.status==='report')return;
  last=Date.now();state.stage=label;state.history.push({ms:last-started,stage:label,detail:detail});if(state.history.length>80)state.history.shift();
  save();display(label+(detail?'\n'+JSON.stringify(detail,null,2):''));
 }
 function fail(error){
  if(state.status==='failed')return;
  state.status='failed';state.error=String(error&&error.stack||error&&error.message||error);save();clearInterval(timer);
  display('Stopped during: '+state.stage+'\n\n'+state.error);
 }
 function finish(){if(state.status==='failed')return;state.status='ready';state.stage='Scene ready';save();clearInterval(timer);if(panel)panel.remove();}
 window.__bardoStartup={revision:revision,mark:mark,fail:fail,finish:finish,
  step:function(label,detail){mark(label,detail);return new Promise(function(resolve){requestAnimationFrame(function(){requestAnimationFrame(resolve);});});},
  pass:function(info){if(state.status==='starting')mark('First frame · '+info.programs.join(', '),{stage:info.stage});},
  report:function(){state.status='report';clearInterval(timer);var view=document.getElementById('viewport');if(view)view.hidden=true;display('Saved previous attempt (no scene or graphics context started):\n\n'+JSON.stringify(previous,null,2));},
  watchLegacy:function(){
   var loading=document.getElementById('loading');
   function check(){if(loading&&loading.style.display==='none'){observer.disconnect();finish();}}
   var observer=new MutationObserver(check);if(loading)observer.observe(loading,{attributes:true});check();
  }
 };
 window.addEventListener('error',function(event){
  if(event.error||event.message)fail(event.error||new Error(event.message));
  else if(event.target&&event.target.tagName==='SCRIPT')fail(new Error('Script failed to load: '+event.target.src));
 },true);
 window.addEventListener('unhandledrejection',function(event){fail(event.reason||new Error('Module initialization rejected.'));});
 timer=setInterval(function(){if(state.status==='starting'&&Date.now()-last>15000)display('Still waiting during: '+state.stage+'\nCopy the startup report, or reopen /?startup=report to inspect the last operation after a stalled page.');},1000);
 mark(state.stage);
}());
