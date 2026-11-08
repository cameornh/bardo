export class SceneShaderCompiler{
 constructor(){this.worker=new Worker(new URL('./compiler-worker.js',import.meta.url),{type:'module'});this.serial=0;this.pending=new Map();this.cache=new Map();this.worker.onmessage=({data})=>{const p=this.pending.get(data.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data);};this.worker.onerror=e=>this.stop(Error('Worker load failed: '+[e.message,e.filename,e.lineno,e.error].join(' ')));}
 compile(vertex,fragment,defines={},samplerGroups={}){
  const key=vertex+'\n'+fragment+'\n'+JSON.stringify([defines,samplerGroups]);if(this.cache.has(key))return this.cache.get(key);
  const id=++this.serial,promise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.stop(Error('Shader translation exceeded its time budget')),30000);this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({id,vertex,fragment,defines,samplerGroups});});this.cache.set(key,promise);return promise;
 }
 stop(error=Error('Shader compiler stopped')){this.worker.terminate();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
}
