// RTX-only diagnostics. A rejected optional pressure program falls back without
// poisoning healthy rendering; a lost context always stops all submissions.
export function installRTXGraphicsGuard(renderer,report,progress=()=>{}){
 let failure=null,active=[],stage='startup';const rejected=new WeakMap();
 const lost=()=>renderer.getContext().isContextLost();
 const stop=error=>{if(!failure){failure=error instanceof Error?error:new Error(String(error));report(failure);}return failure;};
 const assertHealthy=()=>{if(failure)throw failure;if(lost())throw stop(Error('Graphics context lost during '+stage+'. No further graphics work will be submitted.'));};
 function name(material){
  if(material.name)return material.name;
  let hash=2166136261;for(const c of material.fragmentShader||'')hash=Math.imul(hash^c.charCodeAt(0),16777619);
  return material.name='rtx-program-'+(hash>>>0).toString(16);
 }
 function materials(scene){const result=[];scene.traverse?.(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)result.push(m);});return result;}
 const handle=error=>{
  const e=error instanceof Error?error:Error(String(error));
  if(lost()||!active.length||!active.every(m=>m.userData?.rtxOptionalCompute))return stop(e);
  for(const m of active)rejected.set(m,e);return e;
 };
 const draw=renderer.render.bind(renderer);
 renderer.render=(scene,...args)=>{
  assertHealthy();const previous=active;active=materials(scene);active.forEach(name);
  progress({stage,programs:active.map(name)});
  try{for(const m of active)if(rejected.has(m))throw rejected.get(m);return draw(scene,...args);}
  catch(error){throw handle(error);}finally{active=previous;}
 };
 renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{
  const source=gl.getShaderSource(fragment)||'',vertexSource=gl.getShaderSource(vertex)||'';
  const shader=active.map(name).join(', ')||source.match(/#define SHADER_NAME ([^\n]+)/)?.[1]||stage;
  const logs=[gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n');
  const detail={stage,program:shader,vertexCompiled:gl.getShaderParameter(vertex,gl.COMPILE_STATUS),fragmentCompiled:gl.getShaderParameter(fragment,gl.COMPILE_STATUS),linked:gl.getProgramParameter(program,gl.LINK_STATUS),contextLost:gl.isContextLost(),glError:gl.getError(),vertexChars:vertexSource.length,fragmentChars:source.length};
  throw handle(Error('Graphics shader failed: '+shader+'\n'+(logs||'The driver returned no compiler log.')+'\n'+JSON.stringify(detail,null,2)));
 };
 renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();stop(Error('Graphics context lost during '+stage+'. No further graphics work will be submitted.'));});
 return {get failed(){return !!failure;},stop,assertHealthy,stage(value){stage=value;},
  label(owner,prefix){
   // Label direct scenes and materials, including named subsystems. Do not walk
   // arbitrary THREE graphs or uniforms, which contain shared/cyclic resources.
   const visit=(o,path,depth)=>{for(const [key,value] of Object.entries(o||{})){
    if(value?.isMaterial){if(!value.name)value.name=path+'-'+key;}
    else if(value?.isScene)materials(value).forEach((m,i)=>{if(!m.name)m.name=path+'-'+key+'-'+i;});
    else if(depth&&value?.constructor?.name&&value.constructor.name!=='Object'&&!value.isObject3D&&!value.isTexture&&!value.isWebGLRenderTarget&&!ArrayBuffer.isView(value)&&!Array.isArray(value)&&!['renderer','field','lab','camera','u','uniforms'].includes(key))visit(value,path+'-'+key,depth-1);
   }};visit(owner,prefix,1);
  }};
}
