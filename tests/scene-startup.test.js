import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {loadScene} from '../src/scene-startup.js';

function observer(){const events=[];return {events,mark:s=>events.push(['mark',s]),fail:e=>events.push(['fail',e.message]),report:()=>events.push(['report']),watchLegacy:()=>events.push(['legacy'])};}
test('module failures and async scene initialization failures reach visible startup diagnostics',async()=>{
 for(const phase of ['download','initialize']){
  const boot=observer(),error=Error(phase==='download'?'Failed to fetch scene module':'WebGL initialization failed');
  const result=await loadScene(new URLSearchParams(),boot,async()=>{if(phase==='download')throw error;return {startRTXApp:async()=>{throw error;}};});
  assert.equal(result,'failed');assert.deepEqual(boot.events.at(-1),['fail',error.message]);
 }
});
test('report mode never imports a scene or requests graphics',async()=>{
 const boot=observer();let loads=0;
 assert.equal(await loadScene(new URLSearchParams('startup=report'),boot,()=>{loads++;throw Error('must not load');}),'report');
 assert.equal(loads,0);assert.deepEqual(boot.events,[['report']]);
});
test('root and explicit sand URLs start the RTX app, while safe and snapshot URLs retain their implementations',async()=>{
 for(const [query,expected] of [['','rtx'],['scene=sand-lab','rtx'],['scene=sand-lab&profile=safe','safe'],['scene=water-lab','snapshot']]){
  const boot=observer(),loaded=[];let starts=0;
  assert.equal(await loadScene(new URLSearchParams(query),boot,async kind=>{loaded.push(kind);return {async startRTXApp(){starts++;}};}),expected);
  assert.deepEqual(loaded,[expected]);assert.equal(starts,expected==='rtx'?1:0);
  assert.equal(boot.events.some(([e])=>e==='legacy'),expected!=='rtx');
 }
});

const monitorSource=await readFile(new URL('../public/startup-monitor.js',import.meta.url),'utf8');
function monitor(storage=new Map(),search=''){
 const listeners={},roots=[];let timers=0;
 function element(tag){return {tagName:tag.toUpperCase(),style:{},children:[],isConnected:false,textContent:'',setAttribute(){},appendChild(e){this.children.push(e);e.isConnected=this.isConnected;return e;},querySelector(selector){const find=o=>o.id===selector.slice(1)?o:o.children.map(find).find(Boolean);return find(this);},remove(){this.isConnected=false;}};}
 const body=element('body');body.isConnected=true;body.appendChild=e=>{roots.push(e);e.isConnected=true;};
 const document={body,createElement:element,getElementById:id=>roots.filter(e=>e.isConnected).map(e=>e.querySelector('#'+id)).find(Boolean)};
 const window={addEventListener:(name,fn)=>listeners[name]=fn};
 runInNewContext(monitorSource,{window,document,navigator:{userAgent:'test Chrome Windows'},location:{href:'http://localhost/?scene=sand-lab',search},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setInterval:()=>++timers,clearInterval:()=>--timers,requestAnimationFrame:fn=>queueMicrotask(fn),MutationObserver:class{observe(){}disconnect(){}}});
 return {boot:window.__bardoStartup,storage,document,listeners,get timers(){return timers;}};
}
test('classic bootstrap preserves the last operation across a page reload before any module starts',()=>{
 const first=monitor();first.boot.mark('First frame · render-backgroundScene-0');
 const saved=[...first.storage.values()][0],second=monitor(first.storage,'?startup=report');second.boot.report();
 const text=second.document.getElementById('startup-stage').textContent;
 assert.match(text,/render-backgroundScene-0/);assert.match(text,/startup-v4/);assert.equal(second.timers,0);
 assert.equal([...first.storage.values()][0],saved);
});
test('unhandled early promise rejection is shown and preserved even when the scene replaces the body',()=>{
 const m=monitor();m.document.getElementById('startup-diagnostics').remove();
 m.listeners.unhandledrejection({reason:Error('Failed to fetch dynamically imported module: /src/rtx-sand-lab/main.js')});
 assert.match(m.document.getElementById('startup-stage').textContent,/Failed to fetch dynamically imported module/);
 const saved=JSON.parse([...m.storage.values()][0]);assert.equal(saved.status,'failed');assert.match(saved.error,/rtx-sand-lab/);assert.equal(m.timers,0);
});
test('finished startup stops recording drawing passes and dismisses its panel',async()=>{
 const m=monitor();await m.boot.step('Creating WebGL 2 context');m.boot.finish();
 const saved=[...m.storage.values()][0];m.boot.pass({stage:'scene',programs:['display']});
 assert.equal([...m.storage.values()][0],saved);assert.equal(m.document.getElementById('startup-diagnostics'),undefined);assert.equal(m.timers,0);
});
