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
   if(!state){const original=material.onBeforeCompile,cacheKey=material.customProgramCacheKey();state={key,constants,original,cacheKey};states.set(material,state);
    material.onBeforeCompile=(shader,r)=>{original.call(material,shader,r);shader.vertexShader=specializeSource(shader.vertexShader,state.constants);shader.fragmentShader=specializeSource(shader.fragmentShader,state.constants);};
    material.customProgramCacheKey=()=>cacheKey+state.key;material.needsUpdate=true;
   }else if(key!==state.key){state.key=key;state.constants=constants;material.needsUpdate=true;}
  }});
 };
 const warmed=new WeakMap(),pending=new Set();let warmFailure=null;
 const warm=(scene,camera)=>{
  if(warmFailure)throw warmFailure;if(!renderer.compileAsync)return;let needed=false;const replacements=new Map();
  scene.traverse(object=>{for(const material of (Array.isArray(object.material)?object.material:[object.material])){
   if(!material?.isShaderMaterial||material.userData?.skipObjectWarmup||material.uniforms.uBodyCount?.value!==0)return;
   const constants=programConstants(material.uniforms,enabled(),true),key=JSON.stringify(constants);let keys=warmed.get(material);
   if(!keys)warmed.set(material,keys=new Map());
   if(!keys.has(key)){
    let copy=material;
    if(scene.clone&&material.clone){
     const state=states.get(material),original=state?.original??material.onBeforeCompile,cacheKey=state?.cacheKey??material.customProgramCacheKey();
     copy=material.clone();copy.uniforms=material.uniforms;
     copy.onBeforeCompile=(shader,r)=>{original.call(copy,shader,r);shader.vertexShader=specializeSource(shader.vertexShader,constants);shader.fragmentShader=specializeSource(shader.fragmentShader,constants);};
     copy.customProgramCacheKey=()=>cacheKey+key;
    }
    keys.set(key,copy);needed=true;
   }
   replacements.set(material,keys.get(key));
  }});
  if(!needed)return;
  // compileAsync polls a material's currentProgram. Sharing live materials
  // lets the next empty-scene frame replace that with the already-ready lean
  // program, falsely completing warmup. Keep immutable compilation materials
  // alive so the actual object programs are ready before their first use.
  const compilation=scene.clone?scene.clone(true):scene;
  if(compilation!==scene)compilation.traverse(object=>{if(Array.isArray(object.material))object.material=object.material.map(m=>replacements.get(m)||m);else if(replacements.has(object.material))object.material=replacements.get(object.material);});
  else prepare(scene,true);
  const work=renderer.compileAsync(compilation,camera).catch(error=>{warmFailure??=error;}).finally(()=>{pending.delete(work);if(compilation===scene)prepare(scene);});pending.add(work);
 };
 renderer.render=(scene,camera)=>{prepare(scene);const result=render(scene,camera);warm(scene,camera);return result;};
 // Include compute passes as they first execute: their specialization depends
 // on the solver/boundary settings selected at that time. No fake body and no
 // changed simulation uniforms. Empty scenes retain their lean programs.
 renderer.warmObjectPrograms=async(scenes,camera)=>{
  for(const scene of scenes)warm(scene,camera);await Promise.all([...pending]);if(warmFailure)throw warmFailure;
 };
}
