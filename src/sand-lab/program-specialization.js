// Compile out absent features instead of carrying every historical station and
// empty object loop through register-heavy ray/particle shaders. The selected
// values are uniforms for the whole draw; this does not change sample counts.
export function programConstants(uniforms,enabled=true,objectCapable=false){
 if(!enabled)return {};
 const c={};
 if(uniforms.uStation)c.uStation=['int',uniforms.uStation.value];
 if(!objectCapable&&uniforms.uBodyCount?.value===0)c.uBodyCount=['int',0];
 if(uniforms.uSandCount){const lo=uniforms.uSandMin?.value,hi=uniforms.uSandMax?.value;
  if(uniforms.uSandCount.value===0||(lo&&hi&&lo.x===hi.x&&lo.y===hi.y&&lo.z===hi.z))c.uSandCount=['int',0];
 }
 for(const name of ['uFieldLinear','uFieldSkipping','uFlowLinear','uFlowSkipping'])if(uniforms[name])c[name]=['bool',!!uniforms[name].value];
 if(uniforms.uPass)c.uPass=['int',uniforms.uPass.value];
 for(const name of ['uCollision','uBoundaryDensity','uReuseBoundary','uPackedGpuNeighbors','uReuseSurfaceLight'])if(uniforms[name])c[name]=['bool',!!uniforms[name].value];
 return c;
}
export function specializeSource(source,constants){
 source=source.replace(/uniform\s+((?:highp\s+|mediump\s+|lowp\s+)?)(int|bool)\s+([^;]+);/g,(declaration,precision,type,names)=>{
  const list=names.split(',').map(n=>n.trim());if(!list.some(n=>constants[n]))return declaration;
  return list.map(name=>constants[name]?`const ${type} ${name}=${constants[name][1]};`:`uniform ${precision}${type} ${name};`).join(' ');
 });
 return source;
}
export function installProgramSpecialization(renderer,enabled){
 const render=renderer.render.bind(renderer),states=new WeakMap();
 const prepare=(scene,objectCapable=false)=>{
  scene.traverse(object=>{for(const material of (Array.isArray(object.material)?object.material:[object.material])){
   if(!material?.isShaderMaterial)continue;
   const constants=programConstants(material.uniforms,enabled(),objectCapable),key=JSON.stringify(constants);
   let state=states.get(material);
   if(!state){const original=material.onBeforeCompile,cacheKey=material.customProgramCacheKey();state={key,constants};states.set(material,state);
    material.onBeforeCompile=(shader,r)=>{original.call(material,shader,r);shader.vertexShader=specializeSource(shader.vertexShader,state.constants);shader.fragmentShader=specializeSource(shader.fragmentShader,state.constants);};
    material.customProgramCacheKey=()=>cacheKey+state.key;material.needsUpdate=true;
   }else if(key!==state.key){state.key=key;state.constants=constants;material.needsUpdate=true;}
  }});
 };
 const warmed=new WeakMap(),pending=new Set();
 const warm=(scene,camera)=>{
  if(!renderer.compileAsync)return;let needed=false;
  scene.traverse(object=>{for(const material of (Array.isArray(object.material)?object.material:[object.material])){
   if(!material?.isShaderMaterial||material.uniforms.uBodyCount?.value!==0)return;
   const key=JSON.stringify(programConstants(material.uniforms,enabled(),true));let keys=warmed.get(material);
   if(!keys)warmed.set(material,keys=new Set());if(!keys.has(key)){keys.add(key);needed=true;}
  }});
  if(!needed)return;prepare(scene,true);
  const work=renderer.compileAsync(scene,camera).finally(()=>{pending.delete(work);prepare(scene);});pending.add(work);
 };
 renderer.render=(scene,camera)=>{prepare(scene);const result=render(scene,camera);warm(scene,camera);return result;};
 // Include compute passes as they first execute: their specialization depends
 // on the solver/boundary settings selected at that time. No fake body and no
 // changed simulation uniforms. Empty scenes retain their lean programs.
 renderer.warmObjectPrograms=async(scenes,camera)=>{
  for(const scene of scenes)warm(scene,camera);await Promise.all([...pending]);
 };
}
