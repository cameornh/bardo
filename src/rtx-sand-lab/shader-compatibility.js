// Render targets and simulation textures have only level zero. Using implicit
// derivatives for them inside divergent ray/geometry loops asks ANGLE's D3D
// compiler to unroll loops on some backends, despite no mip level to pick.
// Explicit level zero preserves filtering and samples, without derivatives.
import {compactMacroReduction,MACRO_REDUCTION_SAMPLES} from './macro-reduction.js';
export function explicitTextureLevel(source,names){
 const eligible=new Set(names),edits=[];
 // Match comments as well so text inside them can never be rewritten.
 const tokens=/\/\*[\s\S]*?\*\/|\/\/[^\n]*|\btexture\s*\(\s*([A-Za-z_]\w*)\s*,/g;
 for(const match of source.matchAll(tokens)){
  if(!match[1]||!eligible.has(match[1]))continue;
  const open=source.indexOf('(',match.index);let depth=1,commas=0,end=open+1;
  for(;end<source.length&&depth;end++){
   const c=source[end];if(c==='(')depth++;else if(c===')')depth--;else if(c===','&&depth===1)commas++;
  }
  if(depth||commas!==1)continue; // Do not reinterpret bias/other overloads.
  edits.push([match.index,match.index+7,'textureLod'],[end-1,end-1,',0.0']);
 }
 edits.sort((a,b)=>b[0]-a[0]);for(const [from,to,text] of edits)source=source.slice(0,from)+text+source.slice(to);
 return source;
}

export function installRTXShaderCompatibility(renderer){
 const draw=renderer.render.bind(renderer),states=new WeakMap();
 const prepare=scene=>{
  scene.traverse?.(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){
   if(!m?.isShaderMaterial)continue;
   const reduced=compactMacroReduction(m.fragmentShader);
   if(reduced!==m.fragmentShader){m.fragmentShader=reduced;m.uniforms.uReductionSamples={value:MACRO_REDUCTION_SAMPLES};m.needsUpdate=true;}
   // Null data samplers are populated after field allocation. Treat them as
   // level-zero samplers now, so compilation matches the first real draw.
   const samplers=new Set();for(const match of (m.vertexShader+'\n'+m.fragmentShader).matchAll(/uniform\s+(?:(?:highp|mediump|lowp)\s+)?sampler2D\s+([^;]+);/g))for(const n of match[1].split(','))samplers.add(n.trim());
   const names=Object.entries(m.uniforms).filter(([n,u])=>(u.value==null&&samplers.has(n))||(u.value?.isTexture&&u.value.generateMipmaps===false&&!u.value.mipmaps?.length)).map(([name])=>name).sort(),key=names.join(',');
   let state=states.get(m);
   if(!state){
    state={key,names};states.set(m,state);const original=m.onBeforeCompile,cache=m.customProgramCacheKey;
    m.onBeforeCompile=function(shader,r){original.call(this,shader,r);shader.vertexShader=explicitTextureLevel(shader.vertexShader,state.names);shader.fragmentShader=explicitTextureLevel(shader.fragmentShader,state.names);};
    m.customProgramCacheKey=function(){return cache.call(this)+'|rtx-level-zero:'+state.key;};m.needsUpdate=true;
   }else if(key!==state.key){state.key=key;state.names=names;m.needsUpdate=true;}
  }});
 };
 renderer.render=(scene,...args)=>{prepare(scene);return draw(scene,...args);};
 if(renderer.compile){const compile=renderer.compile.bind(renderer);renderer.compile=(scene,...args)=>{prepare(scene);return compile(scene,...args);};}
}
