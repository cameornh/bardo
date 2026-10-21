// Compile out absent features instead of carrying every historical station and
// empty object loop through register-heavy ray/particle shaders. The selected
// values are uniforms for the whole draw; this does not change sample counts.
export function programConstants(uniforms,enabled=true){
 if(!enabled)return {};
 const c={};
 if(uniforms.uStation)c.uStation=['int',uniforms.uStation.value];
 if(uniforms.uBodyCount?.value===0)c.uBodyCount=['int',0];
 if(uniforms.uSandCount){const lo=uniforms.uSandMin?.value,hi=uniforms.uSandMax?.value;
  if(uniforms.uSandCount.value===0||(lo&&hi&&lo.x===hi.x&&lo.y===hi.y&&lo.z===hi.z))c.uSandCount=['int',0];
 }
 for(const name of ['uFieldLinear','uFieldSkipping','uFlowLinear','uFlowSkipping'])if(uniforms[name])c[name]=['bool',!!uniforms[name].value];
 if(uniforms.uPass)c.uPass=['int',uniforms.uPass.value];
 for(const name of ['uCollision','uBoundaryDensity','uReuseBoundary'])if(uniforms[name])c[name]=['bool',!!uniforms[name].value];
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
 renderer.render=(scene,camera)=>{
  scene.traverse(object=>{for(const material of (Array.isArray(object.material)?object.material:[object.material])){
   if(!material?.isShaderMaterial)continue;
   const constants=programConstants(material.uniforms,enabled()),key=JSON.stringify(constants);
   let state=states.get(material);
   if(!state){const original=material.onBeforeCompile,cacheKey=material.customProgramCacheKey();state={key,constants};states.set(material,state);
    material.onBeforeCompile=(shader,r)=>{original.call(material,shader,r);shader.vertexShader=specializeSource(shader.vertexShader,state.constants);shader.fragmentShader=specializeSource(shader.fragmentShader,state.constants);};
    material.customProgramCacheKey=()=>cacheKey+state.key;material.needsUpdate=true;
   }else if(key!==state.key){state.key=key;state.constants=constants;material.needsUpdate=true;}
  }});
  return render(scene,camera);
 };
}
