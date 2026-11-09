import {parseHTML} from 'linkedom';
import {createCanvas} from '@napi-rs/canvas';
export function installDOM({width,height,getContext,lock=()=>{},navigate=()=>{}}){
 const {document,window:dom}=parseHTML('<!doctype html><html><head></head><body></body></html>');
 const events=document.createElement('native-window');
 const attr=(proto,name,fallback='')=>Object.defineProperty(proto,name,{configurable:true,get(){return this.getAttribute(name)??fallback;},set(v){this.setAttribute(name,String(v));}});
 for(const name of ['min','max','step'])attr(dom.HTMLInputElement.prototype,name);
 Object.defineProperty(dom.HTMLInputElement.prototype,'checked',{configurable:true,get(){return this.hasAttribute('checked');},set(v){this.toggleAttribute('checked',!!v);}});
 Object.defineProperties(dom.HTMLSelectElement.prototype,{value:{configurable:true,get(){return [...this.options].find(o=>o.selected)?.value??this.options[0]?.value??'';},set(v){for(const o of this.options)o.selected=o.value===String(v);}},selectedOptions:{configurable:true,get(){return [...this.options].filter(o=>o.value===this.value);}},selectedIndex:{configurable:true,get(){return [...this.options].findIndex(o=>o.value===this.value);},set(i){this.value=this.options[i]?.value;}}});
 Object.defineProperty(dom.HTMLElement.prototype,'offsetParent',{configurable:true,get(){return this.closest('[hidden]')?null:this.parentElement;}});
 const canvases=new WeakMap(),p=dom.HTMLCanvasElement.prototype;
 for(const name of ['width','height'])Object.defineProperty(p,name,{configurable:true,get(){return Number(this.getAttribute(name)|| (this.id==='view'?(name==='width'?globalThis.innerWidth:globalThis.innerHeight):name==='width'?300:150));},set(v){this.setAttribute(name,v);const c=canvases.get(this);if(c)c[name]=v;}});
 p.getContext=function(type){if(this.id==='view'&&type==='webgpu')return getContext(this);if(type!=='2d')return null;let c=canvases.get(this);if(!c){c=createCanvas(this.width,this.height);canvases.set(this,c);}return c.getContext('2d');};
 p.getBoundingClientRect=function(){return this.nativeRect||{left:0,top:0,width:this.width,height:this.height,right:this.width,bottom:this.height};};
 Object.defineProperties(p,{clientWidth:{configurable:true,get(){return this.width;}},clientHeight:{configurable:true,get(){return this.height;}}});
 p.setPointerCapture=function(){};p.releasePointerCapture=function(){};p.hasPointerCapture=()=>false;p.focus=function(){};
 p.requestPointerLock=function(){document.pointerLockElement=this;lock(true);document.dispatchEvent(new dom.Event('pointerlockchange'));return Promise.resolve();};
 document.exitPointerLock=()=>{document.pointerLockElement=null;lock(false);document.dispatchEvent(new dom.Event('pointerlockchange'));};
 document.hidden=false;document.visibilityState='visible';
 globalThis.document=document;globalThis.window=events;globalThis.innerWidth=width;globalThis.innerHeight=height;globalThis.devicePixelRatio=1;
 globalThis.getComputedStyle=e=>({display:e.hidden?'none':e.style.display||'block',visibility:'visible'});
 globalThis.location={search:'?scene=sand-lab&renderer=webgpu&backend=gpu&paused=1',href:'bardo://sand-lab',origin:'bardo://local',assign:navigate};
 const emit=(target,type,props={})=>{const e=new dom.Event(type,{bubbles:true,cancelable:true});Object.assign(e,props);target.dispatchEvent(e);return e;};
 return {document,events,emit,canvasImage:e=>canvases.get(e),resize:(w,h)=>{globalThis.innerWidth=w;globalThis.innerHeight=h;emit(events,'resize');}};
}
