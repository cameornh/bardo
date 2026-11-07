// Large fixed ray loops contain further sand-bin, carve and lighting loops.
// Give the driver uniform loop bounds instead of inviting static expansion of
// those call trees. The supplied limits are EXACTLY the original literals;
// neither sampling precision nor the maximum amount of work is changed.
export function shaderLoopBounds(source){
 const limits={};
 const code=source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|\bfor\s*\(\s*int\s+(\w+)\s*=\s*0\s*;\s*\1\s*<\s*(\d+)\s*;/g,(match,index,bound)=>{
  if(!index||Number(bound)<24)return match;
  const name='uLiveLoop'+bound;limits[name]=Number(bound);
  return match.replace(new RegExp('<\\s*'+bound+'\\s*;'),'<'+name+';');
 });
 const declarations=Object.keys(limits).map(name=>'uniform int '+name+';').join('\n');
 return {source:declarations?'\n'+declarations+'\n'+code:source,limits};
}

export function installShaderLoopBounds(material){
 if(!material?.isShaderMaterial||material.userData.liveLoopBounds)return;
 material.userData.liveLoopBounds=true;
 // Install on the final shader so hardware compatibility and scene
 // specialization still see the original source and compose normally.
 const original=material.onBeforeCompile,cacheKey=material.customProgramCacheKey;
 material.onBeforeCompile=function(shader,renderer){
  original.call(this,shader,renderer);
  for(const stage of ['vertexShader','fragmentShader']){
   const bounded=shaderLoopBounds(shader[stage]);shader[stage]=bounded.source;
   for(const [name,value] of Object.entries(bounded.limits)){
    this.uniforms[name]??={value};if(shader.uniforms)shader.uniforms[name]=this.uniforms[name];
   }
  }
 };
 material.customProgramCacheKey=function(){return cacheKey.call(this)+'|live-unexpanded-loops-v1';};
 material.needsUpdate=true;
}
